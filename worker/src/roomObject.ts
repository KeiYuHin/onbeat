// One rehearsal room per Durable Object, driving the same `createRoom` as the Node server.
import { DurableObject } from 'cloudflare:workers';
import {
  createRoom,
  parseClientMsg,
  type ClientMsg,
  type Part,
  type Peer,
  type Room,
  type RoomHost,
  type RoomSnapshot,
  type ServerMsg,
  type Song,
} from '@onbeat/shared';
import { libraryForKey, PUBLIC_LIBRARY, songLibrary, type LibraryEnv } from './libraries';

export type Env = LibraryEnv & {
  ROOMS: DurableObjectNamespace<RoomObject>;
  ASSETS: Fetcher;
};

/** Set by the Worker: the room code this object is named after, and whether the socket may create the room. */
export const ROOM_HEADER = 'X-OnBeat-Room';
export const CREATE_HEADER = 'X-OnBeat-Create';

/**
 * Kept on each socket so it survives hibernation. `create` is the room code on a socket the Worker
 * opened to make a new room; `part` is set once the socket has joined.
 */
type Attachment = { id: string; create?: string; part?: Part };

const EMPTY_ROOM_TTL_MS = 10 * 60_000;
/** Clients resync their clock every 30s (throttled to about once a minute in a background tab). */
const STALE_MS = 150_000;
const REAP_INTERVAL_MS = 60_000;
/** Failed joins (wrong or missing key) allowed per room per window before refusing everyone for a while. */
const MAX_FAILED_JOINS = 5;
const FAILED_JOIN_WINDOW_MS = 60_000;

export class RoomObject extends DurableObject<Env> {
  private room: Room | null = null;
  /** The library the room is bound to, and its catalog. */
  private library: string | null = null;
  private songs: Song[] = [];
  /** Last message per socket. Lost on hibernation; a socket counts from when this object first sees it again. */
  private lastSeen = new Map<WebSocket, number>();
  private failedJoins: number[] = [];

  // Workers' performance.now() is not a usable clock and memory is lost on hibernation, so this uses
  // Date.now() (the one exception to the no-Date.now() rule) and persists the room on every change.
  private host: RoomHost = {
    now: () => Date.now(),
    songs: () => this.songs,
    changed: () => void this.ctx.storage.put('room', this.room!.snapshot()),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const [saved, library] = await Promise.all([
        ctx.storage.get<RoomSnapshot>('room'),
        ctx.storage.get<string>('library'),
      ]);
      if (!saved || !library) return;
      this.songs = await songLibrary(env, library).list();
      if (this.songs.length === 0) return;
      this.library = library;
      this.room = createRoom(saved.code, this.host, saved);
      for (const ws of ctx.getWebSockets()) {
        const { id, part } = attachment(ws);
        if (part) this.room.restore(peer(ws, id), part);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const create = request.headers.has(CREATE_HEADER) ? request.headers.get(ROOM_HEADER)! : undefined;
    // The room itself is made on the `create` message, which carries the library key.
    if (create && this.room) return new Response('room taken', { status: 409 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID(), ...(create && { create }) } satisfies Attachment);
    this.lastSeen.set(server, Date.now());
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    this.lastSeen.set(ws, Date.now());
    const msg = typeof data === 'string' ? parseClientMsg(data) : null;
    if (!msg) return send(ws, { type: 'error', code: 'bad-message' });
    const { id, part } = attachment(ws);
    switch (msg.type) {
      case 'ping':
        return send(ws, { type: 'pong', c0: msg.c0, serverTime: Date.now() });
      case 'create':
        return this.create(ws, msg);
      case 'join':
        return this.join(ws, msg);
      default: {
        const room = this.room;
        if (!room || !part) return send(ws, { type: 'error', code: 'not-in-room' });
        room.handle(id, msg);
        // Keep the part on the socket so a restored member comes back on the right part.
        const current = room.partOf(id);
        if (current && current !== part) ws.serializeAttachment({ ...attachment(ws), part: current } satisfies Attachment);
      }
    }
  }

  private async create(ws: WebSocket, msg: Extract<ClientMsg, { type: 'create' }>) {
    const code = attachment(ws).create;
    // Only a socket the Worker opened with ?create may make the room, and only once.
    if (!code || this.room) return send(ws, { type: 'error', code: 'room-not-found' });
    const library = libraryForKey(this.env, msg.key);
    if (!library) return send(ws, { type: 'error', code: 'bad-key' });
    const songs = await songLibrary(this.env, library).list();
    if (songs.length === 0) return send(ws, { type: 'error', code: 'song-not-found' });
    // Another socket may have created the room while the library loaded.
    if (this.room) return send(ws, { type: 'error', code: 'room-not-found' });
    this.library = library;
    this.songs = songs;
    this.room = createRoom(code, this.host);
    await this.ctx.storage.put({ library, room: this.room.snapshot() });
    this.enter(ws, msg.part);
    await this.schedule();
  }

  private async join(ws: WebSocket, msg: Extract<ClientMsg, { type: 'join' }>) {
    const now = Date.now();
    this.failedJoins = this.failedJoins.filter((t) => now - t < FAILED_JOIN_WINDOW_MS);
    if (this.failedJoins.length >= MAX_FAILED_JOINS) return send(ws, { type: 'error', code: 'rate-limited' });
    const room = this.room;
    if (!room || msg.room !== room.code) return send(ws, { type: 'error', code: 'room-not-found' });
    // The public library is open to anyone with the code; a private one needs its key.
    if (this.library !== PUBLIC_LIBRARY && libraryForKey(this.env, msg.key) !== this.library) {
      this.failedJoins.push(now);
      return send(ws, { type: 'error', code: 'bad-key' });
    }
    this.enter(ws, msg.part);
    await this.schedule();
  }

  private enter(ws: WebSocket, part: Part) {
    const room = this.room!;
    const a = attachment(ws);
    if (a.part) room.leave(a.id);
    ws.serializeAttachment({ ...a, part } satisfies Attachment);
    room.join(peer(ws, a.id), part);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.drop(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
    await this.schedule(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.drop(ws);
    await this.schedule(ws);
  }

  /** Reaps sockets that went quiet (phones that sleep often never send a close), and ends rooms left empty. */
  async alarm() {
    const now = Date.now();
    const stale: WebSocket[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (!this.lastSeen.has(ws)) this.lastSeen.set(ws, now);
      if (now - this.lastSeen.get(ws)! > STALE_MS) stale.push(ws);
    }
    for (const ws of stale) {
      this.drop(ws);
      ws.close(1001, 'no messages for too long');
    }
    const emptyAt = await this.ctx.storage.get<number>('emptyAt');
    if (emptyAt !== undefined && now >= emptyAt + EMPTY_ROOM_TTL_MS && this.live(stale) === 0) {
      await this.ctx.storage.deleteAll();
      this.room = null;
      return;
    }
    await this.schedule(...stale);
  }

  private drop(ws: WebSocket) {
    this.lastSeen.delete(ws);
    this.room?.leave(attachment(ws).id);
  }

  private live(closing: WebSocket[]) {
    return this.ctx.getWebSockets().filter((ws) => !closing.includes(ws)).length;
  }

  /** While anyone is connected, check for quiet sockets every minute; once empty, expire the room after the TTL. */
  private async schedule(...closing: WebSocket[]) {
    const storage = this.ctx.storage;
    if (this.live(closing) > 0) {
      await storage.delete('emptyAt');
      await storage.setAlarm(Date.now() + REAP_INTERVAL_MS);
    } else if (this.room) {
      const emptyAt = (await storage.get<number>('emptyAt')) ?? Date.now();
      await storage.put('emptyAt', emptyAt);
      await storage.setAlarm(emptyAt + EMPTY_ROOM_TTL_MS);
    }
  }
}

const attachment = (ws: WebSocket) => ws.deserializeAttachment() as Attachment;

const peer = (ws: WebSocket, id: string): Peer => ({ id, send: (msg) => send(ws, msg) });

function send(ws: WebSocket, msg: ServerMsg) {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // The socket is closing; its close handler cleans up.
  }
}
