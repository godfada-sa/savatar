import {
  FieldValue,
  type DocumentReference,
  type Firestore,
  type Transaction,
} from "firebase-admin/firestore";

export const STREAM_LOCK_COLLECTION = "_streamLocks";
export const STREAM_LOCK_DOCUMENT = "shared-ai-provider";
export const MAX_CONCURRENT_AI_STREAMS = 5;

/**
 * Fixed provider leases make the account-wide cap transactional without a
 * single hot counter document. Slot zero deliberately keeps the legacy name,
 * so a live pre-upgrade stream remains accounted for.
 */
export function streamLockRef(db: Firestore, slot = 0) {
  return db.collection(STREAM_LOCK_COLLECTION)
    .doc(slot === 0 ? STREAM_LOCK_DOCUMENT : `${STREAM_LOCK_DOCUMENT}-${slot}`);
}

export function streamLockRefs(db: Firestore) {
  return Array.from({ length: MAX_CONCURRENT_AI_STREAMS }, (_, slot) => streamLockRef(db, slot));
}

function timestampMillis(value: unknown): number | null {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && "toMillis" in value) {
    const millis = (value as { toMillis?: () => number }).toMillis?.();
    return Number.isFinite(millis) ? Number(millis) : null;
  }
  return null;
}

/**
 * Bill Fal only after the browser has confirmed decoded AI frames. Reserving a
 * token or negotiating a track is not useful output and must be fully refunded
 * when the user stops or the browser disappears before generation begins.
 */
export function authoritativeFalUsageSeconds(
  session: Record<string, unknown>,
  endedAtMs = Date.now(),
) {
  const reserved = Math.floor(Number(session.reservedSeconds ?? 0));
  if (!Number.isSafeInteger(reserved) || reserved <= 0) return 0;

  const startedAt = timestampMillis(session.generationStartedAt);
  if (startedAt === null) return 0;

  const deadlineAt = timestampMillis(session.deadlineAt) ?? (startedAt + reserved * 1000);
  const tokenExpiresAt = timestampMillis(session.tokenExpiresAt) ?? deadlineAt;
  const billableEnd = Math.min(endedAtMs, deadlineAt, tokenExpiresAt);
  return Math.max(0, Math.min(reserved, Math.ceil((billableEnd - startedAt) / 1000)));
}

export function releaseStreamLockInTransaction(
  transaction: Transaction,
  lockRef: DocumentReference,
  lock: Record<string, unknown> | undefined,
  sessionId: string,
) {
  if (lock?.sessionId === sessionId) transaction.delete(lockRef);
}

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
  opts: {
    asOfMs?: number;
    lockRef?: DocumentReference;
    lock?: Record<string, unknown>;
  } = {},
): Promise<FinalizeResult> {
  const reserved = Math.floor(Number(session.reservedSeconds ?? 0));
  if (session.status !== "active" || !Number.isSafeInteger(reserved) || reserved <= 0) {
    return { alreadyProcessed: true, usedSeconds: Number(session.usedSeconds ?? 0), unusedSeconds: 0, deadlineHit: false };
  }
  const asOfMs = opts.asOfMs ?? Date.now();
  const expiry = session.ticketExpiresAt as { toMillis?: () => number } | undefined;
  // Only the authenticated proxy can prove that its provider credential was
  // never used. fal credentials are handed to the browser, so their authorized
  // time window is billable even when a malicious client suppresses heartbeats.
  const unclaimedProxy = session.transport !== "fal-realtime"
    && !session.claimedAt
    && (expiry?.toMillis?.() ?? Infinity) <= asOfMs;
  let usedSeconds: number;
  if (unclaimedProxy) {
    usedSeconds = 0;
  } else if (session.transport === "fal-realtime" || session.transport === "fal-proxy-v1") {
    usedSeconds = authoritativeFalUsageSeconds(session, asOfMs);
  } else {
    usedSeconds = reserved;
  }
  const unusedSeconds = reserved - usedSeconds;
  if (unusedSeconds) transaction.update(userRef, {
    "wallet.balanceSeconds": FieldValue.increment(unusedSeconds),
    "wallet.totalUsed": FieldValue.increment(-unusedSeconds),
  });
  const deadlineAt = timestampMillis(session.deadlineAt);
  const updates = {
    status: "completed", usedSeconds, unusedSeconds,
    deadlineHit: deadlineAt !== null && asOfMs >= deadlineAt,
    reconciliationRequired: !unclaimedProxy
      && session.transport !== "fal-realtime"
      && session.transport !== "fal-proxy-v1",
    endedAt: FieldValue.serverTimestamp(),
  };
  transaction.update(sessionRef, { ...updates, providerToken: FieldValue.delete(), ticketHash: FieldValue.delete() });
  transaction.update(transactionRef, updates);
  if (opts.lockRef) {
    releaseStreamLockInTransaction(transaction, opts.lockRef, opts.lock, sessionRef.id);
  }
  return { alreadyProcessed: false, usedSeconds, unusedSeconds, deadlineHit: updates.deadlineHit };
}
