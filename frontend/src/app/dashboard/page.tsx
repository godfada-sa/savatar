"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { prepareReferenceImage, savePreparedReferenceImage } from "@/lib/reference-image";
import { STREAM_MODES, type StreamMode } from "@/lib/ai-prompts";
import { useAiStreamEngine } from "@/lib/use-ai-stream";
import DashboardLayout from "@/components/DashboardLayout";

export default function Dashboard() {
  const { user, userData } = useAuth();
  const [activeMode, setActiveMode] = useState<StreamMode>("character");
  const [prompt, setPrompt] = useState("");
  // Decart's realtime models currently produce a 720p-class stream. Matching
  // the capture to that output avoids an unnecessary 1080p upload and reduces
  // connection failures on slower browsers.
  const [resolution, setResolution] = useState("720p");
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
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  // iOS-style front-camera mirroring for the self-view only: the outgoing
  // camera track and AI output stay unmirrored so text reads correctly to
  // viewers, matching how phone front cameras behave.
  const [mirrorPreview, setMirrorPreview] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("savatar-mirror-preview") !== "off";
  });
  const [isFrontCamera, setIsFrontCamera] = useState(true);
  const [lookModalOpen, setLookModalOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const lookInputRef = useRef<HTMLInputElement>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);

  const {
    isStreaming, isDecartActive, cameraActive, micEnabled, micAvailable,
    remainingSeconds, reservedSeconds, streamDuration, viewerCount,
    error, setError, notice, setNotice, startupStatus,
    goLive, stopStream, openCamera, stopCamera, toggleMic,
    pushLookIfChanged,
  } = useAiStreamEngine({
    user,
    balanceSeconds: userData?.wallet?.balanceSeconds ?? 0,
    activeMode,
    prompt,
    referenceImage,
    localVideoRef,
  });

  // Use the active track's reported direction so selecting a specific rear
  // device can never inherit a stale front-camera mirror setting.
  const previewMirrored = cameraActive && mirrorPreview && isFrontCamera;

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  const applyFrontCamera = (stream: MediaStream | null) => {
    setIsFrontCamera(stream?.getVideoTracks()[0]?.getSettings().facingMode !== "environment");
  };

  const startCamera = () => {
    void openCamera(cameraDevice, facingMode).then(applyFrontCamera);
  };

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

  // Live-look updates: push prompt/reference changes into the running session.
  useEffect(() => {
    pushLookIfChanged(referenceImage, prompt);
  }, [activeMode, isStreaming, prompt, pushLookIfChanged, referenceImage]);

  const changeResolution = (nextResolution: string) => {
    setResolution(nextResolution);
    if (cameraActive && !isStreaming) void openCamera(cameraDevice, facingMode).then(applyFrontCamera);
  };

  const changeCameraDevice = (nextDevice: string) => {
    setCameraDevice(nextDevice);
    if (nextDevice === "default") localStorage.removeItem("savatar-camera-device");
    else localStorage.setItem("savatar-camera-device", nextDevice);
    if (cameraActive && !isStreaming) void openCamera(nextDevice, facingMode).then(applyFrontCamera);
  };

  const flipCamera = () => {
    if (isStreaming) return;
    const next = facingModeRef.current === "user" ? "environment" : "user";
    facingModeRef.current = next;
    setFacingMode(next);
    try { localStorage.setItem("savatar-facing-mode", next); } catch { /* storage unavailable */ }
    setCameraDevice("default");
    localStorage.removeItem("savatar-camera-device");
    if (cameraActive) void openCamera("default", next).then(applyFrontCamera);
  };

  const toggleMirror = () => {
    setMirrorPreview((current) => {
      const next = !current;
      try { localStorage.setItem("savatar-mirror-preview", next ? "on" : "off"); } catch { /* storage unavailable */ }
      return next;
    });
  };

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
        {!error && notice && (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-700" role="status" aria-live="polite">
            <span>{notice}</span>
            <button
              onClick={() => setNotice("")}
              className="shrink-0 rounded border border-emerald-200 bg-white px-2 py-0.5 text-[11px] text-emerald-600 transition hover:bg-emerald-100"
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
            {isStreaming && reservedSeconds > 0 && isDecartActive && (
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
              <button onClick={toggleMic} disabled={!cameraActive || !micAvailable} className="px-3 py-2 rounded-lg bg-white border border-stone-300 text-xs text-stone-700 hover:bg-stone-50 transition disabled:opacity-40">
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
              {isStreaming && reservedSeconds > 0 && isDecartActive && (
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
                  {STREAM_MODES.find((m) => m.id === activeMode)?.label || "Natural"}
                </span>
                <span className="text-[11px] text-stone-500">
                  {isStreaming ? "AI active — uses credits" : "Real camera — no credits used"}
                </span>
              </div>
              <div className="space-y-1">
                {STREAM_MODES.map((m) => (
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
