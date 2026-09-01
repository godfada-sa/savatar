import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getCreditPack } from "@/lib/credit-packs";
import { getAdminServices } from "@/lib/firebase-admin";
import {
  clientIp,
  enforceRateLimit,
  errorJson,
  privateJson,
  readJsonObject,
  RequestError,
} from "@/lib/server-security";

export const runtime = "nodejs";

const MOOLRE_BASE_URL = process.env.MOOLRE_BASE_URL ?? "https://api.moolre.com";

function serverVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function assertAllowedCallbackIp(req: NextRequest) {
  const configured = (process.env.MOOLRE_CALLBACK_IPS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.length > 0 && !configured.includes(clientIp(req))) {
    throw new RequestError(403, "Callback source is not allowed");
  }
}

export async function POST(req: NextRequest) {
  try {
    assertAllowedCallbackIp(req);
    const payload = record(await readJsonObject(req, 32_768));
    const callbackData = record(payload.data);
    const reference =
      text(callbackData.externalref) ??
      text(callbackData.externalRef) ??
      text(payload.externalref) ??
      text(payload.reference);

    if (!reference || !/^savatar-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(reference)) {
      throw new RequestError(400, "Invalid payment reference");
    }

    const apiUser = serverVariable("MOOLRE_API_USER");
    const publicKey = serverVariable("MOOLRE_PUBLIC_KEY");
    const accountNumber = serverVariable("MOOLRE_ACCOUNT_NUMBER");
    const { db } = getAdminServices();
    await enforceRateLimit(db, "payment-callback", clientIp(req), 120, 60_000);
    const paymentRef = db.collection("payments").doc(reference);
    const paymentSnapshot = await paymentRef.get();

    if (!paymentSnapshot.exists) {
      throw new RequestError(404, "Unknown payment reference");
    }

    if (paymentSnapshot.data()?.status === "completed") {
      return privateJson({ received: true, message: "Already processed" });
    }

    // Verify payment with Moolre
    const verificationResponse = await fetch(`${MOOLRE_BASE_URL}/open/transact/status`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-USER": apiUser,
        "X-API-PUBKEY": publicKey,
      },
      body: JSON.stringify({
        type: 1,
        idtype: 1,
        id: reference,
        accountnumber: accountNumber,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });

    const verification = record(await verificationResponse.json());
    const verifiedData = record(verification.data);
    const payment = paymentSnapshot.data()!;
    const pack = getCreditPack(String(payment.packId ?? ""));
    const verifiedAmount = Number(verifiedData.amount);
    
    // Use the stored payment amount (includes promo discount) for verification
    const storedAmount = Number(payment.amount);
    const isVerified =
      Boolean(pack) &&
      verificationResponse.ok &&
      Number(verification.status) === 1 &&
      Number(verifiedData.txstatus) === 1 &&
      text(verifiedData.externalref) === reference &&
      text(verifiedData.accountnumber) === accountNumber &&
      Number.isFinite(verifiedAmount) &&
      Math.abs(verifiedAmount - storedAmount) < 0.01;

    if (!isVerified) {
      await paymentRef.update({
        status: "verification_pending",
        callbackReceivedAt: FieldValue.serverTimestamp(),
        providerStatusCode: verification.code ?? null,
      });
      return privateJson({ received: true, verified: false });
    }

    await db.runTransaction(async (transaction) => {
      const freshPayment = await transaction.get(paymentRef);
      const order = freshPayment.data();
      if (!order || order.status === "completed") return;

      const orderPack = getCreditPack(String(order.packId ?? ""));
      if (!orderPack || order.accountNumber !== accountNumber) {
        throw new Error("Stored payment order does not match the server catalog");
      }

      // Use stored seconds (includes bonus) and stored amount (includes discount)
      const secondsToCredit = Number(order.seconds) || orderPack.seconds;
      const amountPaid = Number(order.amount) || orderPack.priceGHS;

      const userRef = db.collection("users").doc(order.userId);
      const user = await transaction.get(userRef);
      if (!user.exists) throw new Error("Payment user does not exist");

      // Add credits to wallet
      transaction.update(userRef, {
        "wallet.balanceSeconds": FieldValue.increment(secondsToCredit),
        "wallet.totalPurchased": FieldValue.increment(secondsToCredit),
      });

      // Mark promo as used (if applicable)
      const promoCode = order.promoCode;
      if (promoCode) {
        const userData = user.data()!;
        const promoUsed = userData.promoUsed || [];
        if (!promoUsed.includes(promoCode)) {
          transaction.update(userRef, {
            promoUsed: [...promoUsed, promoCode],
          });
        }

        // Increment promo usage count
        const promoDocId = order.promoDocId;
        if (promoDocId) {
          const promoRef = db.collection("promos").doc(promoDocId);
          const promoSnap = await transaction.get(promoRef);
          if (promoSnap.exists) {
            transaction.update(promoRef, {
              usedCount: FieldValue.increment(1),
            });
          }
        }
      }

      // Mark payment as completed
      transaction.update(paymentRef, {
        status: "completed",
        providerTransactionId: verifiedData.transactionid ?? null,
        callbackReceivedAt: FieldValue.serverTimestamp(),
        providerStatusCode: typeof verification.code === "string" ? verification.code.slice(0, 50) : null,
        completedAt: FieldValue.serverTimestamp(),
      });

      // Log transaction
      transaction.set(db.collection("transactions").doc(reference), {
        userId: order.userId,
        packId: order.packId,
        type: "purchase",
        seconds: secondsToCredit,
        amount: amountPaid,
        originalPrice: order.originalPrice || orderPack.priceGHS,
        discountPercent: order.discountPercent || 0,
        bonusSeconds: order.bonusSeconds || 0,
        promoCode: promoCode || null,
        paymentRef: reference,
        providerTransactionId: verifiedData.transactionid ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return privateJson({ received: true, verified: true });
  } catch (error) {
    console.error("Payment callback error:", error instanceof Error ? error.message : "unknown error");
    return errorJson(error);
  }
}
