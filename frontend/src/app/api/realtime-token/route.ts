import { createDecartClient } from "@decartai/sdk";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import {
  assertSameOrigin,
  enforceRateLimit,
  errorJson,
  privateJson,
  readJsonObject,
  requireAuthenticatedUser,
  RequestError,
} from "@/lib/server-security";

export const runtime = "nodejs";

const ALLOWED_MODELS = new Set(["lucy-2.5", "lucy-restyle-2", "lucy-vton-3.5"]);
const MAX_PREPAID_SESSION_SECONDS = 300;
const MINIMUM_STREAM_SECONDS = 60;

/**
 * Short-lived fal realtime tokens. The fal relay keeps a session (and its
 * billed runner) alive until the token it was opened with expires — closing
 * the WebSocket alone does not free it. A short TTL plus client renewal
 * through this route is therefore the kill switch: once /api/streaming/end
 * marks the session completed, renewals are refused and the runner dies
 * within FAL_TOKEN_TTL_SECONDS even if the browser is already closed.
 */
const FAL_TOKEN_TTL_SECONDS = 90;

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
function useFalProvider() {
  return process.env.FAL_PROVIDER === "1" && Boolean(process.env.FAL_KEY);
}

function permanentApiKey() {
  const value = process.env.DECART_API_KEY;
  if (!value) throw new Error("DECART_API_KEY is not configured");
  return value;
}

/**
 * Mint a short-lived, model-scoped JWT from fal's realtime token endpoint.
 * The browser connects directly to wss://fal.run/<endpoint> with this token;
 * FAL_KEY itself never leaves this route.
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
    throw new Error(`fal token endpoint rejected the request (${response.status})`);
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
  if (!token) throw new Error("fal token endpoint returned no token");
  // Decode the JWT's exp claim for a precise expiry.
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")) as { exp?: number };
  return {
    token,
    expiresAt: new Date((claims.exp ?? Date.now() / 1000 + durationSeconds) * 1000),
  };
}

export async function POST(req: NextRequest) {
  let reservation: { sessionId: string; userId: string; seconds: number } | null = null;
  let db: ReturnType<typeof getAdminServices>["db"] | null = null;
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    const body = await readJsonObject(req, 2_048);

    ({ db } = getAdminServices());

    // ── Token renewal (fal path) ──────────────────────────────────────
    // Called by the client every ~81s while a session is live. Refuses once
    // the session is no longer active (ended / killed / swept), so a stopped
    // or dead browser's runner is released at the previous token's expiry.
    // No wallet movement here — the reservation happened at initial mint.
    if (body.renew === true) {
      const renewSessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      if (!renewSessionId) throw new RequestError(400, "sessionId is required for token renewal");
      const sessionRef = db.collection("streamSessions").doc(renewSessionId);
      const sessionSnapshot = await sessionRef.get();
      const session = sessionSnapshot.data();
      if (!sessionSnapshot.exists || !session) throw new RequestError(404, "Stream session not found");
      if (session.userId !== user.uid) throw new RequestError(403, "Not your stream session");
      if (session.status !== "active" || session.provider !== "fal") {
        throw new RequestError(409, "This stream session is no longer active");
      }
      const endpoint =
        typeof session.providerEndpoint === "string" ? session.providerEndpoint : FAL_ENDPOINTS[String(session.model ?? "")];
      if (!endpoint) throw new RequestError(400, "Session has no provider endpoint");
      const falToken = await mintFalRealtimeToken(endpoint, FAL_TOKEN_TTL_SECONDS);
      await sessionRef.update({ tokenExpiresAt: falToken.expiresAt });
      return privateJson({
        apiKey: falToken.token,
        expiresAt: falToken.expiresAt,
        sessionId: renewSessionId,
        provider: "fal",
        endpoint,
      });
    }

    const model = typeof body.model === "string" ? body.model : "";
    if (!ALLOWED_MODELS.has(model)) throw new RequestError(400, "Unsupported realtime model");

    await enforceRateLimit(db, "realtime-token", user.uid, 3, 5 * 60_000);

    const userRef = db.collection("users").doc(user.uid);
    const sessionId = randomUUID();
    const ticket = `${sessionId}.${randomBytes(32).toString("hex")}`;
    const sessionRef = db.collection("streamSessions").doc(sessionId);
    const transactionRef = db.collection("transactions").doc(`stream-${sessionId}`);
    const reservedSeconds = await db.runTransaction(async (transaction) => {
      const userSnapshot = await transaction.get(userRef);
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
      return seconds;
    });
    reservation = { sessionId, userId: user.uid, seconds: reservedSeconds };

    const origin = req.headers.get("origin") ?? process.env.APP_ORIGIN ?? req.nextUrl.origin;
    const maxSessionDuration = reservedSeconds;
    // Decart proxy path keeps a long-lived provider credential (no renewal
    // mechanism, and the proxy relays it server-side). The fal path uses a
    // SHORT token (FAL_TOKEN_TTL_SECONDS) renewed by the client through this
    // route, because fal's relay holds the billed runner until token expiry.
    const tokenDuration = Math.max(120, reservedSeconds + 120);

    const provider = useFalProvider() ? "fal" : "decart";
    let sessionTransport: string;
    let apiKey: string;
    // The Decart SDK returns expiresAt as a string; fal returns a Date.
    let tokenExpiresAt: Date | string;
    if (provider === "fal") {
      const endpoint = FAL_ENDPOINTS[model];
      if (!endpoint) {
        throw new RequestError(400, "This mode is not available on the fal provider yet.");
      }
      const falToken = await mintFalRealtimeToken(endpoint, FAL_TOKEN_TTL_SECONDS);
      sessionTransport = "fal-realtime";
      apiKey = falToken.token;
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
      apiKey = ticket;
      tokenExpiresAt = token.expiresAt;
    }

    // deadlineAt is the server-side hard deadline: activatedAt + reservedSeconds.
    // If the client never calls /api/streaming/end (closed tab, crash), a sweep
    // finalizes the session at this point and the full reservation is spent —
    // the same window the countdown shows, so overuse is impossible.
    await sessionRef.update({
      status: "active",
      transport: sessionTransport,
      ticketHash: createHash("sha256").update(ticket).digest("hex"),
      ticketExpiresAt: new Date(Date.now() + 90_000),
      // The fal JWT is handed to the browser and never persisted; the proxy
      // path stores its provider token for upstream relay instead.
      ...(provider === "fal"
        ? { provider: "fal", providerEndpoint: FAL_ENDPOINTS[model] }
        : { providerToken: apiKey }),
      allowedOrigin: origin,
      tokenExpiresAt,
      activatedAt: FieldValue.serverTimestamp(),
      deadlineAt: new Date(Date.now() + reservedSeconds * 1000),
    });

    return privateJson({
      apiKey,
      expiresAt: tokenExpiresAt,
      maxSessionDuration,
      sessionId,
      provider,
      // The fal WebRTC endpoint the browser should connect to (fal path only).
      ...(provider === "fal" ? { endpoint: FAL_ENDPOINTS[model] } : {}),
    });
  } catch (error) {
    // Do not charge a user when the provider token was never issued. Once the
    // token is returned, the full prepaid window is final and cannot be
    // manipulated by a browser-side "stream ended" request.
    if (reservation && db) {
      const failedReservation = reservation;
      const sessionRef = db.collection("streamSessions").doc(failedReservation.sessionId);
      const userRef = db.collection("users").doc(failedReservation.userId);
      const transactionRef = db.collection("transactions").doc(`stream-${failedReservation.sessionId}`);
      await db.runTransaction(async (transaction) => {
        const session = await transaction.get(sessionRef);
        if (session.data()?.status !== "reserved") return;
        transaction.update(userRef, {
          "wallet.balanceSeconds": FieldValue.increment(failedReservation.seconds),
          "wallet.totalUsed": FieldValue.increment(-failedReservation.seconds),
        });
        transaction.update(sessionRef, { status: "token_failed", releasedAt: FieldValue.serverTimestamp() });
        transaction.update(transactionRef, { status: "reversed", reversedAt: FieldValue.serverTimestamp() });
      });
    }
    console.error("Realtime token error:", error instanceof Error ? error.message : "unknown error");
    return errorJson(error);
  }
}
