import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import sirv from 'sirv';
import { WebSocket, WebSocketServer } from 'ws';
import {
  checkDrumPattern,
  compileSong,
  loadSong,
  parseClientMsg,
  repeatSection,
  resumeBeat,
  seekTo,
  setBpm,
  setLoop,
  startPlayback,
  stopPlayback,
  type ClientMsg,
  type Command,
  type DrumEdits,
  type ErrorCode,
  type Member,
  type Part,
  type PlaybackState,
  type RoomEdits,
  type ServerMsg,
  type Song,
} from '@onbeat/shared';

export type ServerOptions = {
  /** The song catalog; at least one. New rooms start on the first. */
  songs: Song[];
  port?: number;
  host?: string;
  /** Built web app to serve on the same port, so phones need only one URL. */
  staticDir?: string;
  /** Test hook: artificial one-way delay (ms) per message, in each direction. */
  latencyMs?: (connId: string) => number;
  /** How long an empty room survives, so a phone that reloads can rejoin. */
  emptyRoomTtlMs?: number;
  /** Persists a room's drum edits into the song file and returns the updated song. Without it, saving fails. */
  saveSong?: (songId: string, drums: DrumEdits) => Song | Promise<Song>;
};

type Room = {
  code: string;
  state: PlaybackState;
  edits: RoomEdits;
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

export async function startServer(opts: ServerOptions) {
  const { port = 8787, host, staticDir, latencyMs, emptyRoomTtlMs = 10 * 60_000, saveSong } = opts;
  if (opts.songs.length === 0) throw new Error('at least one song is required');
  let songs = opts.songs; // replaced when a song is saved
  const songById = new Map(songs.map((s) => [s.id, s]));
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
    send(conn, { type: 'songs', songs });
    send(conn, { type: 'state', state: room.state });
    send(conn, { type: 'edits', edits: room.edits });
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

  type PlaybackCommand = Exclude<Command, { action: 'setDrums' | 'setDrumsAll' | 'saveSong' }>;

  function applyCommand(state: PlaybackState, cmd: PlaybackCommand): PlaybackState | ErrorCode {
    const t = now();
    const song = songById.get(state.songId)!;
    const compiled = compileSong(song, state.extraPasses);
    const bpb = compiled.beatsPerBar;
    switch (cmd.action) {
      case 'start': {
        // Picks up where it stopped (or where a seek put it), after a count-in.
        const parked = stopPlayback(state, t);
        return startPlayback(parked, t, { startBeat: resumeBeat(parked, compiled), beatsPerBar: bpb });
      }
      case 'stop':
        return stopPlayback(state, t);
      case 'selectSong': {
        const next = songById.get(cmd.songId);
        return next ? loadSong(next, t) : 'song-not-found';
      }
      case 'repeatSection':
        // The loop's end is in beats, so growing a section under it would cut the loop short.
        if (state.loop) return 'looping';
        return repeatSection(state, compiled, cmd.sectionIndex, t) ?? 'too-late';
      case 'seek': {
        const section = compiled.sections[cmd.sectionIndex];
        if (!section || cmd.bar >= section.barCount) return 'bad-position';
        return seekTo(state, t, section.startBeat + cmd.bar * bpb, bpb);
      }
      case 'setBpm':
        return setBpm(state, t, cmd.bpm, bpb);
      case 'setLoop': {
        if (cmd.sectionIndex === null) return setLoop(state, t, null, bpb);
        const section = compiled.sections[cmd.sectionIndex];
        if (!section) return 'bad-position';
        return setLoop(state, t, { startBeat: section.startBeat, endBeat: section.startBeat + section.barCount * bpb }, bpb);
      }
    }
  }

  function setDrums(room: Room, cmd: Extract<Command, { action: 'setDrums' | 'setDrumsAll' }>): ErrorCode | null {
    const song = songById.get(room.state.songId)!;
    const pattern = cmd.pattern;
    if (pattern && pattern !== 'default' && checkDrumPattern(pattern, song.timeSignature[0] * 4)) return 'bad-pattern';
    let drums: DrumEdits;
    if (cmd.action === 'setDrumsAll') {
      // Sections with a pattern of their own in the song are told to follow the new default instead.
      const own = Object.entries(song.parts.drums?.sections ?? {}).filter(([, d]) => typeof d.pattern === 'object');
      drums = { default: cmd.pattern, sections: Object.fromEntries(own.map(([id]) => [id, 'default' as const])) };
    } else {
      if (cmd.sectionId !== null && !(cmd.sectionId in song.sections)) return 'bad-pattern';
      const { default: def, sections = {} } = room.edits.drums;
      drums = { ...(def && { default: def }), sections: { ...sections } };
      if (cmd.sectionId === null) {
        if (pattern && pattern !== 'default') drums.default = pattern;
        else delete drums.default;
      } else if (pattern) drums.sections![cmd.sectionId] = pattern;
      else delete drums.sections![cmd.sectionId];
    }
    room.edits = { songId: song.id, drums };
    broadcast(room, { type: 'edits', edits: room.edits });
    return null;
  }

  async function save(room: Room): Promise<ErrorCode | null> {
    const { songId, drums } = room.edits;
    if (!saveSong) return 'save-failed';
    try {
      const updated = await saveSong(songId, drums);
      songById.set(songId, updated);
      songs = songs.map((s) => (s.id === songId ? updated : s));
    } catch (e) {
      console.error(`saving song "${songId}" failed:`, e);
      return 'save-failed';
    }
    for (const c of conns) if (c.room) send(c, { type: 'songs', songs });
    if (room.edits.songId === songId) {
      room.edits = { songId, drums: {} };
      broadcast(room, { type: 'edits', edits: room.edits });
    }
    return null;
  }

  function handle(conn: Conn, msg: ClientMsg) {
    switch (msg.type) {
      case 'ping':
        return send(conn, { type: 'pong', c0: msg.c0, serverTime: now() });
      case 'create': {
        const code = newRoomCode();
        const room: Room = {
          code,
          state: loadSong(songs[0], now()),
          edits: { songId: songs[0].id, drums: {} },
          members: new Map(),
          conns: new Set(),
          expiry: null,
        };
        rooms.set(code, room);
        return enter(conn, room, msg.part);
      }
      case 'join': {
        const room = rooms.get(msg.room);
        if (!room) return send(conn, { type: 'error', code: 'room-not-found' });
        return enter(conn, room, msg.part);
      }
      case 'setPart': {
        const room = conn.room;
        if (!room) return send(conn, { type: 'error', code: 'not-in-room' });
        room.members.set(conn.id, { id: conn.id, part: msg.part });
        return broadcast(room, { type: 'members', members: [...room.members.values()] });
      }
      case 'cmd': {
        const room = conn.room;
        if (!room) return send(conn, { type: 'error', code: 'not-in-room' });
        const fail = (code: ErrorCode | null) => code && send(conn, { type: 'error', code });
        if (msg.action === 'setDrums' || msg.action === 'setDrumsAll') return fail(setDrums(room, msg));
        if (msg.action === 'saveSong') return void save(room).then(fail);
        const next = applyCommand(room.state, msg);
        if (typeof next === 'string') return fail(next);
        room.state = next;
        broadcast(room, { type: 'state', state: room.state });
        if (msg.action === 'selectSong') {
          room.edits = { songId: next.songId, drums: {} };
          broadcast(room, { type: 'edits', edits: room.edits });
        }
        return;
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
