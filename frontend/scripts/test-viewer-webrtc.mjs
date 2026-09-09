// Viewer-path WebRTC smoke test against PRODUCTION.
//
// Proves, end to end, that after the TURN change a real media session still
// works: disposable broadcaster + viewer sign in, join a room on the deployed
// Socket.IO signaling service, negotiate SDP, and exchange real RTP.
// Companion check (this file): a raw TURN Allocate handshake proves the
// metered credentials served by /api/webrtc/ice-servers are actually valid.
//
// Usage: node scripts/test-viewer-webrtc.mjs [origin] [signalingUrl]
// Cleanup is automatic: the disposable user and its Firestore data are deleted.

import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import dgram from "node:dgram";
import { cert, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { io } from "socket.io-client";
import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader } from "werift";

const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
const origin = process.argv[2] ?? "https://savatar.vercel.app";
const signaling = process.argv[3] ?? "https://savatar-signaling.onrender.com";

const PASS = (name, detail = "") => console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
const FAIL = (name, detail = "") => { console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`); process.exitCode = 1; };
const withTimeout = (promise, ms, label) => Promise.race([
  promise,
  new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
]);

initializeApp({ credential: cert({
  projectId: env.FIREBASE_PROJECT_ID,
  clientEmail: env.FIREBASE_CLIENT_EMAIL,
  privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
}), projectId: env.FIREBASE_PROJECT_ID });
const auth = getAuth();
const db = getFirestore();

const roomId = `stream-${randomUUID()}`;
let uid;
let track;
const sockets = [];
const peers = [];
let relay;

try {
  // 1. Live ICE servers from the new route must include metered TURN.
  const iceResponse = await fetch(`${origin}/api/webrtc/ice-servers`, { headers: { "sec-fetch-site": "none" } });
  const ice = await iceResponse.json();
  if (!iceResponse.ok || !Array.isArray(ice.iceServers)) throw new Error(`ice-servers request failed (${iceResponse.status})`);
  const relayEntries = ice.iceServers.filter(
    (s) => JSON.stringify(s.urls).includes("turn") && (s.username || s.credential || s.password),
  );
  if (relayEntries.length === 0) throw new Error("ice-servers served no TURN relay entries");
  const selectedRelay = relayEntries[0];
  relay = { urls: selectedRelay.urls, username: selectedRelay.username, password: selectedRelay.credential ?? selectedRelay.password };
  if (!relay.username || !relay.password) throw new Error("ice-servers returned incomplete TURN credentials");
  PASS("ice-servers serves TURN relay", `${relayEntries.length} relay transports`);

  // 2. Disposable broadcaster (same flow the app uses: custom token -> idToken).
  const user = await auth.createUser({ email: `webrtc-smoke-${Date.now()}@example.com`, emailVerified: true });
  uid = user.uid;
  const customToken = await auth.createCustomToken(uid);
  const signIn = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${env.NEXT_PUBLIC_FIREBASE_API_KEY}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const { idToken } = await signIn.json();
  if (!idToken) throw new Error("Disposable sign-in failed");
  await db.collection("users").doc(uid).set({
    uid, email: user.email, streamRoomId: roomId,
    wallet: { balanceSeconds: 60, totalUsed: 0 }, plan: "starter",
    createdAt: new Date().toISOString(),
  });

  // 3. Sockets: broadcaster owns the room, viewer joins it.
  const connect = (role, token) => new Promise((resolve, reject) => {
    const socket = io(signaling, { transports: ["websocket"], reconnection: false, timeout: 15_000, extraHeaders: { Origin: origin }, ...(token ? { auth: { token } } : {}) });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error(`${role} socket connect timeout`)), 20_000);
    socket.on("connect", () => { clearTimeout(timer); resolve(socket); });
    socket.on("connect_error", (error) => { clearTimeout(timer); reject(error); });
  });
  const broadcaster = await connect("broadcaster", idToken);
  console.log("  [stage] broadcaster socket connected");
  const viewer = await connect("viewer");
  console.log("  [stage] viewer socket connected");

  const join = (socket, role) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${role} join timeout`)), 15_000);
    socket.on("room-joined", (payload) => { clearTimeout(timer); resolve(payload); });
    socket.on("room-error", (message) => { clearTimeout(timer); reject(new Error(`room-error: ${message}`)); });
    socket.on("authorization-error", () => { clearTimeout(timer); reject(new Error("authorization-error")); });
    socket.emit("join-room", { roomId, role });
  });
  const broadcasterJoin = join(broadcaster, "broadcaster");
  await new Promise((resolve) => setTimeout(resolve, 500));
  const viewerJoin = join(viewer, "viewer");
  const [bRoom, vRoom] = await Promise.all([withTimeout(broadcasterJoin, 15_000, "broadcaster join"), withTimeout(viewerJoin, 15_000, "viewer join")]);
  console.log("  [stage] both sockets joined the room");
  if (vRoom.viewerCount !== 1 || !bRoom.streamActive) throw new Error("Unexpected room state after join");
  PASS("signaling room established", `viewerCount=${vRoom.viewerCount}`);

  // 4. WebRTC with normal ICE policy ( werift's own TURN client cannot
  // complete allocations with metered, but browsers' can; the credentials are
  // verified separately below with a raw TURN Allocate handshake).
  const makePeer = (socket, role) => {
    const pc = new RTCPeerConnection({ iceServers: [relay] });
    peers.push(pc);
    pc.connectionStateChange.subscribe((state) => console.log(`  [${role}] connectionState=${state}`));
    return pc;
  };
  track = new MediaStreamTrack({ kind: "video" });
  const broadcasterPc = makePeer(broadcaster, "broadcaster");
  broadcasterPc.addTrack(track);
  const viewerPc = makePeer(viewer, "viewer");
  let receivedResolve;
  const received = new Promise((resolve) => { receivedResolve = resolve; });
  // werift's onTrack payload IS the remote MediaStreamTrack (it carries
  // onReceiveRtp directly), unlike the browser's {track} event shape.
  viewerPc.onTrack.subscribe((payload) => {
    const remoteTrack = payload?.track ?? (payload && payload.onReceiveRtp ? payload : undefined);
    remoteTrack?.onReceiveRtp?.subscribe?.((rtp) => receivedResolve?.(rtp));
  });

  // Vanilla ICE: werift gathers candidates into localDescription after
  // setLocalDescription; wait for gathering to finish, then send THAT sdp.
  const gatherAndSend = async (pc, socket, kind, targetField) => {
    const description = kind === "broadcaster" ? await pc.createOffer() : await pc.createAnswer();
    await pc.setLocalDescription(description);
    await withTimeout(new Promise((resolve) => {
      if (pc.iceGatheringState === "complete") return resolve();
      pc.iceGatheringStateChange.subscribe((state) => { if (state === "complete") resolve(); });
      setTimeout(resolve, 6_000); // werift has no ongatheringstatechange callback; bounded fallback
    }), 8_000, `${kind} gathering`).catch(() => {});
    const sdp = pc.localDescription.sdp;
    if (!sdp.includes("a=candidate")) throw new Error(`${kind} SDP has no ICE candidates`);
    socket.emit(kind === "broadcaster" ? "offer" : "answer", {
      roomId,
      [targetField]: { type: kind === "broadcaster" ? "offer" : "answer", sdp },
      ...(kind === "broadcaster" ? { viewerId: viewer.id } : { broadcasterId: broadcaster.id }),
    });
    return sdp;
  };
  await gatherAndSend(broadcasterPc, broadcaster, "broadcaster", "offer");
  console.log("  [stage] offer relayed to viewer");
  const offerForViewer = await withTimeout(new Promise((resolve) => viewer.once("offer", ({ offer }) => resolve(offer))), 10_000, "offer relay");
  await viewerPc.setRemoteDescription(offerForViewer);
  await gatherAndSend(viewerPc, viewer, "viewer", "answer");
  console.log("  [stage] answer relayed to broadcaster");
  const answerForBroadcaster = await withTimeout(new Promise((resolve) => broadcaster.once("answer", ({ answer }) => resolve(answer))), 10_000, "answer relay");
  await broadcasterPc.setRemoteDescription(answerForBroadcaster);

  // 5. Connection state must reach "connected" for the media path to exist
  // (werift's terminal state is "connected"; browsers call it "completed").
  const isUp = (state) => state === "connected" || state === "completed";
  const connected = Promise.all([
    withTimeout(new Promise((resolve) => broadcasterPc.connectionStateChange.subscribe((s) => { if (isUp(s)) resolve("broadcaster"); })), 30_000, "broadcaster ICE"),
    withTimeout(new Promise((resolve) => viewerPc.connectionStateChange.subscribe((s) => { if (isUp(s)) resolve("viewer"); })), 30_000, "viewer ICE"),
  ]);
  const sides = await connected;
  PASS("WebRTC established via signaling + ICE", `${sides.join(" + ")} connected`);

  // 6. Real media: broadcaster writes RTP, viewer's track must receive it.
  await new Promise((resolve) => setTimeout(resolve, 500));
  const rtpRace = withTimeout(received, 20_000, "RTP between peers");
  const ssrc = track.ssrc ?? 1;
  for (let i = 0; i < 30; i += 1) {
    track.writeRtp(new RtpPacket(new RtpHeader({
      version: 2, sequenceNumber: i, timestamp: 1000 + i * 3000,
      payloadType: 96, marker: i === 0, ssrc,
    }), Buffer.from([0x53, 0x41, 0x56, 0x41, 0x54, 0x41, 0x52, i])));
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  const rtp = await rtpRace;
  PASS("RTP flowed viewer-ward", `seq=${rtp.header.sequenceNumber} bytes=${rtp.payload?.length ?? 0}`);

  // 7. Raw TURN Allocate handshake — proves the exact credentials served to
  // browsers are valid against metered (independent of werift's ICE stack).
  const turnHost = "global.relay.metered.ca";
  const allocate = async (port) => new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    let done = false;
    const settle = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(guard);
      try { socket.close(); } catch { /* already closed */ }
      if (error) reject(error); else resolve(value);
    };
    const fail = (error) => settle(error);
    const send = (parts) => socket.send(Buffer.concat(parts), port, turnHost);
    const attr = (type, value) => {
      const pad = (4 - (value.length % 4)) % 4;
      const body = Buffer.concat([value, Buffer.alloc(pad)]);
      const head = Buffer.alloc(4); head.writeUInt16BE(type); head.writeUInt16BE(value.length, 2);
      return Buffer.concat([head, body]);
    };
    // STUN message: 20-byte header (type, msgLength, magic cookie, txn id)
    // followed by attributes. MESSAGE-INTEGRITY (when present) is HMAC'd over
    // everything before it, with the length field already including its 24 bytes.
    const txn = () => randomBytes(12);
    const buildMessage = (type, attrs, key) => {
      const body = Buffer.concat(attrs);
      const head = Buffer.alloc(20);
      head.writeUInt16BE(type, 0);
      head.writeUInt16BE(body.length + (key ? 24 : 0), 2);
      head.writeUInt32BE(0x2112a442, 4);
      txn().copy(head, 8);
      const core = Buffer.concat([head, body]);
      if (!key) return core;
      const hmac = createHmac("sha1", key).update(core).digest();
      return Buffer.concat([core, attr(0x0008, hmac)]);
    };
    let nonce;
    socket.on("message", (msg) => { try { step(msg); } catch (error) { fail(error); } });
    socket.on("error", fail);
    const step = (msg) => {
      const type = msg.readUInt16BE(0);
      const attrs = parseAttrs(msg.subarray(20));
      if (type === 0x0113) { // Allocate error response: expect 401 challenge
        const error = attrs.get(0x0009);
        // ERROR-CODE value: 2 reserved bytes, class byte (hundreds), number byte.
        const code = error ? error[2] * 100 + error[3] : 0;
        if (code !== 401) { fail(new Error(`TURN allocate failed with error ${code}`)); return; }
        nonce = attrs.get(0x0015);
        const realm = attrs.get(0x0014)?.toString() ?? turnHost;
        const key = createHash("md5").update(`${relay.username}:${realm}:${relay.password}`).digest();
        send([buildMessage(0x0003, [attr(0x0019, Buffer.from([17, 0, 0, 0])),
          attr(0x0006, Buffer.from(relay.username)), attr(0x0015, nonce), attr(0x0014, Buffer.from(realm))], key)]);
        return;
      }
      if (type === 0x0103) { // Allocate success: XOR-RELAYED-ADDRESS
        const relayed = attrs.get(0x0016);
        const ip = [relayed[4] ^ 0x2b, relayed[5] ^ 0x12, relayed[6] ^ 0xa4, relayed[7] ^ 0x42].join(".");
        const port2 = relayed.readUInt16BE(2) ^ 0x2112;
        settle(null, { ip, port: port2 });
        return;
      }
      fail(new Error(`Unexpected TURN response 0x${type.toString(16)} ${attrsDump(msg)}`));
    };
    const attrsDump = (msg) => { try { return JSON.stringify([...parseAttrs(msg.subarray(20)).keys()].map((k) => `0x${k.toString(16)}`)); } catch { return ""; } };
    function parseAttrs(buffer) {
      const map = new Map();
      let offset = 0;
      while (offset + 4 <= buffer.length) {
        const type = buffer.readUInt16BE(offset);
        const length = buffer.readUInt16BE(offset + 2);
        map.set(type, buffer.subarray(offset + 4, offset + 4 + length));
        offset += 4 + length + ((4 - (length % 4)) % 4);
      }
      return map;
    }
    socket.bind(() => send([buildMessage(0x0003, [attr(0x0019, Buffer.from([17, 0, 0, 0]))])]));
    const guard = setTimeout(() => fail(new Error("TURN allocate timed out")), 10_000);
  });
  let allocated = null;
  let lastError;
  for (const port of [443, 80]) {
    try { allocated = await allocate(port); break; } catch (error) { lastError = error; }
  }
  if (!allocated) throw new Error(`TURN Allocate failed: ${lastError?.message}`);
  PASS("metered TURN credentials allocate successfully", `relayed=${allocated.ip}:${allocated.port}`);
  console.log("\nALL CHECKS PASSED — viewer path works end-to-end; TURN credentials verified");
} catch (error) {
  FAIL("viewer webrtc smoke", error.message);
} finally {
  await Promise.all(peers.map((pc) => pc.close().catch(() => {})));
  track?.stop?.();
  for (const socket of sockets) socket.disconnect();
  try {
    if (uid) {
      const batch = db.batch();
      const docs = await db.collection("users").where("uid", "==", uid).get();
      docs.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      await auth.deleteUser(uid).catch(() => {});
    }
    console.log("Disposable WebRTC smoke data removed");
  } catch (cleanupError) {
    console.error(`Cleanup failed (delete uid ${uid} manually): ${cleanupError.message}`);
  }
  // Some WebRTC implementations retain internal timers after close.
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}
