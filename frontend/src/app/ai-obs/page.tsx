"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import DashboardLayout from "@/components/DashboardLayout";

interface Background {
  id: string;
  name: string;
  category: string;
  image?: string;
}

export default function AiObsPage() {
  const { user, userData } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [selectedBg, setSelectedBg] = useState("original");
  const [selectedLook, setSelectedLook] = useState("default");
  const [obsUrl, setObsUrl] = useState("");
  const [resolution, setResolution] = useState("1080p");
  const [bgCategory, setBgCategory] = useState("all");
  const [referenceImage, setReferenceImage] = useState<string | null>(null);
  const [lookModalOpen, setLookModalOpen] = useState(false);
  const [error, setError] = useState("");

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
    const frame = requestAnimationFrame(() => {
      setObsUrl(`${window.location.origin}/obs/creator-${user?.uid || "demo"}`);
    });
    return () => cancelAnimationFrame(frame);
  }, [user]);

  useEffect(() => {
    setReferenceImage(localStorage.getItem("savatar-reference-image"));
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: resolution === "1080p" ? 1920 : 1280, height: resolution === "1080p" ? 1080 : 720, frameRate: { ideal: 30 } },
        audio: true,
      });
      if (videoRef.current) videoRef.current.srcObject = stream;
      setCameraActive(true);
    } catch {
      setError("Camera or microphone permission was denied.");
    }
  };

  const toggleMic = () => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getAudioTracks().forEach((track) => { track.enabled = !track.enabled; });
  };

  const uploadReference = (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 2_000_000) { setError("Use an image under 2 MB."); return; }
    const reader = new FileReader();
    reader.onload = () => { const image = String(reader.result); localStorage.setItem("savatar-reference-image", image); setReferenceImage(image); setSelectedLook("reference"); setLookModalOpen(false); };
    reader.readAsDataURL(file);
  };

  const removeReference = () => {
    localStorage.removeItem("savatar-reference-image");
    setReferenceImage(null);
    setSelectedLook("default");
  };

  const selectBackground = (background: Background) => {
    setSelectedBg(background.id);
    const prompt = background.id === "original"
      ? "Preserve the original camera background."
      : `Place the subject naturally in a ${background.name.toLowerCase()} background while preserving their motion.`;
    localStorage.setItem("savatar-ai-prompt", prompt);
  };

  const selectLook = (look: string) => {
    setSelectedLook(look);
    if (look === "default") {
      localStorage.removeItem("savatar-ai-prompt");
      return;
    }
    localStorage.setItem("savatar-ai-prompt", `Apply a ${look} visual style while preserving the subject's identity and camera motion.`);
  };

  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const stream = videoRef.current.srcObject as MediaStream;
      stream.getTracks().forEach((t) => t.stop());
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  return (
    <DashboardLayout>
      <div className="p-3 sm:p-6 space-y-4">
        {/* Error banner */}
        {(error || !cameraActive) && (
          <div className="mb-4 p-4 rounded-xl bg-red-950/30 border border-red-500/20">
            <div className="text-sm font-semibold text-red-400">Streaming error</div>
            <div className="text-xs text-red-300/70 mt-0.5">
              {error || "Start your camera to preview and stream."}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Main Area */}
          <div className="lg:col-span-2 space-y-4">
            {/* Video Feeds */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Camera Input */}
              <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
                <div className="p-3 border-b border-white/5 flex items-center justify-between">
                  <span className="text-xs font-semibold">Camera Input</span>
                  <span className="text-[10px] text-neutral-500 px-2 py-0.5 rounded bg-white/5">Private</span>
                </div>
                <div className="relative aspect-[4/3] sm:aspect-video bg-[#0a0a0a]">
                  <video ref={videoRef} autoPlay muted playsInline className="w-full h-full object-cover" />
                  {!cameraActive && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-600">
                      <svg className="w-10 h-10 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span className="text-xs">No camera</span>
                    </div>
                  )}
                  <div className="absolute bottom-2 left-2 px-2 py-0.5 bg-black/60 rounded text-[10px] text-neutral-300">
                    Your camera
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 p-2 border-t border-white/5">
                  <button onClick={cameraActive ? stopCamera : startCamera} className="px-3 py-2.5 rounded-lg bg-white/5 border border-indigo-500/50 text-xs text-neutral-200">{cameraActive ? "Stop camera" : "Camera"}</button>
                  <button onClick={toggleMic} disabled={!cameraActive} className="px-3 py-2.5 rounded-lg bg-white/5 border border-indigo-500/50 text-xs text-neutral-200 disabled:opacity-40">Mic</button>
                </div>
              </div>

              {/* AI Output */}
              <div className="rounded-xl bg-[#111] border border-white/5 overflow-hidden">
                <div className="p-3 border-b border-white/5 flex items-center justify-between">
                  <span className="text-xs font-semibold">AI program output</span>
                  <span className="text-[10px] px-2 py-0.5 rounded text-neutral-500 bg-white/5">
                    Studio required
                  </span>
                </div>
                <div className="relative aspect-[4/3] sm:aspect-video bg-[#07111a]">
                  <div className="absolute inset-0 flex items-center justify-center text-neutral-600">
                    <span className="text-xs">Start your AI stream in Studio to see output</span>
                  </div>
                </div>
                <div className="grid grid-cols-[1fr_auto] gap-2 p-2 border-t border-white/5">
                  <button
                    onClick={() => {
                      window.location.href = (userData?.wallet?.balanceSeconds ?? 0) < 60 ? "/credits" : "/dashboard";
                    }}
                    className="px-4 py-1.5 rounded-lg text-xs font-medium transition bg-indigo-500 hover:bg-indigo-600 text-white"
                  >
                    {(userData?.wallet?.balanceSeconds ?? 0) < 60 ? "Buy credits" : "Open Studio"}
                  </button>
                  <select
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                    className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-white focus:outline-none"
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
              </div>
            </div>

            {/* STREAM arrow */}
            <div className="flex items-center justify-center">
              <div className="flex items-center gap-2 text-neutral-600">
                <div className="h-px w-16 bg-white/10" />
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span className="text-[10px] uppercase tracking-wider">Stream</span>
                <div className="h-px w-16 bg-white/10" />
              </div>
            </div>

            {/* Backgrounds */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-1">Backgrounds</h3>
              <p className="text-[11px] text-neutral-500 mb-3">
                Choose a scene here, then open Studio to begin the real AI stream.
              </p>
              <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
                {["all", "professional", "luxury", "nature", "creative"].map((cat) => (
                  <button
                    key={cat}
                    onClick={() => setBgCategory(cat)}
                    className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition ${
                      bgCategory === cat ? "bg-indigo-500 text-white" : "bg-white/5 text-neutral-400 hover:text-white"
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
                        ? "border-indigo-400 ring-2 ring-indigo-500/30"
                        : "border-white/10 bg-white/5 hover:-translate-y-0.5 hover:border-white/25"
                    }`}
                  >
                    {bg.image ? (
                      <img src={bg.image} alt={bg.name} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
                    ) : (
                      <div className="grid h-full w-full place-items-center bg-gradient-to-br from-slate-800 to-slate-950 text-xs text-neutral-400">Your camera</div>
                    )}
                    <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/70 to-transparent px-3 pb-2 pt-8">
                      <span className="block text-[11px] font-medium leading-tight text-white">{bg.name}</span>
                      <span className="text-[9px] capitalize text-neutral-400">{bg.id === "original" ? "Camera" : bg.category}</span>
                    </div>
                    {selectedBg === bg.id && <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-indigo-500 text-xs text-white shadow-lg">✓</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Choose Your Look */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-3">Choose your look</h3>
              <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex gap-2">
                  {["default", "anime", "cyberpunk", "ghibli"].map((look) => (
                    <button
                      key={look}
                      onClick={() => selectLook(look)}
                      className={`w-16 h-16 rounded-lg border text-center flex flex-col items-center justify-center gap-1 transition ${
                        selectedLook === look
                          ? "border-indigo-500 bg-indigo-500/10"
                          : "border-white/5 bg-white/5 hover:border-white/10"
                      }`}
                    >
                      <span className="text-lg">{look === "default" ? "DF" : look[0].toUpperCase()}</span>
                      <span className="text-[9px] text-neutral-400 capitalize">{look}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setLookModalOpen(true)} className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-neutral-200 transition">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  {referenceImage ? "Change reference image" : "Upload reference image"}
                </button>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* OBS Browser Source */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-2">OBS Browser Source</h3>
              <p className="text-[11px] text-neutral-500 mb-3">
                Add this URL as a Browser Source in OBS (1280×720). Start your real stream in Studio and OBS receives it automatically.
              </p>
              <div className="p-3 rounded-lg bg-black border border-white/10 mb-3">
                <code className="text-[10px] text-indigo-400 break-all">{obsUrl}</code>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  onClick={() => { navigator.clipboard.writeText(obsUrl); alert("OBS URL copied!"); }}
                  className="px-3 py-3 bg-indigo-500 hover:bg-indigo-600 border border-indigo-400 rounded-lg text-sm text-white font-medium transition"
                >
                  Copy URL
                </button>
                <a href={obsUrl} target="_blank" rel="noreferrer" className="px-3 py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-white font-medium transition text-center">
                  Open preview
                </a>
              </div>
            </div>

            {/* Stream Status */}
            <div className="p-4 rounded-xl bg-[#111] border border-white/5">
              <h3 className="text-sm font-semibold mb-3">Stream Status</h3>
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="text-[10px] text-neutral-500">Status</div>
                  <div className="text-xs font-medium mt-0.5 text-neutral-400">
                    Studio controls this
                  </div>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="text-[10px] text-neutral-500">Resolution</div>
                  <div className="text-xs font-medium text-white mt-0.5">{resolution}</div>
                </div>
                <div className="text-center p-2 rounded-lg bg-white/5">
                  <div className="text-[10px] text-neutral-500">FPS</div>
                  <div className="text-xs font-medium text-white mt-0.5">30</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        {lookModalOpen && <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-md rounded-2xl border border-indigo-400/30 bg-[#111827] p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-semibold">Choose your look</h2><button onClick={() => setLookModalOpen(false)} className="rounded border border-white/10 px-2">×</button></div><p className="mt-1 text-xs text-neutral-400">Stored only in this browser until its site data is cleared.</p>{referenceImage && <div className="relative mt-4 h-28 w-28"><img src={referenceImage} alt="Saved reference" className="h-full w-full rounded-lg object-cover"/><button onClick={removeReference} aria-label="Delete saved image" className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full bg-red-500 text-xs font-bold text-white shadow-lg">×</button></div>}<input ref={fileInputRef} onChange={(event) => uploadReference(event.target.files?.[0])} type="file" accept="image/*" className="hidden"/><button onClick={() => fileInputRef.current?.click()} className="mt-4 rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white">{referenceImage ? "Upload another image" : "Upload reference image"}</button></div></div>}
      </div>
    </DashboardLayout>
  );
}
