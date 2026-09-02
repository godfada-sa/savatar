import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { getPaystackSecret, verifyAndFulfillPaystackPayment } from "@/lib/paystack-payment";
import { privateJson } from "@/lib/server-security";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 64 * 1024;

export async function POST(req: NextRequest) {
  try {
    const declaredLength = Number(req.headers.get("content-length") ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
      return privateJson({ error: "Webhook body is too large" }, { status: 413 });
    }
    const rawBody = await req.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_WEBHOOK_BYTES) {
      return privateJson({ error: "Webhook body is too large" }, { status: 413 });
    }
    const supplied = req.headers.get("x-paystack-signature") ?? "";
    const expected = createHmac("sha512", getPaystackSecret()).update(rawBody).digest("hex");
    const suppliedBuffer = Buffer.from(supplied, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (suppliedBuffer.length !== expectedBuffer.length || !timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return privateJson({ error: "Invalid webhook signature" }, { status: 401 });
    }
    const event = JSON.parse(rawBody) as { event?: string; data?: { reference?: string } };
    if (event.event !== "charge.success" || typeof event.data?.reference !== "string") {
      return privateJson({ received: true, ignored: true });
    }
    await verifyAndFulfillPaystackPayment(event.data.reference);
    return privateJson({ received: true });
  } catch (error) {
    console.error("Paystack webhook error:", error instanceof Error ? error.message : "unknown error");
    return privateJson({ error: "Webhook processing failed" }, { status: 500 });
  }
}
