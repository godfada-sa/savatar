import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { getCreditPack } from "@/lib/credit-packs";
import { getAdminServices } from "@/lib/firebase-admin";
import { RequestError } from "@/lib/server-security";

const REFERENCE_PATTERN = /^savatar-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function getPaystackSecret(): string {
  const value = process.env.PAYSTACK_SECRET_KEY;
  if (!value) throw new Error("PAYSTACK_SECRET_KEY is not configured");
  return value;
}

export function assertPaymentReference(reference: string) {
  if (!REFERENCE_PATTERN.test(reference)) throw new RequestError(400, "Invalid payment reference");
}

export async function verifyAndFulfillPaystackPayment(reference: string) {
  assertPaymentReference(reference);
  const { db } = getAdminServices();
  const paymentRef = db.collection("payments").doc(reference);
  const paymentSnapshot = await paymentRef.get();
  if (!paymentSnapshot.exists) throw new RequestError(404, "Unknown payment reference");
  if (paymentSnapshot.data()?.status === "completed") return { verified: true, alreadyProcessed: true };

  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${getPaystackSecret()}` }, cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json() as { status?: boolean; message?: string; data?: { id?: number; status?: string; reference?: string; amount?: number; currency?: string; channel?: string; paid_at?: string; metadata?: Record<string, unknown> } };
  const order = paymentSnapshot.data()!;
  const verified = response.ok && result.status === true && result.data?.status === "success" && result.data.reference === reference &&
    result.data.currency === "GHS" && Number(result.data.amount) === Number(order.amountSubunit) &&
    result.data.metadata?.userId === order.userId && result.data.metadata?.packId === order.packId;
  if (!verified) {
    await paymentRef.update({ status: "verification_pending", providerMessage: result.message?.slice(0, 300) ?? null, verificationCheckedAt: FieldValue.serverTimestamp() });
    return { verified: false, alreadyProcessed: false };
  }

  await db.runTransaction(async (transaction) => {
    const freshPayment = await transaction.get(paymentRef);
    const fresh = freshPayment.data();
    if (!fresh || fresh.status === "completed") return;
    const pack = getCreditPack(String(fresh.packId ?? ""));
    const seconds = Math.floor(Number(fresh.seconds));
    const amount = Number(fresh.amount);
    if (!pack || fresh.provider !== "paystack" || !Number.isSafeInteger(seconds) || seconds < pack.seconds || !Number.isFinite(amount) || amount < 1 || Number(fresh.amountSubunit) !== Number(result.data!.amount)) {
      throw new Error("Stored Paystack order is invalid");
    }
    const userRef = db.collection("users").doc(String(fresh.userId));
    const user = await transaction.get(userRef);
    if (!user.exists) throw new Error("Payment user does not exist");
    const promoCode = typeof fresh.promoCode === "string" ? fresh.promoCode : "";
    const promoUsed = Array.isArray(user.data()?.promoUsed) ? user.data()!.promoUsed : [];
    const promoDocId = typeof fresh.promoDocId === "string" ? fresh.promoDocId : "";
    const promoRef = promoCode && !promoUsed.includes(promoCode) && promoDocId ? db.collection("promos").doc(promoDocId) : null;
    const promo = promoRef ? await transaction.get(promoRef) : null;

    transaction.update(userRef, { "wallet.balanceSeconds": FieldValue.increment(seconds), "wallet.totalPurchased": FieldValue.increment(seconds) });
    if (promoCode && !promoUsed.includes(promoCode)) {
      transaction.update(userRef, { promoUsed: FieldValue.arrayUnion(promoCode) });
      if (promoRef && promo?.exists) transaction.update(promoRef, { usedCount: FieldValue.increment(1) });
    }
    transaction.update(paymentRef, { status: "completed", providerTransactionId: String(result.data!.id ?? ""), providerChannel: result.data!.channel ?? null, paidAt: result.data!.paid_at ?? null, completedAt: FieldValue.serverTimestamp() });
    transaction.set(db.collection("transactions").doc(reference), {
      userId: fresh.userId, packId: fresh.packId, type: "purchase", provider: "paystack", seconds, amount,
      originalPrice: fresh.originalPrice ?? pack.priceGHS, discountPercent: fresh.discountPercent ?? 0,
      bonusSeconds: fresh.bonusSeconds ?? 0, promoCode: promoCode || null, paymentRef: reference,
      providerTransactionId: String(result.data!.id ?? ""), createdAt: FieldValue.serverTimestamp(),
    });
  });
  return { verified: true, alreadyProcessed: false };
}
