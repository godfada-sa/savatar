const { WebSocket, WebSocketServer } = require("ws");
const { createHash, timingSafeEqual } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");

const TICKET = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[0-9a-f]{64}$/;
const STREAM_LOCK_COLLECTION = "_streamLocks";
const STREAM_LOCK_DOCUMENT = "shared-ai-provider";
const CREDIT_SAFETY_RESERVE_MS = 5_000;

/**
 * Validate a ticket and mark the session claimed. Reconnects are allowed:
 * the Decart SDK retries with the SAME ticket after a transport drop, so a
 * session that was already claimed may be claimed again. The ticket hash is
 * kept on the session until settle so reconnects can be verified.
 */
async function claimTicket(db, ticket, origin, expectedTransport) {
  const match = TICKET.exec(ticket);
  if (!match) throw new Error("Invalid ticket");
  const ref = db.collection("streamSessions").doc(match[1]);
  const session = await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    const supplied = Buffer.from(createHash("sha256").update(ticket).digest("hex"));
    const expected = Buffer.from(data?.ticketHash ?? "");
    if (!data || !["proxy-v1", "fal-proxy-v1"].includes(data.transport)
      || (expectedTransport && data.transport !== expectedTransport)
      || (data.transport === "fal-proxy-v1" && data.providerEndpoint !== "decart/lucy-2-5/realtime")
      || data.status !== "active" || data.stopRequestedAt
      || !(data.ticketExpiresAt?.toMillis() > Date.now())
      || !(data.deadlineAt?.toMillis() > Date.now()) || data.allowedOrigin !== origin
      || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)
      || typeof data.providerToken !== "string" || !Number.isSafeInteger(data.reservedSeconds)
      || data.reservedSeconds < 1 || data.reservedSeconds > 300) throw new Error("Ticket unavailable");
    // Keep reconnect credentials valid only within the original paid window.
    tx.update(ref, { claimedAt: data.claimedAt ?? FieldValue.serverTimestamp(),
      ticketExpiresAt: new Date(data.deadlineAt.toMillis()) });
    return data;
  });
  return { ref, session };
}

// Record partial usage from a superseded (replaced-by-reconnect) connection
// without settling, so the final connection charges the true total.
async function recordPartialUsage(db, ref, usedSeconds) {
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(ref)).data();
    if (!data || data.status !== "active") return;
    const used = Math.max(0, Math.floor(usedSeconds));
    if (used <= 0) return;
    tx.update(ref, { accumulatedSeconds: FieldValue.increment(Math.min(used, data.reservedSeconds)) });
  });
}

async function settleSession(db, ref, usedSeconds, reconciliationRequired = false) {
  await db.runTransaction(async (tx) => {
    const lockRef = db.collection(STREAM_LOCK_COLLECTION).doc(STREAM_LOCK_DOCUMENT);
    const [sessionSnapshot, lockSnapshot] = await Promise.all([
      tx.get(ref),
      tx.get(lockRef),
    ]);
    const data = sessionSnapshot.data();
    if (!data || data.status !== "active") return;
    const accumulated = Math.max(0, Math.floor(Number(data.accumulatedSeconds ?? 0)));
    const used = Math.max(0, Math.min(data.reservedSeconds, accumulated + Math.ceil(usedSeconds)));
    if (!Number.isSafeInteger(used)) throw new Error("Invalid provider usage");
    const unused = data.reservedSeconds - used;
    tx.update(db.collection("users").doc(data.userId), {
      "wallet.balanceSeconds": FieldValue.increment(unused),
      "wallet.totalUsed": FieldValue.increment(-unused),
    });
    const updates = { status: "completed", usedSeconds: used, unusedSeconds: unused,
      reconciliationRequired, endedAt: FieldValue.serverTimestamp() };
    tx.update(ref, { ...updates, providerStoppedAt: FieldValue.serverTimestamp(),
      providerToken: FieldValue.delete(), ticketHash: FieldValue.delete(),
      accumulatedSeconds: FieldValue.delete() });
    tx.update(db.collection("transactions").doc(`stream-${ref.id}`), updates);
    if (lockSnapshot.data()?.sessionId === ref.id) tx.delete(lockRef);
  });
}

function attachDecartProxy(server, { allowedOrigins, getDb }) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 3 * 1024 * 1024, perMessageDeflate: false });
  const attempts = new Map();
  // sessionId -> { client, superseded }. A reconnect takes over the slot; the
  // superseded connection records its partial usage without settling, and the
  // final connection settles the accumulated total.
  const slots = new Map();
  const cleanup = setInterval(() => {
    for (const [ip, value] of attempts) if (Date.now() - value.at > 60_000) attempts.delete(ip);
  }, 60_000);
  cleanup.unref();
  server.on("close", () => clearInterval(cleanup));
  server.on("upgrade", async (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (!["/v1/stream", "/v1/fal-realtime"].includes(url.pathname)) return;
    const reject = () => { if (!socket.destroyed) socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); };
    const origin = req.headers.origin;
    const ip = socket.remoteAddress ?? "unknown";
    const now = Date.now();
    const rate = attempts.get(ip);
    if (!allowedOrigins.includes(origin) || wss.clients.size >= 200 || attempts.size >= 10_000
      || (rate && now - rate.at < 60_000 && rate.count >= 30)) return reject();
    attempts.set(ip, { at: rate && now - rate.at < 60_000 ? rate.at : now,
      count: rate && now - rate.at < 60_000 ? rate.count + 1 : 1 });
    let db, claimed;
    const expectedTransport = url.pathname === "/v1/fal-realtime" ? "fal-proxy-v1" : "proxy-v1";
    try { db = getDb(); claimed = await claimTicket(db, url.searchParams.get("api_key") ?? "", origin, expectedTransport); }
    catch { return reject(); }
    if (socket.destroyed) {
      void settleSession(db, claimed.ref, 0).catch(() => console.error("Unconnected session settlement pending"));
      return;
    }
    // Reconnect/takeover: any new claim for a session that already has a slot
    // supersedes it (the SDK reconnects with the same ticket). The previous
    // socket is closed gracefully; its finish() records partial usage only.
    const previous = slots.get(claimed.ref.id);
    if (previous && previous.state) {
      previous.state.superseded = true;
      if (previous.client.readyState === WebSocket.OPEN) previous.client.close(1000, "Reconnect");
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      const { ref, session } = claimed;
      const state = { superseded: false };
      slots.set(ref.id, { client, state });
      const isFal = session.transport === "fal-proxy-v1";
      let upstreamUrl;
      if (isFal) {
        upstreamUrl = new URL(`wss://fal.run/${session.providerEndpoint}`);
        upstreamUrl.searchParams.set("fal_jwt_token", session.providerToken);
      } else {
        upstreamUrl = new URL("wss://api3.decart.ai/v1/stream");
        upstreamUrl.searchParams.set("api_key", session.providerToken);
        upstreamUrl.searchParams.set("model", session.model);
        upstreamUrl.searchParams.set("resolution", url.searchParams.get("resolution") === "1080p" ? "1080p" : "720p");
        if (url.searchParams.get("livekit_server_codec") === "vp8") upstreamUrl.searchParams.set("livekit_server_codec", "vp8");
      }
      const upstream = new WebSocket(upstreamUrl, { origin, handshakeTimeout: 20_000,
        maxPayload: 3 * 1024 * 1024, perMessageDeflate: false });
      let startedAt = null, ticks = 0, endedSeconds = null, opened = false, finished = false;
      let queued = [], queuedBytes = 0, messageBytes = 0, messageCount = 0, windowAt = Date.now();
      let unsubscribe = () => {};
      const releaseSlot = () => {
        const slot = slots.get(ref.id);
        if (slot && slot.client === client) slots.delete(ref.id);
      };
      const close = () => {
        if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
        else if (upstream.readyState === WebSocket.OPEN) upstream.close(1000, "Session ended");
        if (client.readyState === WebSocket.OPEN) client.close(1000, "Session ended");
      };
      // Stop upstream before the paid deadline even if the browser timer is
      // throttled or the client disappears. Settlement refunds this reserve.
      const deadline = setTimeout(close, Math.max(0,
        session.deadlineAt.toMillis() - Date.now() - CREDIT_SAFETY_RESERVE_MS));
      const finish = async (code) => {
        if (finished) return;
        finished = true;
        clearTimeout(deadline);
        unsubscribe();
        releaseSlot();
        if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate();
        else if (upstream.readyState === WebSocket.OPEN) upstream.close(1000, "Session ended");
        if (client.readyState === WebSocket.OPEN) client.close(1000, "Session ended");
        const uncertain = opened && code !== 1000 && code !== 1001 && endedSeconds === null;
        const used = endedSeconds ?? (uncertain ? session.reservedSeconds
          : Math.max(ticks, startedAt === null ? 0 : Math.ceil((Date.now() - startedAt) / 1000)));
        if (state.superseded) {
          // A reconnect took over: record this segment's usage, do not settle.
          try { await recordPartialUsage(db, ref, used); }
          catch (error) { console.error("Partial usage recording failed", ref.id, error); }
          return;
        }
        // Retry transient database failures without reopening generation.
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await settleSession(db, ref, used, uncertain); return; }
          catch { if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); }
        }
        console.error("Provider session settlement requires reconciliation", ref.id);
      };
      unsubscribe = ref.onSnapshot((snapshot) => {
        const data = snapshot.data();
        if (!data || data.stopRequestedAt || data.status !== "active") close();
      }, close);
      client.on("message", (raw, binary) => {
        if (Date.now() - windowAt > 60_000) { windowAt = Date.now(); messageBytes = 0; messageCount = 0; }
        messageBytes += raw.length; messageCount++;
        if (messageBytes > 8 * 1024 * 1024 || messageCount > 240) return close();
        if (isFal) {
          if (!binary) return close();
          if (upstream.readyState === WebSocket.OPEN) upstream.send(raw, { binary: true });
          else if (upstream.readyState === WebSocket.CONNECTING && queuedBytes + raw.length <= 3 * 1024 * 1024) {
            queued.push({ raw, binary: true }); queuedBytes += raw.length;
          } else close();
          return;
        }
        if (binary) return close();
        let data;
        try { data = JSON.parse(raw.toString()); } catch { return close(); }
        // A second LiveKit join could allocate another provider session.
        if (data.type === "livekit_join") {
          if (client.joinSent) return close();
          client.joinSent = true;
        }
        if (!["livekit_join", "offer", "ice-candidate", "prompt", "set_image", "set_passthrough", "ping"].includes(data.type)) return close();
        if (upstream.readyState === WebSocket.OPEN) upstream.send(raw, { binary: false });
        else if (upstream.readyState === WebSocket.CONNECTING && queuedBytes + raw.length <= 3 * 1024 * 1024) {
          queued.push({ raw, binary: false }); queuedBytes += raw.length;
        } else close();
      });
      upstream.on("open", () => {
        opened = true;
        if (isFal && startedAt === null) startedAt = Date.now();
        for (const item of queued) upstream.send(item.raw, { binary: item.binary });
        queued = [];
      });
      upstream.on("message", (raw, binary) => {
        if (!isFal) {
          if (binary) return close();
          let data;
          try { data = JSON.parse(raw.toString()); } catch { return close(); }
          if (data.type === "generation_started" && startedAt === null) startedAt = Date.now();
          if ((data.type === "generation_tick" || data.type === "generation_ended")
            && Number.isFinite(data.seconds) && data.seconds >= 0) {
            ticks = Math.max(ticks, data.seconds);
            if (data.type === "generation_ended") endedSeconds = ticks;
          }
        }
        if (client.readyState === WebSocket.OPEN) {
          if (client.bufferedAmount > 4 * 1024 * 1024) return close();
          client.send(raw, { binary });
        }
      });
      upstream.on("close", (code) => { void finish(code); });
      upstream.on("error", close);
      client.on("close", () => { void finish(1001); });
      client.on("error", close);
    });
  });
  return wss;
}

module.exports = { attachDecartProxy, claimTicket, settleSession };
