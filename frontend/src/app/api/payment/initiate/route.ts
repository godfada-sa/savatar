import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getCreditPack } from "@/lib/credit-packs";
import { getAdminServices } from "@/lib/firebase-admin";
import {
  assertSameOrigin,
  clientIp,
  enforceRateLimit,
  errorJson,
  privateJson,
  readJsonObject,
  requireAuthenticatedUser,
  RequestError,
} from "@/lib/server-security";

export const runtime = "nodejs";

const MOOLRE_BASE_URL = process.env.MOOLRE_BASE_URL ?? "https://api.moolre.com";

function serverVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    const body = await readJsonObject(req, 2_048);
    const packId = typeof body.packId === "string" ? body.packId : "";
    const method = typeof body.method === "string" ? body.method : "";
    const phone = typeof body.phone === "string" ? body.phone.replace(/\D/g, "") : "";
    const promoCode = typeof body.promoCode === "string" ? body.promoCode.toUpperCase().trim() : "";

    const pack = getCreditPack(packId);
    if (!pack || !["mtn", "telecel", "airteltigo"].includes(method) || !/^0\d{9}$/.test(phone)) {
      throw new RequestError(400, "Choose a valid credit pack and 10-digit Ghana phone number");
    }

    const { db } = getAdminServices();
    await enforceRateLimit(db, "payment-user", user.uid, 5, 10 * 60_000);
    await enforceRateLimit(db, "payment-phone", `${clientIp(req)}:${phone}`, 5, 10 * 60_000);

    // ─── Validate promo code (server-side) ────────────────
    let discountPercent = 0;
    let bonusSeconds = 0;
    let promoDocId = "";

    if (promoCode) {
      const promoSnap = await db.collection("promos").where("code", "==", promoCode).get();
      if (promoSnap.empty) {
        throw new RequestError(400, "Invalid promo code");
      }

      const promoDoc = promoSnap.docs[0];
      const promoData = promoDoc.data();
      promoDocId = promoDoc.id;

      if (!promoData.active) {
        throw new RequestError(400, "This promo has expired");
      }

      if (promoData.maxUses && promoData.usedCount >= promoData.maxUses) {
        throw new RequestError(400, "This promo has reached its usage limit");
      }

      if (promoData.expiresAt && new Date(promoData.expiresAt) < new Date()) {
        throw new RequestError(400, "This promo has expired");
      }

      // Check if user already used this promo
      const userSnap = await db.collection("users").doc(user.uid).get();
      const promoUsed = userSnap.data()?.promoUsed || [];
      if (promoUsed.includes(promoCode)) {
        throw new RequestError(400, "You have already used this promo code");
      }

      discountPercent = Math.floor(Number(promoData.discountPercent ?? 0));
      bonusSeconds = Math.floor(Number(promoData.bonusSeconds ?? 0));
      if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 100 ||
          !Number.isInteger(bonusSeconds) || bonusSeconds < 0 || bonusSeconds > 86_400) {
        throw new RequestError(400, "Promo configuration is invalid");
      }
    }

    // ─── Calculate final price ────────────────────────────
    const originalPrice = pack.priceGHS;
    let finalPrice: number = originalPrice;

    if (discountPercent > 0) {
      finalPrice = originalPrice * (1 - discountPercent / 100);
      finalPrice = Math.max(finalPrice, 1); // Minimum 1 GHS
    }

    // Total seconds including bonus
    const totalSeconds = pack.seconds + bonusSeconds;

    // ─── Store payment record ─────────────────────────────
    const apiUser = serverVariable("MOOLRE_API_USER");
    const publicKey = serverVariable("MOOLRE_PUBLIC_KEY");
    const accountNumber = serverVariable("MOOLRE_ACCOUNT_NUMBER");
    const reference = `savatar-${randomUUID()}`;
    const paymentRef = db.collection("payments").doc(reference);

    await paymentRef.set({
      reference,
      userId: user.uid,
      packId: pack.id,
      seconds: totalSeconds,
      originalSeconds: pack.seconds,
      bonusSeconds,
      originalPrice,
      discountPercent,
      amount: finalPrice,
      currency: "GHS",
      accountNumber,
      phoneLast4: phone.slice(-4),
      method,
      promoCode: promoCode || null,
      promoDocId: promoDocId || null,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    // ─── Generate Moolre payment link ─────────────────────
    const response = await fetch(`${MOOLRE_BASE_URL}/embed/link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-USER": apiUser,
        "X-API-PUBKEY": publicKey,
      },
      body: JSON.stringify({
        type: 1,
        amount: finalPrice.toFixed(2),
        email: user.email,
        externalref: reference,
        callback: `${req.nextUrl.origin}/api/payment/callback`,
        redirect: `${req.nextUrl.origin}/credits?payment=success&ref=${reference}`,
        reusable: "0",
        currency: "GHS",
        accountnumber: accountNumber,
        metadata: {
          userId: user.uid,
          packId: pack.id,
          seconds: totalSeconds,
          bonusSeconds,
          discountPercent,
          promoCode: promoCode || "",
          phone,
          method,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const result = (await response.json()) as {
      status?: number | string;
      code?: string;
      message?: string | null;
      data?: { authorization_url?: string; reference?: string } | null;
    };

    const providerMessage = typeof result.message === "string" ? result.message.slice(0, 300) : null;

    if (!response.ok || Number(result.status) !== 1 || !result.data?.authorization_url) {
      await paymentRef.update({
        status: "initiation_failed",
        providerCode: typeof result.code === "string" ? result.code.slice(0, 50) : null,
        providerMessage,
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw new RequestError(502, providerMessage || "Payment initiation failed. Please try again.");
    }

    await paymentRef.update({
      authorizationUrl: result.data.authorization_url,
      providerCode: typeof result.code === "string" ? result.code.slice(0, 50) : null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return privateJson({
      success: true,
      reference,
      authorizationUrl: result.data.authorization_url,
      originalPrice,
      discountPercent,
      bonusSeconds,
      amount: finalPrice,
      totalSeconds,
      message: discountPercent > 0
        ? `${discountPercent}% discount applied! Redirecting to payment page...`
        : "Redirecting to payment page...",
    });
  } catch (error) {
    console.error("Payment initiation error:", error instanceof Error ? error.message : "unknown error");
    if (error instanceof RequestError) return errorJson(error);
    if (error instanceof Error && error.message.startsWith("Missing server environment variable")) {
      return privateJson({ error: "Payment service is not configured" }, { status: 503 });
    }
    return privateJson({ error: "Unable to initiate payment. Please try again." }, { status: 500 });
  }
}
