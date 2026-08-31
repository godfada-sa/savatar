import { NextRequest, NextResponse } from "next/server";
import { initializeApp, getApps, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Initialize Firebase Admin with service account
const firebaseConfig = {
  projectId: "savatar-a7e75",
  // For production, use a service account key file
  // For now, use the project ID for basic Firestore access
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];
const db = getFirestore(app);

const CREDIT_PACKS: Record<string, { seconds: number; priceGHS: number }> = {
  starter: { seconds: 300, priceGHS: 250 },
  basic: { seconds: 900, priceGHS: 650 },
  pro: { seconds: 1800, priceGHS: 1100 },
  creator: { seconds: 3600, priceGHS: 1800 },
  unlimited: { seconds: 18000, priceGHS: 7500 },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    console.log("Moolre callback received:", JSON.stringify(body, null, 2));

    const { status, reference, payment_id, amount, metadata } = body;

    // Only process successful payments
    if (status !== "successful" && status !== "completed") {
      console.log("Payment not successful, status:", status);
      return NextResponse.json({ received: true });
    }

    // Extract metadata
    const userId = metadata?.userId || reference?.split("-")[1];
    const packId = metadata?.packId || reference?.split("-")[2];
    const seconds = parseInt(metadata?.seconds) || CREDIT_PACKS[packId]?.seconds || 0;

    if (!userId || !packId || !seconds) {
      console.error("Missing metadata in callback:", { userId, packId, seconds });
      return NextResponse.json({ error: "Missing metadata" }, { status: 400 });
    }

    // Idempotency check
    const paymentRef = db.collection("payments").doc(payment_id || reference);
    const paymentDoc = await paymentRef.get();

    if (paymentDoc.exists) {
      console.log("Payment already processed:", payment_id);
      return NextResponse.json({ received: true, message: "Already processed" });
    }

    // Get user
    const userRef = db.collection("users").doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      console.error("User not found:", userId);
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Atomic batch update
    const batch = db.batch();

    const currentBalance = userDoc.data()?.wallet?.balanceSeconds || 0;
    const currentPurchased = userDoc.data()?.wallet?.totalPurchased || 0;

    batch.update(userRef, {
      "wallet.balanceSeconds": currentBalance + seconds,
      "wallet.totalPurchased": currentPurchased + seconds,
    });

    batch.set(paymentRef, {
      userId,
      packId,
      seconds,
      amount,
      paymentId: payment_id,
      reference,
      status: "completed",
      createdAt: new Date().toISOString(),
    });

    const transactionRef = db.collection("transactions").doc();
    batch.set(transactionRef, {
      userId,
      type: "purchase",
      seconds,
      amount,
      paymentRef: payment_id || reference,
      createdAt: new Date().toISOString(),
    });

    await batch.commit();

    console.log(`Payment confirmed: ${seconds} seconds added to user ${userId}`);

    return NextResponse.json({
      success: true,
      message: `Added ${seconds} seconds to user ${userId}`,
    });
  } catch (error) {
    console.error("Payment callback error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
