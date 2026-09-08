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
  // A session that was never claimed (no proxy connection, no client heartbeat)
  // refunds the full reservation once its ticket grace has passed.
  const unclaimed = !session.claimedAt
    && (expiry?.toMillis?.() ?? Infinity) <= (opts.asOfMs ?? Date.now());
  let usedSeconds: number;
  if (unclaimed) {
    usedSeconds = 0;
  } else if (session.transport === "fal-realtime") {
    // fal has no server-side settlement step (the proxy path does); refund the
    // unused part of the reservation from the client-reported generation time.
    const reported = Math.max(0, Math.floor(Number(session.clientGenerationSeconds ?? 0)));
    usedSeconds = Math.min(reserved, reported);
  } else {
    usedSeconds = reserved;
  }
  const unusedSeconds = reserved - usedSeconds;
  if (unusedSeconds) transaction.update(userRef, {
    "wallet.balanceSeconds": FieldValue.increment(unusedSeconds),
    "wallet.totalUsed": FieldValue.increment(-unusedSeconds),
  });
  const updates = {
    status: "completed", usedSeconds, unusedSeconds,
    reconciliationRequired: !unclaimed && session.transport !== "fal-realtime",
    endedAt: FieldValue.serverTimestamp(),
  };
  transaction.update(sessionRef, { ...updates, providerToken: FieldValue.delete(), ticketHash: FieldValue.delete() });
  transaction.update(transactionRef, updates);
  return { alreadyProcessed: false, usedSeconds, unusedSeconds, deadlineHit: true };
}
