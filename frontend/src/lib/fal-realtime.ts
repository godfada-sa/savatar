// fal.ai realtime WebRTC glue for Savatar.
//
// fal's realtime API is a *signaling relay*: the browser connects to
// wss://fal.run/<endpoint> with a short-lived JWT (minted by
// /api/realtime-token, never FAL_KEY itself), and media flows directly
// between the browser and Decart over WebRTC. The @fal-ai/client only
// handles the WebSocket relay — the app must create the RTCPeerConnection,
// answer the server's negotiation, and surface the remote transformed
// stream. This module implements exactly that dance and exposes a
// Decart-SDK-shaped surface so the dashboard treats both providers alike.
import { fal } from "@fal-ai/client";

export type FalConnectionState =
  | "connecting"
  | "connected"
  | "generating"
  | "reconnecting"
  | "disconnected";

export interface FalRealtimeHandlers {
  onStateChange?: (state: FalConnectionState) => void;
  /** Called with the transformed MediaStream once AI frames arrive. */
  onRemoteStream?: (stream: MediaStream) => void;
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
  endpoint: string;
  /** Short-lived JWT from /api/realtime-token (provider: "fal"). */
  token: string;
  /**
   * Called when the client needs a fresh token (initial connect uses `token`;
   * the fal client re-fetches at 90% of tokenExpirationSeconds). The route
   * refuses renewal once the session is ended/killed, so a stopped or dead
   * browser's runner is released at the previous token's expiry.
   */
  renewToken?: () => Promise<string>;
  /** Matches the minted token lifetime; enables client-side refresh. */
  tokenExpirationSeconds?: number;
  /** The camera MediaStream captured in the browser. */
  localStream: MediaStream;
  initialPrompt: string;
  referenceImage?: string | null;
  handlers: FalRealtimeHandlers;
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
  const { endpoint, token, renewToken, tokenExpirationSeconds, localStream, initialPrompt, referenceImage, handlers } =
    options;
  const { onStateChange, onRemoteStream, onError, onGenerationTick } = handlers;

  // fal's RealtimeConnection.send is typed for model inputs; signaling
  // messages (offer/icecandidate) are protocol-level, so widen the type here.
  interface FalSocket {
    send(input: unknown): void;
    close(): void;
  }
  let pc: RTCPeerConnection | null = null;
  let connection: FalSocket | null = null;
  let state: FalConnectionState = "connecting";
  let generationStartedAt = 0;
  let generationTimer: ReturnType<typeof setInterval> | null = null;
  let disconnected = false;

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
      console.log("[fal-webrtc] ontrack kind=", event.track?.kind, "streams=", event.streams?.length);
      if (disconnected) return;
      // Combine the transformed video with the creator's local audio so the
      // stream handed to viewers matches the Decart path exactly.
      const videoTracks = event.streams[0]?.getVideoTracks() ?? [];
      const audioTracks = localStream.getAudioTracks() ?? [];
      const merged = new MediaStream([...videoTracks, ...audioTracks]);
      onRemoteStream?.(merged);
      // The lucy-2.5 realtime relay does NOT send a `generation_started`
      // message (its output schema is only type/sdp/candidate/iceServers/
      // error) — the first remote track is the authoritative "AI is actually
      // producing frames" signal. Without this, the countdown never starts
      // and the streamer pays fal per-second while credits stay frozen.
      setState("generating");
      startGenerationTimer();
    };

    pc.onicecandidate = (event) => {
      if (disconnected || !event.candidate || !connection) return;
      connection.send({
        type: "icecandidate",
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
        },
      });
    };

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setState("disconnected");
        onError?.(new Error("The AI video connection was lost."));
      }
    };

    return pc;
  };

  const handleResult = async (result: FalResult) => {
    // Debug aid: surface the raw relay messages in the browser console so a
    // live test can confirm exactly which signals fal sends (the lucy-2.5
    // schema is only type/sdp/candidate/iceServers/error — no generation
    // lifecycle messages).
    console.log("[fal-relay]", JSON.stringify(result).slice(0, 300));
    switch (result.type) {
      case "ready":
        setState("connected");
        break;

      case "iceservers":
      case "iceServers": {
        const servers = result.iceservers || result.iceServers || result.ice_servers || [];
        const peer = ensurePeerConnection(servers);
        const offer = await peer.createOffer();
        await peer.setLocalDescription(offer);
        connection?.send({ type: "offer", sdp: offer.sdp });
        break;
      }

      case "answer":
        if (result.sdp && pc) {
          await pc.setRemoteDescription({ type: "answer", sdp: result.sdp });
        }
        break;

      case "icecandidate":
        if (result.candidate && pc) {
          await pc.addIceCandidate(new RTCIceCandidate(result.candidate)).catch(() => {});
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
          connection?.send({ type: "offer", sdp: offer.sdp });
        }
        break;

      case "prompt_ack":
      case "set_image_ack":
        if (result.success === false) {
          onError?.(new Error(result.error || "The AI could not apply that instruction."));
        }
        break;

      case "generation_started":
        setState("generating");
        startGenerationTimer();
        break;

      case "error":
        setState("disconnected");
        onError?.(new Error(result.error || "The AI session failed."));
        break;
    }
  };

  // ── Connect ────────────────────────────────────────────────────────
  // The first tokenProvider call (connect time) returns the pre-minted JWT;
  // refresh calls (90% of the TTL) mint a fresh one through the server, which
  // refuses once the session is no longer active — that refusal is what
  // releases the billed runner at token expiry when the stream was stopped
  // or the browser died.
  let usedInitialToken = false;
  const tokenProvider = async () => {
    if (!usedInitialToken) {
      usedInitialToken = true;
      return token;
    }
    if (!renewToken) return token;
    return renewToken();
  };

  connection = fal.realtime.connect(endpoint, {
    connectionKey: `savatar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    throttleInterval: 0,
    tokenProvider,
    ...(tokenExpirationSeconds ? { tokenExpirationSeconds } : {}),
    onResult: (result: FalResult) => void handleResult(result),
    onError: (error: Error) => {
      setState("disconnected");
      onError?.(error);
    },
  });

  // Kick the session off with the creator's instruction.
  const initialInput: Record<string, unknown> = {
    prompt: initialPrompt,
    enable_prompt_expansion: true,
  };
  if (referenceImage) initialInput.reference_image_url = referenceImage;
  connection.send(initialInput);

  return {
    disconnect() {
      disconnected = true;
      stopGenerationTimer();
      if (pc) {
        pc.close();
        pc = null;
      }
      try {
        connection?.close();
      } catch {
        // Already closed.
      }
      connection = null;
      setState("disconnected");
    },
    getConnectionState: () => state,
    async set(input) {
      if (!connection || disconnected) return;
      const update: Record<string, unknown> = { prompt: input.prompt ?? initialPrompt };
      if (input.enhance !== undefined) update.enable_prompt_expansion = input.enhance;
      if (input.image && input.image !== null) {
        const dataUrl = typeof input.image === "string" ? input.image : await blobToDataUrl(input.image);
        update.reference_image_url = dataUrl;
      } else {
        update.reference_image_url = null;
      }
      connection.send(update);
    },
  };
}