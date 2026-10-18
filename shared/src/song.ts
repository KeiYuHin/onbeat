// Song skeleton (sections, bars, chords) shared by all parts, plus per-part details. See SPEC.md.
import { PARTS, type Part } from './protocol';
import { everyBeats, type Barlines } from './timeline';

export const DRUMS = ['kick', 'snare', 'hat', 'crash', 'ride', 'tom'] as const;
export type Drum = (typeof DRUMS)[number];

/**
 * Drum machine bar: one step per sixteenth note (16 steps in 4/4) per instrument,
 * `x` hit, `X` accent, `.` rest. E.g. { kick: 'x...x...x...x...' }.
 */
export type DrumPattern = Partial<Record<Drum, string>>;

export type PartDetail = {
  strum?: string; // one char per eighth note: D down, U up, - rest
  pattern?: string | DrumPattern;
  groove?: string;
};

export type PartSpec = {
  label: string;
  default: PartDetail;
  notes?: string;
  sections?: Record<string, PartDetail>;
};

export type TimeSignature = [number, number];

/**
 * How a time signature is counted. A beat is what the metronome clicks and `bpm` counts: the denominator's
 * note, except in compound meters (6/8, 9/8, 12/8), which count dotted quarters of three eighths each.
 */
export type Meter = {
  beats: number;
  compound: boolean;
  /** Eighth notes per beat, the unit of strum patterns. */
  eighthsPerBeat: number;
  /** Drum machine steps per beat: sixteenths, or eighths in compound meters. */
  stepsPerBeat: number;
};

export function meter([n, d]: TimeSignature): Meter {
  if (d === 8 && n % 3 === 0 && n > 3) return { beats: n / 3, compound: true, eighthsPerBeat: 3, stepsPerBeat: 3 };
  return { beats: n, compound: false, eighthsPerBeat: 8 / d, stepsPerBeat: 16 / d };
}

export const stepsPerBar = (m: Meter) => m.beats * m.stepsPerBeat;

/** A bar as parsed: JSON bars are written as a chord array, or as an object when they need more. */
export type Bar = {
  chords: string[];
  /** Only for a bar in a different meter from the song (a 2/4 bar in a 4/4 song). */
  timeSignature?: TimeSignature;
};

/** Parsed sections always list their bars unrolled; `{ loop, times }` in the JSON is expanded by parseSong. */
export type Section = { label?: string; bars: Bar[] };

export type Song = {
  id: string;
  title: string;
  bpm: number;
  timeSignature: TimeSignature;
  key?: string;
  sections: Record<string, Section>;
  form: string[];
  parts: Partial<Record<Part, PartSpec>>;
};

const SECTION_LABELS: Record<string, string> = {
  intro: '前奏',
  verse: '主歌',
  prechorus: '导歌',
  chorus: '副歌',
  bridge: '桥段',
  solo: '间奏',
  interlude: '间奏',
  outro: '尾奏',
};

export const sectionName = (song: Song, id: string) => song.sections[id]?.label ?? SECTION_LABELS[id] ?? id;

/** Problem with a drum pattern for a bar of `steps` sixteenths, or null if it is valid. */
export function checkDrumPattern(pattern: unknown, steps: number): string | null {
  if (typeof pattern !== 'object' || pattern === null || Array.isArray(pattern)) return 'pattern must be an object';
  for (const [drum, row] of Object.entries(pattern)) {
    if (!DRUMS.includes(drum as Drum)) return `unknown drum "${drum}" (expected ${DRUMS.join(', ')})`;
    if (typeof row !== 'string' || !/^[xX.]+$/.test(row) || row.length !== steps)
      return `"${drum}" must be ${steps} steps of x, X or .`;
  }
  return null;
}

/**
 * Validates hand-written song JSON; throws with a message that points at the problem.
 * Returns a normalized copy (loops expanded) and never modifies `data`.
 */
export function parseSong(data: unknown): Song {
  const fail = (msg: string): never => {
    throw new Error(`invalid song${typeof (data as any)?.id === 'string' ? ` "${(data as any).id}"` : ''}: ${msg}`);
  };
  const s = data as any;
  if (typeof s !== 'object' || s === null) fail('not an object');
  if (typeof s.id !== 'string' || !s.id) fail('missing id');
  if (typeof s.title !== 'string') fail('missing title');
  if (!(s.bpm > 0)) fail('bpm must be a positive number');
  const ts = s.timeSignature;
  if (!isTimeSignature(ts)) fail('timeSignature must be like [4, 4] (beat note 2, 4 or 8)');
  if (typeof s.sections !== 'object' || s.sections === null) fail('missing sections');
  const sections: Record<string, Section> = {};
  for (const [id, sec] of Object.entries<any>(s.sections)) {
    const looped = sec?.loop !== undefined;
    const written = looped ? sec.loop : sec?.bars;
    if (!Array.isArray(written) || written.length === 0) fail(`section "${id}" has no bars`);
    if (looped && !(Number.isInteger(sec.times) && sec.times >= 1)) fail(`section "${id}" loop needs "times" (1 or more)`);
    const parsed = written.map((bar: unknown, i: number) => parseBar(bar, (msg) => fail(`section "${id}" bar ${i + 1} ${msg}`)));
    const bars: Bar[] = looped ? Array.from({ length: sec.times }, () => parsed).flat() : parsed;
    sections[id] = { ...(typeof sec.label === 'string' && { label: sec.label }), bars: structuredClone(bars) };
  }
  if (!Array.isArray(s.form) || s.form.length === 0) fail('form must list at least one section');
  for (const id of s.form) if (!(id in sections)) fail(`form refers to unknown section "${id}"`);
  if (typeof s.parts !== 'object' || s.parts === null) fail('missing parts');
  const steps = stepsPerBar(meter(ts));
  const checkDetail = (where: string, d: any) => {
    if (d.strum !== undefined && !/^[DU-]+$/.test(d.strum)) fail(`${where} strum may only use D, U and -`);
    if (typeof d.pattern !== 'object' || d.pattern === null) return;
    const problem = checkDrumPattern(d.pattern, steps);
    if (problem) fail(`${where} pattern: ${problem}`);
  };
  for (const [part, spec] of Object.entries<any>(s.parts)) {
    if (!PARTS.includes(part as Part)) fail(`unknown part "${part}" (expected one of ${PARTS.join(', ')})`);
    if (typeof spec?.default !== 'object' || spec.default === null) fail(`part "${part}" needs a default`);
    checkDetail(`part "${part}"`, spec.default);
    for (const [id, d] of Object.entries<any>(spec.sections ?? {})) {
      if (!(id in sections)) fail(`part "${part}" refers to unknown section "${id}"`);
      if (typeof d !== 'object' || d === null) fail(`part "${part}" section "${id}" must be an object`);
      checkDetail(`part "${part}" section "${id}"`, d);
    }
  }
  return { ...structuredClone(s), sections } as Song;
}

const isTimeSignature = (ts: unknown): ts is TimeSignature =>
  Array.isArray(ts) && ts.length === 2 && Number.isInteger(ts[0]) && ts[0] > 0 && [2, 4, 8].includes(ts[1]);

/** `["C", "G/B"]`, or `{ "chords": [...], "timeSignature": [2, 4] }`. */
function parseBar(bar: any, fail: (msg: string) => never): Bar {
  const written = Array.isArray(bar) ? { chords: bar } : bar;
  if (typeof written !== 'object' || written === null) fail('must be an array of chord names or an object');
  const { chords, timeSignature } = written;
  if (!Array.isArray(chords) || chords.length === 0 || !chords.every((c) => typeof c === 'string' && c))
    fail('needs a non-empty array of chord names');
  if (timeSignature !== undefined && !isTimeSignature(timeSignature)) fail('timeSignature must be like [2, 4]');
  return { chords, ...(timeSignature && { timeSignature }) };
}

/** A section's own pattern, or 'default' to drop it so the section follows the whole-song pattern. */
export type SectionDrumEdit = DrumPattern | 'default';

/** Drum patterns changed in a room but not yet saved to the song file. */
export type DrumEdits = { default?: DrumPattern; sections?: Record<string, SectionDrumEdit> };

export const hasDrumEdits = (edits: DrumEdits | null | undefined) =>
  !!edits && (!!edits.default || Object.keys(edits.sections ?? {}).length > 0);

/** The song with a room's drum edits applied to its drums part. */
export function applyDrumEdits(song: Song, edits: DrumEdits | null | undefined): Song {
  if (!edits || !hasDrumEdits(edits)) return song;
  const drums = song.parts.drums ?? { label: '鼓', default: {} };
  const sections = { ...drums.sections };
  for (const [id, edit] of Object.entries(edits.sections ?? {})) {
    if (edit !== 'default') {
      sections[id] = { ...sections[id], pattern: edit };
    } else if (sections[id]) {
      const { pattern: _, ...rest } = sections[id];
      // Drop the section entirely once nothing is left, so saved files don't keep empty objects.
      if (Object.keys(rest).length) sections[id] = rest;
      else delete sections[id];
    }
  }
  const { sections: _old, ...base } = drums;
  return {
    ...song,
    parts: {
      ...song.parts,
      drums: {
        ...base,
        default: edits.default ? { ...drums.default, pattern: edits.default } : drums.default,
        ...(Object.keys(sections).length && { sections }),
      },
    },
  };
}

/** Smallest number of bars that repeats to fill the section (8 bars of C Am F G C Am F G → 4). */
export function repeatPeriod(bars: Bar[]): number {
  const same = (a: Bar, b: Bar) =>
    a.chords.length === b.chords.length &&
    a.chords.every((c, i) => c === b.chords[i]) &&
    String(a.timeSignature) === String(b.timeSignature);
  for (let p = 1; p < bars.length; p++) {
    if (bars.length % p === 0 && bars.every((bar, i) => same(bar, bars[i % p]))) return p;
  }
  return bars.length;
}

export type SectionSpan = {
  id: string;
  label: string; // e.g. "副歌 2"; numbered only when the section occurs more than once
  startBeat: number;
  endBeat: number;
  startBar: number; // 0-based index into CompiledSong.bars
  barCount: number;
  /** The section is `loopBars` bars played `times` times (times is 1 when nothing repeats). */
  loopBars: number;
  times: number;
};

export type BarSpan = { chords: string[]; sectionIndex: number; startBeat: number; beats: number; meter: Meter };

/** The song unrolled along the form into a flat, beat-indexed timeline. */
export type CompiledSong = {
  song: Song;
  /** The song's own meter; single bars may differ, and the count-in always uses this one. */
  meter: Meter;
  beatsPerBar: number;
  sections: SectionSpan[];
  bars: BarSpan[];
  totalBeats: number;
};

/** Extra passes added live ("再绕一遍"), keyed by the section's index in the form. */
export type ExtraPasses = Record<number, number>;

export function compileSong(song: Song, extraPasses: ExtraPasses = {}): CompiledSong {
  const songMeter = meter(song.timeSignature);
  const totals = new Map<string, number>();
  for (const id of song.form) totals.set(id, (totals.get(id) ?? 0) + 1);
  const seen = new Map<string, number>();

  const sections: SectionSpan[] = [];
  const bars: BarSpan[] = [];
  let beat = 0;
  song.form.forEach((id, sectionIndex) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const written = song.sections[id].bars;
    const loopBars = repeatPeriod(written);
    const times = written.length / loopBars + (extraPasses[sectionIndex] ?? 0);
    const name = sectionName(song, id);
    const startBeat = beat;
    const startBar = bars.length;
    for (let i = 0; i < loopBars * times; i++) {
      // Extra passes replay the loop; bars as written keep their own details.
      const bar = written[i < written.length ? i : i % loopBars];
      const m = bar.timeSignature ? meter(bar.timeSignature) : songMeter;
      bars.push({ chords: bar.chords, sectionIndex, startBeat: beat, beats: m.beats, meter: m });
      beat += m.beats;
    }
    sections.push({
      id,
      label: totals.get(id)! > 1 ? `${name} ${n}` : name,
      startBeat,
      endBeat: beat,
      startBar,
      barCount: loopBars * times,
      loopBars,
      times,
    });
  });
  return { song, meter: songMeter, beatsPerBar: songMeter.beats, sections, bars, totalBeats: beat };
}

/** Index of the bar a beat falls in, clamped to the song (0 before it, the last bar after it). */
export function barIndexAt(c: Pick<CompiledSong, 'bars'>, beat: number): number {
  let lo = 0;
  let hi = c.bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.bars[mid].startBeat <= beat + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The song's barlines. Before the song they fall every beatsPerBar beats back from 0 (the count-in);
 * after it they carry on in the last bar's length.
 */
export function barlines(c: Pick<CompiledSong, 'bars' | 'totalBeats' | 'beatsPerBar'>): Barlines {
  return (beat) => {
    if (beat <= 0) return everyBeats(c.beatsPerBar)(beat);
    if (beat >= c.totalBeats) return c.totalBeats + everyBeats(c.bars[c.bars.length - 1].beats)(beat - c.totalBeats);
    const bar = c.bars[barIndexAt(c, beat)];
    return beat - bar.startBeat < 1e-9 ? bar.startBeat : bar.startBeat + bar.beats;
  };
}

export type SongPosition = {
  section: SectionSpan;
  barIndex: number; // 0-based, whole song
  barInSection: number; // 1-based
  beatInBar: number; // 1-based
  chord: string;
  /** Next chord change, skipping repeats of the current chord; null at the end of the song. */
  next: { chord: string; inBeats: number } | null;
};

/** Where a beat falls in the song, or null before the start (count-in) and after the end. */
export function songPosition(c: CompiledSong, beat: number): SongPosition | null {
  if (beat < 0 || beat >= c.totalBeats) return null;
  const barIndex = barIndexAt(c, beat);
  const bar = c.bars[barIndex];
  const section = c.sections[bar.sectionIndex];
  const inBar = beat - bar.startBeat;
  // Chords in a bar split its beats evenly.
  const slot = Math.floor((inBar * bar.chords.length) / bar.beats);
  const chord = bar.chords[slot];

  let next: SongPosition['next'] = null;
  for (let b = barIndex, s = slot + 1; b < c.bars.length && !next; b++, s = 0) {
    const { chords, startBeat, beats } = c.bars[b];
    for (; s < chords.length; s++) {
      if (chords[s] !== chord) {
        next = { chord: chords[s], inBeats: startBeat + (s * beats) / chords.length - beat };
        break;
      }
    }
  }

  return {
    section,
    barIndex,
    barInSection: barIndex - section.startBar + 1,
    beatInBar: Math.floor(inBar) + 1,
    chord,
    next,
  };
}

/** A part's details for a section: the default with that section's overrides applied. */
export function partDetail(song: Song, part: Part, sectionId: string): PartDetail | null {
  const spec = song.parts[part];
  if (!spec) return null;
  return { ...spec.default, ...spec.sections?.[sectionId] };
}

/** Index of the current eighth note in a strum pattern, counted from the section start so longer patterns line up. */
export function strumIndex(strum: string, beatInSection: number, eighthsPerBeat = 2): number {
  const eighth = Math.floor(beatInSection * eighthsPerBeat + 1e-9);
  return ((eighth % strum.length) + strum.length) % strum.length;
}
