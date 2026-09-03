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
      if (session.status === "completed" || session.status === "refunded") {
        return { refunded: 0, alreadyProcessed: true };
      }

      const reservedSeconds = Math.floor(Number(session.reservedSeconds ?? 0));
      if (!Number.isSafeInteger(reservedSeconds) || reservedSeconds <= 0) {
        return { refunded: 0, alreadyProcessed: false };
      }

      // Calculate elapsed time from session start to now
      const createdAt = session.createdAt?.toDate?.() ?? new Date();
      const elapsedSeconds = Math.floor((Date.now() - createdAt.getTime()) / 1000);
      const usedSeconds = Math.min(elapsedSeconds, reservedSeconds);
      const unusedSeconds = reservedSeconds - usedSeconds;

      if (unusedSeconds > 0) {
        transaction.update(userRef, {
          "wallet.balanceSeconds": FieldValue.increment(unusedSeconds),
          "wallet.totalUsed": FieldValue.increment(-unusedSeconds),
        });
      }

      transaction.update(sessionRef, {
        status: "completed",
        usedSeconds,
        unusedSeconds,
        endedAt: FieldValue.serverTimestamp(),
      });

      transaction.update(transactionRef, {
        status: "completed",
        usedSeconds,
        unusedSeconds,
        endedAt: FieldValue.serverTimestamp(),
      });

      return { refunded: unusedSeconds, alreadyProcessed: false, usedSeconds, reservedSeconds };
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
