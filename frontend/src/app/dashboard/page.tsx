"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth-context";
import { getIceServers, signalingUrl } from "@/lib/client-config";
import { getOrCreateStreamRoomId } from "@/lib/stream-room";
import { prepareReferenceImage, savePreparedReferenceImage } from "@/lib/reference-image";
import { FULL_BODY_SWAP_PROMPT, FULL_OUTFIT_SWAP_PROMPT } from "@/lib/ai-prompts";
import { clearLiveSessionDisplay, publishLiveSessionDisplay } from "@/lib/live-session-display";
import DashboardLayout from "@/components/DashboardLayout";

type Mode = "character" | "style" | "background" | "vton" | "vfx";

const MODES: { id: Mode; label: string; model: string }[] = [
  { id: "character", label: "Character", model: "lucy-2.5" },
  { id: "style", label: "Style Transfer", model: "lucy-2.5" },
  { id: "background", label: "Background", model: "lucy-2.5" },
  { id: "vton", label: "Virtual Try-On", model: "lucy-2.5" },
  { id: "vfx", label: "VFX Effects", model: "lucy-2.5" },
];

const DEFAULT_PROMPTS: Record<Mode, string> = {
  character: "Transform the visible person into a consistent, realistic character while preserving their full-body pose, motion, framing, and background.",
  style: "Apply a polished cinematic visual style while preserving the subject, motion, and scene composition.",
  background: "Replace the background with a clean professional studio while preserving the subject, lighting, and motion.",
  vton: "Apply a tasteful virtual outfit to the visible person while preserving their full-body pose, face, hands, and motion.",
  vfx: "Add subtle cinematic visual effects around the subject while preserving their identity, pose, and motion.",
};

const LEGACY_FULL_BODY_SWAP_PROMPT = "Replace the visible person's full body, face, hair, clothing, and visible limbs with the character from the reference image. Preserve pose, motion, framing, and background.";

function streamPrompt(mode: Mode, savedPrompt: string, hasReference: boolean) {
  if (hasReference && mode === "vton") {
    return FULL_OUTFIT_SWAP_PROMPT;
  }
  if (hasReference) {
    const saved = savedPrompt.trim();
    if (!saved) return FULL_BODY_SWAP_PROMPT;
    if (saved.includes(FULL_BODY_SWAP_PROMPT)) return saved;
    const modifiers = saved.replace(LEGACY_FULL_BODY_SWAP_PROMPT, "").trim();
    return modifiers ? `${FULL_BODY_SWAP_PROMPT} ${modifiers}` : FULL_BODY_SWAP_PROMPT;
  }
  if (savedPrompt.trim()) return savedPrompt.trim();
  return DEFAULT_PROMPTS[mode];
}

type DecartModelId = "lucy-2.5" | "lucy-restyle-2" | "lucy-vton-3.5";

export default function Dashboard() {
  const { user, userData } = useAuth();
  const router = useRouter();
  const [, setIsConnected] = useState(false);
  const [isDecartActive, setIsDecartActive] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeMode, setActiveMode] = useState<Mode>("character");
  const [prompt, setPrompt] = useState("");
  const [streamDuration, setStreamDuration] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [reservedSeconds, setReservedSeconds] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [micAvailable, setMicAvailable] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [viewerCount, setViewerCount] = useState(0);
  const [cameraDevice, setCameraDevice] = useState(() => {
    if (typeof window === "undefined") return "default";
    return localStorage.getItem("savatar-camera-device") || "default";
  });
  // Front/back preference for phones. Ignored whenever a specific device is
  // picked from the camera list; desktops simply resolve it to their webcam.
  const [facingMode, setFacingMode] = useState<"user" | "environment">(() => {
    if (typeof window === "undefined") return "user";
    return localStorage.getItem("savatar-facing-mode") === "environment" ? "environment" : "user";
  });
  const facingModeRef = useRef(facingMode);
  // Decart's realtime models currently produce a 720p-class stream. Matching
  // the capture to that output avoids an unnecessary 1080p upload and reduces
  // connection failures on slower browsers.
  const [resolution, setResolution] = useState("720p");
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  // iOS-style front-camera mirroring for the self-view only: the outgoing
  // camera track and AI output stay unmirrored so text reads correctly to
  // viewers, matching how phone front cameras behave.
  const [mirrorPreview, setMirrorPreview] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("savatar-mirror-preview") !== "off";
  });
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  // Use the active track's reported direction so selecting a specific rear
  // device can never inherit a stale front-camera mirror setting.
  const previewMirrored = cameraActive && mirrorPreview && isFrontCamera;
  const [startupStatus, setStartupStatus] = useState("");
  const [lookModalOpen, setLookModalOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const lookInputRef = useRef<HTMLInputElement>(null);
  const appliedReferenceRef = useRef<string | null>(null);
  const appliedPromptRef = useRef("");
  const sessionIdRef = useRef<string | null>(null);
  const sessionDeadlineRef = useRef<number | null>(null);
  const idTokenRef = useRef<string | null>(null);
  // Tracks whether transformed frames are currently arriving for UI status.
  const isDecartActiveRef = useRef(false);
  // Diagnostic provider counter plus heartbeat throttle.
  const lastTickSecondsRef = useRef(0);
  const lastHeartbeatSentAtRef = useRef(0);

  // Report liveness and diagnostics. Billing is always server-authoritative.
  const sendStreamHeartbeat = useCallback((generationSeconds: number, phase: "connected" | "generating" = "connected") => {
    const sid = sessionIdRef.current;
    const token = idTokenRef.current;
    if (!sid || !token) return;
    const now = Date.now();
    if (now - lastHeartbeatSentAtRef.current < 8_000) return; // throttle ~7/min
    lastHeartbeatSentAtRef.current = now;
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

  const localVideoRef = useRef<HTMLVideoElement>(null);
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
      socketRef.current.emit("broadcaster-stopped", { roomId });
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
  }, [roomId]);

  // List cameras
  useEffect(() => {
    if (cameraActive) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        setAvailableCameras(devices.filter((d) => d.kind === "videoinput"));
      });
    }
  }, [cameraActive, cameraDevice, facingMode]);

  useEffect(() => {
    const syncSavedLook = () => {
      setReferenceImage(localStorage.getItem("savatar-reference-image"));
      setPrompt(localStorage.getItem("savatar-ai-prompt") || "");
    };
    syncSavedLook();
    window.addEventListener("storage", syncSavedLook);
    return () => window.removeEventListener("storage", syncSavedLook);
  }, []);

  const applyCurrentLook = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    const nextPrompt = streamPrompt(activeMode, prompt, Boolean(referenceImage));
    const update: { image?: Blob | null; prompt: string; enhance: boolean } = {
      prompt: nextPrompt,
      enhance: true,
    };
    if (referenceImage !== appliedReferenceRef.current) {
      update.image = referenceImage ? await (await fetch(referenceImage)).blob() : null;
    }
    await client.set(update);
    appliedReferenceRef.current = referenceImage;
    appliedPromptRef.current = nextPrompt;
  }, [activeMode, prompt, referenceImage]);

  useEffect(() => {
    const nextPrompt = streamPrompt(activeMode, prompt, Boolean(referenceImage));
    if (isStreaming && (referenceImage !== appliedReferenceRef.current || nextPrompt !== appliedPromptRef.current)) {
      void applyCurrentLook().catch(() => setError("The live AI look could not be updated."));
    }
  }, [activeMode, applyCurrentLook, isStreaming, prompt, referenceImage]);

  const saveReferenceImage = async (file?: File) => {
    try {
      const prepared = await prepareReferenceImage(file);
      savePreparedReferenceImage(prepared);
      setReferenceImage(prepared);
      setLookModalOpen(false);
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The reference image could not be prepared.");
    }
  };

  const removeReferenceImage = () => {
    localStorage.removeItem("savatar-reference-image");
    setReferenceImage(null);
  };

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStreaming]);

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

  // Notify server on tab close / navigation so unused credits are refunded.
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
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
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

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const openCamera = useCallback(async (targetResolution: string, targetDevice: string) => {
    try {
      setStartupStatus("Requesting camera and microphone access");
      const video: MediaTrackConstraints = {
        width: { ideal: targetResolution === "1080p" ? 1920 : 1280 },
        height: { ideal: targetResolution === "1080p" ? 1080 : 720 },
        frameRate: { ideal: 30, max: 30 },
      };
      if (targetDevice !== "default") {
        video.deviceId = { exact: targetDevice };
      } else {
        video.facingMode = { ideal: facingModeRef.current };
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
      setIsFrontCamera(stream.getVideoTracks()[0]?.getSettings().facingMode !== "environment");
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
  }, []);

  const startCamera = () => openCamera(resolution, cameraDevice);

  const changeResolution = (nextResolution: string) => {
    setResolution(nextResolution);
    if (cameraActive && !isStreaming) void openCamera(nextResolution, cameraDevice);
  };

  const changeCameraDevice = (nextDevice: string) => {
    setCameraDevice(nextDevice);
    if (nextDevice === "default") localStorage.removeItem("savatar-camera-device");
    else localStorage.setItem("savatar-camera-device", nextDevice);
    if (cameraActive && !isStreaming) void openCamera(resolution, nextDevice);
  };

  const flipCamera = () => {
    if (isStreaming) return;
    const next = facingModeRef.current === "user" ? "environment" : "user";
    facingModeRef.current = next;
    setFacingMode(next);
    try { localStorage.setItem("savatar-facing-mode", next); } catch { /* storage unavailable */ }
    setCameraDevice("default");
    localStorage.removeItem("savatar-camera-device");
    if (cameraActive) void openCamera(resolution, "default");
  };

  const toggleMirror = () => {
    setMirrorPreview((current) => {
      const next = !current;
      try { localStorage.setItem("savatar-mirror-preview", next ? "on" : "off"); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const stopCamera = async () => {
    // If a stream is active, end it properly to refund credits
    if (isStreaming) {
      await stopStream();
    }
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    for (const connection of peerConnectionsRef.current.values()) connection.close();
    peerConnectionsRef.current.clear();
    pendingPeerCandidatesRef.current.clear();
    transformedStreamRef.current = null;
    appliedReferenceRef.current = null;
    if (socketRef.current) {
      socketRef.current.emit("broadcaster-stopped", { roomId });
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
  };

  const goLive = useCallback(async () => {
    if (!user) {
      setError("Sign in before starting an AI stream.");
      return;
    }
    if ((userData?.wallet?.balanceSeconds ?? 0) < 60) {
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
      setStartupStatus("Authorizing a secure AI session");
      const { createDecartClient, models } = await import("@decartai/sdk");
      const modelId = (MODES.find((m) => m.id === activeMode)?.model || "lucy-2.5") as DecartModelId;
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
      const attachTransformedStream = (transformedStream: MediaStream) => {
        const outputStream = new MediaStream([...transformedStream.getVideoTracks(), ...(streamRef.current?.getAudioTracks() ?? [])]);
        transformedStreamRef.current = outputStream;
        for (const id of waitingViewersRef.current) void offerViewerRef.current?.(id);
        waitingViewersRef.current.clear();
        if (localVideoRef.current) localVideoRef.current.srcObject = outputStream;
        setStartupStatus("AI output live");
        const transformedVideoTrack = transformedStream.getVideoTracks()[0];
        if (transformedVideoTrack) {
          for (const pc of peerConnectionsRef.current.values()) {
            const videoSender = pc.getSenders().find((sender) => sender.track?.kind === "video");
            void videoSender?.replaceTrack(transformedVideoTrack).catch((error) => {
              console.error("Unable to switch viewer to the transformed stream:", error);
            });
          }
        }
      };

      if (tokenResult.provider === "fal") {
        // ── fal.ai provider (master) ──────────────────────────────────
        // Browser ↔ Savatar relay ↔ fal signaling, with the provider
        // credential and paid cutoff controlled server-side.
        const { connectFalRealtime } = await import("@/lib/fal-realtime");
        const initialPrompt = streamPrompt(activeMode, prompt, Boolean(referenceImage));
        appliedReferenceRef.current = referenceImage;
        appliedPromptRef.current = initialPrompt;
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
                setError("The AI session ended. Your balance will update after the server settles usage.");
                setTimeout(() => stopStream(), 0);
              }
            },
            onRemoteStream: attachTransformedStream,
            onGenerationTick: (seconds) => {
              lastTickSecondsRef.current = Math.max(lastTickSecondsRef.current, Math.floor(Number(seconds) || 0));
              sendStreamHeartbeat(lastTickSecondsRef.current);
            },
            onError: (err) => {
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
        // ── Decart provider (legacy proxy path) ───────────────────────
        const model = models.realtime(modelId as Parameters<typeof models.realtime>[0]);
        const client = createDecartClient({ apiKey: tokenResult.apiKey,
          realtimeBaseUrl: signalingUrl.replace(/^http/, "ws"), telemetry: false });
        const initialImage = referenceImage ? await (await fetch(referenceImage)).blob() : undefined;
        appliedReferenceRef.current = referenceImage;
        const initialPrompt = streamPrompt(activeMode, prompt, Boolean(referenceImage));
        appliedPromptRef.current = initialPrompt;

        const realtimeClient = await client.realtime.connect(streamRef.current, {
          model,
          onConnectionChange: (state) => {
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

            // Presence heartbeat: from "connected" onward (covers queue time when
            // there are no generation ticks yet) the server knows the client is
            // alive, so the sweep never mistakes a queued session for a crash.
              if (state === "connected" || state === "generating") {
                sendStreamHeartbeat(lastTickSecondsRef.current, state === "generating" ? "generating" : "connected");
            }

            // Auto-end and settle as soon as the provider disconnects.
            if (state === "disconnected") {
              setError("The AI session ended. Your balance will update after the server settles usage.");
              setTimeout(() => stopStream(), 0);
            }
          },
          onQueuePosition: ({ position }) => setStartupStatus(`AI queue position: ${position}`),
          onRemoteStream: attachTransformedStream,
          initialState: {
            image: initialImage,
            prompt: {
              text: initialPrompt,
              enhance: true,
            },
          },
          resolution: resolution as "720p" | "1080p",
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

      // Signaling server for viewers
      // Stable per-creator room lets the OBS browser-source URL attach to the
      // same live output as viewers.
      const newRoomId = await getOrCreateStreamRoomId(user);
      setRoomId(newRoomId);

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
        const aiStream = transformedStreamRef.current;
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
  }, [activeMode, prompt, referenceImage, resolution, router, sendStreamHeartbeat, stopStream, user, userData?.wallet?.balanceSeconds]);

  return (
    <DashboardLayout streamActive={isStreaming}>
      <div className="p-3 sm:p-6 space-y-4">
        {/* Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-red-50 border border-red-200">
            <div className="text-sm font-semibold text-red-600">Session error</div>
            <div className="text-xs text-red-500 mt-0.5">{error}</div>
            <button
              onClick={() => setError("")}
              className="mt-2 px-3 py-1 bg-white hover:bg-red-100 border border-red-200 rounded text-[11px] text-red-600 transition"
            >
              Dismiss
            </button>
          </div>
        )}
        {!error && startupStatus && (
          <div className="rounded-xl border border-[#e84314]/25 bg-[#e84314]/8 px-4 py-3 text-xs text-[#c73608]" role="status" aria-live="polite">
            {startupStatus}
          </div>
        )}

        {/* Creator Studio Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] text-[#e84314] font-semibold uppercase tracking-wider mb-1">
              Creator Studio
            </div>
            <h1 className="text-xl font-bold text-stone-900">Go live. Get watched. Chat in real time.</h1>
            <p className="text-xs text-stone-500 mt-1 max-w-lg">
              Broadcast with your camera — other creators find you in Feed, open your watch page,
              and interact live. Keep Studio open while broadcasting; OBS receives the same AI output and microphone audio.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 rounded-full border border-stone-200 bg-stone-100 px-3 py-1 text-[11px] text-stone-600">
            <span className={`w-2 h-2 rounded-full ${isStreaming ? "bg-emerald-500" : "bg-stone-400"}`} />
            <span className={isStreaming ? "text-emerald-600" : "text-stone-500"}>
              {isStreaming ? "Live" : "Offline"}
            </span>
            {isStreaming && (
              <>
                <span className="h-3 w-px bg-stone-300" aria-hidden="true" />
                <span className="whitespace-nowrap text-stone-700">
                  {viewerCount} {viewerCount === 1 ? "viewer" : "viewers"}
                </span>
              </>
            )}
            {isStreaming && reservedSeconds > 0 && (
              <>
                <span className="h-3 w-px bg-stone-300" aria-hidden="true" />
                <span
                  className={`font-mono font-bold ${
                    remainingSeconds <= 30 ? "text-red-600" : remainingSeconds <= 60 ? "text-amber-600" : "text-stone-700"
                  }`}
                  aria-label={`${formatTime(remainingSeconds)} of streaming credits remaining`}
                >
                  {formatTime(remainingSeconds)}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Main Layout: Camera + Right Panel */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Left: Camera Preview */}
          <div className="xl:col-span-2 space-y-3">
            <div className="overflow-hidden rounded-xl border border-stone-200 bg-white shadow-sm">
              <div className="p-3 border-b border-stone-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-900">Camera preview</span>
                <span className="text-[10px] text-stone-500 px-2 py-0.5 rounded bg-stone-100">
                  Preview
                </span>
              </div>
              <div className="force-dark relative aspect-[3/4] sm:aspect-video bg-[#0a0a0a]">
                <video
                  ref={localVideoRef}
                  style={{ transform: previewMirrored ? "scaleX(-1)" : undefined }}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-cover"
                />
                {!cameraActive && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-600">
                    <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm">No camera detected</span>
                  </div>
                )}
                <button
                  type="button"
                  onClick={toggleMirror}
                  disabled={!isFrontCamera}
                  aria-label={mirrorPreview ? "Turn off mirror preview" : "Turn on mirror preview"}
                  title={isFrontCamera ? "Mirror preview" : "Back camera preview is not mirrored"}
                  className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-lg bg-black/60 text-neutral-300 hover:bg-black/80 disabled:opacity-40"
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8 7l-4 5 4 5m8-10l4 5-4 5M4 12h16M12 5v14" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Camera Controls Bar */}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <button
                onClick={isStreaming ? stopStream : cameraActive ? goLive : startCamera}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition ${
                  isStreaming
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "bg-[#e84314] hover:bg-[#c73608] text-white shadow-[0_6px_16px_-8px_rgba(232,67,20,0.6)]"
                }`}
              >
                {isStreaming ? "Stop" : cameraActive ? "Go Live" : "Start camera"}
              </button>
              <button onClick={cameraActive ? stopCamera : startCamera} className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-xs text-stone-700 hover:bg-stone-50 transition">
                Camera
              </button>
              <button onClick={() => { const tracks = streamRef.current?.getAudioTracks() ?? []; if (!tracks.length) return; const next = !micEnabled; tracks.forEach((track) => { track.enabled = next; }); setMicEnabled(next); }} disabled={!cameraActive || !micAvailable} className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-xs text-stone-700 hover:bg-stone-50 transition disabled:opacity-40">
                {!micAvailable ? "Mic unavailable" : micEnabled ? "Mic on" : "Mic off"}
              </button>
              {availableCameras.length > 1 && (
                <button
                  onClick={flipCamera}
                  disabled={isStreaming}
                  title="Switch between front and back camera"
                  className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-xs text-stone-700 hover:bg-stone-50 transition disabled:opacity-40"
                >
                  <svg className="inline-block w-3.5 h-3.5 mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Flip camera
                </button>
              )}
              {availableCameras.length > 0 && (
                <select
                  value={cameraDevice}
                  onChange={(e) => changeCameraDevice(e.target.value)}
                  disabled={isStreaming}
                  className="min-w-0 max-w-52 px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:border-[#e84314] disabled:opacity-50"
                >
                  <option value="default">Default camera</option>
                  {availableCameras.map((cam, i) => (
                    <option key={cam.deviceId} value={cam.deviceId}>
                      {cam.label || `Camera ${i + 1}`}
                    </option>
                  ))}
                </select>
              )}
              <select
                value={resolution}
                onChange={(e) => changeResolution(e.target.value)}
                disabled={isStreaming}
                className="px-3 py-2 bg-white border border-stone-300 rounded-lg text-xs text-stone-900 focus:outline-none focus:border-[#e84314] disabled:opacity-50"
              >
                <option value="720p">720p (AI optimized)</option>
              </select>
              <button onClick={() => setLookModalOpen(true)} className="col-span-2 px-3 py-2 rounded-lg bg-white border border-stone-300 text-xs text-stone-700 hover:bg-stone-50 transition">
                Switch look →
              </button>
            </div>

            {/* Live Chat */}
            <div className="rounded-xl bg-white border border-stone-200 overflow-hidden">
              <div className="p-3 border-b border-stone-200 flex items-center justify-between">
                <span className="text-xs font-semibold text-stone-900">Live chat</span>
                <span className="text-[10px] text-stone-500 px-2 py-0.5 rounded bg-stone-100 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isStreaming ? "bg-emerald-500" : "bg-stone-400"}`} />
                  {isStreaming ? "Live" : "Offline"}
                </span>
              </div>
              <div className="p-6 min-h-[200px] flex items-center justify-center">
                <p className="text-xs text-stone-500 text-center">
                  {isStreaming
                    ? "Chat is live. Share your watch link to get viewers."
                    : "Go live to open chat. Other creators will find you in Feed and can join your watch page."}
                </p>
              </div>
            </div>
          </div>

          {/* Right Panel */}
          <div className="space-y-3">
            {/* Audience */}
            <div className="p-4 rounded-xl bg-white border border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900 mb-2">Audience</h3>
              <p className="text-[11px] text-stone-500 leading-relaxed mb-3">
                When you go live, your stream appears in Feed and other creators can watch, chat, and
                react in real time.
              </p>
              <ul className="space-y-1 text-[11px] text-stone-600 mb-3">
                <li>Share your watch link from the chat panel</li>
                <li>Switch look anytime for AI mode (uses credits)</li>
              </ul>
              <a
                href="/feed"
                className="block px-3 py-2 rounded-lg bg-white border border-stone-300 text-xs text-center text-stone-700 hover:bg-stone-50 transition"
              >
                Browse live creators
              </a>
            </div>

            {/* Stream Status */}
            <div className="p-4 rounded-xl bg-white border border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900 mb-3">Stream status</h3>
              {isStreaming && reservedSeconds > 0 && (
                <div className="mb-3">
                  <div className="flex items-center justify-between text-[10px] text-stone-500 mb-1">
                    <span>Credits remaining</span>
                    <span>{formatTime(remainingSeconds)} / {formatTime(reservedSeconds)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-stone-200 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-1000 ${
                        remainingSeconds <= 30 ? "bg-red-500" : remainingSeconds <= 60 ? "bg-amber-500" : "bg-[#e84314]"
                      }`}
                      style={{ width: `${reservedSeconds > 0 ? (remainingSeconds / reservedSeconds) * 100 : 0}%` }}
                    />
                  </div>
                  {remainingSeconds <= 30 && remainingSeconds > 0 && (
                    <p className="text-[10px] text-red-600 mt-1">Stream will auto-end when credits run out</p>
                  )}
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="text-center p-2 rounded-lg bg-stone-100">
                  <div className="text-[10px] text-stone-500 mb-0.5">AI Status</div>
                  <div className={`text-xs font-semibold ${
                    isDecartActive ? "text-emerald-600" : isStreaming ? "text-amber-600" : "text-stone-500"
                  }`}>
                    {isDecartActive ? "Generating" : isStreaming ? "Connecting" : "Offline"}
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-stone-100">
                  <div className="text-[10px] text-stone-500 mb-0.5">Elapsed</div>
                  <div className="text-xs font-semibold text-stone-900">{formatTime(streamDuration)}</div>
                </div>
              </div>
              <button
                onClick={isStreaming ? stopStream : cameraActive ? goLive : startCamera}
                className={`w-full mt-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isStreaming
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "bg-[#e84314] hover:bg-[#c73608] text-white shadow-[0_6px_16px_-8px_rgba(232,67,20,0.6)]"
                }`}
              >
                {isStreaming ? "Stop" : cameraActive ? "Go Live" : "Start camera"}
              </button>
            </div>

            {/* AI Look */}
            <div className="p-4 rounded-xl bg-white border border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900 mb-2">AI look</h3>
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 rounded bg-stone-100 text-[11px] text-stone-600 border border-stone-200">
                  {MODES.find((m) => m.id === activeMode)?.label || "Natural"}
                </span>
                <span className="text-[11px] text-stone-500">
                  {isStreaming ? "AI active — uses credits" : "Real camera — no credits used"}
                </span>
              </div>
              <div className="space-y-1">
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setActiveMode(m.id)}
                    disabled={isStreaming}
                    className={`w-full text-left px-3 py-1.5 rounded text-xs transition ${
                      activeMode === m.id
                        ? "bg-[#e84314]/10 text-[#e84314] font-medium"
                        : "text-stone-500 hover:text-stone-900 hover:bg-stone-100"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* OBS Output */}
            <div className="p-4 rounded-xl bg-white border border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900 mb-2">OBS output</h3>
              <p className="text-[11px] text-stone-500 mb-3">
                Send your AI program into OBS, Zoom, or Meet via Browser Source.
              </p>
              <a
                href="/ai-obs"
                target={isStreaming ? "_blank" : undefined}
                rel={isStreaming ? "noreferrer" : undefined}
                className="block px-3 py-2 rounded-lg bg-white border border-stone-300 text-xs text-center text-stone-700 hover:bg-stone-50 transition"
              >
                Open AI & OBS →
              </a>
            </div>
          </div>
        </div>

        {/* Live Now (bottom) */}
        <div className="rounded-xl bg-white border border-stone-200 overflow-hidden">
          <div className="p-3 border-b border-stone-200 flex items-center justify-between">
            <span className="text-xs font-semibold text-stone-900">Live now</span>
            <a href="/feed" className="text-[11px] text-[#e84314] hover:text-[#c73608] font-medium">View feed</a>
          </div>
          <div className="p-6">
            <p className="text-xs text-stone-500 mb-2">
              Watch and chat with creators streaming on Savatar right now.
            </p>
            <p className="text-xs text-stone-500 mb-3">No other creators are live. Go live and appear here for others.</p>
            <a
              href="/feed"
              className="block px-3 py-2 rounded-lg bg-white border border-stone-300 text-xs text-center text-stone-700 hover:bg-stone-50 transition"
            >
              Open Feed for more →
            </a>
          </div>
        </div>
        {lookModalOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-xl"><div className="flex justify-between"><h2 className="font-semibold text-stone-900">Your saved looks</h2><button onClick={() => setLookModalOpen(false)} className="text-stone-500 hover:text-stone-900 text-lg leading-none">×</button></div><p className="mt-1 text-xs text-stone-500">Saved only in this browser.</p>{referenceImage && <div className="relative mt-4 h-28 w-28"><img src={referenceImage} alt="Saved look" className="h-full w-full rounded-lg object-cover"/><button onClick={removeReferenceImage} aria-label="Delete saved image" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-xs font-bold text-white shadow-lg">×</button></div>}<input ref={lookInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => saveReferenceImage(e.target.files?.[0])}/><button onClick={() => lookInputRef.current?.click()} className="mt-4 rounded-lg bg-[#e84314] hover:bg-[#c73608] px-4 py-2 text-sm text-white">{referenceImage ? "Upload another image" : "Upload image"}</button></div></div>}
      </div>
    </DashboardLayout>
  );
}
