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

const PORT = process.env.SIGNALING_PORT || 4000;

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
    origin: ["http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
  },
});

// Room state: { roomId: { broadcaster: socketId, viewers: Set<socketId> } }
const rooms = {};

io.on("connection", (socket) => {
  console.log(`[connect] ${socket.id}`);

  // ─── Join Room ──────────────────────────────────────
  socket.on("join-room", ({ roomId, role }) => {
    console.log(`[join-room] ${socket.id} -> ${roomId} (${role})`);

    // Leave any previous rooms
    for (const rid of Object.keys(rooms)) {
      if (rooms[rid].broadcaster === socket.id || rooms[rid].viewers.has(socket.id)) {
        leaveRoom(rid, socket);
      }
    }

    // Create room if it doesn't exist
    if (!rooms[roomId]) {
      rooms[roomId] = { broadcaster: null, viewers: new Set(), streamActive: false };
    }

    const room = rooms[roomId];
    socket.roomId = roomId;
    socket.role = role;

    if (role === "broadcaster") {
      room.broadcaster = socket.id;
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
    if (viewerId) {
      io.to(viewerId).emit("offer", { offer, broadcasterId: socket.id });
    }
  });

  // Viewer sends answer back to broadcaster
  socket.on("answer", ({ roomId, answer, broadcasterId }) => {
    console.log(`[answer] from ${socket.id} to ${broadcasterId}`);
    if (broadcasterId) {
      io.to(broadcasterId).emit("answer", { answer, viewerId: socket.id });
    }
  });

  // ICE candidate exchange
  socket.on("ice-candidate", ({ roomId, candidate, targetId }) => {
    if (targetId) {
      io.to(targetId).emit("ice-candidate", { candidate, fromId: socket.id });
    }
  });

  // ─── Broadcaster Events ─────────────────────────────
  socket.on("broadcaster-started", ({ roomId }) => {
    const room = rooms[roomId];
    if (room) {
      room.streamActive = true;
      socket.to(roomId).emit("stream-started");
    }
  });

  socket.on("broadcaster-stopped", ({ roomId }) => {
    const room = rooms[roomId];
    if (room) {
      room.streamActive = false;
      socket.to(roomId).emit("stream-stopped");
    }
  });

  // ─── Chat ───────────────────────────────────────────
  socket.on("chat-message", ({ roomId, username, message }) => {
    io.to(roomId).emit("chat-message", {
      username,
      message,
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
      room.streamActive = false;
      sock.to(roomId).emit("broadcaster-left");
      console.log(`[broadcaster-left] ${roomId}`);
    } else {
      room.viewers.delete(sock.id);
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
