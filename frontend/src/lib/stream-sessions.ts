import { FieldValue, type Transaction, type DocumentReference } from "firebase-admin/firestore";

export function sessionDeadlineMs(activatedAt: Date, reservedSeconds: number): number {
  return activatedAt.getTime() + reservedSeconds * 1000;
}

export interface FinalizeResult {
  alreadyProcessed: boolean;
  usedSeconds: number;
  unusedSeconds: number;
  deadlineHit: boolean;
}

// Browser reports are diagnostic only, never proof of refundable usage.
export async function finalizeSessionInTransaction(
  transaction: Transaction, sessionRef: DocumentReference, userRef: DocumentReference,
  transactionRef: DocumentReference, session: Record<string, unknown>,
  opts: { asOfMs?: number } = {},
): Promise<FinalizeResult> {
  const reserved = Math.floor(Number(session.reservedSeconds ?? 0));
  if (session.status !== "active" || !Number.isSafeInteger(reserved) || reserved <= 0) {
    return { alreadyProcessed: true, usedSeconds: Number(session.usedSeconds ?? 0), unusedSeconds: 0, deadlineHit: false };
  }
  const expiry = session.ticketExpiresAt as { toMillis?: () => number } | undefined;
  const unused = session.transport === "proxy-v1" && !session.claimedAt
    && (expiry?.toMillis?.() ?? Infinity) <= (opts.asOfMs ?? Date.now());
  const usedSeconds = unused ? 0 : reserved;
  const unusedSeconds = reserved - usedSeconds;
  if (unusedSeconds) transaction.update(userRef, {
    "wallet.balanceSeconds": FieldValue.increment(unusedSeconds),
    "wallet.totalUsed": FieldValue.increment(-unusedSeconds),
  });
  const updates = {
    status: "completed", usedSeconds, unusedSeconds,
    reconciliationRequired: !unused, endedAt: FieldValue.serverTimestamp(),
  };
  transaction.update(sessionRef, { ...updates, providerToken: FieldValue.delete(), ticketHash: FieldValue.delete() });
  transaction.update(transactionRef, updates);
  return { alreadyProcessed: false, usedSeconds, unusedSeconds, deadlineHit: true };
}
