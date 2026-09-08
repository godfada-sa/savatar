import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUN = { urls: "stun:stun.l.google.com:19302" };
const EPHEMERAL_CREDENTIAL_TTL_SECONDS = 10 * 60;
// Static credentials do not expire; clients still re-fetch hourly so a rotated
// provider key propagates without a deploy.
const STATIC_CREDENTIAL_TTL_MS = 60 * 60_000;

function noStore(body: object, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Self-hosted coturn with use-auth-secret: derive per-request time-limited credentials. */
function ephemeralTurnServers(): RTCIceServer[] | null {
  const turnUrl = process.env.TURN_URL?.trim();
  const sharedSecret = process.env.TURN_SHARED_SECRET?.trim();
  if (!turnUrl || !sharedSecret) return null;
  const expiresAtSeconds = Math.floor(Date.now() / 1000) + EPHEMERAL_CREDENTIAL_TTL_SECONDS;
  const username = `${expiresAtSeconds}:savatar`;
  const credential = createHmac("sha1", sharedSecret).update(username).digest("base64");
  return [{ urls: turnUrl, username, credential }];
}

/** Managed providers (metered Open Relay and similar): fixed credentials, several transports. */
function staticTurnServers(): RTCIceServer[] | null {
  const urls = (process.env.TURN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const username = process.env.TURN_USERNAME?.trim();
  const password = process.env.TURN_PASSWORD?.trim();
  if (!urls.length || !username || !password) {
    if (urls.length || username || password) {
      console.warn("TURN is partially configured; TURN_URLS, TURN_USERNAME, and TURN_PASSWORD must be set together.");
    }
    return null;
  }
  return urls.map((url) => ({ urls: url, username, password }));
}

export async function GET(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return noStore({ error: "Cross-site credential requests are not allowed." }, 403);
  }

  // Prefer the stronger ephemeral-credential mode when both are configured.
  const turnServers = ephemeralTurnServers() ?? staticTurnServers();
  if (!turnServers) {
    return noStore({ iceServers: [STUN], expiresAt: Date.now() + 5 * 60_000 });
  }

  return noStore({
    iceServers: [STUN, ...turnServers],
    expiresAt: Date.now() + STATIC_CREDENTIAL_TTL_MS,
  });
}
