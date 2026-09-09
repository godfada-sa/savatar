"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getOrCreateStreamRoomId } from "@/lib/stream-room";
import { prepareReferenceImage, savePreparedReferenceImage } from "@/lib/reference-image";
import DashboardLayout from "@/components/DashboardLayout";

interface Background {
  id: string;
  name: string;
  category: string;
  image?: string;
}

export default function AiObsPage() {
  const { user, userData } = useAuth();
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micAvailable, setMicAvailable] = useState(false);
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraDevice, setCameraDevice] = useState(() => {
    if (typeof window === "undefined") return "default";
    return localStorage.getItem("savatar-camera-device") || "default";
  });
  const [selectedBg, setSelectedBg] = useState("original");
  const [selectedLook, setSelectedLook] = useState("default");
  const [obsUrl, setObsUrl] = useState("");
  const resolution = "720p";
  const [bgCategory, setBgCategory] = useState("all");
  const [backgroundsOpen, setBackgroundsOpen] = useState(false);
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [lookModalOpen, setLookModalOpen] = useState(false);
  const [error, setError] = useState("");
  // iOS-style front-camera mirroring for the self-view only: the outgoing
  // camera track stays unmirrored so text reads correctly to viewers.
  const [mirrorPreview, setMirrorPreview] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("savatar-mirror-preview") !== "off";
  });

  const backgrounds: Background[] = [
    { id: "original", name: "Original", category: "all" },
    { id: "luxury-modern", name: "Luxury Modern Suite", category: "luxury", image: "/backgrounds/luxury-modern-suite.jpg" },
    { id: "presidential", name: "Presidential Suite", category: "luxury", image: "/backgrounds/presidential-suite.jpg" },
    { id: "business-room", name: "Premium Business Room", category: "luxury", image: "/backgrounds/business-room.jpg" },
    { id: "ceo-office", name: "Executive CEO Office", category: "professional", image: "/backgrounds/executive-office.jpg" },
    { id: "meeting-room", name: "Corporate Meeting Room", category: "professional", image: "/backgrounds/meeting-room.jpg" },
    { id: "workspace", name: "Creative Workspace", category: "professional", image: "/backgrounds/creative-workspace.jpg" },
    { id: "luxury-suite", name: "Luxury Suite", category: "luxury", image: "/backgrounds/luxury-suite.jpg" },
    { id: "penthouse", name: "Penthouse View", category: "luxury", image: "/backgrounds/penthouse.jpg" },
    { id: "yacht", name: "Yacht Interior", category: "luxury", image: "/backgrounds/yacht.jpg" },
    { id: "beach", name: "Tropical Beach", category: "nature", image: "/backgrounds/beach.jpg" },
    { id: "forest", name: "Mystical Forest", category: "nature", image: "/backgrounds/forest.jpg" },
    { id: "mountain", name: "Mountain Peak", category: "nature", image: "/backgrounds/mountain.jpg" },
    { id: "sunset", name: "Golden Sunset", category: "nature", image: "/backgrounds/sunset.jpg" },
    { id: "cyberpunk", name: "Cyberpunk City", category: "creative", image: "/backgrounds/cyberpunk.jpg" },
    { id: "anime", name: "Tokyo Neon", category: "creative", image: "/backgrounds/anime-city.jpg" },
    { id: "space", name: "Space Station", category: "creative", image: "/backgrounds/space.jpg" },
    { id: "underwater", name: "Underwater Ocean", category: "creative", image: "/backgrounds/underwater.jpg" },
    { id: "gaming", name: "Gaming Room", category: "creative", image: "/backgrounds/gaming.jpg" },
  ];

  const filteredBgs = backgrounds.filter((bg) => bgCategory === "all" || bg.category === bgCategory);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void getOrCreateStreamRoomId(user).then((id) => {
      if (!cancelled) setObsUrl(`${window.location.origin}/obs/${id}`);
    }).catch(() => { if (!cancelled) setError("Unable to load your stream room."); });
    const frame = requestAnimationFrame(() => {
      setReferenceImage(localStorage.getItem("savatar-reference-image"));
      setSelectedBg(localStorage.getItem("savatar-background-id") || "original");
      setSelectedLook(localStorage.getItem("savatar-style-id") || "default");
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [user]);

  useEffect(() => () => { cameraStreamRef.current?.getTracks().forEach((track) => track.stop()); }, []);

  useEffect(() => {
    void navigator.mediaDevices.enumerateDevices().then((devices) => {
      const cameras = devices.filter((device) => device.kind === "videoinput");
      setAvailableCameras(cameras);
      setCameraDevice((current) => {
        const deviceIdsVisible = cameras.some((camera) => Boolean(camera.deviceId));
        if (!deviceIdsVisible || current === "default" || cameras.some((camera) => camera.deviceId === current)) return current;
        localStorage.removeItem("savatar-camera-device");
        return "default";
      });
    }).catch(() => undefined);
  }, []);

  const refreshCameraList = async () => {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === "videoinput");
    setAvailableCameras(cameras);
    setCameraDevice((current) => {
      if (current === "default" || cameras.some((camera) => camera.deviceId === current)) return current;
      localStorage.removeItem("savatar-camera-device");
      return "default";
    });
  };

  const openCamera = async (targetDevice = cameraDevice) => {
    try {
      const video: MediaTrackConstraints = { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } };
      if (targetDevice !== "default") video.deviceId = { exact: targetDevice };
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: true });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      }
      const previousStream = videoRef.current?.srcObject as MediaStream | null;
      if (!videoRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      cameraStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      previousStream?.getTracks().forEach((track) => track.stop());
      setCameraActive(true);
      setMicEnabled(stream.getAudioTracks().some((track) => track.enabled));
      setMicAvailable(stream.getAudioTracks().length > 0);
      await refreshCameraList();
      setError("");
    } catch {
      setError("Camera access was denied or no camera is available.");
    }
  };

  const startCamera = () => openCamera();

  const changeCameraDevice = (nextDevice: string) => {
    setCameraDevice(nextDevice);
    if (nextDevice === "default") localStorage.removeItem("savatar-camera-device");
    else localStorage.setItem("savatar-camera-device", nextDevice);
    if (cameraActive) void openCamera(nextDevice);
  };

  const toggleMic = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    const tracks = stream?.getAudioTracks() ?? [];
    if (!tracks.length) return;
    const next = !micEnabled;
    tracks.forEach((track) => { track.enabled = next; });
    setMicEnabled(next);
  };

  const saveCombinedPrompt = (backgroundId: string, look: string, hasReference: boolean) => {
    const background = backgrounds.find((item) => item.id === backgroundId);
    const instructions: string[] = [];
    if (hasReference) {
      instructions.push("Replace the visible person's full body, face, hair, clothing, and visible limbs with the character from the reference image while preserving pose, motion, and framing.");
    }
    if (background && background.id !== "original") {
      instructions.push(`Replace the background with a ${background.name.toLowerCase()} scene while preserving the subject, lighting, and motion.`);
    }
    if (look !== "default") {
      instructions.push(`Apply a ${look} visual style while preserving subject identity and camera motion.`);
    }
    if (instructions.length) localStorage.setItem("savatar-ai-prompt", instructions.join(" "));
    else localStorage.removeItem("savatar-ai-prompt");
  };

  const uploadReference = async (file?: File) => {
    try {
      const image = await prepareReferenceImage(file);
      savePreparedReferenceImage(image);
      setReferenceImage(image);
      saveCombinedPrompt(selectedBg, selectedLook, true);
      setLookModalOpen(false);
      setError("");
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The reference image could not be prepared.");
    }
  };

  const removeReference = () => {
    localStorage.removeItem("savatar-reference-image");
    setReferenceImage(null);
    saveCombinedPrompt(selectedBg, selectedLook, false);
  };

  const selectBackground = (background: Background) => {
    setSelectedBg(background.id);
    localStorage.setItem("savatar-background-id", background.id);
    saveCombinedPrompt(background.id, selectedLook, Boolean(referenceImage));
  };

  const selectLook = (look: string) => {
    setSelectedLook(look);
    localStorage.setItem("savatar-style-id", look);
    saveCombinedPrompt(selectedBg, look, Boolean(referenceImage));
  };

  const toggleMirror = () => {
    setMirrorPreview((current) => {
      const next = !current;
      try { localStorage.setItem("savatar-mirror-preview", next ? "on" : "off"); } catch { /* storage unavailable */ }
      return next;
    });
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
      cameraStreamRef.current = null;
    }
    setCameraActive(false);
    setMicEnabled(false);
    setMicAvailable(false);
  };

  return (
    <DashboardLayout>
      <div className="p-3 sm:p-6 space-y-4">
        {/* Error banner */}
        {error && (
          <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200">
            <div className="text-sm font-semibold text-red-600">Streaming error</div>
            <div className="text-xs text-red-500 mt-0.5">{error}</div>
          </div>
        )}

        <div className="space-y-4 sm:space-y-6">
          {/* Main Area */}
          <div className="space-y-4">
            {/* Video Feeds */}
            <div className="grid grid-cols-1 items-center gap-4 xl:grid-cols-[minmax(260px,0.65fr)_44px_minmax(0,1.65fr)]">
              {/* Camera Input */}
              <div className="order-2 overflow-hidden rounded-xl border border-stone-200 bg-white xl:order-1">
                <div className="p-3 border-b border-stone-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-900">Camera Input</span>
                  <span className="text-[10px] text-stone-500 px-2 py-0.5 rounded bg-stone-100">Private</span>
                </div>
                <div className="force-dark relative aspect-[4/3] sm:aspect-video bg-[#0a0a0a]">
                  <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                    style={{ transform: cameraActive && mirrorPreview ? "scaleX(-1)" : undefined }}
                  />
                  {!cameraActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-600">
                      <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs">No camera</span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={toggleMirror}
                    title="Mirror your self-view (viewers always see the unmirrored image)"
                    className="absolute bottom-2 right-2 px-2 py-0.5 bg-black/60 hover:bg-black/80 rounded text-[10px] text-neutral-300"
                  >
                    {mirrorPreview ? "Mirror: on" : "Mirror: off"}
                  </button>
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[10px] text-neutral-300">
                    Your camera
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 p-2 border-t border-stone-200">
                  <button onClick={cameraActive ? stopCamera : startCamera} className="px-3 py-2.5 rounded-lg bg-white border border-stone-300 text-xs text-stone-700 hover:bg-stone-50">{cameraActive ? "Stop camera" : "Camera"}</button>
                  <button onClick={toggleMic} disabled={!cameraActive || !micAvailable} className="px-3 py-2.5 rounded-lg bg-white border border-stone-300 text-xs text-stone-700 hover:bg-stone-50 disabled:opacity-40">
                    {!cameraActive ? "Microphone" : !micAvailable ? "Mic unavailable" : micEnabled ? "Mute mic" : "Unmute mic"}
                  </button>
                  <select
                    value={cameraDevice}
                    onChange={(event) => changeCameraDevice(event.target.value)}
                    aria-label="Camera device"
                    className="col-span-2 min-w-0 rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-xs text-stone-700"
                  >
                    <option value="default">Default camera</option>
                    {availableCameras.filter((camera) => Boolean(camera.deviceId)).map((camera, index) => (
                      <option key={`${camera.deviceId}-${index}`} value={camera.deviceId}>
                        {camera.label || `Camera ${index + 1}`}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="hidden items-center justify-center text-[#e84314] xl:order-2 xl:flex">
                <div className="flex items-center gap-2 xl:flex-col xl:gap-1">
                  <div className="h-px w-12 bg-[#e84314]/30 xl:hidden" />
                  <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                  <span className="text-[9px] uppercase tracking-wider text-stone-400">Stream</span>
                  <div className="h-px w-12 bg-[#e84314]/30 xl:hidden" />
                </div>
              </div>

              {/* AI Output */}
              <div className="order-1 -mx-3 overflow-hidden border-y border-stone-200 bg-white shadow-sm sm:mx-0 sm:rounded-xl sm:border xl:order-3">
                <div className="p-3 border-b border-stone-200 flex items-center justify-between">
                  <span className="text-xs font-semibold text-stone-900">AI program output</span>
                  <span className="text-[10px] px-2 py-0.5 rounded text-stone-500 bg-stone-100">
                    OBS monitor
                  </span>
                </div>
                <div className="force-dark relative h-[72svh] min-h-[520px] max-h-[760px] bg-gradient-to-br from-[#0c1d3b] via-[#08213b] to-[#030811] sm:h-auto sm:max-h-none sm:aspect-video sm:min-h-[360px] xl:min-h-[440px]">
                  {obsUrl && <iframe title="AI program output monitor" src={`${obsUrl}?muted=1`} className="absolute inset-0 h-full w-full border-0" allow="autoplay" />}
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 p-2 border-t border-stone-200">
                  <button
                    onClick={() => {
                      if ((userData?.wallet?.balanceSeconds ?? 0) < 60) { router.push("/credits"); return; }
                      stopCamera();
                      const studio = window.open("/dashboard?start=1", "savatar-studio");
                      if (!studio) router.push("/dashboard?start=1");
                    }}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium transition bg-[#e84314] hover:bg-[#c73608] text-white"
                  >
                    {(userData?.wallet?.balanceSeconds ?? 0) < 60 ? "Buy credits" : "Start Stream"}
                  </button>
                  <span className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs text-stone-600" title="The real-time AI model is optimized for 720p output">720p / 30 FPS</span>
                </div>
              </div>
            </div>

            {/* Backgrounds */}
            <div className="p-4 rounded-xl bg-white border border-stone-200">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-stone-900">Backgrounds</h3>
                <button
                  type="button"
                  onClick={() => setBackgroundsOpen((current) => !current)}
                  aria-expanded={backgroundsOpen}
                  aria-controls="background-options"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-stone-200 text-stone-500 sm:hidden"
                >
                  <svg className={`h-4 w-4 transition-transform ${backgroundsOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                  <span className="sr-only">{backgroundsOpen ? "Hide backgrounds" : "Show backgrounds"}</span>
                </button>
              </div>
              <div id="background-options" className={`${backgroundsOpen ? "block" : "hidden"} pt-3 sm:block`}>
                <p className="mb-3 text-[11px] text-stone-500">
                  Choose a scene here, then select Start Stream to launch the AI output.
                </p>
                <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
                  {["all", "professional", "luxury", "nature", "creative"].map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setBgCategory(cat)}
                      className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                        bgCategory === cat ? "bg-[#e84314] text-white" : "bg-stone-100 text-stone-500 hover:text-stone-900"
                      }`}
                    >
                      {cat.charAt(0).toUpperCase() + cat.slice(1)}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
                  {filteredBgs.map((bg) => (
                    <button
                      key={bg.id}
                      onClick={() => selectBackground(bg)}
                      className={`group relative aspect-[4/3] overflow-hidden rounded-xl border text-left transition ${
                        selectedBg === bg.id
                          ? "border-[#e84314] ring-2 ring-[#e84314]/30"
                          : "border-stone-200 bg-white hover:-translate-y-0.5 hover:border-stone-400"
                      }`}
                    >
                      {bg.image ? (
                        <img src={bg.image} alt={bg.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                      ) : (
                        <div className="grid h-full w-full place-items-center bg-stone-200 text-xs text-stone-400">Your camera</div>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-3 pb-2 pt-8">
                        <span className="block text-[11px] font-medium leading-tight text-white">{bg.name}</span>
                        <span className="text-[9px] capitalize text-neutral-300">{bg.id === "original" ? "Camera" : bg.category}</span>
                      </div>
                      {selectedBg === bg.id && <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-[#e84314] text-xs text-white shadow-lg">✓</span>}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Choose Your Look */}
            <div className="p-4 rounded-xl bg-white border border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900 mb-3">Choose your look</h3>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex max-w-full gap-2 overflow-x-auto pb-1 scrollbar-none">
                  {["default", "anime", "cyberpunk", "ghibli"].map((look) => (
                    <button
                      key={look}
                      onClick={() => selectLook(look)}
                      className={`flex h-24 w-20 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border p-1.5 text-center transition ${
                        selectedLook === look
                          ? "border-[#e84314] bg-[#e84314]/10"
                          : "border-stone-200 bg-stone-50 hover:border-stone-400"
                      }`}
                    >
                      {look === "default" && referenceImage ? (
                        <img src={referenceImage} alt="Uploaded reference" className="min-h-0 w-full flex-1 rounded-lg object-cover" />
                      ) : (
                        <span className="grid min-h-0 w-full flex-1 place-items-center rounded-lg bg-stone-100 text-lg text-stone-900">{look === "default" ? "DF" : look[0].toUpperCase()}</span>
                      )}
                      <span className="text-[9px] text-stone-500 capitalize">{look}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setLookModalOpen(true)} className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-700 transition">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {referenceImage ? "Change reference image" : "Upload reference image"}
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="grid gap-4 lg:grid-cols-2">
            {/* OBS Browser Source */}
            <div className="p-4 rounded-xl bg-white border border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900 mb-2">OBS Browser Source</h3>
              <p className="text-[11px] text-stone-500 mb-3">
                Add this URL as a Browser Source in OBS (1280×720). Keep this page open to monitor the same transformed stream OBS receives.
              </p>
              <ol className="mb-3 space-y-1.5 text-[11px] leading-5 text-stone-600">
                <li><strong className="text-stone-800">1.</strong> Add a Browser Source at 1280×720 and paste this URL.</li>
                <li><strong className="text-stone-800">2.</strong> Start the AI stream and wait until the transformed video appears. If OBS stays blank, refresh that source.</li>
                <li><strong className="text-stone-800">3.</strong> Select Start Virtual Camera in OBS, then choose OBS Virtual Camera in your call app.</li>
              </ol>
              <div className="force-dark p-3 rounded-lg bg-stone-900 border border-stone-700 mb-3">
                <code className="text-[10px] text-[#f07a55] break-all">{obsUrl}</code>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  disabled={!obsUrl}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(obsUrl);
                      setError("");
                      alert("OBS URL copied!");
                    } catch {
                      setError("Your browser blocked clipboard access. Select and copy the URL manually.");
                    }
                  }}
                  className="px-3 py-3 bg-[#e84314] hover:bg-[#c73608] rounded-lg text-sm text-white font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Copy URL
                </button>
                <a href={obsUrl} target="_blank" rel="noreferrer" className="px-3 py-3 bg-white hover:bg-stone-50 border border-stone-300 rounded-lg text-sm text-stone-700 font-medium transition text-center">
                  Open preview
                </a>
              </div>
            </div>

            {/* Stream Status */}
            <div className="p-4 rounded-xl bg-white border border-stone-200">
              <h3 className="text-sm font-semibold text-stone-900 mb-3">Stream Status</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-stone-100">
                  <div className="text-[10px] text-stone-500">Status</div>
                  <div className="text-xs font-medium mt-0.5 text-stone-500">
                    Studio controls this
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-stone-100">
                  <div className="text-[10px] text-stone-500">Resolution</div>
                  <div className="text-xs font-medium text-stone-900 mt-0.5">{resolution}</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-stone-100">
                  <div className="text-[10px] text-stone-500">FPS</div>
                  <div className="text-xs font-medium text-stone-900 mt-0.5">30</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {lookModalOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-semibold text-stone-900">Choose your look</h2><button onClick={() => setLookModalOpen(false)} className="rounded border border-stone-300 px-2 text-stone-500 hover:text-stone-900">×</button></div><p className="mt-1 text-xs text-stone-500">Use a clear, full-body JPEG, PNG, or WebP image at least 512×512. It is stored only in this browser until its site data is cleared.</p>{referenceImage && <div className="relative mt-4 h-28 w-28"><img src={referenceImage} alt="Saved reference" className="h-full w-full rounded-lg object-cover"/><button onClick={removeReference} aria-label="Delete saved image" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-xs font-bold text-white shadow-lg">×</button></div>}<input ref={fileInputRef} onChange={(event) => void uploadReference(event.target.files?.[0])} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"/><button onClick={() => fileInputRef.current?.click()} className="mt-4 rounded-lg bg-[#e84314] hover:bg-[#c73608] px-4 py-2 text-sm font-medium text-white">{referenceImage ? "Upload another image" : "Upload reference image"}</button></div></div>}
      </div>
    </DashboardLayout>
  );
}
