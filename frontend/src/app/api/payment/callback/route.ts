import { NextRequest, NextResponse } from "next/server";
import { verifyAndFulfillPaystackPayment } from "@/lib/paystack-payment";
import { canonicalAppOrigin } from "@/lib/server-security";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference") ?? "";
  try {
    const result = await verifyAndFulfillPaystackPayment(reference);
    const url = new URL("/credits", canonicalAppOrigin(req));
    url.searchParams.set("payment", result.verified ? "success" : "pending");
    url.searchParams.set("ref", reference);
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Paystack callback error:", error instanceof Error ? error.message : "unknown error");
    const url = new URL("/credits", canonicalAppOrigin(req));
    url.searchParams.set("payment", "failed");
    if (reference) url.searchParams.set("ref", reference);
    return NextResponse.redirect(url);
  }
}
