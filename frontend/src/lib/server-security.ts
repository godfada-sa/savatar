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

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") ?? "https";
  const allowedOrigins = new Set([req.nextUrl.origin]);
  if (forwardedHost) allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
  if (process.env.APP_ORIGIN) allowedOrigins.add(process.env.APP_ORIGIN);

  if (!allowedOrigins.has(origin)) {
    throw new RequestError(403, "Cross-origin request blocked");
  }
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
    throw new RequestError(429, "Too many requests. Try again shortly.", result.retryAfter);
  }
}
