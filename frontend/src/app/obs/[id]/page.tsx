"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { io, Socket } from "socket.io-client";
import { iceServers, signalingUrl } from "@/lib/client-config";

export default function ObsSourcePage() {
  const { id } = useParams<{ id: string }>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingRef = useRef<RTCIceCandidateInit[]>([]);
  const [status, setStatus] = useState("Waiting for stream");
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setMuted(new URLSearchParams(window.location.search).get("muted") === "1"));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const socket: Socket = io(signalingUrl, { transports: ["websocket", "polling"] });
    socket.on("connect", () => socket.emit("join-room", { roomId: id, role: "viewer" }));
    socket.on("connect_error", () => setStatus("Signaling unavailable"));
    socket.on("room-joined", (room: { streamActive: boolean }) => setStatus(room.streamActive ? "Connecting" : "Waiting for stream"));
    socket.on("broadcaster-exists", () => setStatus("Connecting"));
    socket.on("stream-stopped", () => setStatus("Stream ended"));
    socket.on("broadcaster-left", () => setStatus("Stream ended"));
    socket.on("offer", async ({ offer, broadcasterId }: { offer: RTCSessionDescriptionInit; broadcasterId: string }) => {
      pcRef.current?.close();
      const pc = new RTCPeerConnection({ iceServers });
      pcRef.current = pc;
      pc.ontrack = (event) => {
        if (videoRef.current) { videoRef.current.srcObject = event.streams[0]; void videoRef.current.play().catch(() => undefined); }
        setStatus("");
      };
      pc.onicecandidate = (event) => event.candidate && socket.emit("ice-candidate", { roomId: id, candidate: event.candidate, targetId: broadcasterId });
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      for (const candidate of pendingRef.current) await pc.addIceCandidate(candidate);
      pendingRef.current = [];
      await pc.setLocalDescription(await pc.createAnswer());
      socket.emit("answer", { roomId: id, answer: pc.localDescription, broadcasterId });
    });
    socket.on("ice-candidate", async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
      if (pcRef.current?.remoteDescription) await pcRef.current.addIceCandidate(new RTCIceCandidate(candidate)); else pendingRef.current.push(candidate);
    });
    return () => { pcRef.current?.close(); socket.disconnect(); };
  }, [id]);

  return <main className="force-dark grid min-h-screen place-items-center bg-gradient-to-br from-[#11284b] via-[#0a2942] to-[#020711]"><video ref={videoRef} autoPlay playsInline muted={muted} className="h-screen w-screen object-contain" />{status && <span className="absolute rounded bg-black/35 px-4 py-2 text-sm text-blue-100/70">{status}</span>}</main>;
}
