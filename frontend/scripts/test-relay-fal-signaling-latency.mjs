// Regression test: how long does the relay hold fal's acceptance burst before
// the browser sees it?
//
// The browser cannot send its WebRTC offer until it has fal's `iceServers`, so
// any delay the relay adds here is dead time in the media handshake. The relay
// buffers the provider's first burst while it decides whether the provider
// accepted the session or is merely winding down a previous one; that window
// must not swallow the acceptance messages.
//
// Runs the REAL relay against a local stub "fal" that chatters the way fal does
// (a `timings` keepalive every 400ms), so the buffer's idle timer never fires
// and the worst case is exercised. No fal account, no network, no cost.
//
// Usage: node scripts/test-relay-fal-signaling-latency.mjs
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";

const FAL_PORT = Number(process.env.STUB_FAL_PORT ?? 47811);
const RELAY_PORT = 47812;
process.env.FAL_REALTIME_BASE_URL = `ws://127.0.0.1:${FAL_PORT}`;

const backendRequire = createRequire(new URL("../../backend/package.json", import.meta.url));
const { attachDecartProxy } = backendRequire("./decart-proxy.js");
const { WebSocketServer, WebSocket } = backendRequire("ws");
const { cert, initializeApp } = backendRequire("firebase-admin/app");
const { getFirestore } = backendRequire("firebase-admin/firestore");

const ORIGIN = "http://localhost:3000";
const reserved = 120;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${String(Date.now() % 100000).padStart(5)}]`, ...a);

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

// ── stub provider that behaves like fal ──────────────────────────────
let openedAt = 0;
let chatter = null;
const falWss = new WebSocketServer({ port: FAL_PORT });
falWss.on("connection", (socket) => {
  openedAt = Date.now();
  log("UPSTREAM opened — sending ready + iceServers immediately");
  socket.send(Buffer.from(JSON.stringify({ type: "x-fal-message", action: "timings", timing: 0 })));
  socket.send(Buffer.concat([Buffer.from([0x81]), Buffer.from("iceServers")]));
  socket.send(Buffer.concat([Buffer.from([0x81]), Buffer.from("ready")]));
  // fal keeps talking while it sets the runner up.
  chatter = setInterval(() => {
    try { socket.send(Buffer.from(JSON.stringify({ type: "x-fal-message", action: "timings", timing: 2 }))); }
    catch { /* gone */ }
  }, 400);
  socket.on("close", () => { if (chatter) clearInterval(chatter); });
});

// ── the real relay ───────────────────────────────────────────────────
const relayServer = createServer();
attachDecartProxy(relayServer, { allowedOrigins: [ORIGIN], getDb: () => db });
await new Promise((r) => relayServer.listen(RELAY_PORT, "127.0.0.1", r));

// ── disposable session ───────────────────────────────────────────────
const uid = `tmp-latency-${randomUUID().slice(0, 8)}`;
const sessionId = randomUUID();
const ticket = `${sessionId}.${"a".repeat(64)}`;
await db.collection("users").doc(uid).set({ wallet: { balanceSeconds: reserved, totalUsed: reserved } });
await db.collection("_streamLocks").doc("shared-ai-provider").set({
  sessionId, userId: uid, provider: "fal", status: "reserving",
  expiresAt: new Date(Date.now() + 120_000), createdAt: new Date(),
});
await db.collection("transactions").doc(`stream-${sessionId}`).set({ userId: uid, type: "usage", seconds: reserved, status: "reserved" });
await db.collection("streamSessions").doc(sessionId).set({
  userId: uid, transport: "fal-proxy-v1", providerEndpoint: "decart/lucy-2-5/realtime",
  providerToken: "stub-token", status: "active", reservedSeconds: reserved,
  ticketHash: createHash("sha256").update(ticket).digest("hex"),
  allowedOrigin: ORIGIN,
  ticketExpiresAt: new Date(Date.now() + 300_000),
  deadlineAt: new Date(Date.now() + 120_000),
  createdAt: new Date(),
});

// ── client: exactly what the browser does ────────────────────────────
const arrivals = [];
const ws = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/v1/fal-realtime?api_key=${ticket}`, { headers: { Origin: ORIGIN } });
ws.on("message", (data, isBinary) => {
  const at = Date.now();
  const buf = Buffer.from(data);
  const label = isBinary ? `binary:${buf.toString("latin1").replace(/[^\x20-\x7e]/g, "").slice(0, 40)}`
    : JSON.parse(buf.toString()).type ?? "json";
  arrivals.push({ at, label, sinceOpen: at - openedAt });
  log(`CLIENT <- ${label} (+${at - openedAt}ms after the provider opened)`);
});
// The browser sends its prompt as soon as the relay socket opens.
ws.on("open", () => ws.send(Buffer.from([0x81, 0xa6, 0x70, 0x72, 0x6f, 0x6d, 0x70, 0x74])));
// Long enough to see the buffer's cap fire even when the provider never goes
// quiet (fal chatters a timings message every 400ms).
await wait(9_000);

console.log("\n================ SIGNALING LATENCY ================");
const PASS = (n, d = "") => console.log(`PASS ${n}${d ? ` — ${d}` : ""}`);
const FAIL = (n, d = "") => { console.error(`FAIL ${n}${d ? ` — ${d}` : ""}`); process.exitCode = 1; };
const check = (ok, n, d = "") => (ok ? PASS(n, d) : FAIL(n, d));

const iceMsg = arrivals.find((a) => a.label.includes("iceServers"));
const readyMsg = arrivals.find((a) => a.label.includes("ready"));
check(Boolean(iceMsg), "the browser receives fal's iceServers", iceMsg ? `+${iceMsg.sinceOpen}ms` : "never arrived");
check(Boolean(iceMsg) && iceMsg.sinceOpen < 1_000, "fal's acceptance burst is not held back",
  iceMsg ? `iceServers reached the browser ${iceMsg.sinceOpen}ms after the provider opened`
    : "the offer could never be sent");
check(Boolean(readyMsg) && readyMsg.sinceOpen < 1_000, "ready is forwarded promptly",
  readyMsg ? `+${readyMsg.sinceOpen}ms` : "never arrived");

await db.collection("streamSessions").doc(sessionId).delete().catch(() => {});
await db.collection("transactions").doc(`stream-${sessionId}`).delete().catch(() => {});
const lockRef = db.collection("_streamLocks").doc("shared-ai-provider");
if ((await lockRef.get().catch(() => null))?.data()?.sessionId === sessionId) await lockRef.delete().catch(() => {});
await db.collection("users").doc(uid).delete().catch(() => {});
console.log("cleanup: session, transaction, lock and user removed");
falWss.close(); relayServer.close();
await wait(300);
process.exit(process.exitCode ?? 0);
