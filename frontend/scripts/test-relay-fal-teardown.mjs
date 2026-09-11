// Regression test: the fal relay must not compete with itself for the provider's
// single session slot, and a client Stop must hand the slot back cleanly.
//
// Runs the REAL backend relay locally against a local stub "fal" upstream and a
// real Firestore session (disposable user, deleted afterwards), so it can prove,
// without touching production or fal:
//   1. how many upstream sockets ONE client session opens while the provider
//      keeps reporting "Concurrent session limit reached" (was 11, must be <= 3)
//   2. that every provider socket is released with a close frame, never killed
//      at the TCP level (an abrupt kill leaves the provider holding the session,
//      which is what keeps an account locked out after Stop)
//   3. that a rejected session bills nothing and a healthy one settles normally
//
// Usage: node scripts/test-relay-fal-teardown.mjs [busy|healthy] [all]
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";

// Must be set BEFORE the relay module loads: it reads this at import time.
const FAL_PORT = Number(process.env.STUB_FAL_PORT ?? 47801);
process.env.FAL_REALTIME_BASE_URL = `ws://127.0.0.1:${FAL_PORT}`;

// Resolve the relay, ws AND firebase-admin from the backend's own tree: the
// relay's transactions reject transform objects created by a different copy of
// the SDK ("Couldn't serialize object of type ServerTimestampTransform").
const backendRequire = createRequire(new URL("../../backend/package.json", import.meta.url));
const { attachDecartProxy, claimTicket } = backendRequire("./decart-proxy.js");
const { WebSocketServer, WebSocket } = backendRequire("ws");
const { cert, initializeApp } = backendRequire("firebase-admin/app");
const { getFirestore } = backendRequire("firebase-admin/firestore");

const MODE = process.argv[2] ?? "busy"; // busy | healthy | abrupt
const RELAY_PORT = 47802;
// Seconds the harness pretends the app reserved for this session.
const reserved = 120;
const ORIGIN = "http://localhost:3000";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }),
);
initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

const log = (...a) => console.log(`[${String(Date.now() % 100000).padStart(5)}]`, ...a);

// ── stub provider ("fal") ────────────────────────────────────────────
const upstreams = [];
const falWss = new WebSocketServer({ port: FAL_PORT });
falWss.on("connection", (socket) => {
  const n = upstreams.length + 1;
  const record = { n, at: Date.now(), closed: null };
  upstreams.push(record);
  log(`UPSTREAM #${n} opened`);
  const jsonFrame = (obj) => Buffer.from(JSON.stringify(obj));
  socket.send(jsonFrame({ type: "x-fal-message", action: "timings", timing: 0 }));
  // A couple of binary frames that look like fal's msgpack acceptance burst.
  socket.send(Buffer.concat([Buffer.from([0x82]), Buffer.from("iceServers")]));
  socket.send(Buffer.concat([Buffer.from([0x81]), Buffer.from("ready")]));
  // A provider that keeps the session open the way fal does while it waits.
  const keepAlive = setInterval(() => {
    try { socket.send(jsonFrame({ type: "x-fal-message", action: "timings", timing: 1 })); } catch { /* gone */ }
  }, 5_000);
  socket.on("close", () => clearInterval(keepAlive));
  if (MODE === "busy") {
    socket.send(Buffer.from(JSON.stringify({
      type: "error", error: "Concurrent session limit reached.",
    })));
  }

  socket.on("close", (code, reason) => {
    record.closed = { code, reason: String(reason), graceful: code !== 1006, at: Date.now() };
    log(`UPSTREAM #${n} closed code=${code} graceful=${code !== 1006} after ${Date.now() - record.at}ms`);
  });
  socket.on("error", (e) => log(`UPSTREAM #${n} error: ${e.message}`));
});

// ── real relay ──────────────────────────────────────────────────────
const relayServer = createServer();
attachDecartProxy(relayServer, { allowedOrigins: [ORIGIN], getDb: () => db });
await new Promise((r) => relayServer.listen(RELAY_PORT, "127.0.0.1", r));
log(`relay listening on ${RELAY_PORT} (mode=${MODE})`);

// ── disposable session in Firestore ─────────────────────────────────
const uid = `tmp-relay-${randomUUID().slice(0, 8)}`;
const sessionId = randomUUID();
const ticket = `${sessionId}.${"a".repeat(64)}`;
await db.collection("users").doc(uid).set({ wallet: { balanceSeconds: reserved, totalUsed: reserved } });
await db.collection("_streamLocks").doc("shared-ai-provider").set({
  sessionId, userId: uid, provider: "fal", status: "reserving",
  expiresAt: new Date(Date.now() + 120_000), createdAt: new Date(),
});
await db.collection("transactions").doc(`stream-${sessionId}`).set({ userId: uid, type: "usage", seconds: 120, status: "reserved" });
await db.collection("streamSessions").doc(sessionId).set({
  userId: uid, transport: "fal-proxy-v1", providerEndpoint: "decart/lucy-2-5/realtime",
  providerToken: "stub-token", status: "active", reservedSeconds: 120,
  ticketHash: createHash("sha256").update(ticket).digest("hex"),
  allowedOrigin: ORIGIN,
  ticketExpiresAt: new Date(Date.now() + 300_000),
  deadlineAt: new Date(Date.now() + 120_000),
  createdAt: new Date(),
});

// Sanity: prove the ticket is claimable before the relay is in the way.
try {
  await claimTicket(db, ticket, ORIGIN, "fal-proxy-v1");
  log("claimTicket OK");
} catch (error) {
  log(`claimTicket FAILED: ${error.message}`);
  process.exit(1);
}

// ── client: one "Go Live" ───────────────────────────────────────────
const ws = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/v1/fal-realtime?api_key=${ticket}`, { headers: { Origin: ORIGIN } });
let relayMessages = 0;
ws.on("open", () => log("CLIENT connected to relay"));
ws.on("message", (data, isBinary) => {
  relayMessages++;
  const text = isBinary ? `<binary ${data.length}b>` : String(data).slice(0, 120);
  log(`CLIENT <- relay msg #${relayMessages}: ${text}`);
});
ws.on("close", (code) => log(`CLIENT closed code=${code}`));
ws.on("error", (e) => log(`CLIENT error: ${e.message}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Observe the retry storm window before simulating a Stop.
await wait(MODE === "busy" ? 22_000 : 4_000);
const stopAt = Date.now();

if (MODE === "abrupt") {
  // A phone that sleeps or loses signal: the connection stays half-open at the
  // TCP level and the peer simply stops answering. Nothing sends a close frame,
  // so only a liveness check can tell the relay the creator is gone.
  log("--- half-open: peer stops answering, socket stays up (phone slept) ---");
  ws._socket.pause();
} else {
  log(`--- Stop: client closing its WebSocket (this is what the Stop button does) ---`);
  ws.close(1000, "Session ended");
}

// Poll until the relay's settlement lands, so the refund timing is visible.
let settled = null;
for (let i = 0; i < 40; i++) {
  await wait(250);
  const snap = (await db.collection("streamSessions").doc(sessionId).get()).data();
  if (snap?.status && snap.status !== "active") { settled = { waitedMs: (i + 1) * 250, ...snap }; break; }
}
const wallet = (await db.collection("users").doc(uid).get()).data() ?? {};
log(`settlement observed after ${settled ? `${settled.waitedMs}ms` : "40x250ms (STILL ACTIVE)"}`);

// A vanished browser must not leave the provider running until the deadline.
if (MODE === "abrupt") {
  for (let i = 0; i < 90 && upstreams.every((u) => !u.closed); i++) await wait(1_000);
  log(`provider socket ${upstreams.every((u) => !u.closed) ? "IS STILL OPEN (provider still billing)" : "was released"}`);
}

console.log(`\n================ RESULTS (${MODE}) ================`);
const PASS = (name, detail = "") => console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
const FAIL = (name, detail = "") => { console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); process.exitCode = 1; };
const stillOpen = upstreams.filter((u) => !u.closed);
const abrupt = upstreams.filter((u) => u.closed && !u.closed.graceful);

const check = (ok, name, detail = "") => (ok ? PASS(name, detail) : FAIL(name, detail));
const budget = MODE === "busy" ? 3 : 1;

check(upstreams.length <= budget, `provider sockets per Go Live = ${upstreams.length}`,
  MODE === "busy" ? `bounded at ${budget}, was 11 before the fix` : "exactly one, as it must be");
check(stillOpen.length === 0, "client Stop released every provider socket",
  stillOpen.length ? `${stillOpen.length} still open` : "nothing left behind");
check(abrupt.length === 0, "every provider socket closed with a close frame",
  abrupt.length ? `${abrupt.length} killed at the TCP level` : "no TCP-level kills that strand the slot");

if (MODE === "abrupt") {
  const heldMs = upstreams[0]?.closed ? upstreams[0].closed.at - stopAt : null;
  const deadlineMs = 120_000; // the harness session's paid deadline
  check(heldMs !== null && heldMs < deadlineMs - 20_000, "a sleeping phone releases the provider early",
    heldMs === null ? `socket never closed within 90s (provider ran to the ${deadlineMs / 1000}s deadline)`
      : `released after ${Math.round(heldMs / 1000)}s`);
} else if (MODE === "busy") {
  check(settled?.status === "completed" && settled?.usedSeconds === 0,
    "a provider-busy session bills nothing", `status=${settled?.status} used=${settled?.usedSeconds}`);
  check(wallet.wallet?.balanceSeconds === reserved * 2,
    "busy-session reservation fully refunded", `balance=${wallet.wallet?.balanceSeconds}s, untouched`);
  check(relayMessages >= 1, "the browser is told why the session ended",
    relayMessages ? `${relayMessages} message` : "silent close");
} else {
  check(settled?.status === "completed" && Number(settled?.usedSeconds) >= 1,
    "healthy session settles its usage", `used=${settled?.usedSeconds}s`);
  check(wallet.wallet?.balanceSeconds === reserved * 2 - Number(settled?.usedSeconds),
    "only the unused remainder is refunded", `balance=${wallet.wallet?.balanceSeconds}s`);
  check(relayMessages >= 3, "healthy handshake reaches the browser", `${relayMessages} messages`);
}

// Cleanup. The lock is checked too: a leftover lock blocks the real app with
// "another AI stream is already active" until it expires, so a test that walked
// away from one must never be allowed to leave it behind.
await db.collection("streamSessions").doc(sessionId).delete().catch(() => {});
await db.collection("transactions").doc(`stream-${sessionId}`).delete().catch(() => {});
const lockRef = db.collection("_streamLocks").doc("shared-ai-provider");
if ((await lockRef.get().catch(() => null))?.data()?.sessionId === sessionId) {
  await lockRef.delete().catch(() => {});
}
await db.collection("users").doc(uid).delete().catch(() => {});
console.log("cleanup: session, transaction, lock and user removed");
falWss.close(); relayServer.close();
await wait(300);
process.exit(0);
