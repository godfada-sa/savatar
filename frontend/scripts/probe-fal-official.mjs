// Run the OFFICIAL fal.realtime.connect() and dump every onResult, so we can
// compare its behavior with my manual probes right now.
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

fal.config({ credentials: FAL_KEY });

const ENDPOINT = process.argv[2] || "decart/lucy-2-5/realtime";
const t0 = Date.now();
const ts = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

console.log(`[${ts()}] connecting via official client to ${ENDPOINT}`);
const connection = fal.realtime.connect(ENDPOINT, {
  onResult: (res) => {
    console.log(`[${ts()}] RESULT: ${JSON.stringify(res).slice(0, 1200)}`);
    // If the server sends an SDP offer, answer it so the session proceeds.
    if (res.type === "sdp" && res.sdp && res.sdp.type === "offer") {
      console.log(`[${ts()}] got server offer — sending back a dummy answer`);
    }
  },
  onError: (err) => {
    console.log(`[${ts()}] ERROR: ${err.message?.slice(0, 300)}`);
  },
});
connection.send({});
console.log(`[${ts()}] sent {} via connection.send`);

setTimeout(() => {
  console.log(`[done]`);
  try { connection.close(); } catch {}
  process.exit(0);
}, 30_000);