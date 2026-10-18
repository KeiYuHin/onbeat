// The Cloudflare Worker: serves the web app and routes each /ws socket to its room's Durable Object.
import { CREATE_HEADER, ROOM_HEADER, type Env } from './roomObject';

export { RoomObject } from './roomObject';

const MAX_CODE_TRIES = 10;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/ws') return env.ASSETS.fetch(request);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });

    const room = url.searchParams.get('room');
    if (room !== null) {
      if (!/^\d{6}$/.test(room)) return new Response('bad room code', { status: 400 });
      return forward(env, request, room, false);
    }
    if (!url.searchParams.has('create')) return new Response('expected ?room=<code> or ?create', { status: 400 });
    // A code is free when its Durable Object holds no room; the object answers 409 otherwise.
    for (let i = 0; i < MAX_CODE_TRIES; i++) {
      const res = await forward(env, request, newRoomCode(), true);
      if (res.status !== 409) return res;
    }
    return new Response('no free room code', { status: 503 });
  },
} satisfies ExportedHandler<Env>;

function forward(env: Env, request: Request, code: string, create: boolean): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set(ROOM_HEADER, code);
  if (create) headers.set(CREATE_HEADER, '1');
  return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(new Request(request, { headers }));
}

function newRoomCode(): string {
  const [n] = crypto.getRandomValues(new Uint32Array(1));
  return String(n % 1_000_000).padStart(6, '0');
}
