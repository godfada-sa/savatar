import { createDecartClient } from "@decartai/sdk";
import { randomUUID } from "node:crypto";
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

function permanentApiKey() {
  const value = process.env.DECART_API_KEY;
  if (!value) throw new Error("DECART_API_KEY is not configured");
  return value;
}

export async function POST(req: NextRequest) {
  let reservation: { sessionId: string; userId: string; seconds: number } | null = null;
  let db: ReturnType<typeof getAdminServices>["db"] | null = null;
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    const body = await readJsonObject(req, 2_048);
    const model = typeof body.model === "string" ? body.model : "";
    if (!ALLOWED_MODELS.has(model)) throw new RequestError(400, "Unsupported realtime model");

    ({ db } = getAdminServices());
    await enforceRateLimit(db, "realtime-token", user.uid, 3, 5 * 60_000);

    const userRef = db.collection("users").doc(user.uid);
    const sessionId = randomUUID();
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
    const decart = createDecartClient({ apiKey: permanentApiKey() });
    const token = await decart.tokens.create({
      // Token must outlive the reserved window so the provider-side cap
      // (maxSessionDuration) is what ends the session, never a short token TTL.
      expiresIn: Math.max(120, reservedSeconds + 60),
      allowedModels: [model],
      allowedOrigins: [origin],
      constraints: { realtime: { maxSessionDuration } },
      metadata: { userId: user.uid, service: "savatar" },
    });

    // deadlineAt is the server-side hard deadline: activatedAt + reservedSeconds.
    // If the client never calls /api/streaming/end (closed tab, crash), a sweep
    // finalizes the session at this point and the full reservation is spent —
    // the same window the countdown shows, so overuse is impossible.
    await sessionRef.update({
      status: "active",
      tokenExpiresAt: token.expiresAt,
      activatedAt: FieldValue.serverTimestamp(),
      deadlineAt: new Date(Date.now() + reservedSeconds * 1000),
    });

    return privateJson({
      apiKey: token.apiKey,
      expiresAt: token.expiresAt,
      maxSessionDuration,
      sessionId,
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
