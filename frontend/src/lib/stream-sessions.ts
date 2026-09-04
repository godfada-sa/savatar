import { FieldValue, type Transaction, type DocumentReference } from "firebase-admin/firestore";

/**
 * Server-side hard deadline for a stream session: the session is allowed to
 * consume at most `reservedSeconds` of AI time measured from activation. This
 * mirrors the provider's `maxSessionDuration` cap and is the same window the
 * client countdown displays.
 */
export function sessionDeadlineMs(activatedAt: Date, reservedSeconds: number): number {
  return activatedAt.getTime() + reservedSeconds * 1000;
}

/**
 * When a session is finalized WITHOUT an explicit /api/streaming/end (the
 * browser crashed and its last heartbeat is stale), the ledger charges the
 * generation seconds the client actually reported plus this grace window.
 * The grace covers generation that ran between the final heartbeat and the
 * WebRTC connection actually dying (ICE timeout), so a crash never forfeits
 * the whole reservation, while a silent client still can't ride for free
 * beyond a bounded overhead.
 */
export const REPORT_TAIL_GRACE_SECONDS = 15;

export interface FinalizeOptions {
  asOfMs?: number;
  /**
   * "wall" (default): charge server wall-clock time since activation. Used by
   * /api/streaming/end where the client is present — server-authoritative and
   * immune to client tampering.
   *
   * "report": charge what the client reported generating (via heartbeats)
   * plus a small tail. Used by the sweep when the client is gone, so an
   * abandoned session is billed for real generation, not the full reserve.
   */
  basis?: "wall" | "report";
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
 *  - /api/streaming/end   — client-driven early stop; the client is present, so
 *                           used time is measured on the server's wall clock
 *                           and unused reserved time is refunded.
 *  - /api/streaming/sweep — the client is gone (crashed tab, lost heartbeat) or
 *                           the reserved window elapsed. Uses the "report"
 *                           basis: charges the generation seconds the client
 *                           actually reported (plus a bounded tail) instead of
 *                           forfeiting the whole reservation.
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
  opts: FinalizeOptions = {}
): Promise<FinalizeResult> {
  const { asOfMs = Date.now(), basis = "wall" } = opts;
  const reservedSeconds = Math.floor(Number(session.reservedSeconds ?? 0));
  if (!Number.isSafeInteger(reservedSeconds) || reservedSeconds <= 0) {
    return { alreadyProcessed: false, usedSeconds: 0, unusedSeconds: 0, deadlineHit: false };
  }

  const activatedAt = toDateOrNow(session.activatedAt ?? session.createdAt);
  const deadlineMs = sessionDeadlineMs(activatedAt, reservedSeconds);
  const elapsedSeconds = Math.max(0, Math.floor((asOfMs - activatedAt.getTime()) / 1000));
  const wallUsedSeconds = Math.min(elapsedSeconds, reservedSeconds);
  const deadlineHit = asOfMs >= deadlineMs;

  // "wall": server clock is authoritative (explicit end with client present).
  // "report": client is gone; charge actual reported generation + tail grace,
  // clamped by both the reservation and the wall clock so we never bill for
  // time that couldn't have been generated.
  let usedSeconds = wallUsedSeconds;
  if (basis === "report") {
    const reported = Math.max(0, Math.floor(Number(session.clientGenerationSeconds ?? 0)));
    usedSeconds = Math.min(wallUsedSeconds, reported + REPORT_TAIL_GRACE_SECONDS, reservedSeconds);
  }
  const unusedSeconds = reservedSeconds - usedSeconds;

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