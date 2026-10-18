import { describe, expect, it } from 'vitest';
import { ClockSync, offsetFromSamples, smoothOffset, SYNC_SAMPLES } from './clock';

describe('offsetFromSamples', () => {
  it('uses the midpoint of the lowest-RTT sample', () => {
    const { offset, rtt } = offsetFromSamples([
      { c0: 0, c1: 300, serverTime: 5200 }, // rtt 300, asymmetric
      { c0: 1000, c1: 1040, serverTime: 6020 }, // rtt 40 -> offset 5000
      { c0: 2000, c1: 2200, serverTime: 7050 },
    ]);
    expect(rtt).toBe(40);
    expect(offset).toBe(5000);
  });

  it('rejects an empty sample set', () => {
    expect(() => offsetFromSamples([])).toThrow();
  });
});

describe('smoothOffset', () => {
  it('takes the first estimate as-is', () => {
    expect(smoothOffset(null, 123)).toBe(123);
  });

  it('blends small corrections', () => {
    const next = smoothOffset(1000, 1010);
    expect(next).toBeGreaterThan(1000);
    expect(next).toBeLessThan(1010);
  });

  it('jumps on large changes (e.g. server restarted)', () => {
    expect(smoothOffset(1000, 90_000)).toBe(90_000);
  });
});

describe('ClockSync', () => {
  it('recovers the true offset over a symmetric fake transport', async () => {
    const trueOffset = 123_456;
    let t = 1000;
    const clock: ClockSync = new ClockSync(
      (c0) => {
        t += 20; // uplink
        const serverTime = t + trueOffset;
        t += 20; // downlink
        queueMicrotask(() => clock.handlePong(c0, serverTime));
      },
      () => t,
    );
    expect(clock.synced).toBe(false);
    await clock.sync();
    expect(clock.offset).toBe(trueOffset);
    expect(clock.rtt).toBe(40);
    expect(clock.serverNow()).toBe(t + trueOffset);
  });

  it('ignores pongs that do not match the outstanding ping', async () => {
    let t = 0;
    let pings = 0;
    const clock: ClockSync = new ClockSync(
      (c0) => {
        pings++;
        t += 10;
        queueMicrotask(() => {
          clock.handlePong(c0 + 1, 999_999); // stale
          clock.handlePong(c0, t + 50);
        });
      },
      () => t,
    );
    await clock.sync();
    expect(pings).toBe(SYNC_SAMPLES);
    expect(clock.offset).toBe(55);
  });
});
