import { createDecartClient } from "@decartai/sdk";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import { streamLockRefs } from "@/lib/stream-sessions";
import {
  assertSameOrigin,
  enforceRateLimit,
  errorJson,
  privateJson,
  readJsonObject,
  refundRateLimit,
  requireAuthenticatedUser,
  RequestError,
} from "@/lib/server-security";

export const runtime = "nodejs";

const ALLOWED_MODELS = new Set(["lucy-2.5", "lucy-restyle-2", "lucy-vton-3.5"]);
const MAX_PREPAID_SESSION_SECONDS = 300;
const MINIMUM_STREAM_SECONDS = 60;

// The fal token is stored server-side and used only by the bounded relay.
const FAL_TOKEN_TTL_SECONDS = 120;

/**
 * fal.ai realtime endpoints per Savatar model. lucy-2.5 is the confirmed
 * realtime endpoint on fal; restyle/vton variants are not exposed on fal's
 * realtime API yet, so selecting those modes returns a clear 400 instead of
 * silently streaming the wrong model.
 */
const FAL_ENDPOINTS: Record<string, string> = {
  "lucy-2.5": "decart/lucy-2-5/realtime",
};

/** fal is the master provider once FAL_KEY is set and FAL_PROVIDER=1. */
function isFalProviderEnabled() {
  return process.env.FAL_PROVIDER === "1" && Boolean(process.env.FAL_KEY);
}

function permanentApiKey() {
  const value = process.env.DECART_API_KEY;
  if (!value) throw new Error("DECART_API_KEY is not configured");
  return value;
}

/**
 * Mint a short-lived, model-scoped JWT from fal's realtime token endpoint.
 * The provider relay uses this token; neither it nor FAL_KEY reaches the browser.
 *
 * Verified against the live API: the token that authenticates the realtime
 * WebSocket comes from POST /tokens/ with `allowed_apps` (the app alias, not
 * the full endpoint path) — the /tokens/realtime variant mints a JWT the WS
 * relay silently rejects. The response body is the JWT as a JSON string.
 */
async function mintFalRealtimeToken(endpoint: string, durationSeconds: number) {
  const falKey = process.env.FAL_KEY;
  if (!falKey) throw new Error("FAL_KEY is not configured");
  // The app alias is the SECOND path segment (e.g. "lucy-2-5" for
  // decart/lucy-2-5/realtime) — exactly what fal-js's parseEndpointId sends:
  // owner/alias/path. Taking the last segment would yield "realtime", which
  // the token relay rejects with Forbidden.
  const appAlias = endpoint.split("/")[1] ?? endpoint;
  const response = await fetch("https://rest.fal.ai/tokens/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Key ${falKey}`,
    },
    body: JSON.stringify({
      allowed_apps: [appAlias],
      token_expiration: durationSeconds,
    }),
  });
  if (!response.ok) {
    // A revoked/invalid FAL_KEY surfaces here. Without this wrapper the raw
    // Error falls into errorJson's 500 fallback and users see a useless
    // "Unexpected server error" instead of the actionable cause.
    throw new RequestError(
      502,
      response.status === 401 || response.status === 403
        ? "The AI provider rejected the stream authorization — the configured provider key is invalid or revoked."
        : `The AI provider could not authorize the stream (${response.status}).`,
    );
  }
  // Body is the bare JWT as a JSON string (fal-js also handles a wrapped
  // { detail } shape from older proxies, so accept both).
  const text = await response.text();
  const trimmed = text.trim();
  let token = trimmed;
  if (trimmed.startsWith("{")) {
    const obj = JSON.parse(trimmed) as { token?: string; detail?: string };
    token = obj.token ?? obj.detail ?? "";
  } else if (trimmed.startsWith('"')) {
    token = JSON.parse(trimmed) as string;
  }
  if (!token) throw new RequestError(502, "The AI provider returned an empty stream authorization.");
  // Decode the JWT's exp claim for a precise expiry.
  let expiresAtMs = Date.now() / 1000 + durationSeconds;
  try {
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp?: number };
    if (typeof claims.exp === "number") expiresAtMs = claims.exp;
  } catch {
    // Non-JWT body: keep the fallback expiry rather than crashing the route.
  }
  return {
    token,
    expiresAt: new Date(expiresAtMs * 1000),
  };
}

export async function POST(req: NextRequest) {
  let reservation: { sessionId: string; userId: string; seconds: number } | null = null;
  let db: ReturnType<typeof getAdminServices>["db"] | null = null;
  // Set only once the limiter has actually charged an attempt, so the failure
  // path hands one back without ever discounting a request the limiter refused
  // (a refusal consumed nothing).
  let rateLimitedUserId: string | null = null;
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    const body = await readJsonObject(req, 2_048);

    ({ db } = getAdminServices());

    if (body.renew === true) {
      throw new RequestError(400, "Token renewal is not supported for relayed sessions");
    }

    const model = typeof body.model === "string" ? body.model : "";
    if (!ALLOWED_MODELS.has(model)) throw new RequestError(400, "Unsupported realtime model");

    const provider = isFalProviderEnabled() ? "fal" : "decart";
    if (provider === "fal" && !FAL_ENDPOINTS[model]) {
      throw new RequestError(400, "This mode is not available on the configured AI provider.");
    }

    // Every authorization is a real reserve/settle cycle, and a provider that
    // rejects the session must
    // not lock the creator out of retrying. The wallet is the real cost bound,
    // so this only has to stop hammering.
    await enforceRateLimit(db, "realtime-token", user.uid, 10, 5 * 60_000);
    rateLimitedUserId = user.uid;

    const userRef = db.collection("users").doc(user.uid);
    const sessionId = randomUUID();
    const ticket = `${sessionId}.${randomBytes(32).toString("hex")}`;
    const sessionRef = db.collection("streamSessions").doc(sessionId);
    const transactionRef = db.collection("transactions").doc(`stream-${sessionId}`);
    const lockRefs = streamLockRefs(db);
    const reservationStartedAt = new Date();
    const reservedSeconds = await db.runTransaction(async (transaction) => {
      const lockSnapshots = await Promise.all(lockRefs.map((ref) => transaction.get(ref)));
      const userSnapshot = await transaction.get(userRef);
      const providerSlot = lockSnapshots.findIndex((snapshot) => {
        const lock = snapshot.data();
        const expiresAt = lock?.expiresAt?.toMillis?.();
        return !lock?.sessionId || !Number.isFinite(expiresAt) || expiresAt <= Date.now();
      });
      if (providerSlot < 0) {
        throw new RequestError(
          409,
          "All 5 AI stream slots are currently in use. Please wait a moment and try again.",
        );
      }
      const lockRef = lockRefs[providerSlot];
      const balanceSeconds = Math.floor(Number(userSnapshot.data()?.wallet?.balanceSeconds ?? 0));
      if (!userSnapshot.exists || !Number.isSafeInteger(balanceSeconds) || balanceSeconds < MINIMUM_STREAM_SECONDS) {
        throw new RequestError(402, "At least one minute of streaming credits is required");
      }

      const seconds = Math.min(balanceSeconds, MAX_PREPAID_SESSION_SECONDS);
      transaction.update(userRef, {
        "wallet.balanceSeconds": FieldValue.increment(-seconds),
        "wallet.totalUsed": FieldValue.increment(seconds),
      });
      transaction.set(sessionRef, {
        userId: user.uid,
        model,
        reservedSeconds: seconds,
        status: "reserved",
        providerSlot,
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(transactionRef, {
        userId: user.uid,
        type: "usage",
        seconds,
        sessionId,
        status: "reserved",
        createdAt: FieldValue.serverTimestamp(),
      });
      transaction.set(lockRef, {
        sessionId,
        userId: user.uid,
        provider,
        status: "reserving",
        expiresAt: new Date(reservationStartedAt.getTime() + 120_000),
        createdAt: FieldValue.serverTimestamp(),
      });
      return seconds;
    });
    reservation = { sessionId, userId: user.uid, seconds: reservedSeconds };

    const origin = req.headers.get("origin") ?? process.env.APP_ORIGIN ?? req.nextUrl.origin;
    const maxSessionDuration = reservedSeconds;
    const tokenDuration = Math.max(120, reservedSeconds + 120);

    let sessionTransport: string;
    const apiKey = ticket;
    let providerToken: string;
    // The Decart SDK returns expiresAt as a string; fal returns a Date.
    let tokenExpiresAt: Date | string;
    if (provider === "fal") {
      const endpoint = FAL_ENDPOINTS[model];
      if (!endpoint) {
        throw new RequestError(400, "This mode is not available on the fal provider yet.");
      }
      const falToken = await mintFalRealtimeToken(endpoint, FAL_TOKEN_TTL_SECONDS);
      sessionTransport = "fal-proxy-v1";
      providerToken = falToken.token;
      tokenExpiresAt = falToken.expiresAt;
    } else {
      const decart = createDecartClient({ apiKey: permanentApiKey() });
      const token = await decart.tokens.create({
        // Only the authenticated proxy receives this provider credential.
        expiresIn: tokenDuration,
        allowedModels: [model],
        allowedOrigins: [origin],
        constraints: { realtime: { maxSessionDuration } },
        metadata: { userId: user.uid, service: "savatar" },
      });
      sessionTransport = "proxy-v1";
      providerToken = token.apiKey;
      tokenExpiresAt = token.expiresAt;
    }

    // deadlineAt is the server-side hard deadline: activatedAt + reservedSeconds.
    // If the client never calls /api/streaming/end (closed tab, crash), a sweep
    // finalizes the session at this point and the full reservation is spent —
    // the same window the countdown shows, so overuse is impossible.
    const providerAuthorizedAt = new Date();
    const deadlineAt = new Date(providerAuthorizedAt.getTime() + reservedSeconds * 1000);
    await db.runTransaction(async (transaction) => {
      const freshSessionSnapshot = await transaction.get(sessionRef);
      const candidateSlot = Number(freshSessionSnapshot.data()?.providerSlot ?? 0);
      const providerSlot = Number.isInteger(candidateSlot) && candidateSlot >= 0 && candidateSlot < lockRefs.length
        ? candidateSlot
        : 0;
      const lockRef = lockRefs[providerSlot];
      const lockSnapshot = await transaction.get(lockRef);
      if (freshSessionSnapshot.data()?.status !== "reserved" || lockSnapshot.data()?.sessionId !== sessionId) {
        throw new RequestError(409, "The AI session reservation expired before it could start");
      }
      transaction.update(sessionRef, {
        status: "active",
        transport: sessionTransport,
      provider,
      providerToken,
      ticketHash: createHash("sha256").update(ticket).digest("hex"),
      ticketExpiresAt: new Date(Date.now() + 90_000),
      ...(provider === "fal" ? { providerEndpoint: FAL_ENDPOINTS[model] } : {}),
      allowedOrigin: origin,
      tokenExpiresAt,
      providerAuthorizedAt,
      activatedAt: FieldValue.serverTimestamp(),
      deadlineAt,
      });
      transaction.set(lockRef, {
        sessionId,
        userId: user.uid,
        provider,
        providerSlot,
        status: "active",
        expiresAt: deadlineAt,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    return privateJson({
      apiKey,
      expiresAt: tokenExpiresAt,
      maxSessionDuration,
      sessionId,
      provider,
      deadlineAt: deadlineAt.toISOString(),
    });
  } catch (error) {
    // Reverse reservations that failed before a usable relay ticket was returned.
    if (reservation && db) {
      const activeDb = db;
      const failedReservation = reservation;
      const sessionRef = activeDb.collection("streamSessions").doc(failedReservation.sessionId);
      const userRef = activeDb.collection("users").doc(failedReservation.userId);
      const transactionRef = activeDb.collection("transactions").doc(`stream-${failedReservation.sessionId}`);
      try {
        await activeDb.runTransaction(async (transaction) => {
          const session = await transaction.get(sessionRef);
          const providerSlot = Number(session.data()?.providerSlot ?? 0);
          const lockRef = streamLockRefs(activeDb)[Number.isInteger(providerSlot) && providerSlot >= 0 && providerSlot < 5 ? providerSlot : 0];
          const lock = await transaction.get(lockRef);
          if (session.data()?.status !== "reserved") return;
          transaction.update(userRef, {
            "wallet.balanceSeconds": FieldValue.increment(failedReservation.seconds),
            "wallet.totalUsed": FieldValue.increment(-failedReservation.seconds),
          });
          transaction.update(sessionRef, { status: "token_failed", releasedAt: FieldValue.serverTimestamp() });
          transaction.update(transactionRef, { status: "reversed", reversedAt: FieldValue.serverTimestamp() });
          if (lock.data()?.sessionId === failedReservation.sessionId) transaction.delete(lockRef);
        });
      } catch (cleanupError) {
        console.error("Realtime reservation cleanup failed:", cleanupError instanceof Error ? cleanupError.message : "unknown error");
      }
    }
    // The limiter already charged this attempt, but an authorization that never
    // handed back a usable relay ticket produced no session at all — a provider
    // rejecting the stream is not abuse, so give the attempt back instead of
    // burning the creator's allowance on retries.
    if (rateLimitedUserId && db) {
      try {
        await refundRateLimit(db, "realtime-token", rateLimitedUserId);
      } catch (refundError) {
        console.error("Rate limit refund failed:", refundError instanceof Error ? refundError.message : "unknown error");
      }
    }
    console.error("Realtime token error:", error instanceof Error ? error.message : "unknown error");
    return errorJson(error);
  }
}
