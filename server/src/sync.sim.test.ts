// Simulation from SPEC.md: with 50–300ms network delay, two clients' beat positions agree within 20ms.
import { afterEach, expect, it } from 'vitest';
import { beatAt, msPerBeat } from '@onbeat/shared';
import { startServer } from './server';
import { TestClient } from './testClient';

const MAX_ERROR_MS = 20;
const rand = (min: number, max: number) => min + Math.random() * (max - min);

// Each connection gets its own base latency in 50–300ms (one phone on good Wi-Fi, one on bad 4G),
// plus per-message jitter. Fully independent 50–300ms per message would make one-way asymmetry,
// which no ping-based sync can observe, the dominant error.
const JITTER_MS = 20;
const baseLatency = new Map<string, number>();
const latencyMs = (connId: string) => {
  if (!baseLatency.has(connId)) baseLatency.set(connId, rand(50, 300));
  return baseLatency.get(connId)! + rand(0, JITTER_MS);
};

let server: Awaited<ReturnType<typeof startServer>>;
const clients: TestClient[] = [];
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await server?.close();
  baseLatency.clear();
});

async function connect() {
  // Large random skew: each device's performance.now() has an unrelated origin.
  const c = await TestClient.connect(server.port, rand(-1e7, 1e7));
  clients.push(c);
  return c;
}

/** Beat-position disagreement between two clients at the same real instant, in ms. */
function errorMs(a: TestClient, b: TestClient): number {
  const state = a.state!;
  return Math.abs(beatAt(state, a.clock.serverNow()) - beatAt(b.state!, b.clock.serverNow())) * msPerBeat(state.bpm);
}

it(
  'keeps two clients and a late joiner within 20ms under 50–300ms latency',
  async () => {
    server = await startServer({ port: 0, latencyMs });

    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    const { room } = await a.next('welcome');
    const b = await connect();
    b.send({ type: 'join', room, part: 'drums' });
    await b.next('welcome');
    await Promise.all([a.clock.sync(), b.clock.sync()]);

    a.send({ type: 'cmd', action: 'start' });
    await Promise.all([a.next('state', (m) => m.state.playing), b.next('state', (m) => m.state.playing)]);

    // Both received the state before the count-in starts (1500ms lead covers the slow link).
    expect(beatAt(a.state!, a.clock.serverNow())).toBeLessThan(-4);

    for (let i = 0; i < 5; i++) {
      expect(errorMs(a, b)).toBeLessThan(MAX_ERROR_MS);
      await new Promise((r) => setTimeout(r, 200));
    }

    // A device that joins mid-song aligns from the state it gets on join.
    const c = await connect();
    c.send({ type: 'join', room, part: 'bass' });
    await c.next('state');
    await c.clock.sync();
    expect(errorMs(a, c)).toBeLessThan(MAX_ERROR_MS);
    expect(errorMs(b, c)).toBeLessThan(MAX_ERROR_MS);
  },
  30_000,
);
