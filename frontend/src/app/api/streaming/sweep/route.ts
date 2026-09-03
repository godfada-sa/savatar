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

/**
 * Server-side hard deadline enforcement. Finalizes every active session of the
 * caller whose reserved window (activatedAt + reservedSeconds) has elapsed —
 * including sessions whose client vanished without calling /api/streaming/end.
 *
 * At (or past) the deadline, usedSeconds == reservedSeconds, so no credits are
 * refunded and the user can never consume more AI time than they prepaid. The
 * provider's maxSessionDuration cap already stops the stream server-side; this
 * route reconciles the ledger and the session record to match.
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

      const activated = (data.activatedAt ?? data.createdAt) as { toDate?: () => Date } | undefined;
      const activatedAt = activated?.toDate?.() ?? new Date();
      if (sessionDeadlineMs(activatedAt, reservedSeconds) > nowMs) continue;

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
          nowMs
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