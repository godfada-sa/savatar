import { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
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

const MAX_REPORTED_SECONDS = 86_400;

/**
 * Client liveness + usage heartbeat for an active stream session.
 *
 * While a session is live the dashboard posts liveness and a diagnostic SDK
 * counter every few seconds. The server records:
 *
 *   - clientGenerationSeconds — diagnostics only; never trusted for billing.
 *   - lastHeartbeatAt         — proves the client (and its WebRTC feed) is
 *     still alive, so the sweep never finalizes a live session.
 *
 * If the browser crashes without calling /api/streaming/end, the short-lived
 * provider token and server timestamps bound the charge and release the lock.
 */
export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    const body = await readJsonObject(req, 2_048);
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const phase = body.phase === "generating" ? "generating" : "connected";
    const generationSecondsRaw = body.generationSeconds;
    if (!sessionId) throw new RequestError(400, "sessionId is required");

    const generationSeconds = Math.max(0, Math.floor(Number(generationSecondsRaw) || 0));
    if (!Number.isSafeInteger(generationSeconds) || generationSeconds > MAX_REPORTED_SECONDS) {
      throw new RequestError(400, "Invalid generationSeconds");
    }

    const { db } = getAdminServices();
    await enforceRateLimit(db, "streaming-heartbeat", user.uid, 12, 60_000);

    const sessionRef = db.collection("streamSessions").doc(sessionId);
    await db.runTransaction(async (transaction) => {
      const sessionSnap = await transaction.get(sessionRef);
      if (!sessionSnap.exists) throw new RequestError(404, "Session not found");
      const session = sessionSnap.data()!;
      if (session.userId !== user.uid) throw new RequestError(403, "Not your session");

      // A completed/refunded session is a no-op — the ledger is already final.
      if (session.status !== "active") return;

      const current = Math.floor(Number(session.clientGenerationSeconds ?? 0));
      transaction.update(sessionRef, {
        // First heartbeat proves the client actually connected and started a
        // session (fal's transport has no proxy to set this). Monotonic: the
        // client may report out of order or reconnect.
        claimedAt: session.claimedAt ?? FieldValue.serverTimestamp(),
        generationStartedAt: phase === "generating"
          ? (session.generationStartedAt ?? FieldValue.serverTimestamp())
          : (session.generationStartedAt ?? null),
        clientGenerationSeconds: Math.max(current, generationSeconds),
        lastHeartbeatAt: FieldValue.serverTimestamp(),
        heartbeatCount: FieldValue.increment(1),
      });
    });

    return privateJson({ success: true });
  } catch (error) {
    if (error instanceof RequestError) return errorJson(error);
    console.error("Streaming heartbeat error:", error instanceof Error ? error.message : "unknown error");
    return privateJson({ error: "Heartbeat failed" }, { status: 500 });
  }
}
