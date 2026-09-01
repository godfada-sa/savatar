import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
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

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req);
    const body = await readJsonObject(req, 2_048);

    const promoCode = typeof body.promoCode === "string" ? body.promoCode.toUpperCase().trim() : "";
    const packId = typeof body.packId === "string" ? body.packId : "";

    if (!promoCode || !packId) {
      throw new RequestError(400, "Promo code and pack ID are required");
    }

    // Rate limit: max 10 promo validations per 5 minutes per user
    const { db } = getAdminServices();
    await enforceRateLimit(db, "promo-validate", user.uid, 10, 5 * 60_000);

    // Find the promo
    const promosRef = db.collection("promos");
    const q = promosRef.where("code", "==", promoCode);
    const promoSnap = await q.get();

    if (promoSnap.empty) {
      throw new RequestError(404, "Invalid promo code");
    }

    const promoDoc = promoSnap.docs[0];
    const promoData = promoDoc.data();

    // Check if promo is active
    if (!promoData.active) {
      throw new RequestError(400, "This promo has expired");
    }

    // Check max uses
    if (promoData.maxUses && promoData.usedCount >= promoData.maxUses) {
      throw new RequestError(400, "This promo has reached its usage limit");
    }

    // Check expiration
    if (promoData.expiresAt) {
      const expiresAt = new Date(promoData.expiresAt);
      if (expiresAt < new Date()) {
        throw new RequestError(400, "This promo has expired");
      }
    }

    // Check if user already used this promo
    const userRef = db.collection("users").doc(user.uid);
    const userSnap = await userRef.get();
    const userData = userSnap.data();
    const promoUsed = userData?.promoUsed || [];

    if (promoUsed.includes(promoCode)) {
      throw new RequestError(400, "You have already used this promo code");
    }

    // Calculate discount
    const discountPercent = promoData.discountPercent || 0;
    const bonusSeconds = promoData.bonusSeconds || 0;

    // Return promo details (don't apply yet — apply during payment)
    return privateJson({
      success: true,
      code: promoCode,
      discountPercent,
      bonusSeconds,
      message: discountPercent > 0
        ? `${discountPercent}% discount applied`
        : bonusSeconds > 0
        ? `+${bonusSeconds} bonus seconds`
        : "Promo applied",
    });
  } catch (error) {
    if (error instanceof RequestError) return errorJson(error);
    console.error("Promo validation error:", error);
    return privateJson({ error: "Failed to validate promo code" }, { status: 500 });
  }
}
