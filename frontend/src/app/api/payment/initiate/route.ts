import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getCreditPack } from "@/lib/credit-packs";
import { getAdminServices } from "@/lib/firebase-admin";
import { assertSameOrigin, clientIp, enforceRateLimit, errorJson, privateJson, readJsonObject, requireAuthenticatedUser, RequestError } from "@/lib/server-security";

export const runtime = "nodejs";

function paystackSecret(): string {
  const value = process.env.PAYSTACK_SECRET_KEY;
  if (!value) throw new Error("Missing server environment variable: PAYSTACK_SECRET_KEY");
  return value;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    if (!user.email) throw new RequestError(400, "Your account needs a verified email address");
    const body = await readJsonObject(req, 2_048);
    const packId = typeof body.packId === "string" ? body.packId : "";
    const promoCode = typeof body.promoCode === "string" ? body.promoCode.toUpperCase().trim() : "";
    const pack = getCreditPack(packId);
    if (!pack) throw new RequestError(400, "Choose a valid credit pack");

    const { db } = getAdminServices();
    await enforceRateLimit(db, "payment-user", user.uid, 5, 10 * 60_000);
    await enforceRateLimit(db, "payment-ip", clientIp(req), 15, 10 * 60_000);

    let discountPercent = 0;
    let bonusSeconds = 0;
    let promoDocId = "";
    if (promoCode) {
      const promoSnap = await db.collection("promos").where("code", "==", promoCode).limit(1).get();
      if (promoSnap.empty) throw new RequestError(400, "Invalid promo code");
      const promoDoc = promoSnap.docs[0];
      const promo = promoDoc.data();
      const userSnap = await db.collection("users").doc(user.uid).get();
      const used = Array.isArray(userSnap.data()?.promoUsed) ? userSnap.data()!.promoUsed : [];
      const expiresAt = promo.expiresAt ? new Date(String(promo.expiresAt)) : null;
      if (!promo.active || used.includes(promoCode) || (promo.maxUses && Number(promo.usedCount ?? 0) >= Number(promo.maxUses)) ||
          (expiresAt && (!Number.isFinite(expiresAt.getTime()) || expiresAt < new Date()))) {
        throw new RequestError(400, "This promo is no longer available");
      }
      discountPercent = Math.floor(Number(promo.discountPercent ?? 0));
      bonusSeconds = Math.floor(Number(promo.bonusSeconds ?? 0));
      if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100 ||
          !Number.isInteger(bonusSeconds) || bonusSeconds < 0 || bonusSeconds > 86_400) {
        throw new RequestError(400, "Promo configuration is invalid");
      }
      promoDocId = promoDoc.id;
    }

    const amount = Math.max(pack.priceGHS * (1 - discountPercent / 100), 1);
    const amountSubunit = Math.round(amount * 100);
    const totalSeconds = pack.seconds + bonusSeconds;
    const reference = `savatar-${randomUUID()}`;
    const paymentRef = db.collection("payments").doc(reference);
    await paymentRef.set({
      reference, provider: "paystack", userId: user.uid, userEmail: user.email, packId: pack.id,
      seconds: totalSeconds, originalSeconds: pack.seconds, bonusSeconds, originalPrice: pack.priceGHS,
      discountPercent, amount, amountSubunit, currency: "GHS", promoCode: promoCode || null,
      promoDocId: promoDocId || null, status: "pending", createdAt: FieldValue.serverTimestamp(),
    });

    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${paystackSecret()}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: user.email, amount: amountSubunit, currency: "GHS", reference,
        channels: ["card", "mobile_money"], callback_url: `${req.nextUrl.origin}/api/payment/callback`,
        metadata: { userId: user.uid, packId: pack.id, seconds: totalSeconds },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const result = await response.json() as { status?: boolean; message?: string; data?: { authorization_url?: string; access_code?: string; reference?: string } };
    if (!response.ok || result.status !== true || !result.data?.authorization_url || result.data.reference !== reference) {
      await paymentRef.update({ status: "initiation_failed", providerMessage: result.message?.slice(0, 300) ?? null, updatedAt: FieldValue.serverTimestamp() });
      throw new RequestError(502, result.message || "Paystack checkout could not be started");
    }
    await paymentRef.update({ authorizationUrl: result.data.authorization_url, accessCode: result.data.access_code ?? null, updatedAt: FieldValue.serverTimestamp() });
    return privateJson({ success: true, reference, authorizationUrl: result.data.authorization_url, amount, totalSeconds });
  } catch (error) {
    console.error("Paystack initiation error:", error instanceof Error ? error.message : "unknown error");
    if (error instanceof Error && error.message.startsWith("Missing server environment variable")) {
      return privateJson({ error: "Paystack is not configured" }, { status: 503 });
    }
    return errorJson(error);
  }
}
