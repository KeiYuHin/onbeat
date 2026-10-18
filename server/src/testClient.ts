// Node-side client used by the server tests; mirrors what the web app does over the socket.
import { performance } from 'node:perf_hooks';
import WebSocket from 'ws';
import { ClockSync, type ClientMsg, type PlaybackState, type ServerMsg, type Song } from '@onbeat/shared';

export class TestClient {
  readonly clock: ClockSync;
  state: PlaybackState | null = null;
  private inbox: ServerMsg[] = [];
  private waiters: { match: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];

  /** `clockSkewMs` gives each client its own local time base, like separate devices. */
  private constructor(
    private ws: WebSocket,
    clockSkewMs: number,
  ) {
    this.clock = new ClockSync(
      (c0) => this.send({ type: 'ping', c0 }),
      () => performance.now() + clockSkewMs,
    );
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMsg;
      if (msg.type === 'pong') return this.clock.handlePong(msg.c0, msg.serverTime);
      if (msg.type === 'state') this.state = msg.state;
      const i = this.waiters.findIndex((w) => w.match(msg));
      if (i >= 0) this.waiters.splice(i, 1)[0].resolve(msg);
      else this.inbox.push(msg);
    });
  }

  static async connect(port: number, clockSkewMs = 0): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject));
    return new TestClient(ws, clockSkewMs);
  }

  send(msg: ClientMsg) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves with the first message (already received or future) that matches. */
  next<T extends ServerMsg['type']>(
    type: T,
    match: (m: Extract<ServerMsg, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMsg, { type: T }>> {
    const pred = (m: ServerMsg) => m.type === type && match(m as Extract<ServerMsg, { type: T }>);
    const i = this.inbox.findIndex(pred);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as Extract<ServerMsg, { type: T }>);
    return new Promise((resolve) => this.waiters.push({ match: pred, resolve: resolve as (m: ServerMsg) => void }));
  }

  close() {
    this.clock.stop();
    this.ws.close();
  }
}

export const TEST_SONGS: Song[] = [
  {
    id: 'four',
    title: 'Four',
    bpm: 120,
    timeSignature: [4, 4],
    sections: { a: { bars: [['C'], ['G']] } },
    form: ['a'],
    parts: {},
  },
  {
    id: 'waltz',
    title: 'Waltz',
    bpm: 90,
    timeSignature: [3, 4],
    sections: { a: { bars: [['F'], ['C']] } },
    form: ['a', 'a'],
    parts: {},
  },
];
