// Song skeleton (sections, bars, chords) shared by all parts, plus per-part details. See SPEC.md.
import { PARTS, type Part } from './protocol';

/** M2.5 drum machine: 16-step strings per instrument, e.g. { kick: 'x...x...x...x...' }. */
export type DrumPattern = Record<string, string>;

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

/** Validates hand-written song JSON; throws with a message that points at the problem. */
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
  for (const [id, sec] of Object.entries<any>(s.sections)) {
    if (!Array.isArray(sec?.bars) || sec.bars.length === 0) fail(`section "${id}" has no bars`);
    sec.bars.forEach((bar: unknown, i: number) => {
      if (!Array.isArray(bar) || bar.length === 0 || !bar.every((c) => typeof c === 'string' && c))
        fail(`section "${id}" bar ${i + 1} must be a non-empty array of chord names`);
    });
  }
  if (!Array.isArray(s.form) || s.form.length === 0) fail('form must list at least one section');
  for (const id of s.form) if (!(id in s.sections)) fail(`form refers to unknown section "${id}"`);
  if (typeof s.parts !== 'object' || s.parts === null) fail('missing parts');
  for (const [part, spec] of Object.entries<any>(s.parts)) {
    if (!PARTS.includes(part as Part)) fail(`unknown part "${part}" (expected one of ${PARTS.join(', ')})`);
    if (typeof spec?.default !== 'object' || spec.default === null) fail(`part "${part}" needs a default`);
    if (spec.default.strum !== undefined && !/^[DU-]+$/.test(spec.default.strum))
      fail(`part "${part}" strum may only use D, U and -`);
  }
  return s as Song;
}

export type SectionSpan = {
  id: string;
  label: string; // e.g. "副歌 2"; numbered only when the section occurs more than once
  startBeat: number;
  startBar: number; // 0-based index into CompiledSong.bars
  barCount: number;
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

export function compileSong(song: Song): CompiledSong {
  const beatsPerBar = song.timeSignature[0];
  const totals = new Map<string, number>();
  for (const id of song.form) totals.set(id, (totals.get(id) ?? 0) + 1);
  const seen = new Map<string, number>();

  const sections: SectionSpan[] = [];
  const bars: BarSpan[] = [];
  for (const id of song.form) {
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const def = song.sections[id];
    const name = def.label ?? SECTION_LABELS[id] ?? id;
    const sectionIndex = sections.length;
    sections.push({
      id,
      label: totals.get(id)! > 1 ? `${name} ${n}` : name,
      startBeat: bars.length * beatsPerBar,
      startBar: bars.length,
      barCount: def.bars.length,
    });
    for (const chords of def.bars) bars.push({ chords, sectionIndex, startBeat: bars.length * beatsPerBar });
  }
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
