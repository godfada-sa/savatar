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

    // Read and debit in one transaction. A separate read/update sequence lets
    // concurrent requests spend the same final second more than once.
    const balance = await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) throw new RequestError(404, "User not found");

      const currentBalance = Math.floor(Number(userSnap.data()?.wallet?.balanceSeconds ?? 0));
      if (!Number.isFinite(currentBalance) || currentBalance <= 0) return 0;

      transaction.update(userRef, {
        "wallet.balanceSeconds": FieldValue.increment(-1),
        "wallet.totalUsed": FieldValue.increment(1),
      });
      return currentBalance;
    });

    if (balance <= 0) {
      return privateJson({
        success: false,
        balance: 0,
        message: "No credits remaining. Purchase more to continue streaming.",
      });
    }

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
