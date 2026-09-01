import { randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { getCreditPack } from "@/lib/credit-packs";
import { getAdminServices } from "@/lib/firebase-admin";

const MOOLRE_BASE_URL = process.env.MOOLRE_BASE_URL ?? "https://api.moolre.com";

const networkMap = {
  mtn: "13",
  telecel: "6",
  airteltigo: "7",
} as const;

interface PaymentRequest {
  packId?: string;
  phone?: string;
  method?: keyof typeof networkMap;
}

function serverVariable(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing server environment variable: ${name}`);
  return value;
}

function bearerToken(req: NextRequest) {
  const authorization = req.headers.get("authorization");
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null;
}

export async function POST(req: NextRequest) {
  try {
    const token = bearerToken(req);
    if (!token) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { auth, db } = getAdminServices();
    let user;
    try {
      user = await auth.verifyIdToken(token);
    } catch {
      return NextResponse.json({ error: "Invalid or expired session" }, { status: 401 });
    }
    const body = (await req.json()) as PaymentRequest;
    const pack = body.packId ? getCreditPack(body.packId) : undefined;
    const channel = body.method ? networkMap[body.method] : undefined;
    const phone = body.phone?.replace(/\D/g, "") ?? "";

    if (!pack || !channel || !/^0\d{9}$/.test(phone)) {
      return NextResponse.json(
        { error: "Choose a valid credit pack, network, and 10-digit Ghana phone number" },
        { status: 400 }
      );
    }

    const apiUser = serverVariable("MOOLRE_API_USER");
    const publicKey = serverVariable("MOOLRE_PUBLIC_KEY");
    const accountNumber = serverVariable("MOOLRE_ACCOUNT_NUMBER");
    const reference = `savatar-${randomUUID()}`;
    const paymentRef = db.collection("payments").doc(reference);

    await paymentRef.set({
      reference,
      userId: user.uid,
      packId: pack.id,
      seconds: pack.seconds,
      amount: pack.priceGHS,
      currency: "GHS",
      accountNumber,
      phone,
      channel,
      status: "pending",
      createdAt: FieldValue.serverTimestamp(),
    });

    const response = await fetch(`${MOOLRE_BASE_URL}/open/transact/payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-USER": apiUser,
        "X-API-PUBKEY": publicKey,
      },
      body: JSON.stringify({
        type: 1,
        channel,
        currency: "GHS",
        payer: phone,
        amount: pack.priceGHS.toFixed(2),
        externalref: reference,
        accountnumber: accountNumber,
      }),
    });

    const result = (await response.json()) as {
      status?: number | string;
      code?: string;
      message?: string | null;
      data?: unknown;
    };

    if (!response.ok || Number(result.status) !== 1) {
      await paymentRef.update({
        status: "initiation_failed",
        providerCode: result.code ?? null,
        providerMessage: result.message ?? null,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json(
        { error: result.message || "Payment initiation failed" },
        { status: 502 }
      );
    }

    await paymentRef.update({
      providerPaymentId: result.data ?? null,
      providerCode: result.code ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      success: true,
      reference,
      paymentId: result.data ?? reference,
      amount: pack.priceGHS,
      message: result.message || "Payment initiated. Approve the prompt on your phone.",
    });
  } catch (error) {
    console.error("Payment initiation error:", error);
    const message = error instanceof Error && error.message.startsWith("Missing server environment variable")
      ? "Payment service is not configured"
      : "Unable to initiate payment";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
