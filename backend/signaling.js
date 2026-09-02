/**
 * Savatar's Socket.IO signaling service. Media remains peer-to-peer; this
 * process only authorizes broadcasters and relays bounded WebRTC messages.
 */

const { Server } = require("socket.io");
const http = require("http");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const PORT = Number(process.env.PORT || process.env.SIGNALING_PORT || 4000);
const MAX_VIEWERS_PER_ROOM = 100;
const MAX_SIGNAL_BYTES = 48 * 1024;
const ROOM_ID_PATTERN = /^stream-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "https://savatar.vercel.app,http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

function allowOrigin(origin, callback) {
  if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) return callback(null, true);
  return callback(new Error("Origin is not allowed"));
}

function firebaseAuth() {
  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) throw new Error("Firebase Admin is not configured");
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId });
  }
  return getAuth();
}

async function authenticatedBroadcaster(socket) {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string" || token.length === 0 || token.length > 8192) return null;
  try {
    const decoded = await firebaseAuth().verifyIdToken(token, true);
    if (decoded.firebase?.sign_in_provider === "password" && !decoded.email_verified) return null;
    return decoded.uid;
  } catch {
    return null;
  }
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isRoomId(value) {
  return typeof value === "string" && ROOM_ID_PATTERN.test(value);
}

function isBoundedObject(value) {
  if (!isObject(value)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_SIGNAL_BYTES;
  } catch {
    return false;
  }
}

function withinRateLimit(socket, scope, limit, windowMs) {
  const now = Date.now();
  const current = socket.rateLimits.get(scope);
  if (!current || now - current.startedAt >= windowMs) {
    socket.rateLimits.set(scope, { startedAt: now, count: 1 });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

const rooms = new Map();

const server = http.createServer((req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ status: "ok", rooms: rooms.size }));
    return;
  }
  res.writeHead(404);
  res.end();
});

const io = new Server(server, {
  cors: { origin: allowOrigin, methods: ["GET", "POST"] },
  maxHttpBufferSize: 64 * 1024,
  perMessageDeflate: false,
  pingInterval: 25_000,
  pingTimeout: 20_000,
});

io.on("connection", (socket) => {
  socket.rateLimits = new Map();

  socket.on("join-room", async (payload) => {
    if (!withinRateLimit(socket, "join", 10, 60_000) || !isObject(payload)) return;
    const { roomId, role } = payload;
    if (!isRoomId(roomId) || (role !== "broadcaster" && role !== "viewer")) return;

    let userId = null;
    if (role === "broadcaster") {
      userId = await authenticatedBroadcaster(socket);
      if (!userId) {
        socket.emit("authorization-error", "Sign in with a verified account to broadcast.");
        socket.disconnect(true);
        return;
      }
    }

    leaveCurrentRoom(socket);
    let room = rooms.get(roomId);
    if (!room) {
      room = { broadcaster: null, broadcasterUserId: null, viewers: new Set(), streamActive: false };
      rooms.set(roomId, room);
    }

    if (role === "broadcaster" && room.broadcaster) {
      socket.emit("room-error", "This stream is already being broadcast.");
      return;
    }
    if (role === "viewer" && room.viewers.size >= MAX_VIEWERS_PER_ROOM) {
      socket.emit("room-error", "This stream has reached its viewer limit.");
      return;
    }

    socket.roomId = roomId;
    socket.role = role;
    socket.userId = userId;
    socket.join(roomId);

    if (role === "broadcaster") {
      room.broadcaster = socket.id;
      room.broadcasterUserId = userId;
      room.streamActive = true;
      socket.to(roomId).emit("broadcaster-joined");
    } else {
      room.viewers.add(socket.id);
      if (room.streamActive && room.broadcaster) {
        socket.emit("broadcaster-exists");
        io.to(room.broadcaster).emit("viewer-joined", { viewerId: socket.id });
      }
    }

    socket.emit("room-joined", { roomId, role, viewerCount: room.viewers.size, streamActive: room.streamActive });
    io.to(roomId).emit("viewer-count", room.viewers.size);
  });

  socket.on("offer", (payload) => {
    if (!withinRateLimit(socket, "signal", 240, 60_000) || !isObject(payload)) return;
    const { roomId, offer, viewerId } = payload;
    const room = rooms.get(roomId);
    if (room?.broadcaster === socket.id && typeof viewerId === "string" && room.viewers.has(viewerId) && isBoundedObject(offer)) {
      io.to(viewerId).emit("offer", { offer, broadcasterId: socket.id });
    }
  });

  socket.on("answer", (payload) => {
    if (!withinRateLimit(socket, "signal", 240, 60_000) || !isObject(payload)) return;
    const { roomId, answer, broadcasterId } = payload;
    const room = rooms.get(roomId);
    if (room?.broadcaster === broadcasterId && room.viewers.has(socket.id) && isBoundedObject(answer)) {
      io.to(broadcasterId).emit("answer", { answer, viewerId: socket.id });
    }
  });

  socket.on("ice-candidate", (payload) => {
    if (!withinRateLimit(socket, "signal", 240, 60_000) || !isObject(payload)) return;
    const { roomId, candidate, targetId } = payload;
    const room = rooms.get(roomId);
    if (!room || typeof targetId !== "string" || !isBoundedObject(candidate)) return;
    const broadcasterToViewer = room.broadcaster === socket.id && room.viewers.has(targetId);
    const viewerToBroadcaster = room.broadcaster === targetId && room.viewers.has(socket.id);
    if (broadcasterToViewer || viewerToBroadcaster) {
      io.to(targetId).emit("ice-candidate", { candidate, fromId: socket.id });
    }
  });

  socket.on("broadcaster-started", (payload) => {
    const roomId = isObject(payload) ? payload.roomId : null;
    const room = rooms.get(roomId);
    if (room?.broadcaster === socket.id) {
      room.streamActive = true;
      socket.to(roomId).emit("stream-started");
    }
  });

  socket.on("broadcaster-stopped", (payload) => {
    const roomId = isObject(payload) ? payload.roomId : null;
    const room = rooms.get(roomId);
    if (room?.broadcaster === socket.id) {
      room.streamActive = false;
      socket.to(roomId).emit("stream-stopped");
    }
  });

  socket.on("chat-message", (payload) => {
    if (!withinRateLimit(socket, "chat", 12, 60_000) || !isObject(payload)) return;
    const { roomId, message } = payload;
    const room = rooms.get(roomId);
    const isMember = room && (room.broadcaster === socket.id || room.viewers.has(socket.id));
    if (!isMember || socket.roomId !== roomId || typeof message !== "string") return;
    const safeMessage = message.trim().slice(0, 500);
    if (!safeMessage) return;
    io.to(roomId).emit("chat-message", {
      username: socket.role === "broadcaster" ? "Creator" : "Viewer",
      message: safeMessage,
      timestamp: Date.now(),
    });
  });

  socket.on("disconnect", () => leaveCurrentRoom(socket));
});

function leaveCurrentRoom(socket) {
  const roomId = socket.roomId;
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  if (room.broadcaster === socket.id) {
    room.broadcaster = null;
    room.broadcasterUserId = null;
    room.streamActive = false;
    socket.to(roomId).emit("broadcaster-left");
  } else if (room.viewers.delete(socket.id) && room.broadcaster) {
    io.to(room.broadcaster).emit("viewer-left", { viewerId: socket.id });
  }

  socket.leave(roomId);
  io.to(roomId).emit("viewer-count", room.viewers.size);
  socket.roomId = null;
  socket.role = null;
  if (!room.broadcaster && room.viewers.size === 0) rooms.delete(roomId);
}

server.listen(PORT, () => {
  console.log(`Savatar signaling service listening on port ${PORT}`);
});
