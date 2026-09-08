// Create a throwaway fal-stream test account: sign up, verify email, fund the
// wallet with ~150 seconds, and print credentials.
// Usage: node scripts/create-fal-test-user.mjs [email]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";

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
    // Restore escaped newlines (dotenv-style multiline secrets).
    out[k] = v.replace(/\\n/g, "\n");
  }
  return out;
}

const env = loadEnvLocal();
const API_KEY = env.NEXT_PUBLIC_FIREBASE_API_KEY;
const PROJECT_ID = env.FIREBASE_PROJECT_ID ?? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

initializeApp({
  credential: cert({
    projectId: PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY,
  }),
});

const email = process.argv[2] ?? `fal-test-${Date.now()}@example.com`;
const password = "Fal-Test-123456";

// Sign up via the REST API (same path the browser uses).
const signUpRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password, returnSecureToken: true }),
});
if (!signUpRes.ok) throw new Error(`signUp ${signUpRes.status}: ${await signUpRes.text()}`);
const signUp = await signUpRes.json();
const uid = signUp.localId;

// Verify email so realtime-token accepts the account.
await getAuth().updateUser(uid, { emailVerified: true });

// Fund the wallet (150s ≈ 2.5 min; only ~6s will actually be spent).
const db = getFirestore();
await db.runTransaction(async (tx) => {
  tx.set(db.collection("users").doc(uid), {
    email,
    wallet: { balanceSeconds: 150, totalPurchased: 150, totalUsed: 0 },
    plan: "Standard",
    createdAt: FieldValue.serverTimestamp(),
  });
  tx.set(db.collection("transactions").doc(), {
    userId: uid,
    type: "admin",
    seconds: 150,
    adjustment: true,
    note: "fal stream test funding",
    createdAt: FieldValue.serverTimestamp(),
  });
});

console.log(JSON.stringify({ email, password, uid }, null, 2));