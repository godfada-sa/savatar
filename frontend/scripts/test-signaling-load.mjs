// Small, provider-free production load test for the Socket.IO signaling path.
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";

const signaling = (process.argv[2] ?? "https://savatar-signaling.onrender.com").replace(/\/$/, "");
const origin = process.argv[3] ?? "https://savatar.vercel.app";
const connectionCount = Math.min(25, Math.max(1, Number(process.argv[4] ?? 10)));
const roomId = `stream-${randomUUID()}`;
const sockets = [];

function connectViewer() {
  return new Promise((resolve, reject) => {
    const socket = io(signaling, {
      transports: ["websocket"], reconnection: false, timeout: 45_000,
      extraHeaders: { Origin: origin },
    });
    sockets.push(socket);
    const timer = setTimeout(() => reject(new Error("join timed out")), 50_000);
    socket.once("connect_error", reject);
    socket.once("connect", () => socket.emit("join-room", { roomId, role: "viewer" }));
    socket.once("room-joined", (payload) => {
      clearTimeout(timer);
      resolve(payload.viewerCount);
    });
  });
}

try {
  const health = await fetch(`${signaling}/health`, { signal: AbortSignal.timeout(90_000) });
  if (!health.ok) throw new Error(`signaling health returned HTTP ${health.status}`);
  const counts = await Promise.all(Array.from({ length: connectionCount }, connectViewer));
  const maxCount = Math.max(...counts);
  if (maxCount !== connectionCount) throw new Error(`expected ${connectionCount} viewers, observed ${maxCount}`);
  console.log(`PASS ${connectionCount} concurrent signaling viewers joined one room`);
} finally {
  for (const socket of sockets) socket.disconnect();
}
