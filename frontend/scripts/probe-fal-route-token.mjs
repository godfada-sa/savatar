// Verify the EXACT token-minting path used by /api/realtime-token:
// POST https://rest.fal.ai/tokens/realtime  { app, duration }
// then connect with the official client (as the browser will) and confirm
// the server accepts the token (ready + iceServers before any concurrency
// error). This validates the route's token end-to-end.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fal } from "@fal-ai/client";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  const p = join(__dirname, "..", ".env.local");
  if (!existsSync(p)) throw new Error(".env.local not found");
  const out = {};
  for (const raw of readFileSync(p, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    let k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

const env = loadEnvLocal();
const FAL_KEY = env.FAL_KEY || process.env.FAL_KEY;
if (!FAL_KEY) { console.error("FAL_KEY missing"); process.exit(1); }

const ENDPOINT = process.argv[2] || "decart/lucy-2-5/realtime";

// Exact replica of mintFalRealtimeToken in realtime-token/route.ts.
async function mintLikeRoute() {
  const appAlias = ENDPOINT.split("/")[1] ?? ENDPOINT;
  const res = await fetch("https://rest.fal.ai/tokens/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${FAL_KEY}` },
    body: JSON.stringify({ allowed_apps: [appAlias], token_expiration: 120 }),
  });
  if (!res.ok) throw new Error(`token ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = (await res.text()).trim();
  let token = text;
  if (text.startsWith("{")) {
    const obj = JSON.parse(text);
    token = obj.token ?? obj.detail ?? "";
  } else if (text.startsWith('"')) {
    token = JSON.parse(text);
  }
  return { token };
}

// The realtime client resolves config globally; configure the credentials so
// the client is fully initialized (browser flow does this implicitly).
fal.config({ credentials: FAL_KEY });

const minted = await mintLikeRoute();
const token = minted.token;
console.log(`[mint] route-style token obtained`);

// Browser-style connect: official client, tokenProvider returns the route token.
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
console.log(`[${ts()}] connecting via official client with route-minted token`);
const connection = fal.realtime.connect(ENDPOINT, {
  connectionKey: `route-token-check-${Date.now()}`,
  throttleInterval: 0,
  tokenProvider: async () => token,
  onResult: (res) => {
    console.log(`[${ts()}] RESULT: ${JSON.stringify(res).slice(0, 400)}`);
  },
  onError: (err) => {
    console.log(`[${ts()}] ERROR: ${err.message?.slice(0, 300)}`);
  },
});
connection.send({});

setTimeout(() => {
  console.log(`[done]`);
  try { connection.close(); } catch {}
  process.exit(0);
}, 20_000);
