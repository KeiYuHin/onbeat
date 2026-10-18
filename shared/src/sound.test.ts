import { describe, expect, it } from 'vitest';
import exampleJson from './fixtures/example-song.json';
import { checkDrumPattern, compileSong, meter, parseSong } from './song';
import {
  bassNote,
  DEFAULT_SOUND_OPTIONS,
  defaultDrumPattern,
  drumPresets,
  soundEvents,
  type SoundOptions,
} from './sound';

const example = compileSong(parseSong(exampleJson));
const opts = (o: Partial<SoundOptions>): SoundOptions => ({ ...DEFAULT_SOUND_OPTIONS, ...o });
const at = (events: { beat: number; sound: string }[], beat: number) =>
  events.filter((e) => e.beat === beat).map((e) => e.sound).sort();

describe('metronome', () => {
  it('clicks the count-in bar with an accent on its first beat', () => {
    const e = soundEvents(example, -10, 0, opts({ metronome: false }));
    expect(e.map((x) => [x.beat, x.sound])).toEqual([
      [-4, 'clickAccent'],
      [-3, 'click'],
      [-2, 'click'],
      [-1, 'click'],
    ]);
  });

  it('accents downbeats and plays quieter subdivisions', () => {
    const e = soundEvents(example, 0, 4, opts({ subdivision: 2 }));
    expect(e.map((x) => x.beat)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(e[0].sound).toBe('clickAccent');
    expect(e[2].sound).toBe('click');
    expect(e[1].gain).toBeLessThan(e[2].gain);
  });

  it('is silent when everything is off, and after the end of the song', () => {
    expect(soundEvents(example, -4, 8, opts({ metronome: false, countIn: false }))).toEqual([]);
    expect(soundEvents(example, example.totalBeats, example.totalBeats + 8, opts({}))).toEqual([]);
  });

  it('splits windows without dropping or doubling events', () => {
    const o = opts({ subdivision: 4, drums: true });
    const whole = soundEvents(example, -4, 40, o);
    const pieces = [-4, -1.3, 0, 0.1, 7.99, 16, 40].flatMap((b, i, a) =>
      i ? soundEvents(example, a[i - 1], b, o) : [],
    );
    expect(pieces).toEqual(whole);
  });
});

describe('drum machine', () => {
  const drums = opts({ metronome: false, countIn: false, drums: true });

  it('plays the section pattern from the song', () => {
    const e = soundEvents(example, 0, 4, drums); // intro bar 1
    expect(at(e, 0)).toEqual(['hat', 'kick']);
    expect(at(e, 1)).toEqual(['hat', 'snare']);
    expect(at(e, 2)).toEqual(['hat', 'kick']);
    expect(at(e, 2.5)).toEqual(['hat', 'kick']);
  });

  it('switches pattern per section and marks accents', () => {
    const chorus = example.sections[2];
    const e = soundEvents(example, chorus.startBeat + 4, chorus.startBeat + 8, drums); // second chorus bar
    expect(at(e, chorus.startBeat + 4)).toEqual(['kick', 'ride']);
    expect(e.find((x) => x.sound === 'snare')!.gain).toBe(1);
  });

  it('fills the last two beats before a new section and crashes into it', () => {
    const verse = example.sections[1];
    const e = soundEvents(example, verse.startBeat - 2, verse.startBeat + 1, drums);
    expect(at(e, verse.startBeat - 2)).toEqual(['kick', 'tom']);
    expect(at(e, verse.startBeat - 1.5)).toEqual(['tom']);
    expect(at(e, verse.startBeat - 0.25)).toEqual(['snare']);
    expect(at(e, verse.startBeat)).toEqual(['crash', 'kick']);
  });

  it('does not fill when fills are off', () => {
    const verse = example.sections[1];
    const e = soundEvents(example, verse.startBeat - 2, verse.startBeat + 1, { ...drums, fills: false });
    expect(e.some((x) => x.sound === 'tom' || x.sound === 'crash')).toBe(false);
  });

  it('falls back to a basic beat that fits the time signature', () => {
    expect(defaultDrumPattern(meter([4, 4]))).toEqual({
      kick: 'x.......x.......',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
    });
    const waltz = parseSong({
      id: 'w',
      title: 'w',
      bpm: 90,
      timeSignature: [3, 4],
      sections: { a: { bars: [['C']] } },
      form: ['a'],
      parts: {},
    });
    const e = soundEvents(compileSong(waltz), 0, 3, drums);
    expect(at(e, 0)).toEqual(['hat', 'kick']);
    expect(at(e, 1)).toEqual(['hat', 'snare']);
    expect(at(e, 2)).toEqual(['hat']);
  });
});

describe('other meters', () => {
  const song = (patch: object) =>
    compileSong(parseSong({ ...exampleJson, sections: { a: { bars: [['C'], ['C']] } }, form: ['a'], parts: {}, ...patch }));
  const beats = (e: { beat: number; sound: string }[], sound?: string) =>
    e.filter((x) => !sound || x.sound === sound).map((x) => x.beat);

  it('accents the first beat of every bar, whatever its length', () => {
    const c = song({ sections: { a: { bars: [['C'], { chords: ['G'], timeSignature: [2, 4] }, ['C']] } } });
    const e = soundEvents(c, 0, 10, opts({}));
    expect(beats(e, 'clickAccent')).toEqual([0, 4, 6]);
    expect(beats(e)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('counts 12/8 in four dotted quarters and subdivides them in threes', () => {
    const c = song({ timeSignature: [12, 8] });
    expect(c.totalBeats).toBe(8);
    expect(beats(soundEvents(c, -10, 0, opts({})))).toEqual([-4, -3, -2, -1]);
    const eighths = soundEvents(c, 0, 1, opts({ subdivision: 2 }));
    expect(eighths.map((x) => x.beat)).toEqual([0, 1 / 3, 2 / 3]);
    expect(eighths.map((x) => x.sound)).toEqual(['clickAccent', 'click', 'click']);
  });

  it('plays a 12/8 default beat on eighth-note steps', () => {
    const c = song({ timeSignature: [12, 8] });
    expect(defaultDrumPattern(c.meter)).toEqual({ kick: 'x.....x.....', snare: '...x.....x..', hat: 'xxxxxxxxxxxx' });
    const e = soundEvents(c, 0, 1, opts({ metronome: false, countIn: false, drums: true }));
    expect(beats(e, 'hat')).toEqual([0, 1 / 3, 2 / 3]);
    expect(drumPresets(c.meter).map((p) => p.name)).toEqual(['基本', '清空']);
  });

  it('cuts a pattern short in a short bar', () => {
    const c = song({ sections: { a: { bars: [{ chords: ['C'], timeSignature: [2, 4] }, ['C']] } } });
    const e = soundEvents(c, 0, 2, opts({ metronome: false, countIn: false, drums: true, fills: false }));
    expect(beats(e, 'snare')).toEqual([1]);
    expect(beats(e, 'kick')).toEqual([0]);
  });
});

describe('drum presets', () => {
  it.each([3, 4, 5])('fit %i/4 bars', (bpb) => {
    for (const p of drumPresets(meter([bpb, 4]))) expect(checkDrumPattern(p.pattern, bpb * 4)).toBeNull();
  });
});

describe('root-note bass', () => {
  it('maps chord names to a root (or slash bass) in the low bass range', () => {
    expect(bassNote('E')).toBe(28);
    expect(bassNote('C')).toBe(36);
    expect(bassNote('Am7')).toBe(33);
    expect(bassNote('F#m')).toBe(30);
    expect(bassNote('Bb')).toBe(34);
    expect(bassNote('G/B')).toBe(35);
    expect(bassNote('Eb')).toBe(39);
    expect(bassNote('N.C.')).toBeNull();
    expect(bassNote('6m')).toBeNull();
  });

  it('plays eighths, quarters or one held note per chord', () => {
    const bass = (rhythm: 0 | 1 | 2) =>
      soundEvents(example, 0, 4, opts({ metronome: false, bass: true, bassRhythm: rhythm }));
    expect(bass(2).map((e) => e.beat)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(bass(1).every((e) => e.note === 36 && e.length === 1)).toBe(true);
    expect(bass(0)).toEqual([{ beat: 0, sound: 'bass', gain: 1, note: 36, length: 4 }]);
  });

  it('splits bars with two chords, in 3/4 too', () => {
    const song = parseSong({
      id: 's',
      title: 's',
      bpm: 90,
      timeSignature: [3, 4],
      sections: { a: { bars: [['C', 'G/B']] } },
      form: ['a'],
      parts: {},
    });
    const e = soundEvents(compileSong(song), 0, 3, opts({ metronome: false, bass: true, bassRhythm: 1 }));
    expect(e.map((x) => [x.beat, x.note, x.length])).toEqual([
      [0, 36, 1],
      [1, 36, 0.5],
      [1.5, 35, 1],
      [2.5, 35, 0.5],
    ]);
  });
});
