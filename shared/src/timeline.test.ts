import { describe, expect, it } from 'vitest';
import { barPosition, beatAt, initialState, startPlayback, START_LEAD_MS, stopPlayback } from './timeline';

describe('beatAt', () => {
  it('advances one beat per 60000/bpm ms from the anchor', () => {
    const s = { ...initialState(120), playing: true, anchorServerTime: 10_000, anchorBeat: 8 };
    expect(beatAt(s, 10_000)).toBe(8);
    expect(beatAt(s, 10_500)).toBe(9);
    expect(beatAt(s, 12_250)).toBe(12.5);
  });

  it('holds still while stopped', () => {
    const s = { ...initialState(), anchorBeat: 5.25 };
    expect(beatAt(s, 0)).toBe(5.25);
    expect(beatAt(s, 1e9)).toBe(5.25);
  });
});

describe('startPlayback', () => {
  it('puts a count-in bar after the lead time, so beat 0 lands one bar later', () => {
    const s = startPlayback(initialState(120), 1000);
    expect(s.playing).toBe(true);
    expect(beatAt(s, 1000 + START_LEAD_MS)).toBe(-4);
    expect(beatAt(s, 1000 + START_LEAD_MS + 4 * 500)).toBe(0);
  });

  it('honours startBeat and beatsPerBar', () => {
    const s = startPlayback(initialState(60), 0, { startBeat: 12, beatsPerBar: 3, leadMs: 0 });
    expect(beatAt(s, 3000)).toBe(12);
  });
});

describe('stopPlayback', () => {
  it('keeps the position continuous at the moment of stopping', () => {
    const playing = startPlayback(initialState(97), 0);
    const t = 7_777;
    const stopped = stopPlayback(playing, t);
    expect(stopped.playing).toBe(false);
    expect(beatAt(stopped, t)).toBeCloseTo(beatAt(playing, t), 9);
    expect(beatAt(stopped, t + 5000)).toBeCloseTo(beatAt(playing, t), 9);
  });
});

describe('barPosition', () => {
  it('maps beats to 1-based bar and beat', () => {
    expect(barPosition(0)).toEqual({ bar: 1, beatInBar: 1, phase: 0 });
    expect(barPosition(5.5)).toEqual({ bar: 2, beatInBar: 2, phase: 0.5 });
  });

  it('handles count-in (negative) beats', () => {
    expect(barPosition(-4)).toEqual({ bar: 0, beatInBar: 1, phase: 0 });
    expect(barPosition(-0.25)).toEqual({ bar: 0, beatInBar: 4, phase: 0.75 });
  });
});
