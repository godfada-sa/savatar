// Probe the fal.ai lucy-2.5 realtime signaling protocol.
// Mint a short-lived JWT from FAL_KEY (frontend/.env.local) and connect to the
// realtime WebSocket, dumping every inbound message so we can map the WebRTC
// handshake (iceServers / sdp / candidate flow) that fal.realtime.connect()
// documents but does not implement.
//
// Usage:  node scripts/probe-fal-realtime.mjs [model] [durationSeconds]
//   model defaults to decart/lucy-2-5/realtime
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load frontend/.env.local (tiny parser, no deps) ─────────────
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
if (!FAL_KEY) {
  console.error("FAL_KEY is not set in frontend/.env.local");
  process.exit(1);
}

const ENDPOINT = process.argv[2] || "decart/lucy-2-5/realtime";
const DURATION = Number(process.argv[3] || 120);

// Try to use msgpackr if @fal-ai/client pulled it in, so binary messages decode.
let msgpack = null;
try { msgpack = (await import("msgpackr")).default ?? (await import("msgpackr")); } catch { /* optional */ }

async function mintToken() {
  const res = await fetch("https://rest.fal.ai/tokens/realtime", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${FAL_KEY}` },
    body: JSON.stringify({ app: ENDPOINT, duration: DURATION }),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  console.log(`[token] minted, expiresAt=${data.expiresAt ?? "?"}`);
  return data.token;
}

const token = await mintToken();
const url = `wss://fal.run/${ENDPOINT}?fal_jwt_token=${encodeURIComponent(token)}`;
console.log(`[ws] connecting to ${url.replace(/token=.*/, "token=…")}`);
const ws = new WebSocket(url);
let messageNo = 0;

function describe(data) {
  if (typeof data === "string") return data.slice(0, 1000);
  if (Buffer.isBuffer(data) || data instanceof ArrayBuffer) {
    const buf = Buffer.from(data);
    // Try JSON (the unauthenticated handshake used JSON), then msgpack.
    const asText = buf.toString("utf8");
    if (asText.trim().startsWith("{")) return asText.slice(0, 1000);
    if (msgpack) {
      try { return JSON.stringify(msgpack.decode(buf)).slice(0, 1000); }
      catch { /* fall through to hex */ }
    }
    return `buffer(${buf.length}b) hex=${buf.toString("hex").slice(0, 400)}`;
  }
  return String(data).slice(0, 1000);
}

ws.on("open", async () => {
  console.log("[open] connected");
  // Kick the session off with the documented no-op input. The fal client
  // default-encodes messages as msgpack; FORMAT env/arg switches to JSON.
  const FORMAT = process.argv[5] || "msgpack";
  const initial = {};
  if (FORMAT === "msgpack" && msgpack) {
    ws.send(msgpack.pack(initial));
    console.log("[send] {} (msgpack)");
  } else {
    ws.send(JSON.stringify(initial));
    console.log("[send] {} (json)");
  }
});

ws.on("message", (data) => {
  messageNo += 1;
  console.log(`[msg ${messageNo}]`, describe(data));
});

ws.on("close", (code, reason) => console.log(`[close] code=${code} reason=${reason.toString().slice(0, 200)}`));
ws.on("error", (e) => console.log("[error]", e.message.slice(0, 300)));

const timeoutMs = Number(process.argv[4] || 20_000);
setTimeout(() => {
  console.log(`[done] saw ${messageNo} messages over ${Math.round(timeoutMs / 1000)}s`);
  try { ws.close(); } catch { /* ignore */ }
  process.exit(0);
}, timeoutMs);