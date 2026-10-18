// M2.5 metronome and drum machine as pure functions: sounds are events at beat positions,
// so every device derives the same events from the shared timeline. The web app schedules them.
import { partDetail, type CompiledSong, type Drum, type DrumPattern } from './song';

export type SoundName = Drum | 'click' | 'clickAccent' | 'bass';
/** `note` (MIDI) and `length` (beats) are set for pitched sounds, i.e. the bass. */
export type SoundEvent = { beat: number; sound: SoundName; gain: number; note?: number; length?: number };

export type Subdivision = 1 | 2 | 4; // clicks per beat: quarter, eighth, sixteenth
/** Bass notes per beat; 0 holds one note for each chord. */
export type BassRhythm = 0 | 1 | 2;

export type SoundOptions = {
  metronome: boolean;
  subdivision: Subdivision;
  /** Click the count-in bar even when the metronome is off. */
  countIn: boolean;
  drums: boolean;
  /** Fill in the last bar of each section and crash into the next one. */
  fills: boolean;
  /** Root-note bass following the chords, for practising along. */
  bass: boolean;
  bassRhythm: BassRhythm;
};

export const DEFAULT_SOUND_OPTIONS: SoundOptions = {
  metronome: true,
  subdivision: 1,
  countIn: true,
  drums: false,
  fills: true,
  bass: false,
  bassRhythm: 2,
};

const PITCH_CLASSES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** Lowest bass note, E1 (the open E string); roots land in E1..D#2. */
const BASS_LOW = 28;

/**
 * MIDI note the bass plays for a chord: the slash bass if there is one (G/B → B), else the root.
 * Null when the name doesn't start with a note letter (N.C., scale degrees).
 */
export function bassNote(chord: string): number | null {
  const slash = chord.split('/')[1];
  const m = /^([A-G])([#b]?)/.exec(slash ?? '') ?? /^([A-G])([#b]?)/.exec(chord);
  if (!m) return null;
  const pc = PITCH_CLASSES[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return BASS_LOW + ((((pc - 4) % 12) + 12) % 12);
}

const STEPS_PER_BEAT = 4;
const ACCENT = 1;
const HIT = 0.7;

/** Basic beat for sections without a written pattern: hats on eighths, kick on 1 (and 3), snare on the off beats. */
export function defaultDrumPattern(beatsPerBar: number): DrumPattern {
  const row = (onBeat: (beat: number) => boolean, everyEighth = false) =>
    Array.from({ length: beatsPerBar * STEPS_PER_BEAT }, (_, i) =>
      (everyEighth ? i % 2 === 0 : i % STEPS_PER_BEAT === 0 && onBeat(i / STEPS_PER_BEAT)) ? 'x' : '.',
    ).join('');
  const half = beatsPerBar % 2 === 0 ? beatsPerBar / 2 : -1;
  return {
    kick: row((b) => b === 0 || b === half),
    snare: row((b) => b % 2 === 1),
    hat: row(() => true, true),
  };
}

export type DrumPreset = { name: string; pattern: DrumPattern };

const PRESETS: DrumPreset[] = [
  { name: '基本 8beat', pattern: { kick: 'x.......x.x.....', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' } },
  { name: '抒情 4beat', pattern: { kick: 'x.......x.......', snare: '....x.......x...', hat: 'x...x...x...x...' } },
  { name: '16beat', pattern: { kick: 'x.....x...x.....', snare: '....x.......x...', hat: 'XxxxXxxxXxxxXxxx' } },
  { name: '摇滚 叮叮镲', pattern: { kick: 'x.x.....x.x.....', snare: '....X.......X...', ride: 'x.x.x.x.x.x.x.x.' } },
  { name: 'Disco', pattern: { kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.' } },
  { name: '放克', pattern: { kick: 'x..x..x...x.....', snare: '....x..x.x..x...', hat: 'xxxxxxxxxxxxxxxx' } },
  { name: '雷鬼 One Drop', pattern: { kick: '........x.......', snare: '........X.......', hat: 'x.x.x.x.x.x.x.x.' } },
  { name: '华尔兹', pattern: { kick: 'x...........', snare: '....x...x...', hat: 'x.x.x.x.x.x.' } },
  { name: '3/4 8beat', pattern: { kick: 'x.......x...', snare: '....x.......', hat: 'x.x.x.x.x.x.' } },
];

/** Presets that fit this time signature, plus the automatic basic beat and an empty bar. */
export function drumPresets(beatsPerBar: number): DrumPreset[] {
  const steps = beatsPerBar * STEPS_PER_BEAT;
  const fitting = PRESETS.filter((p) => Object.values(p.pattern).every((row) => row.length === steps));
  return [
    ...(fitting.length ? fitting : [{ name: '基本', pattern: defaultDrumPattern(beatsPerBar) }]),
    { name: '清空', pattern: { kick: '.'.repeat(steps), snare: '.'.repeat(steps), hat: '.'.repeat(steps) } },
  ];
}

/** The drum machine pattern for a section: the drums part's pattern if it is written as steps, else the default. */
export function drumPatternFor(c: CompiledSong, sectionId: string): DrumPattern {
  const pattern = partDetail(c.song, 'drums', sectionId)?.pattern;
  return typeof pattern === 'object' ? pattern : defaultDrumPattern(c.beatsPerBar);
}

/** All events with `from <= beat < to`, sorted by beat. Count-in clicks sit on beats -beatsPerBar..-1. */
export function soundEvents(c: CompiledSong, from: number, to: number, opts: SoundOptions): SoundEvent[] {
  const events: SoundEvent[] = [];
  const bpb = c.beatsPerBar;

  // Count-in: quarter clicks, accented on the first beat.
  if (opts.countIn || opts.metronome) {
    for (let b = Math.max(Math.ceil(from), -bpb); b < Math.min(to, 0); b++)
      events.push({ beat: b, sound: b === -bpb ? 'clickAccent' : 'click', gain: ACCENT });
  }

  const songFrom = Math.max(from, 0);
  const songTo = Math.min(to, c.totalBeats);
  if (songFrom >= songTo) return sortEvents(events);

  if (opts.metronome) {
    const s = opts.subdivision;
    // Integer step counters keep beats exact instead of accumulating float error.
    for (let i = Math.ceil(songFrom * s); i < songTo * s; i++) {
      const beat = i / s;
      const onBeat = i % s === 0;
      const downbeat = onBeat && (i / s) % bpb === 0;
      events.push({ beat, sound: downbeat ? 'clickAccent' : 'click', gain: onBeat ? ACCENT : 0.35 });
    }
  }

  if (opts.drums) {
    const stepsPerBar = bpb * STEPS_PER_BEAT;
    for (let i = Math.ceil(songFrom * STEPS_PER_BEAT); i < songTo * STEPS_PER_BEAT; i++) {
      const barIndex = Math.floor(i / stepsPerBar);
      const step = i % stepsPerBar;
      const sectionIndex = c.bars[barIndex].sectionIndex;
      const section = c.sections[sectionIndex];
      const beat = i / STEPS_PER_BEAT;
      const lastBarBeforeNext =
        opts.fills && barIndex === section.startBar + section.barCount - 1 && sectionIndex < c.sections.length - 1;
      const firstBarAfterFill = opts.fills && barIndex === section.startBar && sectionIndex > 0;

      if (lastBarBeforeNext && bpb >= 2 && step >= stepsPerBar - 2 * STEPS_PER_BEAT) {
        fillStep(events, beat, step - (stepsPerBar - 2 * STEPS_PER_BEAT));
        continue;
      }
      if (firstBarAfterFill && step === 0) {
        events.push({ beat, sound: 'crash', gain: ACCENT }, { beat, sound: 'kick', gain: ACCENT });
        continue;
      }
      const pattern = drumPatternFor(c, section.id);
      for (const [drum, row] of Object.entries(pattern) as [Drum, string][]) {
        const hit = row[step];
        if (hit === 'x' || hit === 'X') events.push({ beat, sound: drum, gain: hit === 'X' ? ACCENT : HIT });
      }
    }
  }

  if (opts.bass) bassEvents(events, c, songFrom, songTo, opts.bassRhythm);

  return sortEvents(events);
}

/** Root notes for each chord slot of the bars in the window: one held note per chord, or repeated per beat/eighth. */
function bassEvents(events: SoundEvent[], c: CompiledSong, from: number, to: number, rhythm: BassRhythm) {
  const bpb = c.beatsPerBar;
  for (let b = Math.floor(from / bpb); b < c.bars.length && b * bpb < to; b++) {
    const bar = c.bars[b];
    const slot = bpb / bar.chords.length;
    bar.chords.forEach((chord, i) => {
      const note = bassNote(chord);
      if (note === null) return;
      const start = bar.startBeat + i * slot;
      const end = start + slot;
      const step = rhythm === 0 ? slot : 1 / rhythm;
      // Integer step counters keep beats exact, as for the metronome.
      for (let k = 0; start + k * step < end - 1e-9; k++) {
        const beat = start + k * step;
        if (beat < from || beat >= to) continue;
        events.push({ beat, sound: 'bass', gain: k === 0 ? ACCENT : HIT, note, length: Math.min(step, end - beat) });
      }
    });
  }
}

/** Two-beat fill: toms on eighths, then a sixteenth-note snare build. `step` counts sixteenths from 0 to 7. */
function fillStep(events: SoundEvent[], beat: number, step: number) {
  if (step < STEPS_PER_BEAT) {
    if (step % 2 === 0) events.push({ beat, sound: 'tom', gain: HIT });
    if (step === 0) events.push({ beat, sound: 'kick', gain: HIT });
  } else {
    events.push({ beat, sound: 'snare', gain: 0.45 + 0.15 * (step - STEPS_PER_BEAT) });
  }
}

function sortEvents(events: SoundEvent[]): SoundEvent[] {
  return events.sort((a, b) => a.beat - b.beat);
}
