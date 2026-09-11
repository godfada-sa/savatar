const { WebSocket, WebSocketServer } = require("ws");
const { createHash, timingSafeEqual } = require("node:crypto");
const { FieldValue } = require("firebase-admin/firestore");

const TICKET = /^([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.[0-9a-f]{64}$/;
const STREAM_LOCK_COLLECTION = "_streamLocks";
const STREAM_LOCK_DOCUMENT = "shared-ai-provider";
const MAX_CONCURRENT_AI_STREAMS = 5;
const CREDIT_SAFETY_RESERVE_MS = 5_000;
// The provider account supports multiple realtime sessions, and it reports
// the rejection only AFTER acknowledging the socket (ready + iceServers, then
// {type:"error",error:"Concurrent session limit reached."}). Hold the browser
// open and re-open the upstream for a bounded window so a session that is still
// winding down on fal's side delays the stream instead of failing the paid one.
//
// fal does not free the account the moment a session closes: measured release
// lag ranges from about four seconds to over thirty. The retry waits escalate to
// cover that window without hammering, because a tight loop does not wait a slot
// out — it competes for the same slot, opening a new session every couple of
// seconds while the previous one is still being reaped. Past the last entry the
// session is given up on, so a creator is never left hanging indefinitely.
const FAL_CONCURRENCY_RETRY_SCHEDULE_MS = [4_000, 9_000, 15_000];
const FAL_CONCURRENCY_WAIT_MS = 30_000;
// How long a released upstream may take to acknowledge a close frame before the
// socket is torn down at the TCP level.
const UPSTREAM_CLOSE_GRACE_MS = 1_000;
// A creator's phone can stop answering without ever closing the socket (sleep,
// tunnel, carrier handover). The connection stays half-open, so no close event
// arrives and the provider session keeps running and billing until the paid
// deadline — minutes of AI time nobody used. Ping the browser and end the
// session once it stops answering; the browser replies to pings on its own.
const CLIENT_PING_INTERVAL_MS = 15_000;
const CLIENT_LIVENESS_TIMEOUT_MS = 45_000;
// fal reports the rejection a fraction of a second after the messages it sends
// on a socket it accepted, so the acceptance window is idle-based: it restarts
// on every upstream message and only flushes once fal has gone quiet. The
// absolute cap keeps a chatty-but-healthy upstream from stalling the browser.
const FAL_ACCEPT_IDLE_MS = 800;
const FAL_ACCEPT_MAX_MS = 6_000;
const FAL_CONCURRENCY_MARKER = "Concurrent session limit reached";
// Overridable so the retry path can be exercised against a stub provider in
// tests; production always uses fal's realtime host.
const FAL_REALTIME_BASE_URL = process.env.FAL_REALTIME_BASE_URL || "wss://fal.run";

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
    const sessionSnapshot = await tx.get(ref);
    const data = sessionSnapshot.data();
    if (!data || data.status !== "active") return;
    const providerSlot = Number(data.providerSlot ?? 0);
    const lockDocument = Number.isInteger(providerSlot) && providerSlot >= 0 && providerSlot < MAX_CONCURRENT_AI_STREAMS
      ? (providerSlot === 0 ? STREAM_LOCK_DOCUMENT : `${STREAM_LOCK_DOCUMENT}-${providerSlot}`)
      : STREAM_LOCK_DOCUMENT;
    const lockRef = db.collection(STREAM_LOCK_COLLECTION).doc(lockDocument);
    const lockSnapshot = await tx.get(lockRef);
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
        upstreamUrl = new URL(`${FAL_REALTIME_BASE_URL}/${session.providerEndpoint}`);
        upstreamUrl.searchParams.set("fal_jwt_token", session.providerToken);
      } else {
        upstreamUrl = new URL("wss://api3.decart.ai/v1/stream");
        upstreamUrl.searchParams.set("api_key", session.providerToken);
        upstreamUrl.searchParams.set("model", session.model);
        upstreamUrl.searchParams.set("resolution", url.searchParams.get("resolution") === "1080p" ? "1080p" : "720p");
        if (url.searchParams.get("livekit_server_codec") === "vp8") upstreamUrl.searchParams.set("livekit_server_codec", "vp8");
      }
      let upstream = null;
      let startedAt = null, ticks = 0, endedSeconds = null, opened = false, finished = false;
      // One initial attempt plus one per entry in the retry schedule.
      const falAttemptBudget = FAL_CONCURRENCY_RETRY_SCHEDULE_MS.length + 1;
      let queued = [], queuedBytes = 0, messageBytes = 0, messageCount = 0, windowAt = Date.now();
      let unsubscribe = () => {};
      let retryTimer = null;
      let probeTimer = null;
      let livenessTimer = null;
      let lastClientPongAt = Date.now();
      const releaseSlot = () => {
        const slot = slots.get(ref.id);
        if (slot && slot.client === client) slots.delete(ref.id);
      };
      // Hand a socket back to the provider with a real close frame. Killing a
      // session at the TCP level leaves the provider holding it until its own
      // idle timeout, which is what keeps an account's single session slot busy
      // after the browser has already stopped. A close frame is the provider's
      // cue to release the slot immediately; the grace timer only covers a peer
      // that never acknowledges it.
      const releaseUpstream = (socket, reason) => {
        if (!socket) return;
        try {
          if (socket.readyState === WebSocket.CONNECTING) socket.terminate();
          else if (socket.readyState === WebSocket.OPEN) socket.close(1000, reason);
        } catch { /* already gone */ }
        if (socket.readyState === WebSocket.CLOSED) return;
        const grace = setTimeout(() => {
          try { if (socket.readyState !== WebSocket.CLOSED) socket.terminate(); } catch { /* gone */ }
        }, UPSTREAM_CLOSE_GRACE_MS);
        grace.unref?.();
      };
      const close = () => {
        releaseUpstream(upstream, "Session ended");
        clearTimeout(retryTimer);
        clearTimeout(probeTimer);
        clearInterval(livenessTimer);
        retryTimer = null;
        probeTimer = null;
        livenessTimer = null;
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
        clearTimeout(retryTimer);
        clearTimeout(probeTimer);
        clearInterval(livenessTimer);
        retryTimer = null;
        probeTimer = null;
        livenessTimer = null;
        unsubscribe();
        releaseSlot();
        releaseUpstream(upstream, "Session ended");
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
      const sendUpstream = (raw, binary) => {
        if (upstream && upstream.readyState === WebSocket.OPEN) { upstream.send(raw, { binary }); return true; }
        // While a fal reconnect is pending `upstream` is null; keep queueing so
        // the browser's offer/prompt/ICE messages survive the wait.
        if ((!upstream || upstream.readyState === WebSocket.CONNECTING)
          && queuedBytes + raw.length <= 3 * 1024 * 1024) {
          queued.push({ raw, binary }); queuedBytes += raw.length; return true;
        }
        return false;
      };
      client.on("message", (raw, binary) => {
        if (Date.now() - windowAt > 60_000) { windowAt = Date.now(); messageBytes = 0; messageCount = 0; }
        messageBytes += raw.length; messageCount++;
        if (messageBytes > 8 * 1024 * 1024 || messageCount > 240) return close();
        if (isFal) {
          if (!binary) return close();
          if (!sendUpstream(raw, true)) close();
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
        if (!sendUpstream(raw, false)) close();
      });
      // ── Provider upstream (fal is retryable) ─────────────────────────
      let probing = false;
      let probeBuffer = [];
      let lastRejection = null;
      let falUpstreamAttempts = 0;
      // Never wait past the paid window: the deadline timer already owns that.
      const retryUntil = isFal
        ? Math.max(Date.now(), Math.min(Date.now() + FAL_CONCURRENCY_WAIT_MS,
            session.deadlineAt.toMillis() - CREDIT_SAFETY_RESERVE_MS))
        : 0;
      let probeOpenedAt = 0;
      const forwardToClient = (raw, binary) => {
        if (client.readyState !== WebSocket.OPEN) return;
        if (client.bufferedAmount > 4 * 1024 * 1024) return close();
        client.send(raw, { binary });
      };
      // fal accepted the session for real: bill from acceptance, not from the
      // handshake of an attempt it went on to reject.
      const flushProbe = () => {
        probing = false;
        clearTimeout(probeTimer);
        probeTimer = null;
        const buffered = probeBuffer;
        probeBuffer = [];
        if (startedAt === null) startedAt = Date.now();
        for (const item of buffered) forwardToClient(item.raw, item.binary);
      };
      // Re-arm the acceptance window. Returns false once the cap is reached, at
      // which point the buffered messages are released even if fal is chatty.
      const armProbe = () => {
        clearTimeout(probeTimer);
        const remainingCap = FAL_ACCEPT_MAX_MS - (Date.now() - probeOpenedAt);
        if (remainingCap <= 0) { flushProbe(); return false; }
        probeTimer = setTimeout(flushProbe, Math.min(FAL_ACCEPT_IDLE_MS, remainingCap));
        return true;
      };
      const retryFalUpstream = () => {
        if (finished || !isFal) return;
        // One retry per rejection: the rejected socket's own close event must
        // not schedule a second attempt (that would open two upstreams and
        // leave one orphaned against fal's single-session limit).
        if (retryTimer) return;
        probing = false;
        probeBuffer = [];
        clearTimeout(probeTimer);
        probeTimer = null;
        const rejected = upstream;
        upstream = null;
        releaseUpstream(rejected, "Provider slot busy");
        const waitMs = FAL_CONCURRENCY_RETRY_SCHEDULE_MS[falUpstreamAttempts - 1];
        if (waitMs === undefined || Date.now() + waitMs >= retryUntil) {
          // Out of wait: hand the browser the provider's own message so the
          // failure is explanatory, then settle normally (nothing billed).
          if (lastRejection) forwardToClient(lastRejection.raw, lastRejection.binary);
          else forwardToClient(Buffer.from(JSON.stringify({
            type: "error",
            error: "The AI service is at capacity right now. Nothing was billed — please try again in a moment.",
          })), false);
          close();
          return;
        }
        retryTimer = setTimeout(() => { retryTimer = null; openUpstream(); }, waitMs);
      };
      function openUpstream() {
        if (finished || client.readyState !== WebSocket.OPEN) return;
        const attempt = new WebSocket(upstreamUrl, { origin, handshakeTimeout: 20_000,
          maxPayload: 3 * 1024 * 1024, perMessageDeflate: false });
        upstream = attempt;
        if (isFal) {
          falUpstreamAttempts++;
          // Never exceed the schedule: the last entry's wait ends the session.
          if (falUpstreamAttempts > falAttemptBudget) {
            void finish(1001);
            return;
          }
        }
        attempt.on("open", () => {
          opened = true;
          if (!isFal && startedAt === null) startedAt = Date.now();
          // The acceptance window starts only once the upstream is actually
          // open: fal's ready/iceServers/rejection burst happens after that,
          // and arming earlier would flush before fal has said anything.
          if (isFal) {
            probing = true;
            probeBuffer = [];
            probeOpenedAt = Date.now();
          }
          for (const item of queued) attempt.send(item.raw, { binary: item.binary });
          queued = [];
          if (isFal) armProbe();
        });
        attempt.on("message", (raw, binary) => {
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
            forwardToClient(raw, binary);
            return;
          }
          if (probing) {
            // The rejection message is the signal to re-open, so it must not
            // reach the browser (which would tear the paid session down).
            if (raw.includes(FAL_CONCURRENCY_MARKER)) { lastRejection = { raw, binary }; retryFalUpstream(); return; }
            probeBuffer.push({ raw, binary });
            armProbe();
            return;
          }
          forwardToClient(raw, binary);
        });
        attempt.on("close", (code) => {
          if (finished) return;
          // A retry already replaced this socket; its close is not a signal.
          if (upstream !== attempt) return;
          // A close before acceptance is the rejection arriving without its
          // message; retry rather than failing the session on the first try.
          if (isFal && startedAt === null && Date.now() < retryUntil) { retryFalUpstream(); return; }
          void finish(code);
        });
        attempt.on("error", () => { if (!isFal) close(); });
      }
      openUpstream();
      // End the provider session when the browser stops answering. 1001 ("going
      // away") keeps the settlement honest: usage is the time actually spent,
      // refunding the rest, instead of the whole reservation.
      client.on("pong", () => { lastClientPongAt = Date.now(); });
      livenessTimer = setInterval(() => {
        if (finished) return;
        if (Date.now() - lastClientPongAt > CLIENT_LIVENESS_TIMEOUT_MS) {
          console.warn("Client stopped answering; ending the provider session", ref.id);
          void finish(1001);
          return;
        }
        try { client.ping(); } catch { /* closing */ }
      }, CLIENT_PING_INTERVAL_MS);
      livenessTimer.unref?.();
      client.on("close", () => { void finish(1001); });
      client.on("error", close);
    });
  });
  return wss;
}

module.exports = { attachDecartProxy, claimTicket, settleSession };
