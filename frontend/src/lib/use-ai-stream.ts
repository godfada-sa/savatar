"use client";

// The AI go-live engine shared by the Studio dashboard and the AI & OBS page.
// Extracted from the dashboard so both pages drive the identical pipeline:
// token mint → provider session (fal primary, Decart fallback) → viewer/OBS
// broadcast over the signaling relay. Both pages therefore bill, heartbeat,
// refund, and tear down exactly the same way.

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import type { User } from "firebase/auth";
import { getIceServers, signalingUrl } from "@/lib/client-config";
import { getOrCreateStreamRoomId } from "@/lib/stream-room";
import { dataUrlToBlob } from "@/lib/reference-image";
import { clearLiveSessionDisplay, publishLiveSessionDisplay } from "@/lib/live-session-display";
import { streamPrompt, type StreamMode } from "@/lib/ai-prompts";

type DecartModelId = "lucy-2.5" | "lucy-restyle-2" | "lucy-vton-3.5";

// Every page that hosts the engine needs a local <video> to show either the
// camera (pre-live) or the AI output (live), mirroring the Studio layout.
export function useAiStreamEngine(params: {
  user: User | null;
  balanceSeconds: number;
  activeMode: StreamMode;
  prompt: string;
  referenceImage: string | null;
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const { user, balanceSeconds, activeMode, prompt, referenceImage, localVideoRef } = params;
  const router = useRouter();
  const [, setIsConnected] = useState(false);
  const [isDecartActive, setIsDecartActive] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamDuration, setStreamDuration] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [reservedSeconds, setReservedSeconds] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [micAvailable, setMicAvailable] = useState(false);
  const [viewerCount, setViewerCount] = useState(0);
  const [error, setError] = useState("");
  // Informational end-of-session message. Deliberate stops and clean provider
  // disconnects are not errors — they get a calm notice instead of the red
  // banner, which is reserved for genuine failures.
  const [notice, setNotice] = useState("");
  const [startupStatus, setStartupStatus] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null);
  const socketRef = useRef<Socket | null>(null);
  const transformedStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingPeerCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const waitingViewersRef = useRef(new Set<string>());
  const offerViewerRef = useRef<((viewerId: string) => Promise<void>) | null>(null);
  const startingRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const sessionDeadlineRef = useRef<number | null>(null);
  const idTokenRef = useRef<string | null>(null);
  const isDecartActiveRef = useRef(false);
  const lastTickSecondsRef = useRef(0);
  const lastHeartbeatPhaseRef = useRef<"connected" | "generating" | null>(null);
  const lastHeartbeatSentAtRef = useRef(0);
  const roomIdRef = useRef("");
  const appliedReferenceRef = useRef<string | null>(null);
  const appliedPromptRef = useRef("");

  // Report liveness and diagnostics. Billing is always server-authoritative.
  const sendStreamHeartbeat = useCallback((generationSeconds: number, phase: "connected" | "generating" = "connected") => {
    const sid = sessionIdRef.current;
    const token = idTokenRef.current;
    if (!sid || !token) return;
    const now = Date.now();
    // The connected→generating upgrade must never be throttled away: the server
    // starts the billable window from the first "generating" heartbeat, and the
    // throttle (armed by the "connected" heartbeat sent moments earlier) would
    // otherwise drop exactly that one call.
    const upgrade = phase === "generating" && lastHeartbeatPhaseRef.current !== "generating";
    if (!upgrade && now - lastHeartbeatSentAtRef.current < 8_000) return; // throttle ~7/min
    lastHeartbeatSentAtRef.current = now;
    lastHeartbeatPhaseRef.current = phase;
    void fetch("/api/streaming/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        sessionId: sid,
        generationSeconds: Math.max(0, Math.floor(generationSeconds)),
        phase,
      }),
    }).catch(() => {});
  }, []);

  const stopStream = useCallback(async () => {
    // Stop local/provider media first so clicking Stop is immediate even if the
    // settlement request is slow. The short fal token is only a final fallback.
    startingRef.current = false;
    isDecartActiveRef.current = false;
    setIsDecartActive(false);
    setIsStreaming(false);
    clearLiveSessionDisplay();
    setStartupStatus("Stopping AI session");
    const activeClient = clientRef.current;
    clientRef.current = null;
    try { activeClient?.disconnect(); } catch { /* Already disconnected. */ }

    const currentSessionId = sessionIdRef.current;
    const currentToken = idTokenRef.current;
    if (socketRef.current) {
      socketRef.current.emit("broadcaster-stopped", { roomId: roomIdRef.current });
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    for (const connection of peerConnectionsRef.current.values()) connection.close();
    peerConnectionsRef.current.clear();
    pendingPeerCandidatesRef.current.clear();
    transformedStreamRef.current = null;
    appliedReferenceRef.current = null;
    appliedPromptRef.current = "";
    if (localVideoRef.current && streamRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }
    setIsConnected(false);
    setStreamDuration(0);
    setRemainingSeconds(0);
    setReservedSeconds(0);
    sessionDeadlineRef.current = null;
    setViewerCount(0);

    if (!currentSessionId || !currentToken) {
      setStartupStatus("");
      return;
    }

    // Retry once before leaving settlement to the short-token sweeper. Session
    // refs are cleared only after the server acknowledges the idempotent end.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch("/api/streaming/end", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${currentToken}` },
          body: JSON.stringify({ sessionId: currentSessionId }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!response.ok) throw new Error("Settlement was not accepted");
        sessionIdRef.current = null;
        idTokenRef.current = null;
        setStartupStatus("");
        setNotice("Stream ended. Unused seconds were refunded to the balance.");
        return;
      } catch {
        if (attempt === 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
          continue;
        }
      }
    }
    setStartupStatus("");
    setError("The stream stopped, but the balance update is still pending. The server will reconcile it automatically.");
  }, [localVideoRef]);

  const goLive = useCallback(async () => {
    if (!user) {
      setError("Sign in before starting an AI stream.");
      return;
    }
    if (balanceSeconds < 60) {
      router.push("/credits");
      return;
    }
    if (!streamRef.current) {
      setError("Start your camera first.");
      return;
    }

    if (startingRef.current || clientRef.current) return;
    startingRef.current = true;
    try {
      setError("");
      setNotice("");
      setStartupStatus("Authorizing a secure AI session");
      const { createDecartClient, models } = await import("@decartai/sdk");
      const modelId = (STREAM_MODEL_FOR_MODE[activeMode] || "lucy-2.5") as DecartModelId;
      const idToken = await user.getIdToken();
      const tokenResponse = await fetch("/api/realtime-token", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ model: modelId }),
      });
      const tokenResult = await tokenResponse.json() as { apiKey?: string; error?: string; maxSessionDuration?: number; sessionId?: string; provider?: string; deadlineAt?: string };
      if (!tokenResponse.ok || !tokenResult.apiKey) {
        throw new Error(tokenResult.error || "Unable to authorize this AI session");
      }

      // Store session info for countdown and cleanup
      sessionIdRef.current = tokenResult.sessionId ?? null;
      idTokenRef.current = idToken;
      const sessionSeconds = tokenResult.maxSessionDuration ?? 0;
      setReservedSeconds(sessionSeconds);
      const paidDeadline = Date.parse(tokenResult.deadlineAt ?? "");
      const effectiveDeadline = Number.isFinite(paidDeadline) ? paidDeadline : Date.now() + sessionSeconds * 1000;
      sessionDeadlineRef.current = effectiveDeadline;
      setRemainingSeconds(Math.max(0, Math.min(sessionSeconds, Math.ceil((effectiveDeadline - Date.now()) / 1000))));
      publishLiveSessionDisplay(user.uid, effectiveDeadline);
      lastTickSecondsRef.current = 0;
      lastHeartbeatSentAtRef.current = 0;

      // Handle the transformed stream the same way for both providers: hand
      // it to viewers, show it locally, and switch existing viewer tracks.
      const attachTransformedStream = (transformedStream: MediaStream, info: { framesFlowing: boolean } = { framesFlowing: true }) => {
        // A stream with no video track is not AI output: swapping the preview to
        // it is what turned a stalled session into a black rectangle. Keep the
        // camera on screen until there is something real to show.
        const videoTracks = transformedStream.getVideoTracks();
        if (videoTracks.length === 0) return;
        // The fal path already merges the creator's microphone into the stream
        // it hands over, so only fall back to the local tracks when it carries
        // no audio of its own (otherwise viewers hear the creator twice).
        const incomingAudio = transformedStream.getAudioTracks();
        const outputStream = new MediaStream([
          ...videoTracks,
          ...(incomingAudio.length ? incomingAudio : streamRef.current?.getAudioTracks() ?? []),
        ]);
        // A declared WebRTC track can be empty. Do not hand it to OBS or
        // viewers until decoded frames prove that it contains AI video.
        if (!info.framesFlowing) return;
        transformedStreamRef.current = outputStream;
        for (const id of waitingViewersRef.current) void offerViewerRef.current?.(id);
        waitingViewersRef.current.clear();
        if (localVideoRef.current) localVideoRef.current.srcObject = outputStream;
        setStartupStatus("AI output live");
        const transformedVideoTrack = transformedStream.getVideoTracks()[0];
        if (transformedVideoTrack) {
          for (const pc of peerConnectionsRef.current.values()) {
            const videoSender = pc.getSenders().find((sender) => sender.track?.kind === "video");
            void videoSender?.replaceTrack(transformedVideoTrack).catch((swapError) => {
              console.error("Unable to switch viewer to the transformed stream:", swapError);
            });
          }
        }
      };

      if (tokenResult.provider === "fal") {
        // ── fal.ai provider ───────────────────────────────────────────
        // Browser ↔ Savatar relay ↔ fal signaling, with the provider
        // credential and paid cutoff controlled server-side.
        const { connectFalRealtime } = await import("@/lib/fal-realtime");
        const initialPrompt = streamPrompt(activeMode, prompt, Boolean(referenceImage));
        const falClient = connectFalRealtime({
          relayUrl: signalingUrl,
          ticket: tokenResult.apiKey,
          localStream: streamRef.current,
          initialPrompt,
          referenceImage,
          handlers: {
            onStateChange: (state) => {
              const labels = {
                connecting: "Connecting to the AI service",
                connected: "AI connected; waiting for output",
                generating: "AI output live",
                reconnecting: "Reconnecting to the AI service",
                disconnected: "AI stream disconnected",
              } as const;
              setStartupStatus(labels[state]);
              isDecartActiveRef.current = state === "generating";
              setIsDecartActive(state === "generating");
              if (state === "connected" || state === "generating") {
                sendStreamHeartbeat(lastTickSecondsRef.current, state === "generating" ? "generating" : "connected");
              }
              if (state === "disconnected") {
                setNotice("The AI session ended. Your balance will update automatically.");
                setTimeout(() => stopStream(), 0);
              }
            },
            onRemoteStream: attachTransformedStream,
            onGenerationTick: (seconds) => {
              lastTickSecondsRef.current = Math.max(lastTickSecondsRef.current, Math.floor(Number(seconds) || 0));
              // "generating" is what starts the billable window on the server;
              // fal ticks only flow once frames are actually decoding.
              sendStreamHeartbeat(lastTickSecondsRef.current, "generating");
            },
            onError: (err: Error) => {
              console.error("fal error:", err);
              isDecartActiveRef.current = false; setIsDecartActive(false);
              setError(err.message || "The AI stream disconnected unexpectedly.");
              setStartupStatus("AI connection failed");
              setTimeout(() => stopStream(), 0);
            },
          },
        });
        clientRef.current = falClient;
        isDecartActiveRef.current = falClient.getConnectionState() === "generating";
      } else {
        // ── Decart provider (fallback) ────────────────────────────────
        const model = models.realtime(modelId as Parameters<typeof models.realtime>[0]);
        const client = createDecartClient({ apiKey: tokenResult.apiKey,
          realtimeBaseUrl: signalingUrl.replace(/^http/, "ws"), telemetry: false });
        const initialImage = referenceImage ? await dataUrlToBlob(referenceImage) : undefined;
        const initialPrompt = streamPrompt(activeMode, prompt, Boolean(referenceImage));

        const realtimeClient = await client.realtime.connect(streamRef.current, {
          model,
          onConnectionChange: (state: string) => {
            const labels: Record<string, string> = {
              connecting: "Connecting to the AI service",
              connected: "AI connected; waiting for output",
              generating: "AI output live",
              reconnecting: "Reconnecting to the AI service",
              disconnected: "AI stream disconnected",
            };
            setStartupStatus(labels[state] ?? state);
            isDecartActiveRef.current = state === "generating";
            setIsDecartActive(state === "generating");
            // Presence heartbeat: from "connected" onward (covers queue time when
            // there are no generation ticks yet) the server knows the client is
            // alive, so the sweep never mistakes a queued session for a crash.
            if (state === "connected" || state === "generating") {
              sendStreamHeartbeat(lastTickSecondsRef.current, state === "generating" ? "generating" : "connected");
            }
            // Auto-end and settle as soon as the provider disconnects.
            if (state === "disconnected") {
              setNotice("The AI session ended. Your balance will update automatically.");
              setTimeout(() => stopStream(), 0);
            }
          },
          onQueuePosition: ({ position }: { position: number }) => setStartupStatus(`AI queue position: ${position}`),
          onRemoteStream: attachTransformedStream,
          initialState: {
            image: initialImage,
            prompt: {
              text: initialPrompt,
              enhance: true,
            },
          },
          resolution: "720p" as "720p" | "1080p",
        });

        realtimeClient.on("error", (err: { message: string }) => {
          console.error("Decart error:", err);
          isDecartActiveRef.current = false; setIsDecartActive(false);
          setError(err.message || "The AI stream disconnected unexpectedly.");
          setStartupStatus("AI connection failed");
          setTimeout(() => stopStream(), 0);
        });

        // Record provider diagnostics; the proxy remains the billing authority.
        realtimeClient.on("generationTick", ({ seconds }: { seconds: number }) => {
          lastTickSecondsRef.current = Math.max(lastTickSecondsRef.current, Math.floor(Number(seconds) || 0));
          sendStreamHeartbeat(lastTickSecondsRef.current, "generating");
        });

        clientRef.current = realtimeClient;
        isDecartActiveRef.current = realtimeClient.getConnectionState() === "generating";
      }
      setIsConnected(true);
      setStreamDuration(0);
      setIsStreaming(true);

      // Signaling server for viewers. Stable per-creator room lets the OBS
      // browser-source URL attach to the same live output as viewers.
      const newRoomId = await getOrCreateStreamRoomId(user);
      roomIdRef.current = newRoomId;

      const socket = io(signalingUrl, {
        transports: ["websocket", "polling"],
        auth: { token: idToken },
      });
      socketRef.current = socket;

      socket.on("connect", () => {
        socket.emit("join-room", { roomId: newRoomId, role: "broadcaster" });
      });

      socket.on("connect_error", () => {
        setError("Could not reach the live-stream signaling service.");
        void stopStream();
      });

      socket.on("authorization-error", () => {
        setError("Your account is not authorized to broadcast.");
        void stopStream();
      });

      socket.on("room-error", (message: string) => {
        setError(message || "Unable to open a live stream room.");
        void stopStream();
      });

      socket.on("viewer-count", (count: number) => {
        setViewerCount(count);
      });

      const offerViewer = async (viewerId: string) => {
        // Before AI frames are verified, viewers receive the real camera rather
        // than an empty provider track. The sender is replaced atomically once
        // AI output is live.
        const aiStream = transformedStreamRef.current ?? streamRef.current;
        if (!aiStream) { waitingViewersRef.current.add(viewerId); return; }

        peerConnectionsRef.current.get(viewerId)?.close();
        pendingPeerCandidatesRef.current.set(viewerId, []);
        const pc = new RTCPeerConnection({ iceServers: await getIceServers() });
        peerConnectionsRef.current.set(viewerId, pc);
        aiStream.getTracks().forEach((track) => pc.addTrack(track, aiStream));

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            socket.emit("ice-candidate", {
              roomId: newRoomId,
              candidate: event.candidate,
              targetId: viewerId,
            });
          }
        };

        pc.onconnectionstatechange = () => {
          if (["closed", "failed", "disconnected"].includes(pc.connectionState)) {
            pc.close();
            peerConnectionsRef.current.delete(viewerId);
            pendingPeerCandidatesRef.current.delete(viewerId);
          }
        };

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", { roomId: newRoomId, offer: pc.localDescription, viewerId });
      };
      offerViewerRef.current = offerViewer;
      socket.on("viewer-joined", ({ viewerId }: { viewerId: string }) => {
        void offerViewer(viewerId).catch(() => setError("A viewer could not connect."));
      });

      socket.on(
        "answer",
        async ({ answer, viewerId }: { answer: RTCSessionDescriptionInit; viewerId: string }) => {
          const pc = peerConnectionsRef.current.get(viewerId);
          if (pc) {
            await pc.setRemoteDescription(answer);
            for (const candidate of pendingPeerCandidatesRef.current.get(viewerId) ?? []) {
              await pc.addIceCandidate(candidate);
            }
            pendingPeerCandidatesRef.current.delete(viewerId);
          }
        }
      );

      socket.on(
        "ice-candidate",
        async ({ candidate, fromId }: { candidate: RTCIceCandidateInit; fromId: string }) => {
          const pc = peerConnectionsRef.current.get(fromId);
          if (pc?.remoteDescription) {
            await pc.addIceCandidate(candidate);
          } else if (pc) {
            const pending = pendingPeerCandidatesRef.current.get(fromId) ?? [];
            pending.push(candidate);
            pendingPeerCandidatesRef.current.set(fromId, pending);
          }
        }
      );

      socket.on("viewer-left", ({ viewerId }: { viewerId: string }) => {
        waitingViewersRef.current.delete(viewerId);
        peerConnectionsRef.current.get(viewerId)?.close();
        peerConnectionsRef.current.delete(viewerId);
        pendingPeerCandidatesRef.current.delete(viewerId);
      });
    } catch (err) {
      console.error("SDK connect error:", err);
      setError(err instanceof Error ? err.message : "Failed to start the AI stream.");
      setStartupStatus("");
      if (sessionIdRef.current) await stopStream();
    } finally {
      startingRef.current = false;
    }
  }, [activeMode, balanceSeconds, localVideoRef, prompt, referenceImage, router, sendStreamHeartbeat, stopStream, user]);

  // Camera plumbing lives in the hook so both pages behave identically,
  // including the stop path that also tears down any active AI session.
  const openCamera = useCallback(async (targetDevice: string, facingMode: "user" | "environment") => {
    try {
      setStartupStatus("Requesting camera and microphone access");
      const video: MediaTrackConstraints = {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      };
      if (targetDevice !== "default") {
        video.deviceId = { exact: targetDevice };
      } else {
        video.facingMode = { ideal: facingMode };
      }
      // Stop the previous stream first so phone browsers reliably hand the
      // camera over when switching between front and back.
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      } catch {
        // A missing/blocked microphone should not prevent a video-only stream.
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      setCameraActive(true);
      setMicEnabled(stream.getAudioTracks().some((track) => track.enabled));
      setMicAvailable(stream.getAudioTracks().length > 0);
      setError("");
      setStartupStatus(stream.getAudioTracks().length ? "Camera ready" : "Camera ready; microphone unavailable");
      return stream;
    } catch {
      // The previous stream was already stopped for the switch, so reflect
      // reality: no camera is active until a new one opens successfully.
      setCameraActive(false);
      setError("No camera was found. Connect a camera, then reload this page.");
      setStartupStatus("");
      return null;
    }
  }, [localVideoRef]);

  const stopCamera = useCallback(async () => {
    // End any active AI session properly first so credits are refunded.
    await stopStream();
    for (const connection of peerConnectionsRef.current.values()) connection.close();
    peerConnectionsRef.current.clear();
    pendingPeerCandidatesRef.current.clear();
    transformedStreamRef.current = null;
    if (socketRef.current) {
      socketRef.current.emit("broadcaster-stopped", { roomId: roomIdRef.current });
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setCameraActive(false);
    setMicEnabled(false);
    setMicAvailable(false);
    setIsConnected(false);
    setIsStreaming(false);
  }, [localVideoRef, stopStream]);

  const toggleMic = useCallback(() => {
    const tracks = streamRef.current?.getAudioTracks() ?? [];
    if (!tracks.length) return;
    const next = !micEnabled;
    tracks.forEach((track) => { track.enabled = next; });
    setMicEnabled(next);
  }, [micEnabled]);

  const stopCameraTracksOnly = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
    setCameraActive(false);
    setMicEnabled(false);
    setMicAvailable(false);
  }, [localVideoRef]);

  // Live-look updates: push prompt/reference changes into the running session
  const applyCurrentLook = useCallback(async (nextReferenceImage: string | null) => {
    const client = clientRef.current;
    if (!client) return;
    const nextPrompt = streamPrompt(activeMode, prompt, Boolean(nextReferenceImage));
    const update: { image?: Blob | null; prompt: string; enhance: boolean } = {
      prompt: nextPrompt,
      enhance: true,
    };
    if (nextReferenceImage !== appliedReferenceRef.current) {
      update.image = nextReferenceImage ? await dataUrlToBlob(nextReferenceImage) : null;
    }
    await client.set(update);
    appliedReferenceRef.current = nextReferenceImage;
    appliedPromptRef.current = nextPrompt;
  }, [activeMode, prompt]);

  const pushLookIfChanged = useCallback((nextReferenceImage: string | null, nextPrompt: string) => {
    const nextComputed = streamPrompt(activeMode, nextPrompt, Boolean(nextReferenceImage));
    if (isStreaming && (nextReferenceImage !== appliedReferenceRef.current || nextComputed !== appliedPromptRef.current)) {
      void applyCurrentLook(nextReferenceImage).catch(() => setError("The live AI look could not be updated."));
    }
  }, [activeMode, applyCurrentLook, isStreaming]);

  // Follow the server clock instead of decrementing local state, which prevents
  // background-tab timer throttling from extending a paid session. Stop with a
  // five-second safety reserve; settlement returns those unused seconds.
  useEffect(() => {
    if (!isStreaming) return;
    let stopping = false;
    const enforceCutoff = () => {
      const deadline = sessionDeadlineRef.current;
      if (!deadline) return;
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(remaining);
      if (remaining <= 5 && !stopping) {
        stopping = true;
        void stopStream();
      }
    };
    enforceCutoff();
    const cutoffTimer = window.setInterval(enforceCutoff, 250);
    const durationTimer = window.setInterval(() => setStreamDuration((duration) => duration + 1), 1000);
    return () => {
      window.clearInterval(cutoffTimer);
      window.clearInterval(durationTimer);
    };
  }, [isStreaming, stopStream]);

  // Reconcile abandoned sessions from a previous visit: the server-side hard
  // deadline (/api/streaming/sweep) finalizes any session whose reserved
  // window elapsed without a client "end" call, so records never stay dangling.
  useEffect(() => {
    if (!user) return;
    void user
      .getIdToken()
      .then((token) =>
        fetch("/api/streaming/sweep", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({}),
        })
      )
      .catch(() => {});
  }, [user]);

  // While live, periodically ask the server to finalize any session whose
  // client is gone (deadline passed or heartbeats stale), and refresh our own
  // presence heartbeat so the sweep never finalizes a live session.
  useEffect(() => {
    if (!isStreaming) return;
    const sweep = () => {
      const token = idTokenRef.current;
      if (!token) return;
      void fetch("/api/streaming/sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({}),
      }).catch(() => {});
      sendStreamHeartbeat(lastTickSecondsRef.current);
    };
    sweep();
    const timer = setInterval(sweep, 30_000);
    return () => clearInterval(timer);
  }, [isStreaming, sendStreamHeartbeat]);

  // Notify server on tab close / navigation so the relay tears down the
  // provider immediately and refunds all unused reservation time.
  useEffect(() => {
    const handleBeforeUnload = () => {
      clearLiveSessionDisplay();
      const sid = sessionIdRef.current;
      const token = idTokenRef.current;
      if (!sid || !token) return;
      // Authenticated keepalive; sendBeacon cannot carry the required token.
      void fetch("/api/streaming/end", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: sid }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, []);

  useEffect(() => {
    const peers = peerConnectionsRef.current;
    const pendingCandidates = pendingPeerCandidatesRef.current;
    return () => {
      // Notify server to refund unused time on unmount
      clearLiveSessionDisplay();
      const sid = sessionIdRef.current;
      const token = idTokenRef.current;
      if (sid && token) {
        void fetch("/api/streaming/end", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ sessionId: sid }),
          keepalive: true,
        }).catch(() => {});
      }
      clientRef.current?.disconnect();
      socketRef.current?.disconnect();
      for (const connection of peers.values()) connection.close();
      peers.clear();
      pendingCandidates.clear();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // A failed debit or signaling authorization must also release the paid AI
  // session; merely changing the UI state would leave it running remotely.
  useEffect(() => {
    if (isStreaming) return;
    clientRef.current?.disconnect();
    clientRef.current = null;
    socketRef.current?.disconnect();
    socketRef.current = null;
    for (const connection of peerConnectionsRef.current.values()) connection.close();
    peerConnectionsRef.current.clear();
    pendingPeerCandidatesRef.current.clear();
    transformedStreamRef.current = null;
  }, [isStreaming]);

  return {
    // state
    isStreaming, isDecartActive, cameraActive, micEnabled, micAvailable,
    remainingSeconds, reservedSeconds, streamDuration, viewerCount,
    error, setError, notice, setNotice, startupStatus,
    // camera + stream controls
    goLive, stopStream, openCamera, stopCamera, stopCameraTracksOnly, toggleMic,
    pushLookIfChanged,
    // internal stream accessor for pages that need the raw camera track
    getCameraStream: () => streamRef.current,
  };
}

const STREAM_MODEL_FOR_MODE: Record<StreamMode, string> = {
  character: "lucy-2.5",
  style: "lucy-2.5",
  background: "lucy-2.5",
  vton: "lucy-2.5",
  vfx: "lucy-2.5",
};
