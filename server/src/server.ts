import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import sirv from 'sirv';
import { WebSocket, WebSocketServer } from 'ws';
import {
  applyDrumEdits,
  createRoom,
  parseClientMsg,
  type ClientMsg,
  type Part,
  type Peer,
  type Room,
  type RoomHost,
  type ServerMsg,
  type SongLibrary,
} from '@onbeat/shared';

export type ServerOptions = {
  /** The song catalog (at least one song) and where saves go. Saving fails if it has no `save`. */
  library: SongLibrary;
  port?: number;
  host?: string;
  /** Built web app to serve on the same port, so phones need only one URL. */
  staticDir?: string;
  /** Test hook: artificial one-way delay (ms) per message, in each direction. */
  latencyMs?: (connId: string) => number;
  /** How long an empty room survives, so a phone that reloads can rejoin. */
  emptyRoomTtlMs?: number;
};

type Conn = {
  peer: Peer;
  ws: WebSocket;
  room: Room | null;
  alive: boolean;
  // Delivery deadlines for simulated latency; kept monotonic so messages stay in order, like TCP.
  lastIn: number;
  lastOut: number;
};

const HEARTBEAT_MS = 15_000;

/** Serves every room from one process over `ws`; the room logic itself is `createRoom` in `shared`. */
export async function startServer(opts: ServerOptions) {
  const { library, port = 8787, host, staticDir, latencyMs, emptyRoomTtlMs = 10 * 60_000 } = opts;
  let songs = await library.list(); // replaced when a song is saved
  if (songs.length === 0) throw new Error('at least one song is required');
  const now = () => performance.now();
  const rooms = new Map<string, Room>();
  const expiries = new Map<string, NodeJS.Timeout>();
  const conns = new Set<Conn>();

  const roomHost: RoomHost = {
    now,
    songs: () => songs,
    saveSong: library.save
      ? async (songId, drums) => {
          // applyDrumEdits only touches `parts`, so it works on the raw JSON too.
          const updated = await library.save!(songId, (raw) => applyDrumEdits(raw, drums));
          songs = songs.map((s) => (s.id === songId ? updated : s));
          for (const room of rooms.values()) room.broadcast({ type: 'songs', songs });
        }
      : undefined,
  };

  const serveStatic = staticDir && existsSync(staticDir) ? sirv(staticDir, { single: true }) : null;
  const httpServer = http.createServer((req, res) => {
    if (serveStatic) return serveStatic(req, res);
    res.writeHead(404).end('web app not built; run `npm run build -w web`');
  });
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function delayed(conn: Conn, dir: 'lastIn' | 'lastOut', fn: () => void) {
    if (!latencyMs) return fn();
    const at = Math.max(conn[dir], now() + latencyMs(conn.peer.id));
    conn[dir] = at;
    setTimeout(fn, at - now());
  }

  function send(conn: Conn, msg: ServerMsg) {
    const data = JSON.stringify(msg);
    delayed(conn, 'lastOut', () => {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(data);
    });
  }

  function newRoomCode(): string {
    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while (rooms.has(code));
    return code;
  }

  function enter(conn: Conn, room: Room, part: Part) {
    leave(conn);
    clearTimeout(expiries.get(room.code));
    expiries.delete(room.code);
    conn.room = room;
    room.join(conn.peer, part);
  }

  function leave(conn: Conn) {
    const room = conn.room;
    if (!room) return;
    conn.room = null;
    room.leave(conn.peer.id);
    if (room.size > 0) return;
    const timer = setTimeout(() => {
      rooms.delete(room.code);
      expiries.delete(room.code);
    }, emptyRoomTtlMs);
    expiries.set(room.code, timer);
  }

  function handle(conn: Conn, msg: ClientMsg) {
    switch (msg.type) {
      case 'ping':
        return send(conn, { type: 'pong', c0: msg.c0, serverTime: now() });
      case 'create': {
        const room = createRoom(newRoomCode(), roomHost);
        rooms.set(room.code, room);
        return enter(conn, room, msg.part);
      }
      case 'join': {
        const room = rooms.get(msg.room);
        if (!room) return send(conn, { type: 'error', code: 'room-not-found' });
        return enter(conn, room, msg.part);
      }
      default:
        if (!conn.room) return send(conn, { type: 'error', code: 'not-in-room' });
        return conn.room.handle(conn.peer.id, msg);
    }
  }

  wss.on('connection', (ws) => {
    const conn: Conn = { peer: { id: randomUUID(), send: (msg) => send(conn, msg) }, ws, room: null, alive: true, lastIn: 0, lastOut: 0 };
    conns.add(conn);
    ws.on('pong', () => (conn.alive = true));
    ws.on('message', (data) => {
      const raw = data.toString();
      delayed(conn, 'lastIn', () => {
        const msg = parseClientMsg(raw);
        if (msg) handle(conn, msg);
        else send(conn, { type: 'error', code: 'bad-message' });
      });
    });
    ws.on('close', () => {
      conns.delete(conn);
      leave(conn);
    });
  });

  // Phones that sleep or drop off Wi-Fi often never send a close frame; reap them so the member list stays honest.
  const heartbeat = setInterval(() => {
    for (const conn of conns) {
      if (!conn.alive) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, HEARTBEAT_MS);

  await new Promise<void>((resolve) => httpServer.listen(port, host, resolve));

  return {
    port: (httpServer.address() as AddressInfo).port,
    async close() {
      clearInterval(heartbeat);
      for (const timer of expiries.values()) clearTimeout(timer);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
