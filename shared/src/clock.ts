// NTP-style clock sync: estimate `offset` so that serverNow() = localNow() + offset.

export type ClockSample = { c0: number; c1: number; serverTime: number };

export const SYNC_SAMPLES = 8;
export const RESYNC_INTERVAL_MS = 30_000;
const PING_TIMEOUT_MS = 2000;
/** New estimates are blended in gradually so the beat position doesn't jump... */
const SMOOTHING = 0.3;
/** ...unless they differ this much, which means the server restarted or the old estimate was bad. */
const JUMP_THRESHOLD_MS = 50;

/** Uses the sample with the smallest round trip; it has the least room for asymmetric delay. */
export function offsetFromSamples(samples: ClockSample[]): { offset: number; rtt: number } {
  if (samples.length === 0) throw new Error('no clock samples');
  let best = samples[0];
  for (const s of samples) if (s.c1 - s.c0 < best.c1 - best.c0) best = s;
  return { offset: best.serverTime - (best.c0 + best.c1) / 2, rtt: best.c1 - best.c0 };
}

export function smoothOffset(prev: number | null, next: number): number {
  if (prev === null || Math.abs(next - prev) > JUMP_THRESHOLD_MS) return next;
  return prev + SMOOTHING * (next - prev);
}

/**
 * Transport-agnostic: the caller sends `ping {c0}` via `sendPing` and feeds `pong`s back to `handlePong`.
 * `now` must be monotonic (performance.now), never Date.now.
 */
export class ClockSync {
  offset: number | null = null;
  rtt: number | null = null;

  private pending: { c0: number; resolve: (s: ClockSample | null) => void } | null = null;
  private running: Promise<void> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  constructor(
    private sendPing: (c0: number) => void,
    private now: () => number = () => performance.now(),
  ) {}

  get synced(): boolean {
    return this.offset !== null;
  }

  serverNow(): number {
    if (this.offset === null) throw new Error('clock not synced');
    return this.now() + this.offset;
  }

  handlePong(c0: number, serverTime: number): void {
    if (this.pending?.c0 !== c0) return; // stale pong from a timed-out ping or an old socket
    const { resolve } = this.pending;
    this.pending = null;
    resolve({ c0, c1: this.now(), serverTime });
  }

  /** Runs one burst of pings. Concurrent calls share the burst in progress. */
  sync(): Promise<void> {
    this.running ??= this.burst().finally(() => (this.running = null));
    return this.running;
  }

  /** Syncs now, then every RESYNC_INTERVAL_MS. */
  start(): void {
    void this.sync();
    this.timer ??= setInterval(() => void this.sync(), RESYNC_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
    this.pending?.resolve(null);
    this.pending = null;
  }

  private async burst(): Promise<void> {
    this.stopped = false;
    const samples: ClockSample[] = [];
    for (let i = 0; i < SYNC_SAMPLES && !this.stopped; i++) {
      const sample = await this.ping();
      if (sample) samples.push(sample);
    }
    if (samples.length === 0) return;
    const { offset, rtt } = offsetFromSamples(samples);
    this.offset = smoothOffset(this.offset, offset);
    this.rtt = rtt;
  }

  private ping(): Promise<ClockSample | null> {
    return new Promise((resolve) => {
      const c0 = this.now();
      const timeout = setTimeout(() => {
        if (this.pending?.c0 === c0) this.pending = null;
        resolve(null);
      }, PING_TIMEOUT_MS);
      this.pending = {
        c0,
        resolve: (s) => {
          clearTimeout(timeout);
          resolve(s);
        },
      };
      this.sendPing(c0);
    });
  }
}
