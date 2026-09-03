import { FieldValue, type Transaction, type DocumentReference } from "firebase-admin/firestore";

/**
 * Server-side hard deadline for a stream session: the session is allowed to
 * consume at most `reservedSeconds` of AI time measured from activation. This
 * mirrors the provider's `maxSessionDuration` cap and is the same window the
 * client countdown displays. Once it passes, the full reservation is spent and
 * nothing is refunded — a closed client can never cause overuse.
 */
export function sessionDeadlineMs(activatedAt: Date, reservedSeconds: number): number {
  return activatedAt.getTime() + reservedSeconds * 1000;
}

export interface FinalizeResult {
  alreadyProcessed: boolean;
  usedSeconds: number;
  unusedSeconds: number;
  deadlineHit: boolean;
}

function toDateOrNow(value: unknown): Date {
  if (value && typeof value === "object") {
    const candidate = value as { toDate?: () => Date };
    if (typeof candidate.toDate === "function") return candidate.toDate();
    if (candidate instanceof Date) return candidate;
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value);
  return new Date();
}

/**
 * Finalize an active stream session inside a Firestore transaction. Shared by:
 *
 *  - /api/streaming/end   — client-driven early stop; refunds unused reserved
 *                           time measured on the server's wall clock.
 *  - /api/streaming/sweep — server-side hard deadline; runs when the client is
 *                           gone and the reserved window has elapsed. At (or
 *                           past) the deadline, usedSeconds == reservedSeconds,
 *                           so nothing is refunded and overuse is impossible.
 *
 * Caller must have already verified ownership and that the session is not
 * completed/refunded.
 */
export async function finalizeSessionInTransaction(
  transaction: Transaction,
  sessionRef: DocumentReference,
  userRef: DocumentReference,
  transactionRef: DocumentReference,
  session: Record<string, unknown>,
  asOfMs = Date.now()
): Promise<FinalizeResult> {
  const reservedSeconds = Math.floor(Number(session.reservedSeconds ?? 0));
  if (!Number.isSafeInteger(reservedSeconds) || reservedSeconds <= 0) {
    return { alreadyProcessed: false, usedSeconds: 0, unusedSeconds: 0, deadlineHit: false };
  }

  const activatedAt = toDateOrNow(session.activatedAt ?? session.createdAt);
  const deadlineMs = sessionDeadlineMs(activatedAt, reservedSeconds);
  const elapsedSeconds = Math.max(0, Math.floor((asOfMs - activatedAt.getTime()) / 1000));
  const usedSeconds = Math.min(elapsedSeconds, reservedSeconds);
  const unusedSeconds = reservedSeconds - usedSeconds;
  const deadlineHit = asOfMs >= deadlineMs;

  if (unusedSeconds > 0) {
    transaction.update(userRef, {
      "wallet.balanceSeconds": FieldValue.increment(unusedSeconds),
      "wallet.totalUsed": FieldValue.increment(-unusedSeconds),
    });
  }

  const updates = {
    status: "completed",
    usedSeconds,
    unusedSeconds,
    deadlineHit,
    endedAt: FieldValue.serverTimestamp(),
  };
  transaction.update(sessionRef, updates);
  transaction.update(transactionRef, updates);

  return { alreadyProcessed: false, usedSeconds, unusedSeconds, deadlineHit };
}