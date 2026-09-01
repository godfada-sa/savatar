/**
 * Savatar Signaling Server
 * Handles WebRTC room management and stream relay
 * 
 * Architecture:
 * - Broadcaster connects and publishes AI-transformed stream
 * - Viewers connect and subscribe to the broadcaster's stream
 * - Server relays WebRTC signaling (SDP offers/answers, ICE candidates)
 * - Server does NOT handle media — that's peer-to-peer via WebRTC
 */

const { Server } = require("socket.io");
const http = require("http");
const { cert, getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const PORT = Number(process.env.PORT || process.env.SIGNALING_PORT || 4000);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function allowOrigin(origin, callback) {
  // Health checks and other non-browser clients do not send an Origin header.
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
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
    return decoded.email_verified ? decoded.uid : null;
  } catch {
    return null;
  }
}

const server = http.createServer((req, res) => {
  // CORS headers for health checks
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");
  
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", rooms: Object.keys(rooms).length }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

const io = new Server(server, {
  cors: {
    origin: allowOrigin,
    methods: ["GET", "POST"],
  },
});

// Room state: { roomId: { broadcaster: socketId, viewers: Set<socketId> } }
const rooms = {};

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ─── Join Room ──────────────────────────────────────
  socket.on("join-room", async ({ roomId, role }) => {
    if (typeof roomId !== "string" || !/^[a-z0-9-]{1,64}$/i.test(roomId)) return;
    if (role !== "broadcaster" && role !== "viewer") return;
    if (role === "broadcaster") {
      const userId = await authenticatedBroadcaster(socket);
      if (!userId) {
        socket.emit("authorization-error", "Sign in with a verified account to broadcast.");
        socket.disconnect(true);
        return;
      }
      socket.userId = userId;
    }
    console.log(`[join-room] ${socket.id} -> ${roomId} (${role})`);

    // Leave any previous rooms
    for (const rid of Object.keys(rooms)) {
      if (rooms[rid].broadcaster === socket.id || rooms[rid].viewers.has(socket.id)) {
        leaveRoom(rid, socket);
      }
    }

    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = { broadcaster: null, broadcasterUserId: null, viewers: new Set(), streamActive: false };
    }

    const room = rooms[roomId];
    socket.roomId = roomId;
    socket.role = role;

    if (role === "broadcaster") {
      if (room.broadcaster) {
        socket.emit("room-error", "This stream is already being broadcast.");
        return;
      }
      room.broadcaster = socket.id;
      room.broadcasterUserId = socket.userId;
      room.streamActive = true;
      socket.join(roomId);

      // Notify existing viewers that broadcaster arrived
      socket.to(roomId).emit("broadcaster-joined");
    } else {
      room.viewers.add(socket.id);
      socket.join(roomId);

      // Tell viewer if stream is active AND notify broadcaster a viewer joined
      if (room.streamActive && room.broadcaster) {
        socket.emit("broadcaster-exists");
        // Tell broadcaster to send offer to this new viewer
        io.to(room.broadcaster).emit("viewer-joined", { viewerId: socket.id });
      }
    }

    // Send room info
    socket.emit("room-joined", {
      roomId,
      role,
      viewerCount: room.viewers.size,
      streamActive: room.streamActive,
    });

    // Broadcast updated viewer count
    io.to(roomId).emit("viewer-count", room.viewers.size);
  });

  // ─── WebRTC Signaling ───────────────────────────────
  // Broadcaster sends offer to specific viewer
  socket.on("offer", ({ roomId, offer, viewerId }) => {
    console.log(`[offer] from ${socket.id} to ${viewerId}`);
    const room = rooms[roomId];
    if (room?.broadcaster === socket.id && room.viewers.has(viewerId)) {
      io.to(viewerId).emit("offer", { offer, broadcasterId: socket.id });
    }
  });

  // Viewer sends answer back to broadcaster
  socket.on("answer", ({ roomId, answer, broadcasterId }) => {
    console.log(`[answer] from ${socket.id} to ${broadcasterId}`);
    const room = rooms[roomId];
    if (room?.broadcaster === broadcasterId && room.viewers.has(socket.id)) {
      io.to(broadcasterId).emit("answer", { answer, viewerId: socket.id });
    }
  });

  // ICE candidate exchange
  socket.on("ice-candidate", ({ roomId, candidate, targetId }) => {
    const room = rooms[roomId];
    const isBroadcasterToViewer = room?.broadcaster === socket.id && room.viewers.has(targetId);
    const isViewerToBroadcaster = room?.broadcaster === targetId && room.viewers.has(socket.id);
    if (isBroadcasterToViewer || isViewerToBroadcaster) {
      io.to(targetId).emit("ice-candidate", { candidate, fromId: socket.id });
    }
  });

  // ─── Broadcaster Events ─────────────────────────────
  socket.on("broadcaster-started", ({ roomId }) => {
    const room = rooms[roomId];
    if (room?.broadcaster === socket.id) {
      room.streamActive = true;
      socket.to(roomId).emit("stream-started");
    }
  });

  socket.on("broadcaster-stopped", ({ roomId }) => {
    const room = rooms[roomId];
    if (room?.broadcaster === socket.id) {
      room.streamActive = false;
      socket.to(roomId).emit("stream-stopped");
    }
  });

  // ─── Chat ───────────────────────────────────────────
  socket.on("chat-message", ({ roomId, username, message }) => {
    const room = rooms[roomId];
    if (!room || socket.roomId !== roomId || typeof username !== "string" || typeof message !== "string") return;
    const safeUsername = username.trim().slice(0, 40);
    const safeMessage = message.trim().slice(0, 500);
    if (!safeUsername || !safeMessage) return;
    io.to(roomId).emit("chat-message", {
      username: safeUsername,
      message: safeMessage,
      timestamp: Date.now(),
    });
  });

  // ─── Disconnect ─────────────────────────────────────
  socket.on("disconnect", () => {
    console.log(`[disconnect] ${socket.id}`);
    if (socket.roomId) {
      leaveRoom(socket.roomId, socket);
    }
  });

  function leaveRoom(roomId, sock) {
    const room = rooms[roomId];
    if (!room) return;

    if (room.broadcaster === sock.id) {
      room.broadcaster = null;
      room.broadcasterUserId = null;
      room.streamActive = false;
      sock.to(roomId).emit("broadcaster-left");
      console.log(`[broadcaster-left] ${roomId}`);
    } else {
      room.viewers.delete(sock.id);
      if (room.broadcaster) {
        io.to(room.broadcaster).emit("viewer-left", { viewerId: sock.id });
      }
    }

    sock.leave(roomId);
    io.to(roomId).emit("viewer-count", room.viewers.size);

    // Clean up empty rooms
    if (!room.broadcaster && room.viewers.size === 0) {
      delete rooms[roomId];
      console.log(`[room-deleted] ${roomId}`);
    }
  }
});

server.listen(PORT, () => {
  console.log(`Savatar Signaling Server running on port ${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});
