import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import { assertSameOrigin, enforceRateLimit, errorJson, privateJson, requireAuthenticatedUser } from "@/lib/server-security";
import { finalizeSessionInTransaction } from "@/lib/stream-sessions";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req);
    const { db } = getAdminServices();
    await enforceRateLimit(db, "streaming-sweep", user.uid, 30, 60_000);
    const snapshot = await db.collection("streamSessions").where("userId", "==", user.uid).where("status", "==", "active").limit(30).get();
    const now = Date.now();
    const results = await Promise.all(snapshot.docs.map((doc) => db.runTransaction(async (tx) => {
      const current = (await tx.get(doc.ref)).data();
      if (!current || current.status !== "active") return 0;
      const unclaimed = current.transport === "proxy-v1" && !current.claimedAt;
      const expiry = unclaimed ? current.ticketExpiresAt?.toMillis?.()
        : (current.claimedAt ?? current.activatedAt)?.toMillis?.() + Number(current.reservedSeconds) * 1000 + 150_000;
      if (!Number.isFinite(expiry) || now < expiry) return 0;
      const result = await finalizeSessionInTransaction(tx, doc.ref, db.collection("users").doc(user.uid),
        db.collection("transactions").doc(`stream-${doc.id}`), current, { asOfMs: now });
      return result.unusedSeconds;
    })));
    return privateJson({ success: true, refunded: results.reduce((a, b) => a + b, 0) });
  } catch (error) { return errorJson(error); }
}
