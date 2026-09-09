// End a stream session for the fal test user (settles fairly via
// /api/streaming/end) and print the result.
// Usage: node scripts/end-session.mjs SESSION_ID [baseUrl]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_ID = process.argv[2];
const BASE = process.argv[3] ?? "http://localhost:50625";
const EMAIL = "swap-test@example.com";
const PASSWORD = "Fal-Test-123456";

function loadEnvLocal() {
  const p = join(__dirname, "..", ".env.local");
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
const API_KEY = loadEnvLocal().NEXT_PUBLIC_FIREBASE_API_KEY;

if (!SESSION_ID) throw new Error("Usage: node scripts/end-session.mjs SESSION_ID [baseUrl]");

// Fresh idToken.
const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
});
if (!signIn.ok) throw new Error(`signIn ${signIn.status}: ${await signIn.text()}`);
const { idToken } = await signIn.json();

const res = await fetch(`${BASE}/api/streaming/end`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
  body: JSON.stringify({ sessionId: SESSION_ID }),
});
console.log("end status:", res.status);
console.log("end body:", (await res.text()).slice(0, 400));
