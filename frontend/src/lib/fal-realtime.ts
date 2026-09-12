// fal.ai realtime WebRTC glue for Savatar.
//
// The browser connects to Savatar's authenticated signaling relay. The relay
// owns the fal credential and closes the upstream at the paid deadline.
import { decode, encode } from "@msgpack/msgpack";

export type FalConnectionState =
  | "connecting"
  | "connected"
  | "generating"
  | "reconnecting"
  | "disconnected";

export interface FalRealtimeHandlers {
  onStateChange?: (state: FalConnectionState) => void;
  /**
   * Called with the transformed stream as soon as the provider declares it
   * (`framesFlowing: false`) and again once it actually delivers frames
   * (`framesFlowing: true`). The stream must be handed to viewers immediately:
   * gating the handover on the frame check left the broadcast output blank for
   * as long as the provider took to start, and would leave it blank forever if a
   * browser reports no frame counters.
   */
  onRemoteStream?: (stream: MediaStream, info: { framesFlowing: boolean }) => void;
  onError?: (error: Error) => void;
  /** Called with accumulated AI generation seconds (for heartbeats/refunds). */
  onGenerationTick?: (seconds: number) => void;
}

export interface FalRealtimeConnection {
  disconnect(): void;
  getConnectionState(): FalConnectionState;
  /**
   * Update the prompt / reference image mid-session. `image` is a Blob or
   * data URL (converted to a data URL for the fal reference_image_url field).
   */
  set(input: { image?: Blob | string | null; prompt?: string; enhance?: boolean }): Promise<void>;
}

interface FalRealtimeOptions {
  relayUrl: string;
  /** One-use, session-scoped Savatar ticket; never a provider credential. */
  ticket: string;
  /** The camera MediaStream captured in the browser. */
  localStream: MediaStream;
  initialPrompt: string;
  referenceImage?: string | null;
  handlers: FalRealtimeHandlers;
}

// How long the provider gets to deliver its first decoded frame after it has
// ACCEPTED the session. `ready` is that acceptance signal, and it is also the
// moment the provider starts billing the session — and a session that is
// accepted but never declares a remote track fires no `ontrack` at all, so a
// track-level check cannot cover it. Arming the deadline on acceptance is what
// stops a blank session from being held (and paid for) indefinitely.
const AI_FIRST_FRAME_TIMEOUT_MS = 15_000;
// How long an ICE "disconnected" state may persist before it is treated as a
// real loss (the state is often transient during a path switch).
const CONNECTION_GRACE_MS = 5_000;

// fal only forms the media path when the offer already carries the ICE
// candidates. Measured against the real service (sessions gen=25–125s on
// Sep 11 while this shape was live): a trickled offer — candidates sent as
// their own messages, which is what browsers do by default — leaves ICE
// stuck at the provider and returns zero RTP, while the same offer with
// candidates inline connects and returns video. So gathering is allowed to
// finish first, and trickling is kept only as a fallback for when gathering
// does not complete in time.
const ICE_GATHER_TIMEOUT_MS = 3_000;

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number): Promise<boolean> {
  if (pc.iceGatheringState === "complete") return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (gathered: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve(gathered);
    };
    const onChange = () => { if (pc.iceGatheringState === "complete") finish(true); };
    pc.addEventListener("icegatheringstatechange", onChange);
    const timer = setTimeout(() => finish(pc.iceGatheringState === "complete"), timeoutMs);
  });
}

interface FalResult {
  type?: string;
  sdp?: string | null;
  candidate?: RTCIceCandidateInit | null;
  iceServers?: Array<{ urls?: string | string[]; username?: string; credential?: string }> | null;
  ice_servers?: Array<{ urls?: string | string[]; username?: string; credential?: string }> | null;
  iceservers?: Array<{ urls?: string | string[]; username?: string; credential?: string }> | null;
  error?: string | null;
  success?: boolean;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

export function connectFalRealtime(options: FalRealtimeOptions): FalRealtimeConnection {
  const { relayUrl, ticket, localStream, initialPrompt, referenceImage, handlers } =
    options;
  const { onStateChange, onRemoteStream, onError, onGenerationTick } = handlers;

  // fal's RealtimeConnection.send is typed for model inputs; signaling
  // messages (offer/icecandidate) are protocol-level, so widen the type here.
  let pc: RTCPeerConnection | null = null;
  let connection: WebSocket | null = null;
  let state: FalConnectionState = "connecting";
  let generationStartedAt = 0;
  let generationTimer: ReturnType<typeof setInterval> | null = null;
  let disconnected = false;
  // Remote candidates that arrive before the answer is applied. Applying them
  // early always fails (InvalidStateError) and the old code swallowed that,
  // which silently dropped ICE and left a negotiated track with no media.
  let remoteDescriptionSet = false;
  const pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  // Whether candidates still need to be sent separately (see the offer above).
  let trickleCandidates = false;
  // True once the transformed track has actually decoded frames.
  let announced = false;
  let connectionGraceTimer: ReturnType<typeof setTimeout> | null = null;
  let outputWatchdog: ReturnType<typeof setTimeout> | null = null;

  const setState = (next: FalConnectionState) => {
    if (disconnected) return;
    state = next;
    onStateChange?.(next);
  };

  const startGenerationTimer = () => {
    if (generationTimer) return;
    generationStartedAt = Date.now();
    generationTimer = setInterval(() => {
      if (disconnected || !generationStartedAt) return;
      onGenerationTick?.(Math.floor((Date.now() - generationStartedAt) / 1000));
    }, 5_000);
  };

  const stopGenerationTimer = () => {
    if (generationTimer) {
      clearInterval(generationTimer);
      generationTimer = null;
    }
  };

  const clearOutputWatchdog = () => {
    if (outputWatchdog) {
      clearTimeout(outputWatchdog);
      outputWatchdog = null;
    }
  };

  // The provider accepted the session but never produced a frame. End it instead
  // of holding a paid provider session open for a blank screen; the dashboard's
  // error handler stops the stream, which settles the session at zero billable
  // seconds and releases the provider slot.
  const failWithoutOutput = () => {
    if (disconnected || announced) return;
    clearOutputWatchdog();
    setState("disconnected");
    onError?.(new Error("The AI didn't send any video, so the session was ended early — nothing was charged. Please try again."));
  };

  // Armed when the provider accepts the session; disarmed by the first decoded
  // frame. Safe to call repeatedly: it only ever holds one deadline.
  const armOutputWatchdog = () => {
    if (outputWatchdog || announced || disconnected) return;
    outputWatchdog = setTimeout(failWithoutOutput, AI_FIRST_FRAME_TIMEOUT_MS);
  };

  // An `ontrack` event only means the answer DECLARED a track: it fires as soon
  // as the remote description is applied, whether or not a single frame ever
  // arrives. Polling the receiver's stats for decoded frames is what actually
  // proves the AI is producing pictures, so the transformed stream is announced
  // (and billing starts) only then. Until it does, the creator keeps seeing the
  // camera instead of a black rectangle.
  const watchForFrames = (track: MediaStreamTrack, receiver: RTCRtpReceiver | null, onFrames: () => void) => {
    // A declared track is also proof that the provider is generating, so it gets
    // the same deadline as the acceptance watchdog.
    armOutputWatchdog();
    const startedAt = Date.now();
    const poll = async () => {
      if (disconnected) return;
      if (announced) return;
      let decoded = 0;
      try {
        const stats = await (receiver ?? pc)!.getStats();
        stats.forEach((report) => {
          const entry = report as unknown as Record<string, unknown>;
          if (entry.type === "inbound-rtp" && entry.kind === "video") {
            decoded = Math.max(decoded,
              Number(entry.framesDecoded ?? 0), Number(entry.framesReceived ?? 0));
          }
        });
      } catch {
        // Stats unavailable this tick; retry below.
      }
      if (decoded > 0 && track.readyState === "live" && !track.muted) { onFrames(); return; }
      if (Date.now() - startedAt < AI_FIRST_FRAME_TIMEOUT_MS) {
        setTimeout(poll, 250);
      } else {
        // A declared/unmuted track can still contain no video. Never replace
        // the working camera preview with it; end the empty session.
        failWithoutOutput();
      }
    };
    void poll();
  };

  // ── WebRTC negotiation ─────────────────────────────────────────────
  const ensurePeerConnection = (servers: NonNullable<FalResult["iceServers"]>) => {
    if (pc) return pc;
    const iceServers: RTCIceServer[] = servers
      .filter((s) => !!s.urls)
      .map((s) => ({
        urls: s.urls as string | string[],
        ...(s.username ? { username: s.username } : {}),
        ...(s.credential ? { credential: s.credential } : {}),
      }));
    pc = new RTCPeerConnection({ iceServers });
    localStream.getTracks().forEach((track) => pc!.addTrack(track, localStream));

    pc.ontrack = (event) => {
      if (disconnected) return;
      // fal does not always attach the outgoing track to a MediaStream, so fall
      // back to the track itself rather than announcing an audio-only stream.
      const inStreams = event.streams?.[0]?.getVideoTracks() ?? [];
      const videoTracks = inStreams.length
        ? inStreams
        : event.track?.kind === "video" ? [event.track] : [];
      if (videoTracks.length === 0) return;
      // Combine the transformed video with the creator's local audio so the
      // stream handed to viewers matches the Decart path exactly.
      const merged = new MediaStream([...videoTracks, ...(localStream.getAudioTracks() ?? [])]);
      // Wire the output for viewers now; only the creator's own preview and the
      // billing countdown wait for real frames.
      onRemoteStream?.(merged, { framesFlowing: false });
      const announce = () => {
        if (disconnected || announced) return;
        announced = true;
        clearOutputWatchdog();
        onRemoteStream?.(merged, { framesFlowing: true });
        // Only now is the AI truly producing output, so the countdown starts
        // here rather than for a declared track that may stay silent.
        setState("generating");
        startGenerationTimer();
      };
      watchForFrames(videoTracks[0], event.receiver ?? null, announce);
    };

    pc.onicecandidate = (event) => {
      // Only when gathering did not finish in time: otherwise the candidates
      // are already inside the offer fal accepted.
      if (disconnected || !event.candidate || !connection || !trickleCandidates) return;
      connection.send(encode({
        type: "icecandidate",
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        },
      }));
    };

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      const state = pc.connectionState;
      if (state === "connected") {
        if (connectionGraceTimer) { clearTimeout(connectionGraceTimer); connectionGraceTimer = null; }
        return;
      }
      if (state !== "failed" && state !== "disconnected") return;
      // "disconnected" is routinely transient (an ICE path switching, a mobile
      // radio sleeping). Failing the paid session on the first sight of it ends
      // usable streams, so give the path a moment to recover.
      if (connectionGraceTimer) return;
      connectionGraceTimer = setTimeout(() => {
        connectionGraceTimer = null;
        if (disconnected || !pc) return;
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          setState("disconnected");
          onError?.(new Error("The AI video connection was lost."));
        }
      }, CONNECTION_GRACE_MS);
    };

    return pc;
  };

  const handleResult = async (result: FalResult) => {
    switch (result.type) {
      case "ready":
        setState("connected");
        // Acceptance starts the provider's bill and may never produce a track.
        armOutputWatchdog();
        break;

      case "iceservers":
      case "iceServers": {
        const servers = result.iceservers || result.iceServers || result.ice_servers || [];
        const peer = ensurePeerConnection(servers);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        // Let ICE gathering finish so the offer can carry its candidates.
        const gathered = await waitForIceGathering(peer, ICE_GATHER_TIMEOUT_MS);
        trickleCandidates = !gathered;
        connection?.send(encode({ type: "offer", sdp: peer.localDescription?.sdp ?? offer.sdp }));
        break;
      }

      case "answer":
        if (result.sdp && pc) {
          await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
          remoteDescriptionSet = true;
          // Release the candidates that arrived while the answer was in flight.
          for (const candidate of pendingRemoteCandidates.splice(0)) {
            await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
          }
        }
        break;

      case "icecandidate":
        if (result.candidate && pc) {
          if (!remoteDescriptionSet) { pendingRemoteCandidates.push(result.candidate); break; }
          await pc.addIceCandidate(new RTCIceCandidate(result.candidate))
            .catch((error) => console.warn("Discarded a remote ICE candidate", error));
        }
        break;

      case "ice-restart":
        if (pc && result.candidate) {
          // fal may ask for an ICE restart with fresh TURN config.
          const turn = result.candidate as unknown as {
            turn_config?: { server_url?: string; username?: string; credential?: string };
          };
          if (turn.turn_config?.server_url) {
            pc.setConfiguration({
              iceServers: [
                { urls: "stun:stun.l.google.com:19302" },
                {
                  urls: turn.turn_config.server_url,
                  username: turn.turn_config.username,
                  credential: turn.turn_config.credential,
                },
              ],
            });
          }
          const offer = await pc.createOffer({ iceRestart: true });
          await pc.setLocalDescription(offer);
          const gathered = await waitForIceGathering(pc, ICE_GATHER_TIMEOUT_MS);
          trickleCandidates = !gathered;
          connection?.send(encode({ type: "offer", sdp: pc.localDescription?.sdp ?? offer.sdp }));
        }
        break;

      case "prompt_ack":
      case "set_image_ack":
        if (result.success === false) {
          onError?.(new Error(result.error || "The AI could not apply that instruction."));
        }
        break;

      case "generation_started":
        // The provider announces this before a single frame exists, and it says
        // so for sessions that never deliver one at all. It is therefore a
        // status, not proof of output: the countdown and the billable window
        // start on decoded frames (announce(), reached from watchForFrames).
        // Arming them here billed creators for blank sessions.
        break;

      case "error": {
        setState("disconnected");
        // The provider allows one realtime session per account, so a slot that is
        // still winding down after a previous stream comes back as provider
        // jargon. Say what actually happened, and that it cost nothing.
        const providerMessage = result.error ?? "";
        onError?.(new Error(/concurrent session limit/i.test(providerMessage)
          ? "The AI service is still finishing your previous session. Nothing was charged — try again in a few seconds."
          : providerMessage || "The AI session failed."));
        break;
      }
    }
  };

  // ── Connect ────────────────────────────────────────────────────────
  const url = new URL("/v1/fal-realtime", relayUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("api_key", ticket);
  connection = new WebSocket(url);
  connection.binaryType = "arraybuffer";

  const initialInput: Record<string, unknown> = {
    prompt: initialPrompt,
    enable_prompt_expansion: true,
  };
  if (referenceImage) initialInput.reference_image_url = referenceImage;
  let latestInput = initialInput;
  connection.onopen = () => connection?.send(encode(latestInput));
  // Signaling messages must be applied in order: each one used to run in its
  // own floating task, so an `answer` and the ICE candidates behind it raced and
  // candidates were thrown away. Chain them instead.
  let signalingQueue: Promise<void> = Promise.resolve();
  connection.onmessage = (event) => {
    signalingQueue = signalingQueue.then(async () => {
      try {
        const bytes = event.data instanceof ArrayBuffer
          ? new Uint8Array(event.data)
          : event.data instanceof Blob
            ? new Uint8Array(await event.data.arrayBuffer())
            : null;
        const result = bytes ? decode(bytes) : JSON.parse(String(event.data));
        await handleResult(result as FalResult);
      } catch {
        onError?.(new Error("The AI service returned an invalid response."));
      }
    });
  };
  connection.onerror = () => onError?.(new Error("The AI signaling connection failed."));
  connection.onclose = () => {
    if (disconnected) return;
    setState("disconnected");
    onError?.(new Error("The AI signaling connection closed."));
  };

  return {
    disconnect() {
      state = "disconnected";
      disconnected = true;
      stopGenerationTimer();
      clearOutputWatchdog();
      if (connectionGraceTimer) { clearTimeout(connectionGraceTimer); connectionGraceTimer = null; }
      pendingRemoteCandidates.length = 0;
      if (pc) {
        pc.close();
        pc = null;
      }
      try {
        connection?.close(1000, "Session ended");
      } catch {
        // Already closed.
      }
      connection = null;
    },
    getConnectionState: () => state,
    async set(input) {
      if (!connection || disconnected) return;
      const update: Record<string, unknown> = { prompt: input.prompt ?? initialPrompt };
      if (input.enhance !== undefined) update.enable_prompt_expansion = input.enhance;
      if ("image" in input) {
        if (input.image) {
          const dataUrl = typeof input.image === "string" ? input.image : await blobToDataUrl(input.image);
          update.reference_image_url = dataUrl;
        } else {
          update.reference_image_url = null;
        }
      }
      latestInput = { ...latestInput, ...update };
      if (connection.readyState === WebSocket.OPEN) connection.send(encode(update));
    },
  };
}
