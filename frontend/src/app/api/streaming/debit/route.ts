import { FieldValue } from "firebase-admin/firestore";
import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import {
  assertSameOrigin,
  enforceRateLimit,
  errorJson,
  privateJson,
  requireAuthenticatedUser,
  RequestError,
} from "@/lib/server-security";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req);
    const { db } = getAdminServices();
    const userRef = db.collection("users").doc(user.uid);

    // Rate limit: max 1 debit per 800ms (slightly faster than 1/sec to account for network)
    await enforceRateLimit(db, "streaming-debit", user.uid, 75, 60_000);

    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new RequestError(404, "User not found");
    }

    const data = userSnap.data()!;
    const balance = data?.wallet?.balanceSeconds || 0;

    if (balance <= 0) {
      return privateJson({
        success: false,
        balance: 0,
        message: "No credits remaining. Purchase more to continue streaming.",
      });
    }

    // Deduct one second
    await userRef.update({
      "wallet.balanceSeconds": FieldValue.increment(-1),
      "wallet.totalUsed": FieldValue.increment(1),
    });

    return privateJson({
      success: true,
      balance: balance - 1,
      message: "Debited 1 second",
    });
  } catch (error) {
    if (error instanceof RequestError) return errorJson(error);
    console.error("Streaming debit error:", error);
    return privateJson({ error: "Debit failed" }, { status: 500 });
  }
}
