const http = require("http");
const next = require("next");
const { WebSocketServer } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, new Set());
  }
  return rooms.get(roomId);
}

function broadcast(roomId, payload, exclude) {
  const room = rooms.get(roomId);
  if (!room) return;
  const message = JSON.stringify(payload);
  for (const client of room) {
    if (client === exclude) continue;
    if (client.readyState === 1) {
      client.send(message);
    }
  }
}

function cleanup(client) {
  if (!client.roomId) return;
  const room = rooms.get(client.roomId);
  if (!room) return;
  room.delete(client);
  if (room.size === 0) {
    rooms.delete(client.roomId);
  }
}

app.prepare().then(() => {
  const server = http.createServer((req, res) => handle(req, res));
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    }
  });

  wss.on("connection", (ws) => {
    ws.isAlive = true;

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (data) => {
      let payload;
      try {
        payload = JSON.parse(data.toString());
      } catch {
        return;
      }

      if (payload.type === "join") {
        ws.userId = payload.userId;
        ws.roomId = payload.roomId;
        ws.targetLang = payload.targetLang;
        const room = getRoom(payload.roomId);
        room.add(ws);

        broadcast(
          payload.roomId,
          {
            type: "join",
            userId: payload.userId,
            targetLang: payload.targetLang
          },
          ws
        );

        const participants = Array.from(room)
          .filter((client) => client.userId && client.roomId === payload.roomId)
          .map((client) => ({ userId: client.userId, targetLang: client.targetLang }));

        ws.send(JSON.stringify({ type: "room-state", participants }));
        return;
      }

      if (payload.type === "leave") {
        broadcast(
          ws.roomId,
          {
            type: "leave",
            userId: ws.userId
          },
          ws
        );
        cleanup(ws);
        return;
      }

      if (payload.type === "utterance") {
        broadcast(ws.roomId, payload, ws);
      }
    });

    ws.on("close", () => {
      if (ws.roomId && ws.userId) {
        broadcast(ws.roomId, { type: "leave", userId: ws.userId }, ws);
      }
      cleanup(ws);
    });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => clearInterval(interval));

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
  });
});
