import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import { assertSameOrigin, enforceRateLimit, errorJson, privateJson, requireAuthenticatedUser } from "@/lib/server-security";
import { finalizeSessionInTransaction, streamLockRef } from "@/lib/stream-sessions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    const { db } = getAdminServices();
    await enforceRateLimit(db, "streaming-sweep", user.uid, 30, 60_000);
    const snapshot = await db.collection("streamSessions").where("userId", "==", user.uid).where("status", "==", "active").limit(30).get();
    const now = Date.now();
    const results = await Promise.all(snapshot.docs.map((doc) => db.runTransaction(async (tx) => {
      const currentSnapshot = await tx.get(doc.ref);
      const current = currentSnapshot.data();
      if (!current || current.status !== "active") return { finalized: 0, refunded: 0 };
      const providerSlot = Number(current.providerSlot ?? 0);
      const lockRef = streamLockRef(db, Number.isInteger(providerSlot) && providerSlot >= 0 && providerSlot < 5 ? providerSlot : 0);
      const lockSnapshot = await tx.get(lockRef);
      const unclaimed = !current.claimedAt;
      const expiry = current.transport === "fal-realtime" || current.transport === "fal-proxy-v1"
        ? Math.min(
            current.deadlineAt?.toMillis?.() ?? Infinity,
            (current.tokenExpiresAt?.toMillis?.() ?? Infinity) + 5_000,
          )
        : unclaimed
          ? current.ticketExpiresAt?.toMillis?.()
          : (current.claimedAt ?? current.activatedAt)?.toMillis?.() + Number(current.reservedSeconds) * 1000 + 150_000;
      if (!Number.isFinite(expiry) || now < expiry) return { finalized: 0, refunded: 0 };
      const result = await finalizeSessionInTransaction(tx, doc.ref, db.collection("users").doc(user.uid),
        db.collection("transactions").doc(`stream-${doc.id}`), current, {
          asOfMs: now,
          lockRef,
          lock: lockSnapshot.data(),
        });
      return { finalized: result.alreadyProcessed ? 0 : 1, refunded: result.unusedSeconds };
    })));
    return privateJson({
      success: true,
      checked: snapshot.size,
      finalized: results.reduce((sum, result) => sum + result.finalized, 0),
      refunded: results.reduce((sum, result) => sum + result.refunded, 0),
    });
  } catch (error) { return errorJson(error); }
}
