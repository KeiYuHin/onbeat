import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import sirv from 'sirv';
import { WebSocket, WebSocketServer } from 'ws';
import {
  initialState,
  parseClientMsg,
  startPlayback,
  stopPlayback,
  type ClientMsg,
  type Member,
  type Part,
  type PlaybackState,
  type ServerMsg,
} from '@onbeat/shared';

export type ServerOptions = {
  port?: number;
  host?: string;
  /** Built web app to serve on the same port, so phones need only one URL. */
  staticDir?: string;
  /** Test hook: artificial one-way delay (ms) per message, in each direction. */
  latencyMs?: (connId: string) => number;
  /** How long an empty room survives, so a phone that reloads can rejoin. */
  emptyRoomTtlMs?: number;
};

type Room = {
  code: string;
  state: PlaybackState;
  members: Map<string, Member>;
  conns: Set<Conn>;
  expiry: NodeJS.Timeout | null;
};

type Conn = {
  id: string;
  ws: WebSocket;
  room: Room | null;
  alive: boolean;
  // Delivery deadlines for simulated latency; kept monotonic so messages stay in order, like TCP.
  lastIn: number;
  lastOut: number;
};

const HEARTBEAT_MS = 15_000;

export async function startServer(opts: ServerOptions = {}) {
  const { port = 8787, host, staticDir, latencyMs, emptyRoomTtlMs = 10 * 60_000 } = opts;
  const now = () => performance.now();
  const rooms = new Map<string, Room>();
  const conns = new Set<Conn>();

  const serveStatic = staticDir && existsSync(staticDir) ? sirv(staticDir, { single: true }) : null;
  const httpServer = http.createServer((req, res) => {
    if (serveStatic) return serveStatic(req, res);
    res.writeHead(404).end('web app not built; run `npm run build -w web`');
  });
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

  function delayed(conn: Conn, dir: 'lastIn' | 'lastOut', fn: () => void) {
    if (!latencyMs) return fn();
    const at = Math.max(conn[dir], now() + latencyMs(conn.id));
    conn[dir] = at;
    setTimeout(fn, at - now());
  }

  function send(conn: Conn, msg: ServerMsg) {
    const data = JSON.stringify(msg);
    delayed(conn, 'lastOut', () => {
      if (conn.ws.readyState === WebSocket.OPEN) conn.ws.send(data);
    });
  }

  function broadcast(room: Room, msg: ServerMsg) {
    for (const c of room.conns) send(c, msg);
  }

  function newRoomCode(): string {
    let code: string;
    do code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    while (rooms.has(code));
    return code;
  }

  function enter(conn: Conn, room: Room, part: Part) {
    leave(conn);
    if (room.expiry) clearTimeout(room.expiry);
    room.expiry = null;
    room.conns.add(conn);
    room.members.set(conn.id, { id: conn.id, part });
    conn.room = room;
    send(conn, { type: 'welcome', room: room.code, memberId: conn.id });
    send(conn, { type: 'state', state: room.state });
    broadcast(room, { type: 'members', members: [...room.members.values()] });
  }

  function leave(conn: Conn) {
    const room = conn.room;
    if (!room) return;
    conn.room = null;
    room.conns.delete(conn);
    room.members.delete(conn.id);
    broadcast(room, { type: 'members', members: [...room.members.values()] });
    if (room.conns.size === 0) {
      room.expiry = setTimeout(() => rooms.delete(room.code), emptyRoomTtlMs);
    }
  }

  function handle(conn: Conn, msg: ClientMsg) {
    switch (msg.type) {
      case 'ping':
        return send(conn, { type: 'pong', c0: msg.c0, serverTime: now() });
      case 'create': {
        const code = newRoomCode();
        const room: Room = { code, state: initialState(), members: new Map(), conns: new Set(), expiry: null };
        rooms.set(code, room);
        return enter(conn, room, msg.part);
      }
      case 'join': {
        const room = rooms.get(msg.room);
        if (!room) return send(conn, { type: 'error', code: 'room-not-found' });
        return enter(conn, room, msg.part);
      }
      case 'cmd': {
        const room = conn.room;
        if (!room) return send(conn, { type: 'error', code: 'not-in-room' });
        room.state = msg.action === 'start' ? startPlayback(room.state, now()) : stopPlayback(room.state, now());
        return broadcast(room, { type: 'state', state: room.state });
      }
    }
  }

  wss.on('connection', (ws) => {
    const conn: Conn = { id: randomUUID(), ws, room: null, alive: true, lastIn: 0, lastOut: 0 };
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
      for (const room of rooms.values()) if (room.expiry) clearTimeout(room.expiry);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}
