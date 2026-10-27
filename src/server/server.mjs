// Flood server: static files + the race room over WebSocket (/ws).
//   node src/server/server.mjs            (PORT, HOST, FLOOD_LOBBY_MS, FLOOD_SEED)
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { staticHandler } from '../../tools/serve.mjs';
import { Room } from './room.js';
import { DT } from '../shared/river.js';

const MAX_BUFFERED = 4 * 1024 * 1024; // a client this far behind is dropped; it can rejoin and replay
const MSG_PER_SEC = 60;

export function startServer({ port = 8080, host = '0.0.0.0', room = new Room() } = {}) {
  const server = http.createServer(staticHandler);
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 1024 });

  wss.on('connection', (ws) => {
    const conn = {
      send(obj) {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (ws.bufferedAmount > MAX_BUFFERED) return ws.terminate();
        ws.send(JSON.stringify(obj));
      },
      close: () => ws.close(),
    };
    let budget = MSG_PER_SEC, refill = Date.now();
    ws.on('message', (data) => {
      const t = Date.now();
      budget = Math.min(MSG_PER_SEC, budget + ((t - refill) / 1000) * MSG_PER_SEC);
      refill = t;
      if (--budget < 0) return; // over the rate limit: drop
      let msg;
      try { msg = JSON.parse(data); } catch { return; }
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'hello') room.hello(conn, msg);
      else if (msg.t === 'in') room.input(conn, msg);
      else if (msg.t === 'fp') room.fingerprint(conn, msg);
    });
    ws.on('close', () => room.leave(conn));
    ws.on('error', () => ws.terminate());
  });

  // Fixed 20 Hz race clock with a catch-up cap, so a stall can't spiral.
  const stepMs = DT * 1000;
  let next = performance.now();
  const timer = setInterval(() => {
    room.update();
    if (room.state !== 'race') { next = performance.now(); return; }
    let n = 0;
    while (performance.now() >= next && n < 5 && room.state === 'race') {
      room.tickRace();
      next += stepMs;
      n++;
    }
    if (n === 5) next = performance.now();
  }, 10);

  return new Promise((resolve) => server.listen(port, host, () => resolve({
    server, wss, room,
    port: server.address().port,
    close: () => {
      clearInterval(timer);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      server.close();
    },
  })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const room = new Room({
    seed: process.env.FLOOD_SEED ? Number(process.env.FLOOD_SEED) : undefined,
    opts: process.env.FLOOD_LOBBY_MS ? { lobbyMs: Number(process.env.FLOOD_LOBBY_MS) } : {},
  });
  const s = await startServer({ port: Number(process.env.PORT) || 8080, host: process.env.HOST || '0.0.0.0', room });
  console.log(`flood server on http://localhost:${s.port}/ (WebSocket /ws)`);
}
