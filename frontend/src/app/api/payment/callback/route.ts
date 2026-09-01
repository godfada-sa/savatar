import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { getCreditPack } from "@/lib/credit-packs";
import { getAdminServices } from "@/lib/firebase-admin";

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

export async function POST(req: NextRequest) {
  try {
    const payload = record(await req.json());
    const callbackData = record(payload.data);
    const reference =
      text(callbackData.externalref) ??
      text(callbackData.externalRef) ??
      text(payload.externalref) ??
      text(payload.reference);

    if (!reference) {
      return NextResponse.json({ error: "Missing payment reference" }, { status: 400 });
    }

    const apiUser = serverVariable("MOOLRE_API_USER");
    const publicKey = serverVariable("MOOLRE_PUBLIC_KEY");
    const accountNumber = serverVariable("MOOLRE_ACCOUNT_NUMBER");
    const { db } = getAdminServices();
    const paymentRef = db.collection("payments").doc(reference);
    const paymentSnapshot = await paymentRef.get();

    if (!paymentSnapshot.exists) {
      return NextResponse.json({ error: "Unknown payment reference" }, { status: 404 });
    }

    if (paymentSnapshot.data()?.status === "completed") {
      return NextResponse.json({ received: true, message: "Already processed" });
    }

    // Treat callbacks as notifications; verify the final state directly with Moolre.
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
    });

    const verification = record(await verificationResponse.json());
    const verifiedData = record(verification.data);
    const payment = paymentSnapshot.data()!;
    const pack = getCreditPack(String(payment.packId ?? ""));
    const verifiedAmount = Number(verifiedData.amount);
    const isVerified =
      Boolean(pack) &&
      verificationResponse.ok &&
      Number(verification.status) === 1 &&
      Number(verifiedData.txstatus) === 1 &&
      text(verifiedData.externalref) === reference &&
      text(verifiedData.accountnumber) === accountNumber &&
      Number.isFinite(verifiedAmount) &&
      Math.abs(verifiedAmount - Number(pack?.priceGHS)) < 0.01;

    if (!isVerified) {
      await paymentRef.update({
        status: "verification_pending",
        callbackReceivedAt: FieldValue.serverTimestamp(),
        providerStatusCode: verification.code ?? null,
      });
      return NextResponse.json({ received: true, verified: false });
    }

    await db.runTransaction(async (transaction) => {
      const freshPayment = await transaction.get(paymentRef);
      const order = freshPayment.data();
      if (!order || order.status === "completed") return;

      const orderPack = getCreditPack(String(order.packId ?? ""));
      if (
        !orderPack ||
        Number(order.amount) !== orderPack.priceGHS ||
        Number(order.seconds) !== orderPack.seconds ||
        order.accountNumber !== accountNumber
      ) {
        throw new Error("Stored payment order does not match the server catalog");
      }

      const userRef = db.collection("users").doc(order.userId);
      const user = await transaction.get(userRef);
      if (!user.exists) throw new Error("Payment user does not exist");

      transaction.update(userRef, {
        "wallet.balanceSeconds": FieldValue.increment(orderPack.seconds),
        "wallet.totalPurchased": FieldValue.increment(orderPack.seconds),
      });

      transaction.update(paymentRef, {
        status: "completed",
        providerTransactionId: verifiedData.transactionid ?? null,
        callbackPayload: payload,
        completedAt: FieldValue.serverTimestamp(),
      });

      transaction.set(db.collection("transactions").doc(reference), {
        userId: order.userId,
        packId: order.packId,
        type: "purchase",
        seconds: orderPack.seconds,
        amount: orderPack.priceGHS,
        paymentRef: reference,
        providerTransactionId: verifiedData.transactionid ?? null,
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ received: true, verified: true });
  } catch (error) {
    console.error("Payment callback error:", error);
    return NextResponse.json({ error: "Unable to process payment callback" }, { status: 500 });
  }
}
