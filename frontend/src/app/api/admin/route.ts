import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import { assertSameOrigin, errorJson, privateJson, readJsonObject, requireAdminUser, RequestError } from "@/lib/server-security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const admin = await requireAdminUser(req);
    const body = await readJsonObject(req);
    const action = body.action;
    const { db } = getAdminServices();
    if (action === "credit") {
      const userId = typeof body.userId === "string" ? body.userId : "";
      const seconds = Math.floor(Number(body.seconds));
      if (!userId || !Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86_400) throw new RequestError(400, "Invalid credit request");
      await db.runTransaction(async (tx) => {
        const userRef = db.collection("users").doc(userId);
        if (!(await tx.get(userRef)).exists) throw new RequestError(404, "User not found");
        tx.update(userRef, { "wallet.balanceSeconds": FieldValue.increment(seconds), "wallet.totalPurchased": FieldValue.increment(seconds) });
        tx.set(db.collection("adminLogs").doc(), { action: "credit_user", adminEmail: admin.email ?? null, targetUser: userId, seconds, reason: typeof body.reason === "string" ? body.reason.slice(0, 300) : "", createdAt: FieldValue.serverTimestamp() });
      });
    } else if (action === "promo") {
      const code = typeof body.code === "string" ? body.code.toUpperCase().trim() : "";
      const bonusSeconds = Math.floor(Number(body.bonusSeconds ?? 0));
      const discountPercent = Math.floor(Number(body.discountPercent ?? 0));
      const maxUses = body.maxUses == null || body.maxUses === "" ? null : Math.floor(Number(body.maxUses));
      if (!/^[A-Z0-9_-]{3,40}$/.test(code) || bonusSeconds < 0 || bonusSeconds > 86_400 || discountPercent < 0 || discountPercent > 100 || (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1))) throw new RequestError(400, "Invalid promo");
      await db.collection("promos").doc().set({ code, bonusSeconds, discountPercent, maxUses, usedCount: 0, active: true, createdAt: FieldValue.serverTimestamp() });
    } else if (action === "togglePromo") {
      const promoId = typeof body.promoId === "string" ? body.promoId : "";
      const active = typeof body.active === "boolean" ? body.active : null;
      if (!promoId || active === null) throw new RequestError(400, "Invalid promo request");
      await db.collection("promos").doc(promoId).update({ active });
    } else throw new RequestError(400, "Unsupported action");
    return privateJson({ success: true });
  } catch (error) { return errorJson(error); }
}
