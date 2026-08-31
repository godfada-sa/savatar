import { NextRequest, NextResponse } from "next/server";

const MOOLRE_PUBLIC_KEY = process.env.MOOLRE_PUBLIC_KEY;
const MOOLRE_BASE_URL = "https://api.moolre.com/v1";

interface PaymentRequest {
  packId: string;
  userId: string;
  email: string;
  phone: string;
  method: "mtn" | "telecel" | "airteltigo";
  amount: number;
  seconds: number;
}

export async function POST(req: NextRequest) {
  try {
    const body: PaymentRequest = await req.json();
    const { packId, userId, email, phone, method, amount, seconds } = body;

    if (!packId || !userId || !phone || !amount || !seconds) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Map payment method to Moolre network codes
    const networkMap: Record<string, string> = {
      mtn: "MTN",
      telecel: "TELECEL",
      airteltigo: "AIRTELTIGO",
    };

    const reference = `savatar-${userId}-${packId}-${Date.now()}`;

    // Initiate payment with Moolre
    const moolreResponse = await fetch(`${MOOLRE_BASE_URL}/payment/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MOOLRE_PUBLIC_KEY}`,
      },
      body: JSON.stringify({
        amount: amount,
        currency: "GHS",
        phone: phone.replace(/\s/g, ""),
        network: networkMap[method] || "MTN",
        reference,
        description: `Savatar ${packId} credit pack - ${seconds} seconds`,
        callback_url: `${req.nextUrl.origin}/api/payment/callback`,
        metadata: {
          userId,
          packId,
          seconds: seconds.toString(),
          email,
        },
      }),
    });

    const moolreData = await moolreResponse.json();

    if (!moolreResponse.ok) {
      console.error("Moolre payment initiation failed:", moolreData);
      return NextResponse.json(
        { error: "Payment initiation failed", details: moolreData },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      paymentId: moolreData.payment_id || moolreData.id || reference,
      status: moolreData.status,
      message: "Payment initiated. Check your phone for the payment prompt.",
    });
  } catch (error) {
    console.error("Payment API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
