import { createDecartClient } from "@decartai/sdk";
import { NextRequest } from "next/server";
import { getAdminServices } from "@/lib/firebase-admin";
import {
  assertSameOrigin,
  enforceRateLimit,
  errorJson,
  privateJson,
  readJsonObject,
  requireAuthenticatedUser,
  RequestError,
} from "@/lib/server-security";

export const runtime = "nodejs";

const ALLOWED_MODELS = new Set(["lucy-latest", "lucy-restyle-latest", "lucy-vton-latest"]);

function permanentApiKey() {
  const value = process.env.DECART_API_KEY;
  if (!value) throw new Error("DECART_API_KEY is not configured");
  return value;
}

export async function POST(req: NextRequest) {
  try {
    assertSameOrigin(req);
    const user = await requireAuthenticatedUser(req, { requireVerifiedEmail: true });
    const body = await readJsonObject(req, 2_048);
    const model = typeof body.model === "string" ? body.model : "";
    if (!ALLOWED_MODELS.has(model)) throw new RequestError(400, "Unsupported realtime model");

    const { db } = getAdminServices();
    await enforceRateLimit(db, "realtime-token", user.uid, 3, 5 * 60_000);

    const userSnapshot = await db.collection("users").doc(user.uid).get();
    const balanceSeconds = Math.floor(Number(userSnapshot.data()?.wallet?.balanceSeconds ?? 0));
    if (!userSnapshot.exists || balanceSeconds <= 0) {
      throw new RequestError(402, "Streaming credits are required");
    }

    const origin = req.headers.get("origin") ?? process.env.APP_ORIGIN ?? req.nextUrl.origin;
    const maxSessionDuration = Math.min(balanceSeconds, 300);
    const decart = createDecartClient({ apiKey: permanentApiKey() });
    const token = await decart.tokens.create({
      expiresIn: 120,
      allowedModels: [model],
      allowedOrigins: [origin],
      constraints: { realtime: { maxSessionDuration } },
      metadata: { userId: user.uid, service: "savatar" },
    });

    return privateJson({
      apiKey: token.apiKey,
      expiresAt: token.expiresAt,
      maxSessionDuration,
    });
  } catch (error) {
    console.error("Realtime token error:", error instanceof Error ? error.message : "unknown error");
    return errorJson(error);
  }
}
