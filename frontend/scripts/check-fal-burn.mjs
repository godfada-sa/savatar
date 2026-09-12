// Account health check for the fal side of the studio:
//  - every recent session with the wall-time it held a provider session and how
//    many seconds of AI output it actually produced (wall time with gen=0 is
//    provider time nobody saw anything for)
//  - repeated balance readings while nothing streams, so a hidden drain shows up
//    as a falling number with no session running
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
// Reads FAL_KEY from .env.local by default; pass a key as argv[2] to check a
// different account. Usage: node scripts/check-fal-burn.mjs [key] [readings] [gapMs]
const KEY = process.argv[2] || env.FAL_KEY;
const READINGS = Number(process.argv[3] ?? 5);
const GAP_MS = Number(process.argv[4] ?? 20_000);
if (!KEY) throw new Error("no fal key: set FAL_KEY in .env.local or pass one as the first argument");
initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

async function balance() {
  const response = await fetch("https://rest.fal.ai/billing/user_balance", {
    headers: { Authorization: `Key ${KEY}` },
    signal: AbortSignal.timeout(15_000),
  });
  const text = (await response.text()).trim();
  return { ok: response.ok, value: Number(text), raw: text.slice(0, 60) };
}

const t = (v) => (v?.toMillis ? new Date(v.toMillis()).toISOString().slice(11, 19) : "-");
const sessions = await db.collection("streamSessions").orderBy("providerAuthorizedAt", "desc").limit(25).get();
console.log("=== recent sessions: fal session wall-time vs frames actually produced ===");
for (const d of sessions.docs) {
  const s = d.data();
  const a = s.providerAuthorizedAt?.toMillis?.();
  const e = s.endedAt?.toMillis?.();
  if (!a) continue;
  const wall = e ? Math.round((e - a) / 1000) : null;
  const gen = s.clientGenerationSeconds ?? 0;
  const flag = wall !== null && wall >= 5 && gen === 0 ? "  <-- fal time billed with ZERO output" : "";
  console.log(`${d.id.slice(0, 8)} ${t(s.providerAuthorizedAt)}→${t(s.endedAt)} wall=${wall ?? "?"}s used=${s.usedSeconds} gen=${gen} origin=${s.allowedOrigin ?? "-"}${flag}`);
}

console.log("\n=== idle balance readings (nothing of ours is streaming) ===");
const first = await balance();
console.log(`#0 $${first.value.toFixed(6)} at ${new Date().toISOString().slice(11, 19)}`);
let previous = first.value;
let burned = 0;
for (let i = 1; i <= READINGS; i += 1) {
  await new Promise((r) => setTimeout(r, GAP_MS));
  const reading = await balance();
  const delta = reading.value - previous;
  burned += Math.min(0, delta) * -1;
  console.log(`#${i} $${reading.value.toFixed(6)} at ${new Date().toISOString().slice(11, 19)} delta=${delta >= 0 ? "+" : ""}${delta.toFixed(6)}`);
  previous = reading.value;
}
console.log(`\nidle burn over ${((READINGS * GAP_MS) / 1000).toFixed(0)}s: $${burned.toFixed(6)}`);
console.log(burned > 0.0005 ? "VERDICT: something IS draining the account while idle" : "VERDICT: no meaningful drain while idle");
process.exit(0);
