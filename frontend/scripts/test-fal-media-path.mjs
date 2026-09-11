// Does the fal realtime path actually return video? (local, no browser needed)
//
// The browser is the only part this can't reproduce, so everything else is real:
// a real fal session, the app's exact reference-image input, real WebRTC
// negotiation with real ICE, and REAL VP8 video pushed over RTP so fal has
// something to transform. It then counts what fal sends back, which separates
// "fal never produced a frame" from "the browser failed to show the frames it
// received" — the difference between an upstream problem and a client one.
//
// Input is generated with ffmpeg into the OS temp dir (nothing is written into
// the repository) and removed again afterwards.
//
// Usage: node scripts/test-fal-media-path.mjs [seconds=6] [--trickle]
//
// --trickle reproduces the BROWSER's signalling exactly: the offer goes out with
// no candidates in it and each ICE candidate is sent afterwards as its own
// {type:"icecandidate"} message, the way src/lib/fal-realtime.ts does it. The
// default (vanilla ICE, candidates inline) is what werift does on its own; fal
// answering the inline form says nothing about the trickled form.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { decode, encode } from "@msgpack/msgpack";
import { createRequire } from "node:module";
import { RTCPeerConnection, MediaStreamTrack, RtpPacket, RtpHeader } from "werift";

const require = createRequire(import.meta.url);
const { WebSocket } = require("../../backend/node_modules/ws");
const env = parseEnv(readFileSync(new URL("../.env.local", import.meta.url), "utf8"));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const STREAM_SECONDS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a)) ?? 6);
const TRICKLE = process.argv.includes("--trickle");

// ── Real video input, encoded locally (a camera stand-in) ────────────
const mediaDir = mkdtempSync(join(tmpdir(), "savatar-media-"));
const runFfmpeg = (args) => execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
try {
  runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=640x480:rate=30", "-t", "8", "-c:v", "libvpx", "-b:v", "500k", "-g", "15", "-f", "ivf", join(mediaDir, "input.ivf")]);
  runFfmpeg(["-f", "lavfi", "-i", "testsrc=size=1280x720:rate=1", "-frames:v", "1", "-q:v", "3", join(mediaDir, "ref.jpg")]);
} catch (error) {
  console.error("ffmpeg is required to generate the test video:", error.message);
  rmSync(mediaDir, { recursive: true, force: true });
  process.exit(1);
}
const media = (name) => readFileSync(join(mediaDir, name));

// ── Encode input: 240 VP8 frames from the IVF container ──────────────
function readIvfFrames(buf) {
  const frames = [];
  let offset = 32;
  while (offset + 12 <= buf.length) {
    const size = buf.readUInt32LE(offset);
    frames.push(buf.subarray(offset + 12, offset + 12 + size));
    offset += 12 + size;
  }
  return frames;
}
const frames = readIvfFrames(media("input.ivf"));
console.log(`input: ${frames.length} VP8 frames (max ${Math.max(...frames.map((f) => f.length))} bytes)`);

const referenceDataUrl = `data:image/jpeg;base64,${media("ref.jpg").toString("base64")}`;
const PROMPT = "Replace the visible person's full body, face, hair, clothing, and visible limbs with the character "
  + "from the reference image. Preserve pose, motion, framing, and background.";

async function mintToken() {
  const res = await fetch("https://rest.fal.ai/tokens/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Key ${env.FAL_KEY}` },
    body: JSON.stringify({ allowed_apps: ["lucy-2-5"], token_expiration: 180 }),
  });
  const raw = (await res.text()).trim();
  return raw.startsWith("{") ? JSON.parse(raw).token : JSON.parse(raw);
}

// ── One attempt: negotiate, then stream for STREAM_SECONDS ───────────
async function attempt(label) {
  const started = Date.now();
  const at = () => `[${label} +${((Date.now() - started) / 1000).toFixed(1)}s]`;
  const token = await mintToken();
  const ws = new WebSocket(`wss://fal.run/decart/lucy-2-5/realtime?fal_jwt_token=${encodeURIComponent(token)}`, { handshakeTimeout: 20_000 });
  ws.binaryType = "arraybuffer";

  const state = { accepted: false, busy: false, answered: false, codec: "", sent: 0, inbound: 0, inboundBytes: 0, decoded: 0, firstFrameAt: null };
  let pc = null, localTrack = null, remoteSet = false, sendTimer = null, seq = 0, ts = 0;
  const queued = [];
  const send = (obj) => { if (ws.readyState === WebSocket.OPEN) ws.send(encode(obj)); };

  const finish = async () => {
    if (sendTimer) { clearInterval(sendTimer); sendTimer = null; }
    if (pc) {
      try {
        const stats = await pc.getStats();
        stats.forEach((report) => {
          const e = report;
          if (e.type === "inbound-rtp" && e.kind === "video") {
            state.decoded = Math.max(state.decoded, Number(e.framesDecoded ?? 0), Number(e.framesReceived ?? 0));
          }
        });
      } catch { /* stats unavailable */ }
    }
    try { ws.close(1000, "test complete"); } catch { /* gone */ }
    try { pc?.close(); } catch { /* gone */ }
    return state;
  };

  const startStreaming = () => {
    if (sendTimer) return;
    const perFrame = Math.round(1000 / 30);
    let index = 0;
    sendTimer = setInterval(() => {
      if (index >= frames.length) { void finish().then(resolveOnce); return; }
      const frame = frames[index];
      const chunks = [];
      for (let offset = 0; offset < frame.length; offset += 1100) {
        chunks.push(Buffer.concat([Buffer.from([0x10]), frame.subarray(offset, offset + 1100)]));
      }
      chunks.forEach((payload, i) => {
        try {
          localTrack.writeRtp(new RtpPacket(new RtpHeader({
            version: 2, padding: false, extension: false, marker: i === chunks.length - 1,
            payloadType: 98, sequenceNumber: (seq + i) & 0xffff, timestamp: ts, ssrc: 0x12345678,
          }), payload));
          state.sent++;
        } catch (error) {
          if (index === 0) console.log(`${at()} writeRtp failed: ${error.message}`);
          index = frames.length;
        }
      });
      seq = (seq + chunks.length) & 0xffff;
      ts = (ts + 3000) >>> 0;
      index++;
    }, perFrame);
    console.log(`${at()} streaming real VP8 video into fal`);
  };

  let resolved = false;
  let resolveOnce;
  const done = new Promise((r) => { resolveOnce = r; });
  const conclude = async () => { if (resolved) return; resolved = true; resolveOnce(await finish()); };

  ws.on("open", () => {
    console.log(`${at()} connected to fal`);
    send({ prompt: PROMPT, enable_prompt_expansion: true, reference_image_url: referenceDataUrl });
  });

  ws.on("message", async (data, isBinary) => {
    let msg;
    try { msg = isBinary ? decode(new Uint8Array(data)) : JSON.parse(String(data)); } catch { return; }
    const type = msg?.type;
    if (type !== "icecandidate") console.log(`${at()} <- ${type}${msg?.error ? ` error="${msg.error}"` : ""}`);

    if (String(msg?.error ?? "").includes("Concurrent session limit")) {
      state.busy = true;
      setTimeout(() => void conclude(), 300);
      return;
    }
    if (type === "iceservers" || type === "iceServers") {
      if (pc) return;
      const servers = msg.iceServers || msg.iceservers || [];
      console.log(`${at()}    iceServers: ${servers.length} entry(ies), turn=${servers.filter((s) => JSON.stringify(s.urls).includes("turn")).length}`);
      pc = new RTCPeerConnection({ iceServers: servers.filter((s) => s?.urls) });
      pc.connectionStateChange.subscribe((s) => console.log(`${at()}    pc.connectionState=${s}`));
      pc.onTrack.subscribe((payload) => {
        const track = payload?.track ?? payload;
        track?.onReceiveRtp?.subscribe?.((rtp) => {
          state.inbound++;
          state.inboundBytes += rtp.payload?.length ?? 0;
          if (state.inbound === 1) { state.firstFrameAt = Date.now() - started; console.log(`${at()}    FIRST RTP FROM FAL`); }
        });
      });
      localTrack = new MediaStreamTrack({ kind: "video" });
      pc.addTrack(localTrack);
      const trickled = [];
      pc.onIceCandidate.subscribe((c) => {
        if (c?.candidate) trickled.push({ candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex });
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = pc.localDescription?.sdp ?? offer.sdp;
      const pt = sdp.match(/a=rtpmap:(\d+) (VP8|H264|VP9|AV1)\/90000/i);
      console.log(`${at()}    offering ${pt ? `${pt[2]} pt ${pt[1]}` : "unknown codec"}`);
      if (!TRICKLE) {
        send({ type: "offer", sdp });
        return;
      }
      // The browser's shape: offer first, candidates afterwards, one message each.
      const withoutCandidates = sdp.split("\r\n").filter((line) => !line.startsWith("a=candidate:")).join("\r\n");
      send({ type: "offer", sdp: withoutCandidates });
      await wait(700);
      const mid = sdp.match(/^a=mid:(.*)$/m)?.[1] ?? "0";
      const inline = sdp.split("\r\n").filter((line) => line.startsWith("a=candidate:"));
      for (const line of inline) {
        send({ type: "icecandidate", candidate: { candidate: line.slice(2), sdpMid: mid, sdpMLineIndex: 0 } });
      }
      console.log(`${at()}    trickled ${inline.length} candidate(s) after the offer (browser shape)`);
      return;
    }
    if (type === "answer" && msg.sdp) {
      const codec = msg.sdp.match(/a=rtpmap:(\d+) ([A-Za-z0-9]+)\/90000/);
      state.codec = codec ? `${codec[2]} pt ${codec[1]}` : "unknown";
      console.log(`${at()}    answer codec: ${state.codec}`);
      await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      remoteSet = true;
      state.answered = true;
      for (const candidate of queued.splice(0)) await pc.addIceCandidate(candidate).catch(() => {});
      startStreaming();
      setTimeout(() => void conclude(), STREAM_SECONDS * 1000);
      return;
    }
    if (type === "icecandidate" && msg.candidate) {
      if (!pc) return;
      if (!remoteSet) { queued.push(msg.candidate); return; }
      await pc.addIceCandidate(msg.candidate).catch(() => {});
    }
  });

  ws.on("error", (error) => { console.log(`${at()} ws error: ${error.message}`); void conclude(); });
  ws.on("close", (code) => { console.log(`${at()} fal socket closed code=${code}`); void conclude(); });
  setTimeout(() => void conclude(), 40_000);
  return done;
}

// fal keeps the account busy for a while after any session, so wait the slot
// out rather than hammering it.
for (let round = 1; round <= 6; round++) {
  const result = await attempt(`round ${round}`);
  if (result.busy) {
    console.log(`round ${round}: provider busy — waiting 15s for the account slot\n`);
    await wait(15_000);
    continue;
  }
  console.log("\n================ 6-SECOND LOCAL RESULT ================");
  console.log("fal answered SDP          :", result.answered);
  console.log("negotiated codec          :", result.codec);
  console.log("VP8 RTP packets sent      :", result.sent);
  console.log("RTP packets received back :", result.inbound);
  console.log("bytes received back       :", result.inboundBytes);
  console.log("first frame at            :", result.firstFrameAt === null ? "never" : `${(result.firstFrameAt / 1000).toFixed(1)}s`);
  console.log("frames decoded (stats)    :", result.decoded);
  console.log(result.inbound > 0
    ? "VERDICT: fal DID produce video for real input — the media path works"
    : "VERDICT: fal returned NO video for real input");
  break;
}
rmSync(mediaDir, { recursive: true, force: true });
process.exit(0);
