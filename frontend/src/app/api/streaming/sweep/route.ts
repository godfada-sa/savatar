import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import {
  assertSameOrigin,
  enforceRateLimit,
  errorJson,
  privateJson,
  requireAuthenticatedUser,
  RequestError,
} from "@/lib/server-security";
import { finalizeSessionInTransaction, sessionDeadlineMs } from "@/lib/stream-sessions";

export const runtime = "nodejs";

// A live client heartbeats every few seconds. If none arrived for longer than
// this, the browser (and its WebRTC feed) is gone — finalize and refund now
// instead of making the user wait out the whole reserved window.
const HEARTBEAT_STALE_MS = 60_000;
// Sessions that never delivered a single heartbeat were either crashed before
// the first tick or never connected. Give them a generous grace, then treat
// them as abandoned too (charged only the tail grace, never the full reserve).
const NO_HEARTBEAT_GRACE_MS = 90_000;

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  const firestoreValue = value as { toDate?: () => Date };
  return typeof firestoreValue.toDate === "function" ? firestoreValue.toDate() : null;
}

/**
 * Server-side abandonment enforcement for stream sessions.
 *
 * Finalizes every active session of the caller whose client is gone:
 *
 *   - the reserved window (activatedAt + reservedSeconds) elapsed, or
 *   - its last heartbeat is stale (> HEARTBEAT_STALE_MS old) — the browser
 *     crashed or closed without calling /api/streaming/end, or
 *   - it never heartbeat at all and has been active past NO_HEARTBEAT_GRACE_MS.
 *
 * Unlike the previous behavior (which forfeited the full reservation at the
 * deadline), sessions are finalized with the "report" basis: the user pays for
 * the generation seconds the client actually reported plus a bounded tail, so
 * a crash refunds the rest instead of burning it. Overuse stays impossible —
 * the reservation still caps everything, and the provider's maxSessionDuration
 * already stopped the stream the moment the feed died.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req);
    const { db } = getAdminServices();
    await enforceRateLimit(db, "streaming-sweep", user.uid, 30, 60_000);

    const nowMs = Date.now();
    const snap = await db
      .collection("streamSessions")
      .where("userId", "==", user.uid)
      .where("status", "==", "active")
      .get();

    let finalized = 0;
    let refunded = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const reservedSeconds = Math.floor(Number(data.reservedSeconds ?? 0));
      if (!Number.isSafeInteger(reservedSeconds) || reservedSeconds <= 0) continue;

      const activatedAt = toDate(data.activatedAt ?? data.createdAt);
      if (!activatedAt) continue;

      const elapsedMs = nowMs - activatedAt.getTime();
      const pastDeadline = sessionDeadlineMs(activatedAt, reservedSeconds) <= nowMs;

      let clientGone = pastDeadline;
      if (!clientGone) {
        const lastHeartbeatAt = toDate(data.lastHeartbeatAt);
        if (lastHeartbeatAt) {
          clientGone = nowMs - lastHeartbeatAt.getTime() > HEARTBEAT_STALE_MS;
        } else {
          clientGone = elapsedMs > NO_HEARTBEAT_GRACE_MS;
        }
      }
      if (!clientGone) continue;

      await db.runTransaction(async (transaction) => {
        // Re-check inside the transaction: a concurrent /api/streaming/end may
        // have already finalized (and refunded) this session.
        const sessionSnap = await transaction.get(doc.ref);
        const session = sessionSnap.data();
        if (!session || session.status !== "active") return;

        const result = await finalizeSessionInTransaction(
          transaction,
          doc.ref,
          db.collection("users").doc(user.uid),
          db.collection("transactions").doc(`stream-${doc.id}`),
          session,
          { asOfMs: nowMs, basis: "report" }
        );
        finalized += 1;
        refunded += result.unusedSeconds;
      });
    }

    return privateJson({ success: true, checked: snap.size, finalized, refunded });
  } catch (error) {
    if (error instanceof RequestError) return errorJson(error);
    console.error("Streaming sweep error:", error instanceof Error ? error.message : "unknown error");
    return privateJson({ error: "Sweep failed" }, { status: 500 });
  }
}
