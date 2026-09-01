"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth-context";
import { iceServers, signalingUrl } from "@/lib/client-config";
import DashboardLayout from "@/components/DashboardLayout";

type Mode = "character" | "style" | "background" | "vton" | "vfx";

const MODES: { id: Mode; label: string; model: string }[] = [
  { id: "character", label: "Character", model: "lucy-2.5" },
  { id: "style", label: "Style Transfer", model: "lucy-restyle-2" },
  { id: "background", label: "Background", model: "lucy-2.5" },
  { id: "vton", label: "Virtual Try-On", model: "lucy-vton-3.5" },
  { id: "vfx", label: "VFX Effects", model: "lucy-2.5" },
];

type DecartModelId = "lucy-2.5" | "lucy-restyle-2" | "lucy-vton-3.5";

export default function Dashboard() {
  const { user, userData } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeMode, setActiveMode] = useState<Mode>("character");
  const [prompt, setPrompt] = useState("");
  const [streamDuration, setStreamDuration] = useState(0);
  const [cameraActive, setCameraActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [roomId, setRoomId] = useState("");
  const [viewerCount, setViewerCount] = useState(0);
  const [cameraDevice, setCameraDevice] = useState("default");
  const [resolution, setResolution] = useState("1080p");
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  const [showLiveChat, setShowLiveChat] = useState(false);
  const [lookModalOpen, setLookModalOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const lookInputRef = useRef<HTMLInputElement>(null);

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const clientRef = useRef<any>(null);
  const socketRef = useRef<Socket | null>(null);
  const transformedStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingPeerCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());

  // List cameras
  useEffect(() => {
    if (cameraActive) {
      navigator.mediaDevices.enumerateDevices().then((devices) => {
        setAvailableCameras(devices.filter((d) => d.kind === "videoinput"));
      });
    }
  }, [cameraActive]);

  useEffect(() => {
    const syncSavedLook = () => {
      setReferenceImage(localStorage.getItem("savatar-reference-image"));
      setPrompt(localStorage.getItem("savatar-ai-prompt") || "");
    };
    syncSavedLook();
    window.addEventListener("storage", syncSavedLook);
    return () => window.removeEventListener("storage", syncSavedLook);
  }, []);

  const applyReferenceImage = useCallback(async (dataUrl: string) => {
    if (!clientRef.current) return;
    const blob = await (await fetch(dataUrl)).blob();
    await clientRef.current.set({ image: blob, prompt: prompt || "Substitute the character in the video with the person in the reference image.", enhance: true });
  }, [prompt]);

  useEffect(() => {
    if (referenceImage && isStreaming) {
      void applyReferenceImage(referenceImage).catch(() => setError("The new reference image could not be applied."));
    }
  }, [applyReferenceImage, isStreaming, referenceImage]);

  useEffect(() => {
    if (!referenceImage && isStreaming && clientRef.current) {
      void clientRef.current.set({
        image: null,
        prompt: prompt || "Preserve the subject and original camera scene.",
        enhance: true,
      }).catch(() => setError("The selected background could not be applied."));
    }
  }, [isStreaming, prompt, referenceImage]);

  const saveReferenceImage = (file?: File) => {
    if (!file || !file.type.startsWith("image/") || file.size > 2_000_000) { setError("Choose an image under 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { const result = String(reader.result); localStorage.setItem("savatar-reference-image", result); setReferenceImage(result); setLookModalOpen(false); };
    reader.readAsDataURL(file);
  };

  const removeReferenceImage = () => {
    localStorage.removeItem("savatar-reference-image");
    setReferenceImage(null);
  };

  // Display time only. Credits are reserved by the server before the realtime
  // token is issued, so a browser cannot run an unpaid session.
  useEffect(() => {
    if (isStreaming && user) {
      const timer = setInterval(() => setStreamDuration((d) => d + 1), 1000);
      return () => clearInterval(timer);
    }
  }, [isStreaming, user]);

  useEffect(() => {
    const peers = peerConnectionsRef.current;
    const pendingCandidates = pendingPeerCandidatesRef.current;
    return () => {
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

  const openCamera = async (targetResolution: string, targetDevice: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: targetResolution === "1080p" ? 1920 : 1280,
          height: targetResolution === "1080p" ? 1080 : 720,
          frameRate: { ideal: 30 },
          deviceId: targetDevice !== "default" ? { exact: targetDevice } : undefined,
        },
        audio: true,
      });
      const previousStream = streamRef.current;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      previousStream?.getTracks().forEach((track) => track.stop());
      setCameraActive(true);
      setMicEnabled(true);
      setError("");
    } catch {
      setError("No camera was found. Connect a camera, then reload this page.");
    }
  };

  const startCamera = () => openCamera(resolution, cameraDevice);

  const changeResolution = (nextResolution: string) => {
    setResolution(nextResolution);
    if (cameraActive && !isStreaming) void openCamera(nextResolution, cameraDevice);
  };

  const changeCameraDevice = (nextDevice: string) => {
    setCameraDevice(nextDevice);
    if (cameraActive && !isStreaming) void openCamera(resolution, nextDevice);
  };

  const stopCamera = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    for (const connection of peerConnectionsRef.current.values()) connection.close();
    peerConnectionsRef.current.clear();
    pendingPeerCandidatesRef.current.clear();
    transformedStreamRef.current = null;
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
    setIsConnected(false);
    setIsStreaming(false);
  };

  const goLive = useCallback(async () => {
    if (!user) {
      setError("Sign in before starting an AI stream.");
      return;
    }
    if ((userData?.wallet?.balanceSeconds ?? 0) < 60) {
      window.location.href = "/credits";
      return;
    }
    if (!streamRef.current) {
      setError("Start your camera first.");
      return;
    }

    try {
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
      const tokenResult = await tokenResponse.json() as { apiKey?: string; error?: string };
      if (!tokenResponse.ok || !tokenResult.apiKey) {
        throw new Error(tokenResult.error || "Unable to authorize this AI session");
      }

      const model = models.realtime(modelId as Parameters<typeof models.realtime>[0]);
      const client = createDecartClient({ apiKey: tokenResult.apiKey });

      const realtimeClient = await client.realtime.connect(streamRef.current, {
        model,
        onRemoteStream: (transformedStream: MediaStream) => {
          const outputStream = new MediaStream([...transformedStream.getVideoTracks(), ...(streamRef.current?.getAudioTracks() ?? [])]);
          transformedStreamRef.current = outputStream;
          if (localVideoRef.current) localVideoRef.current.srcObject = outputStream;
          const transformedVideoTrack = transformedStream.getVideoTracks()[0];
          if (transformedVideoTrack) {
            for (const pc of peerConnectionsRef.current.values()) {
              const videoSender = pc.getSenders().find((sender) => sender.track?.kind === "video");
              void videoSender?.replaceTrack(transformedVideoTrack).catch((error) => {
                console.error("Unable to switch viewer to the transformed stream:", error);
              });
            }
          }
        },
        initialState: {
          prompt: {
            text: prompt || (referenceImage
              ? "Substitute the character in the video with the person in the reference image."
              : "Preserve the subject and their original camera scene."),
            enhance: true,
          },
        },
        resolution: resolution as "720p" | "1080p",
      });

      realtimeClient.on("error", (err: { message: string }) => {
        console.error("Decart error:", err);
      });

      clientRef.current = realtimeClient;
      setIsConnected(true);
      setIsStreaming(true);

      // Signaling server for viewers
      // Stable per-creator room lets the OBS browser-source URL attach to the
      // same live output as viewers.
      const newRoomId = `creator-${user.uid}`;
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
        setIsStreaming(false);
      });

      socket.on("authorization-error", () => {
        setError("Your account is not authorized to broadcast.");
        setIsStreaming(false);
      });

      socket.on("room-error", (message: string) => {
        setError(message || "Unable to open a live stream room.");
        setIsStreaming(false);
      });

      socket.on("viewer-count", (count: number) => {
        setViewerCount(count);
      });

      socket.on("viewer-joined", async ({ viewerId }: { viewerId: string }) => {
        const aiStream = transformedStreamRef.current ?? streamRef.current;
        if (!aiStream) return;

        peerConnectionsRef.current.get(viewerId)?.close();
        pendingPeerCandidatesRef.current.set(viewerId, []);
        const pc = new RTCPeerConnection({ iceServers });
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
        peerConnectionsRef.current.get(viewerId)?.close();
        peerConnectionsRef.current.delete(viewerId);
        pendingPeerCandidatesRef.current.delete(viewerId);
      });
    } catch (err) {
      console.error("SDK connect error:", err);
      setError(err instanceof Error ? err.message : "Failed to start the AI stream.");
    }
  }, [activeMode, prompt, referenceImage, user, userData?.wallet?.balanceSeconds]);

  const stopStream = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
      clientRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.emit("broadcaster-stopped", { roomId });
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    for (const connection of peerConnectionsRef.current.values()) connection.close();
    peerConnectionsRef.current.clear();
    pendingPeerCandidatesRef.current.clear();
    transformedStreamRef.current = null;
    if (localVideoRef.current && streamRef.current) {
      localVideoRef.current.srcObject = streamRef.current;
    }
    setIsStreaming(false);
    setIsConnected(false);
    setStreamDuration(0);
    setViewerCount(0);
  };

  const balanceMinutes = ((userData?.wallet?.balanceSeconds || 0) / 60).toFixed(1);
  return (
    <DashboardLayout>
      <div className="p-3 sm:p-6 space-y-4">
        {/* Error Banner */}
        {error && (
          <div className="p-4 rounded-xl bg-red-950/30 border border-red-500/20">
            <div className="text-sm font-semibold text-red-400">Session error</div>
            <div className="text-xs text-red-300/70 mt-0.5">{error}</div>
            <button
              onClick={() => setError("")}
              className="mt-2 px-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded text-[11px] text-neutral-300 transition"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Creator Studio Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] text-indigo-400 font-semibold uppercase tracking-wider mb-1">
              Creator Studio
            </div>
            <h1 className="text-xl font-bold">Go live. Get watched. Chat in real time.</h1>
            <p className="text-xs text-neutral-500 mt-1 max-w-lg">
              Broadcast with your camera — other creators find you in Feed, open your watch page,
              and interact live. Keep Studio open while broadcasting; OBS receives the same AI output and microphone audio.
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-[11px]">
            <span className={`w-2 h-2 rounded-full ${isStreaming ? "bg-emerald-500" : "bg-neutral-500"}`} />
            <span className={isStreaming ? "text-emerald-400" : "text-neutral-400"}>
              {isStreaming ? "Live" : "Offline"}
            </span>
          </div>
        </div>

        {/* Main Layout: Camera + Right Panel */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          {/* Left: Camera Preview */}
          <div className="xl:col-span-2 space-y-3">
            <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
              <div className="p-3 border-b border-white/5 flex items-center justify-between">
                <span className="text-xs font-semibold">Camera preview</span>
                <span className="text-[10px] text-neutral-500 px-2 py-0.5 rounded bg-white/5">
                  Preview
                </span>
              </div>
              <div className="relative aspect-[3/4] sm:aspect-video bg-[#0a0a0a]">
                <video
                  ref={localVideoRef}
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
                <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[10px] text-neutral-300">
                  Your camera
                </div>
              </div>
            </div>

            {/* Camera Controls Bar */}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2">
              <button
                onClick={isStreaming ? stopStream : cameraActive ? goLive : startCamera}
                className={`px-4 py-2 rounded-lg text-xs font-medium transition ${
                  isStreaming
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "bg-indigo-500 hover:bg-indigo-600 text-white"
                }`}
              >
                {isStreaming ? "Stop" : cameraActive ? "Go Live" : "Start camera"}
              </button>
              <button onClick={cameraActive ? stopCamera : startCamera} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-300 hover:bg-white/10 transition">
                Camera
              </button>
              <button onClick={() => { const next = !micEnabled; streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = next; }); setMicEnabled(next); }} disabled={!cameraActive} className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-300 hover:bg-white/10 transition disabled:opacity-40">
                {micEnabled ? "Mic on" : "Mic off"}
              </button>
              {availableCameras.length > 0 && (
                <select
                  value={cameraDevice}
                  onChange={(e) => changeCameraDevice(e.target.value)}
                  disabled={isStreaming}
                  className="min-w-0 max-w-52 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none disabled:opacity-50"
                >
                  <option value="default">No camera detected</option>
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
                className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none disabled:opacity-50"
              >
                <option value="720p">720p</option>
                <option value="1080p">1080p</option>
              </select>
              <button onClick={() => setLookModalOpen(true)} className="col-span-2 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-neutral-300 hover:bg-white/10 transition">
                Switch look →
              </button>
            </div>

            {/* Live Chat */}
            <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
              <div className="p-3 border-b border-white/5 flex items-center justify-between">
                <span className="text-xs font-semibold">Live chat</span>
                <span className="text-[10px] text-neutral-500 px-2 py-0.5 rounded bg-white/5 flex items-center gap-1">
                  <span className={`w-1.5 h-1.5 rounded-full ${isStreaming ? "bg-emerald-500" : "bg-neutral-500"}`} />
                  {isStreaming ? "Live" : "Offline"}
                </span>
              </div>
              <div className="p-6 min-h-[200px] flex items-center justify-center">
                <p className="text-xs text-neutral-500 text-center">
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
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-2">Audience</h3>
              <p className="text-[11px] text-neutral-500 leading-relaxed mb-3">
                When you go live, your stream appears in Feed and other creators can watch, chat, and
                react in real time.
              </p>
              <ul className="space-y-1 text-[11px] text-neutral-400 mb-3">
                <li>Share your watch link from the chat panel</li>
                <li>Switch look anytime for AI mode (uses credits)</li>
              </ul>
              <a
                href="/feed"
                className="block px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-center text-neutral-300 hover:bg-white/10 transition"
              >
                Browse live creators
              </a>
            </div>

            {/* Stream Status */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-3">Stream status</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="text-[10px] text-neutral-500 mb-0.5">Status</div>
                  <div className={`text-xs font-semibold ${isStreaming ? "text-emerald-400" : "text-neutral-400"}`}>
                    {isStreaming ? "Live" : "Offline"}
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="text-[10px] text-neutral-500 mb-0.5">Elapsed</div>
                  <div className="text-xs font-semibold text-white">{formatTime(streamDuration)}</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="text-[10px] text-neutral-500 mb-0.5">Viewers</div>
                  <div className="text-xs font-semibold text-white">{viewerCount || "—"}</div>
                </div>
              </div>
              <button
                onClick={isStreaming ? stopStream : cameraActive ? goLive : startCamera}
                className={`w-full mt-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isStreaming
                    ? "bg-red-500 hover:bg-red-600 text-white"
                    : "bg-indigo-500 hover:bg-indigo-600 text-white"
                }`}
              >
                {isStreaming ? "Stop" : cameraActive ? "Go Live" : "Start camera"}
              </button>
            </div>

            {/* AI Look */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-2">AI look</h3>
              <div className="flex items-center gap-2 mb-3">
                <span className="px-2 py-0.5 rounded bg-white/5 text-[11px] text-neutral-300 border border-white/10">
                  {MODES.find((m) => m.id === activeMode)?.label || "Natural"}
                </span>
                <span className="text-[11px] text-neutral-500">
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
                        ? "bg-indigo-500/15 text-indigo-400"
                        : "text-neutral-400 hover:text-white hover:bg-white/5"
                    } disabled:cursor-not-allowed disabled:opacity-50`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* OBS Output */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-2">OBS output</h3>
              <p className="text-[11px] text-neutral-500 mb-3">
                Send your AI program into OBS, Zoom, or Meet via Browser Source.
              </p>
              <a
                href="/ai-obs"
                className="block px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-center text-neutral-300 hover:bg-white/10 transition"
              >
                Open AI & OBS →
              </a>
            </div>
          </div>
        </div>

        {/* Live Now (bottom) */}
        <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
          <div className="p-3 border-b border-white/5 flex items-center justify-between">
            <span className="text-xs font-semibold">Live now</span>
            <a href="/feed" className="text-[11px] text-indigo-400 hover:text-indigo-300">View feed</a>
          </div>
          <div className="p-6">
            <p className="text-xs text-neutral-500 mb-2">
              Watch and chat with creators streaming on Savatar right now.
            </p>
            <p className="text-xs text-neutral-600 mb-3">No other creators are live. Go live and appear here for others.</p>
            <a
              href="/feed"
              className="block px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-center text-neutral-300 hover:bg-white/10 transition"
            >
              Open Feed for more →
            </a>
          </div>
        </div>
        {lookModalOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-indigo-400/30 bg-[#111827] p-5"><div className="flex justify-between"><h2 className="font-semibold">Your saved looks</h2><button onClick={() => setLookModalOpen(false)}>×</button></div><p className="mt-1 text-xs text-neutral-400">Saved only in this browser.</p>{referenceImage && <div className="relative mt-4 h-28 w-28"><img src={referenceImage} alt="Saved look" className="h-full w-full rounded-lg object-cover"/><button onClick={removeReferenceImage} aria-label="Delete saved image" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-xs font-bold text-white shadow-lg">×</button></div>}<input ref={lookInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => saveReferenceImage(e.target.files?.[0])}/><button onClick={() => lookInputRef.current?.click()} className="mt-4 rounded-lg bg-indigo-500 px-4 py-2 text-sm">{referenceImage ? "Upload another image" : "Upload image"}</button></div></div>}
      </div>
    </DashboardLayout>
  );
}
