import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
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
import { FieldValue } from "firebase-admin/firestore";
import {
  authoritativeFalUsageSeconds,
  releaseStreamLockInTransaction,
  streamLockRef,
} from "@/lib/stream-sessions";

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
    const endedAtMs = Date.now();

    const refundResult = await db.runTransaction(async (transaction) => {
      const sessionSnap = await transaction.get(sessionRef);
      if (!sessionSnap.exists) throw new RequestError(404, "Session not found");
      const session = sessionSnap.data()!;
      const providerSlot = Number(session.providerSlot ?? 0);
      const lockRef = streamLockRef(db, Number.isInteger(providerSlot) && providerSlot >= 0 && providerSlot < 5 ? providerSlot : 0);
      const lockSnap = await transaction.get(lockRef);

      if (session.userId !== user.uid) throw new RequestError(403, "Not your session");
      if (session.status !== "active") {
        releaseStreamLockInTransaction(transaction, lockRef, lockSnap.data(), sessionId);
        const settledUsedSeconds = Math.floor(Number(session.usedSeconds ?? 0));
        // Zero billable seconds means no AI output was ever produced — the
        // provider rejected the session, which is not abuse. Hand the
        // authorization attempt back; the marker makes this once-only so a
        // repeated (idempotent) end cannot refund the same attempt twice.
        const refundRateLimitAttempt = settledUsedSeconds === 0 && !session.rateLimitRefundedAt;
        if (refundRateLimitAttempt) {
          transaction.update(sessionRef, { rateLimitRefundedAt: FieldValue.serverTimestamp() });
        }
        return {
          refunded: 0,
          alreadyProcessed: true,
          refundRateLimitAttempt,
          usedSeconds: settledUsedSeconds,
          reservedSeconds: Math.floor(Number(session.reservedSeconds ?? 0)),
        };
      }

      const reservedSeconds = Math.floor(Number(session.reservedSeconds ?? 0));
      if (!Number.isSafeInteger(reservedSeconds) || reservedSeconds <= 0) {
        return { refunded: 0, alreadyProcessed: false, refundRateLimitAttempt: false };
      }

      if (session.transport !== "fal-realtime" && !session.claimedAt) {
        transaction.update(userRef, {
          "wallet.balanceSeconds": FieldValue.increment(reservedSeconds),
          "wallet.totalUsed": FieldValue.increment(-reservedSeconds),
        });
        // The provider credential was never claimed, so no AI session ever ran:
        // nothing to bill and nothing for the limiter to charge for.
        const refundRateLimitAttempt = !session.rateLimitRefundedAt;
        const updates = { status: "completed", usedSeconds: 0, unusedSeconds: reservedSeconds, endedAt: FieldValue.serverTimestamp() };
        transaction.update(sessionRef, {
          ...updates,
          ...(refundRateLimitAttempt ? { rateLimitRefundedAt: FieldValue.serverTimestamp() } : {}),
          providerToken: FieldValue.delete(),
          ticketHash: FieldValue.delete(),
        });
        transaction.update(transactionRef, updates);
        releaseStreamLockInTransaction(transaction, lockRef, lockSnap.data(), sessionId);
        return { refunded: reservedSeconds, usedSeconds: 0, alreadyProcessed: false, refundRateLimitAttempt, reservedSeconds };
      }
      // Fal usage is bounded by server-issued timestamps. Settle both direct
      // and relayed Fal sessions here so Stop refunds and releases the global
      // provider lock atomically instead of depending on a later relay callback.
      if (session.transport === "fal-realtime" || session.transport === "fal-proxy-v1") {
        const usedSeconds = authoritativeFalUsageSeconds(session, endedAtMs);
        const unusedSeconds = reservedSeconds - usedSeconds;
        const deadlineHit = endedAtMs >= (session.deadlineAt?.toMillis?.() ?? Infinity);
        if (unusedSeconds > 0) {
          transaction.update(userRef, {
            "wallet.balanceSeconds": FieldValue.increment(unusedSeconds),
            "wallet.totalUsed": FieldValue.increment(-unusedSeconds),
          });
        }
        const refundRateLimitAttempt = usedSeconds === 0 && !session.rateLimitRefundedAt;
        const updates = { status: "completed", usedSeconds, unusedSeconds, deadlineHit, endedAt: FieldValue.serverTimestamp() };
        transaction.update(sessionRef, {
          ...updates,
          ...(refundRateLimitAttempt ? { rateLimitRefundedAt: FieldValue.serverTimestamp() } : {}),
          providerToken: FieldValue.delete(),
          ticketHash: FieldValue.delete(),
        });
        transaction.update(transactionRef, updates);
        releaseStreamLockInTransaction(transaction, lockRef, lockSnap.data(), sessionId);
        return { refunded: unusedSeconds, usedSeconds, deadlineHit, alreadyProcessed: false, refundRateLimitAttempt, reservedSeconds };
      }
      // Only the proxy can confirm a provider disconnect and refundable usage.
      transaction.update(sessionRef, { stopRequestedAt: FieldValue.serverTimestamp() });
      return { refunded: 0, pending: true, alreadyProcessed: false, refundRateLimitAttempt: false, reservedSeconds };
    });

    // Applied outside the settlement transaction: the marker written above makes
    // the retry-safe end path refund at most one attempt per session.
    if (refundResult.refundRateLimitAttempt) {
      try {
        await refundRateLimit(db, "realtime-token", user.uid);
      } catch (refundError) {
        console.error("Rate limit refund failed:", refundError instanceof Error ? refundError.message : "unknown error");
      }
    }

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
