import { describe, expect, it } from 'vitest';
import exampleJson from './fixtures/example-song.json';
import { compileSong, parseSong } from './song';
import {
  barPosition,
  beatAt,
  bpmAt,
  loadSong,
  repeatSection,
  resumeBeat,
  seekTo,
  segments,
  setBpm,
  setLoop,
  startPlayback,
  START_LEAD_MS,
  stopPlayback,
} from './timeline';

const idle = (bpm = 120) => loadSong({ id: 'test', bpm });

describe('beatAt', () => {
  it('advances one beat per 60000/bpm ms from the anchor', () => {
    const s = { ...idle(120), playing: true, anchorServerTime: 10_000, anchorBeat: 8 };
    expect(beatAt(s, 10_000)).toBe(8);
    expect(beatAt(s, 10_500)).toBe(9);
    expect(beatAt(s, 12_250)).toBe(12.5);
  });

  it('holds still while stopped', () => {
    const s = { ...idle(), anchorBeat: 5.25 };
    expect(beatAt(s, 0)).toBe(5.25);
    expect(beatAt(s, 1e9)).toBe(5.25);
  });
});

describe('startPlayback', () => {
  it('puts a count-in bar after the lead time, so beat 0 lands one bar later', () => {
    const s = startPlayback(idle(120), 1000);
    expect(s.playing).toBe(true);
    expect(beatAt(s, 1000 + START_LEAD_MS)).toBe(-4);
    expect(beatAt(s, 1000 + START_LEAD_MS + 4 * 500)).toBe(0);
  });

  it('honours startBeat and beatsPerBar', () => {
    const s = startPlayback(idle(60), 0, { startBeat: 12, beatsPerBar: 3, leadMs: 0 });
    expect(beatAt(s, 3000)).toBe(12);
  });
});

describe('stopPlayback', () => {
  it('keeps the position continuous at the moment of stopping', () => {
    const playing = startPlayback(idle(97), 0);
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

describe('repeatSection', () => {
  const song = parseSong(exampleJson);
  const playing = { ...loadSong(song), playing: true, anchorServerTime: 0, anchorBeat: 0 }; // beat = ms / 500

  it('adds a pass without moving the current position', () => {
    const c = compileSong(song);
    const t = 20 * 500; // verse, pass 1
    const next = repeatSection(playing, c, 1, t)!;
    expect(next.extraPasses).toEqual({ 1: 1 });
    expect(beatAt(next, t)).toBe(beatAt(playing, t));
    expect(compileSong(song, next.extraPasses).sections[1].times).toBe(3);
    expect(repeatSection(next, compileSong(song, next.extraPasses), 1, t)!.extraPasses).toEqual({ 1: 2 });
  });

  it('refuses once the section is in its last beat or over', () => {
    const c = compileSong(song);
    const verseEnd = c.sections[2].startBeat;
    expect(repeatSection(playing, c, 1, (verseEnd - 0.5) * 500)).toBeNull();
    expect(repeatSection(playing, c, 0, verseEnd * 500)).toBeNull();
    expect(repeatSection(playing, c, 99, 0)).toBeNull();
  });

  it('is cleared by a fresh start', () => {
    const extended = { ...idle(), extraPasses: { 1: 1 } };
    expect(startPlayback(extended, 0).extraPasses).toBeUndefined();
  });
});

describe('start from a bar', () => {
  it('counts in, then jumps to the start bar', () => {
    const s = startPlayback(idle(120), 0, { startBeat: 16, leadMs: 0 });
    expect(beatAt(s, 0)).toBe(-4);
    expect(beatAt(s, 1999)).toBeCloseTo(-0.002, 9);
    expect(beatAt(s, 2000)).toBe(16);
    expect(beatAt(s, 2500)).toBe(17);
  });

  it('keeps extra passes when starting past the top', () => {
    const extended = { ...idle(), extraPasses: { 1: 1 } };
    expect(startPlayback(extended, 0, { startBeat: 8 }).extraPasses).toEqual({ 1: 1 });
  });

  it('resumes from the start of the bar it stopped in, or the top once over', () => {
    const c = { beatsPerBar: 4, totalBeats: 32 };
    expect(resumeBeat({ ...idle(), anchorBeat: 13.7 }, c)).toBe(12);
    expect(resumeBeat({ ...idle(), anchorBeat: -2 }, c)).toBe(0);
    expect(resumeBeat({ ...idle(), anchorBeat: 32 }, c)).toBe(0);
  });

  it('stopping during the count-in parks at the bar it was counting into', () => {
    const s = startPlayback(idle(120), 0, { startBeat: 16, leadMs: 0 });
    expect(stopPlayback(s, 1000).anchorBeat).toBe(16);
  });
});

/** Playing from the top since t=0 at 120bpm: beat = t / 500 (no count-in). */
const playingAt = (bpm = 120) => ({ ...idle(bpm), playing: true, anchorServerTime: 0, anchorBeat: 0 });

describe('seekTo', () => {
  it('jumps at the next barline that is far enough away, continuous until then', () => {
    const s = playingAt();
    const t = 5 * 500; // beat 5, bar 2; next barline beat 8 at t=4000
    const next = seekTo(s, t, 24, 4);
    expect(next.jump).toEqual({ atServerTime: 4000, beat: 24, bpm: 120 });
    for (const at of [t, 3000, 3999]) expect(beatAt(next, at)).toBeCloseTo(beatAt(s, at), 9);
    expect(beatAt(next, 4000)).toBe(24);
    expect(beatAt(next, 4500)).toBe(25);
  });

  it('skips a barline that is too close', () => {
    const t = 7.8 * 500; // 100ms before beat 8
    expect(seekTo(playingAt(), t, 0, 4).jump!.atServerTime).toBe(12 * 500);
  });

  it('moves straight there while stopped', () => {
    const s = seekTo({ ...idle(), anchorBeat: 3.5 }, 0, 20, 4);
    expect(s.playing).toBe(false);
    expect(s.anchorBeat).toBe(20);
  });

  it('changes where a count-in leads', () => {
    const s = seekTo(startPlayback(idle(), 0), 100, 32, 4);
    expect(beatAt(s, START_LEAD_MS + 2000)).toBe(32);
  });

  it('ends a loop when going outside it, keeps it when going inside', () => {
    const looped = setLoop(playingAt(), 0, { startBeat: 0, endBeat: 16 }, 4);
    expect(seekTo(looped, 1000, 8, 4).loop).toEqual({ startBeat: 0, endBeat: 16 });
    expect(seekTo(looped, 1000, 16, 4).loop).toBeUndefined();
  });
});

describe('setBpm', () => {
  it('changes tempo at the next barline without moving the position', () => {
    const s = playingAt(120);
    const next = setBpm(s, 1000, 60, 4); // beat 2; barline beat 4 at t=2000
    expect(beatAt(next, 1999)).toBeCloseTo(beatAt(s, 1999), 9);
    expect(bpmAt(next, 1999)).toBe(120);
    expect(beatAt(next, 2000)).toBeCloseTo(4, 9);
    expect(beatAt(next, 3000)).toBeCloseTo(5, 9);
    expect(bpmAt(next, 3000)).toBe(60);
  });

  it('rides along with a pending seek, and both survive later commands', () => {
    const s = setBpm(seekTo(playingAt(), 1000, 16, 4), 1100, 90, 4);
    expect(s.jump).toEqual({ atServerTime: 2000, beat: 16, bpm: 90 });
    // After the jump has happened, the next change folds it in first.
    const later = setBpm(s, 2500, 100, 4);
    expect(later.jump!.beat).toBeUndefined();
    expect(beatAt(later, 2500)).toBeCloseTo(beatAt(s, 2500), 9);
    expect(bpmAt(later, 2500)).toBe(90);
  });

  it('applies right away while stopped', () => {
    expect(setBpm(idle(120), 0, 80, 4)).toMatchObject({ bpm: 80, anchorBeat: 0 });
  });

  it('keeps a pending tempo when stopped before the barline', () => {
    expect(stopPlayback(setBpm(playingAt(), 1000, 80, 4), 1500).bpm).toBe(80);
  });
});

describe('setLoop', () => {
  const loop = { startBeat: 8, endBeat: 16 };

  it('wraps from the end back to the start', () => {
    const s = setLoop({ ...playingAt(), anchorBeat: 8 }, 0, loop, 4);
    expect(beatAt(s, 7.5 * 500)).toBeCloseTo(15.5, 9);
    expect(beatAt(s, 8 * 500)).toBe(8);
    expect(beatAt(s, 17 * 500)).toBe(9);
  });

  it('plays on into a loop ahead, but jumps into it when asked from outside', () => {
    const inside = setLoop(playingAt(), 5 * 500, { startBeat: 0, endBeat: 16 }, 4);
    expect(inside.jump).toBeUndefined();
    const outside = setLoop(playingAt(), 2 * 500, loop, 4);
    expect(outside.jump).toMatchObject({ beat: 8 });
    expect(beatAt(outside, 4 * 500)).toBe(8);
    expect(beatAt(outside, 12 * 500)).toBe(8); // came round once
  });

  it('carries on from the current position when cleared', () => {
    const s = setLoop({ ...playingAt(), anchorBeat: 8 }, 0, loop, 4);
    const t = 10 * 500; // looped once, at beat 10
    const cleared = setLoop(s, t, null, 4);
    expect(cleared.loop).toBeUndefined();
    expect(beatAt(cleared, t)).toBeCloseTo(10, 9);
    expect(beatAt(cleared, t + 4000)).toBeCloseTo(18, 9);
  });

  it('moves a stopped position into the loop', () => {
    expect(setLoop(idle(), 0, loop, 4).anchorBeat).toBe(8);
  });
});

describe('segments', () => {
  it('splits at the jump and at loop wraps, each piece agreeing with beatAt', () => {
    const looped = setLoop({ ...playingAt(), anchorBeat: 8 }, 0, { startBeat: 8, endBeat: 16 }, 4);
    const s = setBpm(looped, 1000, 60, 4); // tempo halves at beat 12 (t=2000)
    const segs = segments(s, 500, 9000);
    expect(segs.map((g) => [g.from, g.beat, g.bpm])).toEqual([
      [500, 9, 120],
      [2000, 12, 60],
      [6000, 8, 60],
    ]);
    for (const g of segs) expect(beatAt(s, g.from)).toBeCloseTo(g.beat, 9);
    expect(segments(idle(), 0, 1000)).toEqual([]);
  });

  it('covers the count-in and the start bar', () => {
    const s = startPlayback(idle(120), 0, { startBeat: 16, leadMs: 0 });
    expect(segments(s, 1000, 3000).map((g) => [g.from, g.to, g.beat])).toEqual([
      [1000, 2000, -2],
      [2000, 3000, 16],
    ]);
  });
});
