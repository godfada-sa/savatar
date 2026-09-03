// End-to-end credit flow test.
// Creates a throwaway test account, verifies the email, grants credits, and
// exercises the reservation / refund / idempotency paths against the running
// dev server. Does NOT start real Decart generation (free of API charges).
//
// Usage: node scripts/test-credit-flow.mjs [baseUrl]
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

const env = loadEnvLocal();
const API_KEY = env.NEXT_PUBLIC_FIREBASE_API_KEY;
const PROJECT_ID = env.FIREBASE_PROJECT_ID ?? env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const ADMIN_EMAIL = env.FIREBASE_CLIENT_EMAIL;
const ADMIN_KEY = env.FIREBASE_PRIVATE_KEY;

for (const [name, val] of [
  ["NEXT_PUBLIC_FIREBASE_API_KEY", API_KEY],
  ["FIREBASE_PROJECT_ID", PROJECT_ID],
  ["FIREBASE_CLIENT_EMAIL", ADMIN_EMAIL],
  ["FIREBASE_PRIVATE_KEY", ADMIN_KEY],
]) {
  if (!val) throw new Error(`Missing ${name} in .env.local`);
}

// ── Firebase Admin (for email verify / wallet writes / cleanup) ──
const { cert, initializeApp, getApps } = await import("firebase-admin/app");
const { getAuth } = await import("firebase-admin/auth");
const { getFirestore, Timestamp } = await import("firebase-admin/firestore");
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: PROJECT_ID,
      clientEmail: ADMIN_EMAIL,
      privateKey: ADMIN_KEY.replace(/\\n/g, "\n"),
    }),
    projectId: PROJECT_ID,
  });
}
const adminAuth = getAuth();
const adminDb = getFirestore();

// ── Auth REST (create account + sign in with password) ──────────
const AUTH_URL = `https://identitytoolkit.googleapis.com/v1/accounts`;
async function authRest(endpoint, payload) {
  const res = await fetch(`${AUTH_URL}:${endpoint}?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${endpoint} failed: ${JSON.stringify(json.error ?? json)}`);
  return json;
}

const PREFIX = `buffy-credit-test-${Date.now()}`;
const EMAIL = `${PREFIX}@example.com`;
const PASSWORD = "Test-Pass-123456";

const results = [];
function log(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
};

let uid = null;
let finalBalance = null;

try {
  // 1. Sign up the test account
  const created = await authRest("signUp", {
    email: EMAIL,
    password: PASSWORD,
    returnSecureToken: true,
  });
  uid = created.localId;
  let idToken = created.idToken;
  assert(uid, "signup returned a uid");

  // REST signup skips the app's users/{uid} doc creation, so create it exactly
  // like auth-context does (wallet 0).
  await adminDb.collection("users").doc(uid).set({
    uid,
    email: EMAIL,
    displayName: "Credit Flow Test",
    photoURL: "",
    createdAt: new Date().toISOString(),
    plan: "starter",
    wallet: { balanceSeconds: 0, totalPurchased: 0, totalUsed: 0 },
    promoUsed: [],
  });

  // 2. Verify email (realtime-token requires it for password accounts), then
  // re-sign-in so the idToken carries the fresh email_verified claim.
  await adminAuth.updateUser(uid, { emailVerified: true });
  const refreshed = await authRest("signInWithPassword", {
    email: EMAIL,
    password: PASSWORD,
    returnSecureToken: true,
  });
  idToken = refreshed.idToken;

  async function getBalance() {
    const snap = await adminDb.collection("users").doc(uid).get();
    return Math.floor(Number(snap.data()?.wallet?.balanceSeconds ?? 0));
  }
  async function api(path, body) {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, json };
  }

  // 3. Insufficient balance -> server must refuse (402), balance stays 0
  {
    const { status, json } = await api("/api/realtime-token", { model: "lucy-2.5" });
    const balance = await getBalance();
    log("Insufficient balance rejected", status === 402, `status=${status} "${json.error}" balance=${balance}`);
    assert(status === 402, "expected 402 for < 60s balance");
    assert(balance === 0, "balance must stay 0");
  }

  // 4. Grant 480s (8 minutes — mirrors the reported bug scenario)
  await adminDb.collection("users").doc(uid).update({
    "wallet.balanceSeconds": 480,
    "wallet.totalPurchased": 480,
  });
  const granted = await getBalance();
  log("Credits granted", granted === 480, `balance=${granted}s`);
  assert(granted === 480, "balance should be 480 after grant");

  // 5. Reserve a session via /api/realtime-token
  const { status, json } = await api("/api/realtime-token", { model: "lucy-2.5" });
  if (status === 200) {
    const sessionId = json.sessionId;
    const reserved = json.maxSessionDuration;
    const balance = await getBalance();
    log("Session reserved (prepaid, capped at 5 min)", !!sessionId && balance === 480 - reserved, `reserved=${reserved}s balance=${balance}s`);
    assert(balance === 480 - reserved, "balance should drop by the reserved amount");

    // Wait ~6s to simulate usage, then end the stream
    await new Promise((r) => setTimeout(r, 6000));
    const end1 = await api("/api/streaming/end", { sessionId });
    const balance1 = await getBalance();
    const used = end1.json.usedSeconds;
    const refunded = end1.json.refunded;
    const okUsed = Number.isInteger(used) && used >= 5 && used <= 10;
    const okMath = balance1 === 480 - used && refunded === reserved - used;
    log("End stream refunds unused time", okUsed && okMath,
      `used=${used}s refunded=${refunded}s balance=${balance1}s (was ${balance}s)`);
    assert(okUsed && okMath, `refund math wrong: used=${used} refunded=${refunded} balance=${balance1}`);
    finalBalance = balance1;

    // 6. Idempotency: calling end again must not refund again
    const end2 = await api("/api/streaming/end", { sessionId });
    const balance2 = await getBalance();
    log("End is idempotent (no double refund)", end2.json.alreadyProcessed === true && balance2 === balance1,
      `alreadyProcessed=${end2.json.alreadyProcessed} balance=${balance2}s`);
    assert(balance2 === balance1, "balance must not change on second end call");
  } else {
    // Token issuance failed (e.g. Decart key/plan issue) — the route must
    // reverse the reservation so the user is NOT charged.
    const balance = await getBalance();
    log("Token failure reversed (no charge)", balance === 480, `status=${status} "${json.error}" balance=${balance}`);
    assert(balance === 480, "balance must be fully restored when token issuance fails");

    // Still verify the refund math by creating a session directly (as the
    // server would) and calling /api/streaming/end on it.
    const fakeId = `synthetic-${Date.now()}`;
    const startedAt = Timestamp.fromDate(new Date(Date.now() - 60_000)); // "streamed" for ~60s
    await adminDb.collection("streamSessions").doc(fakeId).set({
      userId: uid,
      model: "lucy-2.5",
      reservedSeconds: 300,
      status: "active",
      createdAt: startedAt,
      activatedAt: startedAt,
    });
    await adminDb.collection("transactions").doc(`stream-${fakeId}`).set({
      userId: uid,
      type: "usage",
      seconds: 300,
      sessionId: fakeId,
      status: "active",
      createdAt: startedAt,
    });
    const end1 = await api("/api/streaming/end", { sessionId: fakeId });
    const balance1 = await getBalance();
    const used = end1.json.usedSeconds;
    const refunded = end1.json.refunded;
    const okMath = refunded === 300 - used && balance1 === 480 + refunded && used >= 55 && used <= 65;
    log("End stream refunds unused time (synthetic session)", okMath,
      `used=${used}s refunded=${refunded}s balance=${balance1}s`);
    assert(okMath, `refund math wrong: used=${used} refunded=${refunded} balance=${balance1}`);
    finalBalance = balance1;

    const end2 = await api("/api/streaming/end", { sessionId: fakeId });
    const balance2 = await getBalance();
    log("End is idempotent (no double refund)", end2.json.alreadyProcessed === true && balance2 === balance1,
      `alreadyProcessed=${end2.json.alreadyProcessed} balance=${balance2}s`);
    assert(balance2 === balance1, "balance must not change on second end call");
  }

  // 7. Cross-user protection: another user must not end this session
  {
    const strangerSession = (await adminDb.collection("streamSessions").where("userId", "==", uid).get()).docs[0];
    if (strangerSession) {
      const stranger = await authRest("signUp", { email: `${PREFIX}-stranger@example.com`, password: PASSWORD, returnSecureToken: true });
      const res2 = await fetch(`${BASE}/api/streaming/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${stranger.idToken}` },
        body: JSON.stringify({ sessionId: strangerSession.id }),
      });
      log("Other users cannot end someone else's session", res2.status === 403, `status=${res2.status}`);
      assert(res2.status === 403, "stranger must get 403");
      await adminAuth.deleteUser(stranger.localId);
    }
  }

  // 8. Server-side hard deadline: abandoned sessions are finalized by the
  // sweep even though no client ever called /end.
  {
    const now = Date.now();
    const seedSession = async (id, activatedAt, reservedSeconds) => {
      const activatedDate = activatedAt.toDate ? activatedAt.toDate() : activatedAt;
      await adminDb.collection("streamSessions").doc(id).set({
        userId: uid,
        model: "lucy-2.5",
        reservedSeconds,
        status: "active",
        createdAt: activatedAt,
        activatedAt,
        deadlineAt: new Date(activatedDate.getTime() + reservedSeconds * 1000),
      });
      await adminDb.collection("transactions").doc(`stream-${id}`).set({
        userId: uid,
        type: "usage",
        seconds: reservedSeconds,
        sessionId: id,
        status: "active",
        createdAt: activatedAt,
      });
    };
    const expiredId = `sweep-expired-${Date.now()}`;
    const futureId = `sweep-future-${Date.now()}`;
    const expiredAt = Timestamp.fromDate(new Date(now - 400_000)); // 400s ago
    const futureAt = Timestamp.fromDate(new Date(now - 60_000)); // 60s ago
    await seedSession(expiredId, expiredAt, 300); // deadline passed 100s ago
    await seedSession(futureId, futureAt, 300); // deadline still ~240s away

    const balanceBefore = await getBalance();
    const sweep1 = await api("/api/streaming/sweep", {});
    const expiredDoc = (await adminDb.collection("streamSessions").doc(expiredId).get()).data();
    const futureDoc = (await adminDb.collection("streamSessions").doc(futureId).get()).data();
    const balanceAfter = await getBalance();
    const okSweep = sweep1.json.finalized === 1 && sweep1.json.checked === 2 && sweep1.json.refunded === 0;
    const okExpired = expiredDoc.status === "completed" && expiredDoc.usedSeconds === 300 && expiredDoc.deadlineHit === true;
    const okFuture = futureDoc.status === "active";
    const okBalance = balanceAfter === balanceBefore;
    log("Sweep finalizes only past-deadline sessions", okSweep && okExpired && okFuture && okBalance,
      `finalized=${sweep1.json.finalized} checked=${sweep1.json.checked} refunded=${sweep1.json.refunded} balance=${balanceAfter}s`);
    assert(okSweep && okExpired && okFuture && okBalance, "sweep behavior wrong");

    const sweep2 = await api("/api/streaming/sweep", {});
    log("Sweep is idempotent", sweep2.json.finalized === 0, `finalized=${sweep2.json.finalized}`);
    assert(sweep2.json.finalized === 0, "second sweep must finalize nothing");

    // A delayed /end past the deadline cannot claw back the spent reservation
    const lateEndId = `sweep-late-end-${Date.now()}`;
    await seedSession(lateEndId, Timestamp.fromDate(new Date(now - 400_000)), 300);
    const lateEnd = await api("/api/streaming/end", { sessionId: lateEndId });
    const balanceLate = await getBalance();
    const okLate = lateEnd.json.usedSeconds === 300 && lateEnd.json.refunded === 0
      && lateEnd.json.deadlineHit === true && balanceLate === balanceAfter;
    log("Delayed end past deadline gets no refund", okLate,
      `used=${lateEnd.json.usedSeconds} refunded=${lateEnd.json.refunded} deadlineHit=${lateEnd.json.deadlineHit} balance=${balanceLate}s`);
    assert(okLate, "late end must not refund past deadline");
  }

  console.log("\n───── SUMMARY ─────");
  const failed = results.filter((r) => !r.ok);
  console.log(`${results.length - failed.length}/${results.length} checks passed`);
  console.log(`Test account: ${EMAIL} / ${PASSWORD}`);
  console.log(`Final balance: ${finalBalance}s`);
  if (failed.length) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.name}`);
    process.exitCode = 1;
  }
} finally {
  // Clean up the test account + its docs (set KEEP=1 to leave the account for a UI pass)
  if (uid && process.env.KEEP !== "1") {
    await adminAuth.deleteUser(uid).catch(() => {});
    await adminDb.collection("users").doc(uid).delete().catch(() => {});
    const sessions = await adminDb.collection("streamSessions").where("userId", "==", uid).get();
    for (const d of sessions.docs) await d.ref.delete().catch(() => {});
    const txs = await adminDb.collection("transactions").where("userId", "==", uid).get();
    for (const d of txs.docs) await d.ref.delete().catch(() => {});
    console.log("Cleanup: deleted test auth user, users doc, sessions, transactions");
  }
}