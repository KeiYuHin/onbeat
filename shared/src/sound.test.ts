import { describe, expect, it } from 'vitest';
import exampleJson from '../../songs/example-song.json';
import { checkDrumPattern, compileSong, parseSong, type Song } from './song';
import { DEFAULT_SOUND_OPTIONS, defaultDrumPattern, drumPresets, soundEvents, type SoundOptions } from './sound';

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
    expect(defaultDrumPattern(4)).toEqual({
      kick: 'x.......x.......',
      snare: '....x.......x...',
      hat: 'x.x.x.x.x.x.x.x.',
    });
    const waltz: Song = {
      id: 'w',
      title: 'w',
      bpm: 90,
      timeSignature: [3, 4],
      sections: { a: { bars: [['C']] } },
      form: ['a'],
      parts: {},
    };
    const e = soundEvents(compileSong(waltz), 0, 3, drums);
    expect(at(e, 0)).toEqual(['hat', 'kick']);
    expect(at(e, 1)).toEqual(['hat', 'snare']);
    expect(at(e, 2)).toEqual(['hat']);
  });
});

describe('drum presets', () => {
  it.each([3, 4, 5])('fit %i/4 bars', (bpb) => {
    for (const p of drumPresets(bpb)) expect(checkDrumPattern(p.pattern, bpb * 4)).toBeNull();
  });
});
