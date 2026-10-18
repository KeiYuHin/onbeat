// One rehearsal room per Durable Object, driving the same `createRoom` as the Node server.
import { DurableObject } from 'cloudflare:workers';
import {
  createRoom,
  parseClientMsg,
  parseSong,
  type Part,
  type Peer,
  type Room,
  type RoomHost,
  type RoomSnapshot,
  type ServerMsg,
  type Song,
} from '@onbeat/shared';
import exampleSong from '../../songs/example-song.json';

export type Env = {
  ROOMS: DurableObjectNamespace<RoomObject>;
  ASSETS: Fetcher;
};

/** Set by the Worker: the room code this object is named after, and whether to create the room. */
export const ROOM_HEADER = 'X-OnBeat-Room';
export const CREATE_HEADER = 'X-OnBeat-Create';

// The public catalog until the R2 library lands; read-only, so saving fails.
const SONGS: Song[] = [parseSong(exampleSong)];

/** Kept on each socket so it survives hibernation. `part` is set once the socket has joined. */
type Attachment = { id: string; part?: Part };

const EMPTY_ROOM_TTL_MS = 10 * 60_000;
/** Clients resync their clock every 30s (throttled to about once a minute in a background tab). */
const STALE_MS = 150_000;
const REAP_INTERVAL_MS = 60_000;

export class RoomObject extends DurableObject<Env> {
  private room: Room | null = null;
  /** Last message per socket. Lost on hibernation; a socket counts from when this object first sees it again. */
  private lastSeen = new Map<WebSocket, number>();

  // Workers' performance.now() is not a usable clock and memory is lost on hibernation, so this uses
  // Date.now() (the one exception to the no-Date.now() rule) and persists the room on every change.
  private host: RoomHost = {
    now: () => Date.now(),
    songs: () => SONGS,
    changed: () => void this.ctx.storage.put('room', this.room!.snapshot()),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get<RoomSnapshot>('room');
      if (!saved) return;
      this.room = createRoom(saved.code, this.host, saved);
      for (const ws of ctx.getWebSockets()) {
        const { id, part } = attachment(ws);
        if (part) this.room.restore(peer(ws, id), part);
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.has(CREATE_HEADER)) {
      if (this.room) return new Response('room taken', { status: 409 });
      this.room = createRoom(request.headers.get(ROOM_HEADER)!, this.host);
      await this.ctx.storage.put('room', this.room.snapshot());
    }
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID() } satisfies Attachment);
    this.lastSeen.set(server, Date.now());
    await this.schedule();
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    this.lastSeen.set(ws, Date.now());
    const msg = typeof data === 'string' ? parseClientMsg(data) : null;
    if (!msg) return send(ws, { type: 'error', code: 'bad-message' });
    const { id, part } = attachment(ws);
    const room = this.room;
    switch (msg.type) {
      case 'ping':
        return send(ws, { type: 'pong', c0: msg.c0, serverTime: Date.now() });
      case 'create':
      case 'join':
        // The Worker already routed this socket to its room, so both mean "enter this room".
        if (!room || (msg.type === 'join' && msg.room !== room.code)) return send(ws, { type: 'error', code: 'room-not-found' });
        if (part) room.leave(id);
        ws.serializeAttachment({ id, part: msg.part } satisfies Attachment);
        room.join(peer(ws, id), msg.part);
        return this.schedule();
      default: {
        if (!room || !part) return send(ws, { type: 'error', code: 'not-in-room' });
        room.handle(id, msg);
        // Keep the part on the socket so a restored member comes back on the right part.
        const current = room.partOf(id);
        if (current && current !== part) ws.serializeAttachment({ id, part: current } satisfies Attachment);
      }
    }
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
