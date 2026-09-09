import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STUN = { urls: "stun:stun.l.google.com:19302" };
// 1 hour: metered credentials need up to 2 minutes to propagate across their
// network before they can allocate, so a very short TTL risks handing browsers
// credentials that are still in their propagation window (observed live).
const EPHEMERAL_CREDENTIAL_TTL_SECONDS = 60 * 60;
// Static credentials do not expire; clients still re-fetch hourly so a rotated
// provider key propagates without a deploy.
const STATIC_CREDENTIAL_TTL_MS = 60 * 60_000;
let meteredCache: { servers: RTCIceServer[]; expiresAt: number } | null = null;

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
  return urls.map((url) => ({ urls: url, username, credential: password }));
}

/** Create and cache an expiring Metered credential; the account secret stays server-side. */
async function meteredTurnServers() {
  if (meteredCache && meteredCache.expiresAt - 60_000 > Date.now()) return meteredCache;
  const domain = process.env.METERED_DOMAIN?.trim().toLowerCase();
  const secret = process.env.METERED_SECRET_KEY?.trim();
  if (!domain || !secret) return null;
  if (!/^[a-z0-9.-]+\.metered\.live$/.test(domain)) throw new Error("METERED_DOMAIN is invalid");

  const createUrl = new URL(`https://${domain}/api/v1/turn/credential`);
  createUrl.searchParams.set("secretKey", secret);
  const createdResponse = await fetch(createUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expiryInSeconds: EPHEMERAL_CREDENTIAL_TTL_SECONDS, label: "savatar-web" }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const created = await createdResponse.json() as { apiKey?: string };
  if (!createdResponse.ok || !created.apiKey) throw new Error("Metered credential creation failed");

  const listUrl = new URL(`https://${domain}/api/v1/turn/credentials`);
  listUrl.searchParams.set("apiKey", created.apiKey);
  const listResponse = await fetch(listUrl, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
  const list = await listResponse.json() as Array<{ urls?: string | string[]; username?: string; password?: string; credential?: string }>;
  if (!listResponse.ok || !Array.isArray(list)) throw new Error("Metered ICE server lookup failed");
  const servers: RTCIceServer[] = list
    .filter((item) => item.urls && item.username && (item.credential || item.password))
    .map((item) => ({ urls: item.urls!, username: item.username!, credential: item.credential ?? item.password! }));
  if (!servers.length) throw new Error("Metered returned no TURN servers");
  meteredCache = { servers, expiresAt: Date.now() + EPHEMERAL_CREDENTIAL_TTL_SECONDS * 1000 };
  return meteredCache;
}

export async function GET(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return noStore({ error: "Cross-site credential requests are not allowed." }, 403);
  }

  // Prefer expiring credentials. Static managed credentials are a compatibility fallback.
  const coturn = ephemeralTurnServers();
  let managed: { servers: RTCIceServer[]; expiresAt: number } | null = null;
  if (!coturn) {
    try { managed = await meteredTurnServers(); } catch (error) {
      console.error("Expiring TURN credential request failed:", error instanceof Error ? error.message : "unknown error");
    }
  }
  const turnServers = coturn ?? managed?.servers ?? staticTurnServers();
  if (!turnServers) {
    return noStore({ iceServers: [STUN], expiresAt: Date.now() + 5 * 60_000 });
  }

  return noStore({
    iceServers: [STUN, ...turnServers],
    expiresAt: coturn
      ? Date.now() + EPHEMERAL_CREDENTIAL_TTL_SECONDS * 1000
      : managed?.expiresAt ?? Date.now() + STATIC_CREDENTIAL_TTL_MS,
  });
}
