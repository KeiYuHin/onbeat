// M2.5 metronome and drum machine as pure functions: sounds are events at beat positions,
// so every device derives the same events from the shared timeline. The web app schedules them.
import { bassPitch, type Chord, type Key } from './chord';
import { barIndexAt, partDetail, stepsPerBar, type CompiledSong, type Drum, type DrumPattern, type Meter } from './song';

export type SoundName = Drum | 'click' | 'clickAccent' | 'bass';
/** `note` (MIDI) and `length` (beats) are set for pitched sounds, i.e. the bass. */
export type SoundEvent = { beat: number; sound: SoundName; gain: number; note?: number; length?: number };

/** Clicks per beat: quarter, eighth, sixteenth (in compound meters: dotted quarter, eighths, sixteenths). */
export type Subdivision = 1 | 2 | 4;
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

/** Lowest bass note, E1 (the open E string); roots land in E1..D#2. */
const BASS_LOW = 28;

/**
 * MIDI note the bass plays for a chord: the slash bass if there is one (G/B → B), else the root.
 * Null for names that aren't chords (N.C.).
 */
export function bassNote(chord: Chord | null, key: Key): number | null {
  const pc = bassPitch(chord, key);
  return pc === null ? null : BASS_LOW + ((((pc - 4) % 12) + 12) % 12);
}

const ACCENT = 1;
const HIT = 0.7;

/** Basic beat for sections without a written pattern: hats on eighths, kick on 1 (and 3), snare on the off beats. */
export function defaultDrumPattern(m: Meter): DrumPattern {
  const spb = m.stepsPerBeat;
  const eighth = spb / m.eighthsPerBeat;
  const row = (onBeat: (beat: number) => boolean, everyEighth = false) =>
    Array.from({ length: stepsPerBar(m) }, (_, i) =>
      (everyEighth ? i % eighth === 0 : i % spb === 0 && onBeat(i / spb)) ? 'x' : '.',
    ).join('');
  const half = m.beats % 2 === 0 ? m.beats / 2 : -1;
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
export function drumPresets(m: Meter): DrumPreset[] {
  const steps = stepsPerBar(m);
  // The presets are in sixteenths; a 12/8 bar has as many steps as a 3/4 one but they are eighths.
  const fitting = m.compound ? [] : PRESETS.filter((p) => Object.values(p.pattern).every((row) => row.length === steps));
  return [
    ...(fitting.length ? fitting : [{ name: '基本', pattern: defaultDrumPattern(m) }]),
    { name: '清空', pattern: { kick: '.'.repeat(steps), snare: '.'.repeat(steps), hat: '.'.repeat(steps) } },
  ];
}

/** The drum machine pattern for a section: the drums part's pattern if it is written as steps, else the default. */
export function drumPatternFor(c: CompiledSong, sectionId: string): DrumPattern {
  const pattern = partDetail(c.song, 'drums', sectionId)?.pattern;
  return typeof pattern === 'object' ? pattern : defaultDrumPattern(c.meter);
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

  for (let b = barIndexAt(c, songFrom); b < c.bars.length && c.bars[b].startBeat < songTo; b++) {
    const bar = c.bars[b];
    // Integer step counters from each bar's start keep beats exact instead of accumulating float error.
    const steps = (perBeat: number, each: (i: number, beat: number) => void) => {
      const first = Math.max(0, Math.ceil((songFrom - bar.startBeat) * perBeat - 1e-9));
      for (let i = first; i < bar.beats * perBeat; i++) {
        const beat = bar.startBeat + i / perBeat;
        if (beat >= songTo) break;
        each(i, beat);
      }
    };
    if (opts.metronome) {
      const s = clicksPerBeat(bar.meter, opts.subdivision);
      steps(s, (i, beat) => {
        const onBeat = i % s === 0;
        events.push({ beat, sound: i === 0 ? 'clickAccent' : 'click', gain: onBeat ? ACCENT : 0.35 });
      });
    }
    if (opts.drums) steps(bar.meter.stepsPerBeat, (step, beat) => drumStep(events, c, b, step, beat, opts.fills));
  }

  if (opts.bass) bassEvents(events, c, songFrom, songTo, opts.bassRhythm);

  return sortEvents(events);
}

/** Compound beats split in threes: "eighths" are the beat's three eighth notes, "sixteenths" six. */
const clicksPerBeat = (m: Meter, s: Subdivision) => (m.compound && s > 1 ? (s / 2) * 3 : s);

function drumStep(events: SoundEvent[], c: CompiledSong, barIndex: number, step: number, beat: number, fills: boolean) {
  const bar = c.bars[barIndex];
  const spb = bar.meter.stepsPerBeat;
  const section = c.sections[bar.sectionIndex];
  const lastBarBeforeNext =
    fills && barIndex === section.startBar + section.barCount - 1 && bar.sectionIndex < c.sections.length - 1;
  const firstBarAfterFill = fills && barIndex === section.startBar && bar.sectionIndex > 0;
  const fillFrom = (bar.beats - 2) * spb;

  if (lastBarBeforeNext && bar.beats >= 2 && step >= fillFrom) return fillStep(events, beat, step - fillFrom, spb);
  if (firstBarAfterFill && step === 0) {
    events.push({ beat, sound: 'crash', gain: ACCENT }, { beat, sound: 'kick', gain: ACCENT });
    return;
  }
  // A bar shorter than the pattern (a 2/4 bar in 4/4) plays its start; a longer one starts it over.
  const pattern = drumPatternFor(c, section.id);
  for (const [drum, row] of Object.entries(pattern) as [Drum, string][]) {
    const hit = row[step % row.length];
    if (hit === 'x' || hit === 'X') events.push({ beat, sound: drum, gain: hit === 'X' ? ACCENT : HIT });
  }
}

/** Root notes for each chord slot of the bars in the window: one held note per chord, or repeated per beat/eighth. */
function bassEvents(events: SoundEvent[], c: CompiledSong, from: number, to: number, rhythm: BassRhythm) {
  for (let b = barIndexAt(c, from); b < c.bars.length && c.bars[b].startBeat < to; b++) {
    const bar = c.bars[b];
    for (const slot of bar.chords) {
      const note = bassNote(slot.chord, bar.key);
      if (note === null) continue;
      // In compound meters the eighths come three to a beat.
      const step = rhythm === 0 ? slot.beats : 1 / (rhythm === 2 ? bar.meter.eighthsPerBeat : 1);
      const start = bar.startBeat + slot.start;
      const end = start + slot.beats;
      // Integer step counters keep beats exact, as for the metronome.
      for (let k = 0; start + k * step < end - 1e-9; k++) {
        const beat = start + k * step;
        if (beat < from || beat >= to) continue;
        events.push({ beat, sound: 'bass', gain: k === 0 ? ACCENT : HIT, note, length: Math.min(step, end - beat) });
      }
    }
  }
}

/**
 * Two-beat fill: toms on eighths, then a snare build on every step. `step` counts drum steps from the
 * start of the fill (0..7 in simple meters, 0..5 in compound ones).
 */
function fillStep(events: SoundEvent[], beat: number, step: number, stepsPerBeat: number) {
  const eighth = stepsPerBeat === 3 ? 1 : 2;
  if (step < stepsPerBeat) {
    if (step % eighth === 0) events.push({ beat, sound: 'tom', gain: HIT });
    if (step === 0) events.push({ beat, sound: 'kick', gain: HIT });
  } else {
    events.push({ beat, sound: 'snare', gain: 0.45 + (0.6 * (step - stepsPerBeat)) / stepsPerBeat });
  }
}

function sortEvents(events: SoundEvent[]): SoundEvent[] {
  return events.sort((a, b) => a.beat - b.beat);
}
