import "server-only";

import { createHash } from "node:crypto";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import { NextRequest, NextResponse } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";

export class RequestError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfter?: number
  ) {
    super(message);
  }
}

export function privateJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export function errorJson(error: unknown) {
  if (error instanceof RequestError) {
    const response = privateJson({ error: error.message }, { status: error.status });
    if (error.retryAfter) response.headers.set("Retry-After", String(error.retryAfter));
    return response;
  }
  return privateJson({ error: "Unexpected server error" }, { status: 500 });
}

export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return;

  const allowedOrigins = new Set<string>();
  if (process.env.APP_ORIGIN) allowedOrigins.add(new URL(process.env.APP_ORIGIN).origin);
  else allowedOrigins.add(req.nextUrl.origin);
  if (process.env.NODE_ENV !== "production") {
    allowedOrigins.add("http://localhost:3000");
    allowedOrigins.add("http://127.0.0.1:3000");
  }

  if (!allowedOrigins.has(origin)) {
    throw new RequestError(403, "Cross-origin request blocked");
  }
}

export function canonicalAppOrigin(req: NextRequest) {
  return process.env.APP_ORIGIN ? new URL(process.env.APP_ORIGIN).origin : req.nextUrl.origin;
}

export async function readJsonObject(req: NextRequest, maxBytes = 8_192) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new RequestError(415, "Content-Type must be application/json");
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestError(413, "Request body is too large");
  }

  const raw = await req.text();
  if (raw.length === 0 || Buffer.byteLength(raw, "utf8") > maxBytes) {
    throw new RequestError(raw.length === 0 ? 400 : 413, raw.length === 0 ? "Request body is required" : "Request body is too large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RequestError(400, "Invalid JSON body");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new RequestError(400, "JSON body must be an object");
  }
  return parsed as Record<string, unknown>;
}

export async function requireAuthenticatedUser(
  req: NextRequest,
  { requireVerifiedEmail = false }: { requireVerifiedEmail?: boolean } = {}
): Promise<DecodedIdToken> {
  const authorization = req.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new RequestError(401, "Authentication required");
  }

  const token = authorization.slice(7);
  if (!token || token.length > 8_192) {
    throw new RequestError(401, "Invalid session");
  }

  try {
    const decoded = await getAdminServices().auth.verifyIdToken(token, true);
    if (requireVerifiedEmail && decoded.firebase?.sign_in_provider === "password" && !decoded.email_verified) {
      throw new RequestError(403, "Verify your email before using payments or AI streaming");
    }
    return decoded;
  } catch (error) {
    if (error instanceof RequestError) throw error;
    throw new RequestError(401, "Invalid or expired session");
  }
}

export async function requireAdminUser(req: NextRequest): Promise<DecodedIdToken> {
  const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
  if (user.admin !== true) throw new RequestError(403, "Administrator access required");
  return user;
}

export function clientIp(req: NextRequest) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "unknown").trim();
}

export async function enforceRateLimit(
  db: Firestore,
  scope: string,
  subject: string,
  limit: number,
  windowMs: number
) {
  const digest = createHash("sha256").update(`${scope}:${subject}`).digest("hex").slice(0, 40);
  const ref = db.collection("_securityRateLimits").doc(`${scope}_${digest}`);
  const now = Date.now();

  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const data = snapshot.data();
    const windowStartedAt = Number(data?.windowStartedAt ?? 0);
    const currentCount = Number(data?.count ?? 0);
    const windowExpired = !windowStartedAt || now - windowStartedAt >= windowMs;

    if (!windowExpired && currentCount >= limit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((windowMs - (now - windowStartedAt)) / 1000)) };
    }

    transaction.set(ref, {
      scope,
      count: windowExpired ? 1 : currentCount + 1,
      windowStartedAt: windowExpired ? now : windowStartedAt,
      expiresAt: now + windowMs * 2,
    });
    return { allowed: true, retryAfter: 0 };
  });

  if (!result.allowed) {
    // State the wait so the client can show an actionable countdown instead of
    // an open-ended "shortly" (the value also rides along in Retry-After).
    throw new RequestError(429, `Too many requests. Try again in ${result.retryAfter}s.`, result.retryAfter);
  }
}

/**
 * Give one attempt back to the current window.
 *
 * enforceRateLimit consumes an attempt up front, but an authorization that
 * never produced a session is not abuse: the provider rejecting a stream
 * (fal permits one concurrent session per account) or a failed reservation
 * must not cost the creator one of their attempts. Callers refund only after
 * they have positively established that nothing ran.
 *
 * Decrementing an already-expired window is harmless — the next
 * enforceRateLimit call resets an expired window to 1 regardless of the
 * leftover count — so no window bookkeeping is needed here. Refunds are
 * idempotency-guarded by the caller, never by this helper.
 */
export async function refundRateLimit(db: Firestore, scope: string, subject: string) {
  const digest = createHash("sha256").update(`${scope}:${subject}`).digest("hex").slice(0, 40);
  const ref = db.collection("_securityRateLimits").doc(`${scope}_${digest}`);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    const currentCount = Number(snapshot.data()?.count ?? 0);
    if (!snapshot.exists || !Number.isFinite(currentCount) || currentCount <= 0) return;
    transaction.update(ref, { count: currentCount - 1 });
  });
}
