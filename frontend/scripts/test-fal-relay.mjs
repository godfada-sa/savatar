import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { decode, encode } from "@msgpack/msgpack";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { WebSocket } = require("../../backend/node_modules/ws");
const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
const origin = "http://localhost:3000";
const relay = "ws://localhost:4000";
const credential = cert({
  projectId: env.FIREBASE_PROJECT_ID,
  clientEmail: env.FIREBASE_CLIENT_EMAIL,
  privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
});
initializeApp({ credential, projectId: env.FIREBASE_PROJECT_ID });
const auth = getAuth();
const db = getFirestore();
let uid;
let sessionId;

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const report = (name, detail = "") => console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);

async function api(path, body, token) {
  const response = await fetch(`${origin}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}`, Origin: origin },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  return { status: response.status, json: await response.json() };
}

try {
  const user = await auth.createUser({ email: `fal-relay-${Date.now()}@example.com`, emailVerified: true });
  uid = user.uid;
  const customToken = await auth.createCustomToken(uid);
  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const { idToken } = await signIn.json();
  assert(idToken, "Disposable sign-in failed");
  await db.collection("users").doc(uid).set({
    uid, email: user.email, displayName: "Fal relay audit", photoURL: "", plan: "starter", promoUsed: [],
    wallet: { balanceSeconds: 120, totalPurchased: 120, totalUsed: 0 },
    createdAt: new Date().toISOString(),
  });

  const reserved = await api("/api/realtime-token", { model: "lucy-2.5" }, idToken);
  assert(reserved.status === 200, `Reservation failed (${reserved.status})`);
  assert(/^[0-9a-f-]{36}\.[0-9a-f]{64}$/.test(reserved.json.apiKey), "Browser received a provider credential instead of a relay ticket");
  sessionId = reserved.json.sessionId;
  const stored = (await db.collection("streamSessions").doc(sessionId).get()).data();
  assert(stored?.transport === "fal-proxy-v1" && stored.providerToken !== reserved.json.apiKey, "Provider credential was not isolated server-side");
  report("fal credential isolated behind relay ticket");

  const firstType = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`${relay}/v1/fal-realtime?api_key=${encodeURIComponent(reserved.json.apiKey)}`, { origin, handshakeTimeout: 20_000 });
    const timer = setTimeout(() => { ws.terminate(); reject(new Error("Fal relay timed out")); }, 30_000);
    ws.on("open", () => ws.send(encode({ prompt: "Preserve the subject and replace the background with a clean studio.", enable_prompt_expansion: true })));
    ws.on("message", (raw) => {
      let message;
      try { message = decode(raw); } catch { return; }
      if (!message?.type) return;
      clearTimeout(timer);
      resolve(message.type);
      ws.close(1000, "Audit complete");
    });
    ws.on("unexpected-response", (_, response) => { clearTimeout(timer); response.resume(); reject(new Error(`Relay rejected ticket (${response.statusCode})`)); });
    ws.on("error", (error) => { clearTimeout(timer); reject(error); });
  });
  report("fal upstream handshake", `message=${firstType}`);

  let finalSession;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    finalSession = (await db.collection("streamSessions").doc(sessionId).get()).data();
    if (finalSession?.status === "completed") break;
  }
  assert(finalSession?.status === "completed", "Closed relay did not settle the stream");
  const used = Number(finalSession.usedSeconds);
  const unused = Number(finalSession.unusedSeconds);
  const wallet = (await db.collection("users").doc(uid).get()).data().wallet;
  assert(Number.isInteger(used) && used >= 0 && used <= 120, "Settled usage is invalid");
  assert(unused === 120 - used && wallet.balanceSeconds === unused && wallet.totalUsed === used, "Wallet refund math is inconsistent");
  assert(!(await db.collection("_streamLocks").doc("shared-ai-provider").get()).exists, "Global provider lock was not released");
  report("close settles usage and refunds remainder", `used=${used}s refunded=${unused}s`);

  const endAgain = await api("/api/streaming/end", { sessionId }, idToken);
  assert(endAgain.json.alreadyProcessed === true, "End endpoint is not idempotent after relay close");
  report("post-close end is idempotent");
} finally {
  if (uid) {
    for (const collection of ["streamSessions", "transactions"]) {
      const snapshot = await db.collection(collection).where("userId", "==", uid).get();
      for (const document of snapshot.docs) await document.ref.delete();
    }
    await db.collection("users").doc(uid).delete().catch(() => {});
    await auth.deleteUser(uid).catch(() => {});
  }
  console.log("Disposable fal relay data removed");
}
