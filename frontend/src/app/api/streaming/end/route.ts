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
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req);
    const body = await readJsonObject(req, 2_048);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    if (!sessionId) throw new RequestError(400, "sessionId is required");

    const { db } = getAdminServices();
    await enforceRateLimit(db, "streaming-end", user.uid, 10, 60_000);

    const sessionRef = db.collection("streamSessions").doc(sessionId);
    const transactionRef = db.collection("transactions").doc(`stream-${sessionId}`);
    const userRef = db.collection("users").doc(user.uid);

    const refundResult = await db.runTransaction(async (transaction) => {
      const sessionSnap = await transaction.get(sessionRef);
      if (!sessionSnap.exists) throw new RequestError(404, "Session not found");
      const session = sessionSnap.data()!;

      if (session.userId !== user.uid) throw new RequestError(403, "Not your session");
      if (session.status !== "active") {
        return {
          refunded: 0,
          alreadyProcessed: true,
          usedSeconds: Math.floor(Number(session.usedSeconds ?? 0)),
          reservedSeconds: Math.floor(Number(session.reservedSeconds ?? 0)),
        };
      }

      const reservedSeconds = Math.floor(Number(session.reservedSeconds ?? 0));
      if (!Number.isSafeInteger(reservedSeconds) || reservedSeconds <= 0) {
        return { refunded: 0, alreadyProcessed: false };
      }

      if (!session.claimedAt) {
        transaction.update(userRef, {
          "wallet.balanceSeconds": FieldValue.increment(reservedSeconds),
          "wallet.totalUsed": FieldValue.increment(-reservedSeconds),
        });
        const updates = { status: "completed", usedSeconds: 0, unusedSeconds: reservedSeconds, endedAt: FieldValue.serverTimestamp() };
        transaction.update(sessionRef, { ...updates, providerToken: FieldValue.delete(), ticketHash: FieldValue.delete() });
        transaction.update(transactionRef, updates);
        return { refunded: reservedSeconds, alreadyProcessed: false, reservedSeconds };
      }
      // fal settles inline: refund the unused part of the reservation based on
      // the client-reported generation time (bounded by the reservation).
      if (session.transport === "fal-realtime") {
        const reported = Math.max(0, Math.floor(Number(session.clientGenerationSeconds ?? 0)));
        const usedSeconds = Math.min(reservedSeconds, reported);
        const unusedSeconds = reservedSeconds - usedSeconds;
        if (unusedSeconds > 0) {
          transaction.update(userRef, {
            "wallet.balanceSeconds": FieldValue.increment(unusedSeconds),
            "wallet.totalUsed": FieldValue.increment(-unusedSeconds),
          });
        }
        const updates = { status: "completed", usedSeconds, unusedSeconds, endedAt: FieldValue.serverTimestamp() };
        transaction.update(sessionRef, { ...updates, providerToken: FieldValue.delete(), ticketHash: FieldValue.delete() });
        transaction.update(transactionRef, updates);
        return { refunded: unusedSeconds, alreadyProcessed: false, reservedSeconds };
      }
      // Only the proxy can confirm a provider disconnect and refundable usage.
      transaction.update(sessionRef, { stopRequestedAt: FieldValue.serverTimestamp() });
      return { refunded: 0, pending: true, alreadyProcessed: false, reservedSeconds };
    });

    return privateJson({
      success: true,
      ...refundResult,
    });
  } catch (error) {
    if (error instanceof RequestError) return errorJson(error);
    console.error("Stream end error:", error instanceof Error ? error.message : "unknown error");
    return privateJson({ error: "Failed to end stream" }, { status: 500 });
  }
}
