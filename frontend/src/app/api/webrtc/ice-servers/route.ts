import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CREDENTIAL_TTL_SECONDS = 10 * 60;

function noStore(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return noStore({ error: "Cross-site credential requests are not allowed." }, 403);
  }

  const turnUrl = process.env.TURN_URL?.trim();
  const sharedSecret = process.env.TURN_SHARED_SECRET?.trim();
  const stun = { urls: "stun:stun.l.google.com:19302" };
  if (!turnUrl || !sharedSecret) {
    return noStore({ iceServers: [stun], expiresAt: Date.now() + 5 * 60_000 });
  }

  const expiresAtSeconds = Math.floor(Date.now() / 1000) + CREDENTIAL_TTL_SECONDS;
  const username = `${expiresAtSeconds}:savatar`;
  const credential = createHmac("sha1", sharedSecret).update(username).digest("base64");

  return noStore({
    iceServers: [stun, { urls: turnUrl, username, credential }],
    expiresAt: expiresAtSeconds * 1000,
  });
}
