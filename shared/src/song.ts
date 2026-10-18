// Song skeleton (sections, bars, chords) shared by all parts, plus per-part details. See SPEC.md.
import { PARTS, type Part } from './protocol';

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

/** Parsed sections always list their bars unrolled; `{ loop, times }` in the JSON is expanded by parseSong. */
export type Section = { label?: string; bars: string[][] };

export type Song = {
  id: string;
  title: string;
  bpm: number;
  timeSignature: [number, number];
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
  if (!Array.isArray(ts) || ts.length !== 2 || !ts.every((n: unknown) => Number.isInteger(n) && (n as number) > 0))
    fail('timeSignature must be like [4, 4]');
  if (typeof s.sections !== 'object' || s.sections === null) fail('missing sections');
  const sections: Record<string, Section> = {};
  for (const [id, sec] of Object.entries<any>(s.sections)) {
    const looped = sec?.loop !== undefined;
    const written = looped ? sec.loop : sec?.bars;
    if (!Array.isArray(written) || written.length === 0) fail(`section "${id}" has no bars`);
    if (looped && !(Number.isInteger(sec.times) && sec.times >= 1)) fail(`section "${id}" loop needs "times" (1 or more)`);
    written.forEach((bar: unknown, i: number) => {
      if (!Array.isArray(bar) || bar.length === 0 || !bar.every((c) => typeof c === 'string' && c))
        fail(`section "${id}" bar ${i + 1} must be a non-empty array of chord names`);
    });
    const bars: string[][] = looped ? Array.from({ length: sec.times }, () => written).flat() : written;
    sections[id] = { ...(typeof sec.label === 'string' && { label: sec.label }), bars: structuredClone(bars) };
  }
  if (!Array.isArray(s.form) || s.form.length === 0) fail('form must list at least one section');
  for (const id of s.form) if (!(id in sections)) fail(`form refers to unknown section "${id}"`);
  if (typeof s.parts !== 'object' || s.parts === null) fail('missing parts');
  const steps = ts[0] * 4;
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

/** Drum patterns changed in a room but not yet saved to the song file. */
export type DrumEdits = { default?: DrumPattern; sections?: Record<string, DrumPattern> };

export const hasDrumEdits = (edits: DrumEdits | null | undefined) =>
  !!edits && (!!edits.default || Object.keys(edits.sections ?? {}).length > 0);

/** The song with a room's drum edits applied to its drums part. */
export function applyDrumEdits(song: Song, edits: DrumEdits | null | undefined): Song {
  if (!edits || !hasDrumEdits(edits)) return song;
  const drums = song.parts.drums ?? { label: '鼓', default: {} };
  const sections = { ...drums.sections };
  for (const [id, pattern] of Object.entries(edits.sections ?? {})) sections[id] = { ...sections[id], pattern };
  return {
    ...song,
    parts: {
      ...song.parts,
      drums: {
        ...drums,
        default: edits.default ? { ...drums.default, pattern: edits.default } : drums.default,
        sections,
      },
    },
  };
}

/** Smallest number of bars that repeats to fill the section (8 bars of C Am F G C Am F G → 4). */
export function repeatPeriod(bars: string[][]): number {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((c, i) => c === b[i]);
  for (let p = 1; p < bars.length; p++) {
    if (bars.length % p === 0 && bars.every((bar, i) => same(bar, bars[i % p]))) return p;
  }
  return bars.length;
}

export type SectionSpan = {
  id: string;
  label: string; // e.g. "副歌 2"; numbered only when the section occurs more than once
  startBeat: number;
  startBar: number; // 0-based index into CompiledSong.bars
  barCount: number;
  /** The section is `loopBars` bars played `times` times (times is 1 when nothing repeats). */
  loopBars: number;
  times: number;
};

export type BarSpan = { chords: string[]; sectionIndex: number; startBeat: number };

/** The song unrolled along the form into a flat, beat-indexed timeline. */
export type CompiledSong = {
  song: Song;
  beatsPerBar: number;
  sections: SectionSpan[];
  bars: BarSpan[];
  totalBeats: number;
};

/** Extra passes added live ("再绕一遍"), keyed by the section's index in the form. */
export type ExtraPasses = Record<number, number>;

export function compileSong(song: Song, extraPasses: ExtraPasses = {}): CompiledSong {
  const beatsPerBar = song.timeSignature[0];
  const totals = new Map<string, number>();
  for (const id of song.form) totals.set(id, (totals.get(id) ?? 0) + 1);
  const seen = new Map<string, number>();

  const sections: SectionSpan[] = [];
  const bars: BarSpan[] = [];
  song.form.forEach((id, sectionIndex) => {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const written = song.sections[id].bars;
    const loopBars = repeatPeriod(written);
    const times = written.length / loopBars + (extraPasses[sectionIndex] ?? 0);
    const name = sectionName(song, id);
    sections.push({
      id,
      label: totals.get(id)! > 1 ? `${name} ${n}` : name,
      startBeat: bars.length * beatsPerBar,
      startBar: bars.length,
      barCount: loopBars * times,
      loopBars,
      times,
    });
    for (let i = 0; i < loopBars * times; i++)
      bars.push({ chords: written[i % loopBars], sectionIndex, startBeat: bars.length * beatsPerBar });
  });
  return { song, beatsPerBar, sections, bars, totalBeats: bars.length * beatsPerBar };
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
  const barIndex = Math.floor(beat / c.beatsPerBar);
  const bar = c.bars[barIndex];
  const section = c.sections[bar.sectionIndex];
  const inBar = beat - bar.startBeat;
  // Chords in a bar split its beats evenly.
  const slot = Math.floor((inBar * bar.chords.length) / c.beatsPerBar);
  const chord = bar.chords[slot];

  let next: SongPosition['next'] = null;
  for (let b = barIndex, s = slot + 1; b < c.bars.length && !next; b++, s = 0) {
    const chords = c.bars[b].chords;
    for (; s < chords.length; s++) {
      if (chords[s] !== chord) {
        const startBeat = c.bars[b].startBeat + (s * c.beatsPerBar) / chords.length;
        next = { chord: chords[s], inBeats: startBeat - beat };
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
export function strumIndex(strum: string, beatInSection: number): number {
  const eighth = Math.floor(beatInSection * 2);
  return ((eighth % strum.length) + strum.length) % strum.length;
}
