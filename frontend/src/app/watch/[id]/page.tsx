"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { iceServers, signalingUrl } from "@/lib/client-config";

export default function WatchPage() {
  const params = useParams();
  const streamId = (params?.id as string) || "demo";

  const [isConnected, setIsConnected] = useState(false);
  const [streamActive, setStreamActive] = useState(false);
  const [viewerCount, setViewerCount] = useState(1);
  const [chatMessages, setChatMessages] = useState<{ user: string; text: string }[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isMuted, setIsMuted] = useState(true);
  const [status, setStatus] = useState("Connecting...");

  const videoRef = useRef<HTMLVideoElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  useEffect(() => {
    const socket = io(signalingUrl, {
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Connected to signaling server");
      socket.emit("join-room", { roomId: streamId, role: "viewer" });
    });

    socket.on("connect_error", () => {
      setIsConnected(false);
      setStatus("Live-stream service is unavailable");
    });

    socket.on("room-joined", (data: { streamActive: boolean; viewerCount: number }) => {
      setStreamActive(data.streamActive);
      setViewerCount(data.viewerCount);
      setStatus(data.streamActive ? "Stream is live!" : "Waiting for broadcaster...");
    });

    socket.on("broadcaster-exists", () => {
      setStreamActive(true);
      setStatus("Stream is live!");
    });

    socket.on("stream-started", () => {
      setStreamActive(true);
      setStatus("Stream is live!");
    });

    socket.on("stream-stopped", () => {
      setStreamActive(false);
      setStatus("Stream ended");
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      pendingCandidatesRef.current = [];
    });

    socket.on("broadcaster-left", () => {
      setStreamActive(false);
      setStatus("Broadcaster disconnected");
      if (pcRef.current) {
        pcRef.current.close();
        pcRef.current = null;
      }
      pendingCandidatesRef.current = [];
    });

    socket.on("viewer-count", (count: number) => {
      setViewerCount(count);
    });

    // Handle offer from broadcaster
    socket.on("offer", async ({ offer, broadcasterId }: { offer: RTCSessionDescriptionInit; broadcasterId: string }) => {
      console.log("Received offer from broadcaster");

      pcRef.current?.close();
      pendingCandidatesRef.current = [];
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;

      pc.ontrack = (event) => {
        console.log("Received remote track");
        if (videoRef.current) {
          videoRef.current.srcObject = event.streams[0];
        }
        setIsConnected(true);
        setStatus("Connected to stream");
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          socket.emit("ice-candidate", {
            roomId: streamId,
            candidate: event.candidate,
            targetId: broadcasterId,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        console.log("Connection state:", pc.connectionState);
        if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
          setStatus("Connection lost");
          setIsConnected(false);
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const candidate of pendingCandidatesRef.current) {
        await pc.addIceCandidate(candidate);
      }
      pendingCandidatesRef.current = [];
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      socket.emit("answer", {
        roomId: streamId,
        answer: pc.localDescription,
        broadcasterId,
      });
    });

    socket.on("ice-candidate", async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      if (pcRef.current?.remoteDescription) {
        await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } else {
        pendingCandidatesRef.current.push(candidate);
      }
    });

    // Chat
    socket.on("chat-message", (data: { username: string; message: string; timestamp: number }) => {
      setChatMessages((prev) => [...prev.slice(-50), { user: data.username, text: data.message }]);
    });

    // Cleanup
    return () => {
      if (pcRef.current) {
        pcRef.current.close();
      }
      pendingCandidatesRef.current = [];
      socket.disconnect();
    };
  }, [streamId]);

  const sendChat = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!chatInput.trim() || !socketRef.current) return;
      socketRef.current.emit("chat-message", {
        roomId: streamId,
        username: "Viewer",
        message: chatInput,
      });
      setChatInput("");
    },
    [chatInput, streamId]
  );

  const watchUrl = typeof window !== "undefined" ? `${window.location.origin}/watch/${streamId}` : "";

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <header className="h-14 border-b border-white/5 bg-black/80 backdrop-blur-xl flex items-center justify-between px-3 sm:px-6">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Savatar" className="w-7 h-7" />
          <span className="font-semibold text-sm">Savatar</span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            {streamActive ? (
              <>
                <span className="w-2 h-2 rounded-full bg-red-500 live-pulse" />
                <span className="text-red-400 text-xs font-semibold uppercase tracking-wider">LIVE</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-neutral-600" />
                <span className="text-neutral-500 text-xs font-semibold uppercase tracking-wider">OFFLINE</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-neutral-400">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            {viewerCount}
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col md:h-[calc(100vh-3.5rem)] md:flex-row">
        {/* Video Player */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-[55vh] flex-1 items-center justify-center bg-[#0a0a0a] md:min-h-0">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={isMuted}
              className={`w-full h-full object-contain ${isConnected ? "block" : "hidden"}`}
            />

            {!isConnected && (
              <div className="text-center">
                <div className="w-20 h-20 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-5">
                  <svg className="w-10 h-10 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white mb-1">{status}</h2>
                <p className="text-neutral-500 text-xs">
                  Stream ID: <span className="font-mono text-neutral-400">{streamId}</span>
                </p>
              </div>
            )}
          </div>

          {/* Stream Info */}
          <div className="p-4 border-t border-white/5 bg-[#080808]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Creator&apos;s AI Stream</h3>
                <p className="text-xs text-neutral-500">
                  Powered by Savatar
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-2 rounded-lg hover:bg-white/10 text-neutral-400 hover:text-white transition"
                >
                  {isMuted ? (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                  )}
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(watchUrl);
                    alert("Link copied!");
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-md text-xs text-neutral-300 transition"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                  </svg>
                  Share
                </button>
              </div>
            </div>
          </div>
        </main>

        {/* Chat Sidebar */}
        <aside className="flex min-h-[360px] w-full flex-col border-t border-white/5 bg-[#080808] md:min-h-0 md:w-80 md:border-l md:border-t-0">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider">
              Live Chat
              <span className="text-neutral-500 font-normal ml-2">({viewerCount})</span>
            </h3>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.length === 0 && (
              <p className="text-neutral-600 text-xs text-center py-8">No messages yet</p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} className="text-xs">
                <span className={`font-semibold ${msg.user === "You" ? "text-indigo-400" : "text-neutral-300"}`}>
                  {msg.user}
                </span>
                <span className="text-neutral-500 ml-2">{msg.text}</span>
              </div>
            ))}
          </div>

          <form onSubmit={sendChat} className="p-4 border-t border-white/5">
            <div className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Send a message..."
                className="min-w-0 flex-1 px-3 py-2 bg-black border border-white/10 rounded-lg text-xs text-white placeholder-neutral-600 focus:outline-none focus:border-indigo-500 transition"
              />
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-medium rounded-lg transition"
              >
                Send
              </button>
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
