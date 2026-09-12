// Decisive isolation: the Node harness that GETS RTP from fal when run DIRECT
// (scripts/test-fal-media-path.mjs) is pointed at the REAL RELAY instead. If
// the same werift session also gets RTP through the relay, the relay is clean
// and the difference is the browser's offer. If it gets zero RTP through the
// relay, the relay is altering something in the media handshake.
//
// Cost note: same one-session footprint as test-fal-media-path.mjs.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { decode, encode } from "@msgpack/msgpack";
import { createHash, randomUUID } from "node:crypto";
import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader } from "werift";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const backendRequire = createRequire(new URL("../../backend/package.json", import.meta.url));
const { attachDecartProxy, claimTicket } = backendRequire("./decart-proxy.js");
const { WebSocket } = require("../../backend/node_modules/ws");
const { cert, initializeApp } = backendRequire("firebase-admin/app");
const { getFirestore } = backendRequire("firebase-admin/firestore");
const { createServer } = await import("node:http");

const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ORIGIN = "http://localhost:3000";
const RELAY_PORT = 47821;

// ── real VP8 input + reference ───────────────────────────────────────
const mediaDir = mkdtempSync(join(tmpdir(), "savatar-relay-"));
const runFfmpeg = (args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=640x480:rate=30", "-t", "8", "-c:v", "libvpx", "-b:v", "500k", "-g", "15", "-f", "ivf", join(mediaDir, "input.ivf")]);
runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=1", "-frames:v", "1", "-q:v", "3", join(mediaDir, "ref.jpg")]);
const media = (n) => readFileSync(join(mediaDir, n));
function readIvfFrames(buf) {
  const frames = []; let offset = 32;
  while (offset + 12 <= buf.length) {
    const size = buf.readUInt32LE(offset);
    frames.push(buf.subarray(offset + 12, offset + 12 + size));
    offset += 12 + size;
  }
  return frames;
}
const frames = readIvfFrames(media("input.ivf"));
const referenceDataUrl = `data:image/jpeg;base64,${media("ref.jpg").toString("base64")}`;
const PROMPT = "Replace the visible person's full body, face, hair, clothing, and visible limbs with the character from the reference image. Preserve pose, motion, framing, and background.";

// ── mint a real fal JWT and stage the session the way the app does ──
const mintRes = await fetch("https://rest.fal.ai/tokens/", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Key ${env.FAL_KEY}` },
  body: JSON.stringify({ allowed_apps: ["lucy-2-5"], token_expiration: 180 }),
});
const mintRaw = (await mintRes.text()).trim();
const falJwt = mintRaw.startsWith("{") ? JSON.parse(mintRaw).token : mintRaw;
if (!falJwt || falJwt.length < 20) { console.error("token mint failed:", mintRaw); process.exit(1); }
console.log("fal JWT minted");

initializeApp({
  credential: cert({
    projectId: env.FIREBASE_PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
  projectId: env.FIREBASE_PROJECT_ID,
});
const db = getFirestore();

const uid = `tmp-relaymp-${randomUUID().slice(0, 8)}`;
const sessionId = randomUUID();
const ticket = `${sessionId}.${"a".repeat(64)}`;
const reserved = 120;
await db.collection("users").doc(uid).set({ wallet: { balanceSeconds: reserved, totalUsed: reserved } });
await db.collection("_streamLocks").doc("shared-ai-provider").set({
  sessionId, userId: uid, provider: "fal", status: "reserving",
  expiresAt: new Date(Date.now() + 120_000), createdAt: new Date(),
});
await db.collection("transactions").doc(`stream-${sessionId}`).set({ userId: uid, type: "usage", seconds: reserved, status: "reserved" });
await db.collection("streamSessions").doc(sessionId).set({
  userId: uid, transport: "fal-proxy-v1", providerEndpoint: "decart/lucy-2-5/realtime",
  providerToken: falJwt, status: "active", reservedSeconds: reserved,
  ticketHash: createHash("sha256").update(ticket).digest("hex"),
  allowedOrigin: ORIGIN,
  ticketExpiresAt: new Date(Date.now() + 300_000),
  deadlineAt: new Date(Date.now() + 120_000),
  createdAt: new Date(),
});
console.log("session staged:", sessionId.slice(0, 8));

// Watch the session doc live: the relay closes the client whenever the doc
// disappears, gains stopRequestedAt, or stops being active — or when the
// listener itself errors.
const unwatch = db.collection("streamSessions").doc(sessionId).onSnapshot(
  (snap) => {
    const d = snap.data();
    console.log(`[doc @+${((Date.now() - startedRef.t0) / 1000).toFixed(1)}s]`,
      snap.exists ? `status=${d?.status} stop=${d?.stopRequestedAt ? "yes" : "no"} token=${d?.providerToken ? "present" : "ABSENT"}` : "DELETED");
  },
  (err) => console.log(`[doc ERROR] ${err.message}`),
);
const startedRef = { t0: Date.now() };

// ── local relay in front of real fal ─────────────────────────────────
const relayServer = createServer();
attachDecartProxy(relayServer, { allowedOrigins: [ORIGIN], getDb: () => db });
await new Promise((r) => relayServer.listen(RELAY_PORT, "127.0.0.1", r));

// ── the EXACT harness shape that works direct (inline candidates) ───
const started = Date.now();
const at = () => `[+${((Date.now() - started) / 1000).toFixed(1)}s]`;
const ws = new WebSocket(`ws://127.0.0.1:${RELAY_PORT}/v1/fal-realtime?api_key=${ticket}`, { headers: { Origin: ORIGIN } });
ws.binaryType = "arraybuffer";

const state = { accepted: false, answered: false, sent: 0, inbound: 0, inboundBytes: 0, firstRtpAt: null, ice: "" };
let pc = null, localTrack = null, remoteSet = false, sendTimer = null, seq = 0, ts = 0;
const queued = [];
const send = (obj) => { if (ws.readyState === WebSocket.OPEN) ws.send(encode(obj)); };
let resolved = false;
const conclude = (() => {
  return () => {
    if (resolved) return; resolved = true;
    try { if (sendTimer) clearInterval(sendTimer); } catch {}
    try { ws.close(1000, "done"); } catch {}
    setTimeout(async () => {
      try { await db.collection("streamSessions").doc(sessionId).delete(); } catch {}
      try { await db.collection("transactions").doc(`stream-${sessionId}`).delete(); } catch {}
      const lockRef = db.collection("_streamLocks").doc("shared-ai-provider");
      try { if ((await lockRef.get())?.data()?.sessionId === sessionId) await lockRef.delete(); } catch {}
      try { await db.collection("users").doc(uid).delete(); } catch {}
      console.log("\n================ HARNESS VIA RELAY ================");
      console.log("relay forwarded acceptance :", state.accepted);
      console.log("fal answered SDP           :", state.answered);
      console.log("ICE connection state       :", state.ice || "never connected");
      console.log("VP8 RTP sent               :", state.sent);
      console.log("RTP received from fal      :", state.inbound, `(${state.inboundBytes} bytes)`);
      console.log("first RTP at               :", state.firstRtpAt === null ? "never" : `${(state.firstRtpAt / 1000).toFixed(1)}s`);
      console.log(state.inbound > 0 ? "VERDICT: relay is CLEAN — the browser's offer shape is the difference"
        : "VERDICT: relay BREAKS the media path even for the shape that works direct");
      rmSync(mediaDir, { recursive: true, force: true });
      unwatch(); relayServer.close();
      process.exit(0);
    }, 500);
  };
})();

ws.on("open", () => { console.log(`${at()} connected to relay`); send({ prompt: PROMPT, enable_prompt_expansion: true, reference_image_url: referenceDataUrl }); });
ws.on("message", async (data, isBinary) => {
  let msg; try { msg = isBinary ? decode(new Uint8Array(data)) : JSON.parse(String(data)); } catch { return; }
  const type = msg?.type;
  if (type !== "icecandidate") console.log(`${at()} <- ${type}${msg?.error ? ` error="${msg.error}"` : ""}`);
  if (String(msg?.error ?? "").includes("Concurrent session limit")) { console.log(`${at()} BUSY`); conclude(); return; }
  if (type === "ready") { state.accepted = true; }
  if (type === "iceServers" || type === "iceServers") {
    if (pc) return;
    const servers = (msg.iceServers || msg.iceservers || msg.ice_servers || []).filter((s) => s?.urls);
    console.log(`${at()}    iceServers: ${servers.length} (turn=${servers.filter(s=>JSON.stringify(s.urls).includes("turn")).length})`);
    pc = new RTCPeerConnection({ iceServers: servers });
    pc.connectionStateChange.subscribe((s) => { state.ice = s; console.log(`${at()}    pc.connectionState=${s}`); });
    pc.onTrack.subscribe((payload) => {
      const track = payload?.track ?? payload;
      track?.onReceiveRtp?.subscribe?.((rtp) => {
        state.inbound++; state.inboundBytes += rtp.payload?.length ?? 0;
        if (state.inbound === 1) { state.firstRtpAt = Date.now() - started; console.log(`${at()}    FIRST RTP FROM FAL (via relay)`); }
      });
    });
    localTrack = new MediaStreamTrack({ kind: "video" });
    pc.addTrack(localTrack);
    pc.onIceCandidate.subscribe(() => {});
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      const t = setTimeout(resolve, 3_000);
      pc.onIceCandidate.subscribe((c) => { if (!c?.candidate) { clearTimeout(t); resolve(); } });
    });
    const sdp = pc.localDescription?.sdp ?? offer.sdp;
    const pt = sdp.match(/a=rtpmap:(\d+) (VP8|H264|VP9|AV1)\/90000/i);
    console.log(`${at()}    offering ${pt ? `${pt[2]} pt ${pt[1]}` : "?"} (candidates inline: ${/a=candidate:/.test(sdp)})`);
    send({ type: "offer", sdp });
    return;
  }
  if (type === "answer" && msg.sdp) {
    const codec = msg.sdp.match(/a=rtpmap:(\d+) ([A-Za-z0-9]+)\/90000/);
    console.log(`${at()}    answer codec: ${codec ? codec[2] : "unknown"}`);
    await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
    remoteSet = true; state.answered = true;
    for (const c of queued.splice(0)) await pc.addIceCandidate(c).catch(() => {});
    const perFrame = Math.round(1000 / 30);
    let index = 0;
    sendTimer = setInterval(() => {
      if (index >= frames.length) { console.log(`${at()} input exhausted`); clearInterval(sendTimer); sendTimer = null; return; }
      const frame = frames[index];
      const chunks = [];
      for (let offset = 0; offset < frame.length; offset += 1100) chunks.push(Buffer.concat([Buffer.from([0x10]), frame.subarray(offset, offset + 1100)]));
      chunks.forEach((payload, i) => {
        try {
          localTrack.writeRtp(new RtpPacket(new RtpHeader({
            version: 2, padding: false, extension: false, marker: i === chunks.length - 1,
            payloadType: 98, sequenceNumber: (seq + i) & 0xffff, timestamp: ts, ssrc: 0x12345678,
          }), payload));
          state.sent++;
        } catch { index = frames.length; }
      });
      seq = (seq + chunks.length) & 0xffff; ts = (ts + 3000) >>> 0; index++;
    }, perFrame);
    setTimeout(conclude, 8_000);
    return;
  }
  if (type === "icecandidate" && msg.candidate) {
    if (!pc) return;
    if (!remoteSet) { queued.push(msg.candidate); return; }
    await pc.addIceCandidate(msg.candidate).catch(() => {});
  }
});
ws.on("error", (e) => { console.log(`${at()} ws error: ${e.message}`); conclude(); });
ws.on("close", (code) => { console.log(`${at()} relay socket closed code=${code}`); conclude(); });
setTimeout(conclude, 45_000);
