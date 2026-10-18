import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startServer } from './server';
import { TestClient } from './testClient';

let server: Awaited<ReturnType<typeof startServer>>;
const clients: TestClient[] = [];
const connect = async () => {
  const c = await TestClient.connect(server.port);
  clients.push(c);
  return c;
};

beforeEach(async () => {
  server = await startServer({ port: 0, emptyRoomTtlMs: 50 });
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await server.close();
});

describe('rooms', () => {
  it('creates a room with a 6-digit code and sends the initial state', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'bass' });
    const welcome = await a.next('welcome');
    expect(welcome.room).toMatch(/^\d{6}$/);
    expect((await a.next('state')).state.playing).toBe(false);
    expect((await a.next('members')).members).toEqual([{ id: welcome.memberId, part: 'bass' }]);
  });

  it('lets others join and tracks members coming and going', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    const { room } = await a.next('welcome');
    await a.next('members');

    const b = await connect();
    b.send({ type: 'join', room, part: 'drums' });
    await b.next('welcome');
    expect((await a.next('members')).members.map((m) => m.part)).toEqual(['guitar1', 'drums']);

    b.close();
    expect((await a.next('members')).members.map((m) => m.part)).toEqual(['guitar1']);
  });

  it('rejects unknown rooms and malformed messages', async () => {
    const a = await connect();
    a.send({ type: 'join', room: '000000', part: 'keys' });
    expect((await a.next('error')).code).toBe('room-not-found');
    a.send({ type: 'join', room: 'abc', part: 'keys' } as never);
    expect((await a.next('error')).code).toBe('bad-message');
    a.send({ type: 'cmd', action: 'start' });
    expect((await a.next('error')).code).toBe('not-in-room');
  });

  it('broadcasts start and stop to everyone in the room', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    const { room } = await a.next('welcome');
    await a.next('state');
    const b = await connect();
    b.send({ type: 'join', room, part: 'bass' });
    await b.next('state');

    b.send({ type: 'cmd', action: 'start' });
    const [sa, sb] = await Promise.all([a.next('state'), b.next('state')]);
    expect(sa.state.playing).toBe(true);
    expect(sb.state).toEqual(sa.state);

    a.send({ type: 'cmd', action: 'stop' });
    expect((await b.next('state')).state.playing).toBe(false);
  });

  it('forgets a room once it has been empty for the TTL', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    const { room } = await a.next('welcome');
    a.close();
    await new Promise((r) => setTimeout(r, 150));
    const b = await connect();
    b.send({ type: 'join', room, part: 'bass' });
    expect((await b.next('error')).code).toBe('room-not-found');
  });
});
