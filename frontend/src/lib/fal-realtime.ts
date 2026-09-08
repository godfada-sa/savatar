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
  relayUrl: string;
  /** One-use, session-scoped Savatar ticket; never a provider credential. */
  ticket: string;
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
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        setState("disconnected");
        onError?.(new Error("The AI video connection was lost."));
      }
    };

    return pc;
  };

  const handleResult = async (result: FalResult) => {
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
        connection?.send(encode({ type: "offer", sdp: offer.sdp }));
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
          connection?.send(encode({ type: "offer", sdp: offer.sdp }));
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
  connection.onmessage = (event) => {
    void (async () => {
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
    })();
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
