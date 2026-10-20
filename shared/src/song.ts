// Song skeleton (sections, bars, chords) shared by all parts, plus per-part details. See SPEC.md.
import { PARTS, type Part } from './protocol';
import { everyBeats, type Barlines } from './timeline';
import { parseChord, parseKey, type Chord, type Key } from './chord';
import { arcsOut, melodyProblem, parseMelody, sungCount, type Note } from './jianpu';
import { syllables } from './lyrics';

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

/** Written in a bar's chords to hold the chord before it: ["1", "-", "-", "5/7"] is 3 beats + 1. */
export const HOLD = '-';

/** A bar as parsed: JSON bars are written as a chord array, or as an object when they need more. */
export type Bar = {
  /** Each entry takes an equal share of the bar; HOLD extends the chord before it. */
  chords: string[];
  /** Only for a bar in a different meter from the song (a 2/4 bar in a 4/4 song). */
  timeSignature?: TimeSignature;
  cues?: Cue[];
  /** Jianpu melody text (`jianpu.ts`), from the section's `melody`. */
  melody?: string;
  /** The melody's first note continues the last one of the bar before (an arc over the barline). */
  tiedIn?: boolean;
  /** Part lines like a chart's `Bs: 4. 4_ 5 -`, from the section's `lines`. */
  lines?: PartLine[];
};

/** A part's line in one bar, in jianpu text. `more` marks the last bar written: "carry on like this" (`~`). */
export type PartLine = { part: Part; text: string; more?: boolean };

/**
 * A note on a bar, like the 起鼓 or 钢琴 on a 白玉米谱 chart, for one part or (without `part`) everyone,
 * on every pass of the section or (with `pass`, 1-based) on just that one. JSON writes an everyone cue as
 * just its text.
 */
export type Cue = { part?: Part; text: string; pass?: number };

/**
 * Parsed sections always list their bars unrolled; `{ loop, times }` in the JSON is expanded by parseSong.
 * `lyrics` has one group per pass, each a string per bar of the loop (or of `bars` as written): every time the
 * section is played round once, wherever it is in the form, the next group is sung, and the last one repeats.
 * The JSON's `melody` and `lines` are per bar of the loop too; parseSong moves them onto the bars.
 */
export type Section = { label?: string; bars: Bar[]; lyrics?: string[][] };

/**
 * One entry of the playing order. A `key` changes key from this section on (转调), until the next change.
 * JSON writes plain entries as just the section id.
 */
export type FormEntry = { section: string; key?: string };

export type Song = {
  id: string;
  title: string;
  bpm: number;
  timeSignature: TimeSignature;
  /** The key chords are relative to: needed for scale-degree chords, and to show letters as degrees. */
  key?: string;
  sections: Record<string, Section>;
  form: FormEntry[];
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
    const ofLoop = looped ? ' of the loop' : '';
    /** Parses a bar's jianpu text and checks it fills the bar. */
    const notesOf = (bar: Bar, text: string, where: string): Note[] => {
      const q = quartersPerBeat(bar.timeSignature ?? ts);
      let notes: Note[] = [];
      try {
        notes = parseMelody(text, q);
      } catch (e) {
        fail(`${where}: ${(e as Error).message}`);
      }
      const problem = melodyProblem(notes, meter(bar.timeSignature ?? ts).beats, q);
      if (problem) fail(`${where} ${problem}`);
      return notes;
    };
    const melody = sec.melody;
    const melodies: (Note[] | null)[] = [];
    if (melody !== undefined) {
      if (!Array.isArray(melody) || melody.length !== written.length || !melody.every((m) => typeof m === 'string'))
        fail(`section "${id}" melody needs ${written.length} strings, one per bar${ofLoop}`);
      parsed.forEach((bar: Bar, i: number) => {
        const text = melody[i].trim();
        const notes = text ? notesOf(bar, text, `section "${id}" melody bar ${i + 1}`) : null;
        melodies.push(notes);
        if (!notes) return;
        bar.melody = text;
        // Only within the section as written: an arc out of its last bar is drawn but carries nothing over.
        if (melodies[i - 1] && arcsOut(melodies[i - 1]!)) bar.tiedIn = true;
      });
    }
    if (sec.lines !== undefined) {
      if (typeof sec.lines !== 'object' || sec.lines === null || Array.isArray(sec.lines))
        fail(`section "${id}" lines must be like { "bass": ["4. 4_ 5 -"] }`);
      for (const [part, line] of Object.entries<unknown>(sec.lines)) {
        if (!PARTS.includes(part as Part)) fail(`section "${id}" lines for unknown part "${part}"`);
        const ok = Array.isArray(line) && line.length > 0 && line.length <= written.length && line.every((l) => typeof l === 'string');
        if (!ok) fail(`section "${id}" lines.${part} needs 1 to ${written.length} strings, one per bar${ofLoop}`);
        (line as string[]).forEach((l, i, all) => {
          const text = l.trim();
          if (!text) return;
          notesOf(parsed[i], text, `section "${id}" lines.${part} bar ${i + 1}`);
          const more = i === all.length - 1 && all.length < written.length;
          (parsed[i].lines ??= []).push({ part: part as Part, text, ...(more && { more }) });
        });
      }
    }
    const bars: Bar[] = looped ? Array.from({ length: sec.times }, () => parsed).flat() : parsed;
    const lyrics = sec.lyrics;
    if (lyrics !== undefined) {
      const ok = Array.isArray(lyrics) && lyrics.length > 0 && lyrics.every((g: unknown) => Array.isArray(g));
      if (!ok) fail(`section "${id}" lyrics must be a list of passes, each a list of one string per bar`);
      lyrics.forEach((group: unknown[], p: number) => {
        if (group.length !== written.length || !group.every((l) => typeof l === 'string'))
          fail(`section "${id}" lyrics pass ${p + 1} needs ${written.length} strings, one per bar${ofLoop}`);
        group.forEach((text, i) => {
          const notes = melodies[i];
          if (!notes || !(text as string).trim()) return;
          const words = syllables(text as string).length;
          const sung = sungCount(notes, !!parsed[i].tiedIn);
          if (words !== sung)
            fail(
              `section "${id}" lyrics pass ${p + 1} bar ${i + 1} has ${words} syllables for ${sung} sung notes ` +
                '(write _ for a syllable held over one more note, ~ for an arc)',
            );
        });
      });
    }
    sections[id] = {
      ...(typeof sec.label === 'string' && { label: sec.label }),
      bars: structuredClone(bars),
      ...(lyrics && { lyrics: structuredClone(lyrics) }),
    };
  }
  if (s.key !== undefined && !(typeof s.key === 'string' && parseKey(s.key)))
    fail('key must be a major key like "C", "Ab" or "F#"');
  if (!Array.isArray(s.form) || s.form.length === 0) fail('form must list at least one section');
  const form: FormEntry[] = s.form.map((entry: any, i: number) => {
    const e = typeof entry === 'string' ? { section: entry } : entry;
    if (typeof e?.section !== 'string') fail(`form entry ${i + 1} must be a section id or { "section", "key" }`);
    if (!(e.section in sections)) fail(`form refers to unknown section "${e.section}"`);
    if (e.key !== undefined && !(typeof e.key === 'string' && parseKey(e.key)))
      fail(`form entry ${i + 1} key must be a major key like "G"`);
    if (e.key !== undefined && s.key === undefined) fail('a key change needs the song\'s own "key"');
    return { section: e.section, ...(e.key !== undefined && { key: e.key }) };
  });
  if (s.key === undefined) {
    for (const [id, sec] of Object.entries(sections)) {
      const degree = sec.bars.flatMap((b) => b.chords).find((c) => parseChord(c, C_MAJOR)?.degree);
      if (degree) fail(`section "${id}" has scale-degree chord "${degree}", which needs the song's "key"`);
    }
  }
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
  return { ...structuredClone(s), sections, form } as Song;
}

/** Quarter notes per beat, the unit jianpu durations are written in: 1 in 4/4, 1.5 in 12/8, 0.5 in 3/8. */
const quartersPerBeat = ([n, d]: TimeSignature) => (n * 4) / d / meter([n, d]).beats;

const isTimeSignature =(ts: unknown): ts is TimeSignature =>
  Array.isArray(ts) && ts.length === 2 && Number.isInteger(ts[0]) && ts[0] > 0 && [2, 4, 8].includes(ts[1]);

/**
 * `["C", "G/B"]`, or `{ "chords": [...], "timeSignature": [2, 4], "cues": ["rit.", { "part": "drums", "text": "起鼓" }] }`.
 * A cue `{ "text", "pass": 2 }` shows on the section's 2nd pass only.
 */
function parseBar(bar: any, fail: (msg: string) => never): Bar {
  const written = Array.isArray(bar) ? { chords: bar } : bar;
  if (typeof written !== 'object' || written === null) fail('must be an array of chord names or an object');
  const { chords, timeSignature, cues } = written;
  if (!Array.isArray(chords) || chords.length === 0 || !chords.every((c) => typeof c === 'string' && c))
    fail('needs a non-empty array of chord names');
  if (chords[0] === HOLD) fail(`can't start with "${HOLD}": it holds the chord before it in the same bar`);
  if (timeSignature !== undefined && !isTimeSignature(timeSignature)) fail('timeSignature must be like [2, 4]');
  if (cues !== undefined && !Array.isArray(cues)) fail('cues must be an array');
  const parsedCues = (cues ?? []).map((cue: any): Cue => {
    const c = typeof cue === 'string' ? { text: cue } : cue;
    if (typeof c?.text !== 'string' || !c.text) fail('cues must be text or { "part", "text" }');
    if (c.part !== undefined && !PARTS.includes(c.part)) fail(`cue for unknown part "${c.part}"`);
    if (c.pass !== undefined && !(Number.isInteger(c.pass) && c.pass >= 1)) fail("a cue's pass must be 1 or more");
    return { ...(c.part && { part: c.part }), text: c.text, ...(c.pass && { pass: c.pass }) };
  });
  return { chords, ...(timeSignature && { timeSignature }), ...(parsedCues.length && { cues: parsedCues }) };
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

/**
 * Smallest number of bars that repeats to fill the section (8 bars of C Am F G C Am F G → 4). Bars with the
 * same chords but a different melody or part line are different music.
 */
export function repeatPeriod(bars: Bar[]): number {
  const same = (a: Bar, b: Bar) =>
    a.chords.length === b.chords.length &&
    a.chords.every((c, i) => c === b.chords[i]) &&
    String(a.timeSignature) === String(b.timeSignature) &&
    a.melody === b.melody &&
    JSON.stringify(a.lines) === JSON.stringify(b.lines);
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

/** A chord and the beats it lasts within its bar. */
export type ChordSlot = {
  /** As written (for a held chord, the chord it holds). */
  name: string;
  /** Null when the name isn't a chord we can read ("N.C."); it is still shown. */
  chord: Chord | null;
  /** Beats from the start of the bar. */
  start: number;
  beats: number;
};

export type BarSpan = {
  chords: ChordSlot[];
  sectionIndex: number;
  startBeat: number;
  beats: number;
  meter: Meter;
  /** The key in effect, after any key change; C when the song has none. */
  key: Key;
  /** This pass's cues: those without a `pass`, and those for this one. */
  cues: Cue[];
  /** What is sung in this bar on this pass; empty when nothing is. */
  lyrics: string;
  /** Null when the bar has no melody written. */
  melody: Note[] | null;
  /** The melody's first note is the last one of the bar before, carried over the barline by an arc. */
  tiedIn: boolean;
  lines: { part: Part; notes: Note[]; more: boolean }[];
};

const C_MAJOR = parseKey('C')!;

/**
 * The bar's chords with HOLDs merged into the chord before them. A bass-only change ("/#5") takes the
 * chord it follows, even from an earlier bar.
 */
function chordSlots(chords: string[], beats: number, key: Key, before: Chord | null): ChordSlot[] {
  const share = beats / chords.length;
  const slots: ChordSlot[] = [];
  let prev = before;
  chords.forEach((name, i) => {
    if (name === HOLD) {
      slots[slots.length - 1].beats += share;
      return;
    }
    let chord = parseChord(name, key);
    if (chord?.root === null) chord = prev && prev.root !== null ? { ...prev, bass: chord.bass } : null;
    if (chord) prev = chord;
    slots.push({ name, chord, start: i * share, beats: share });
  });
  return slots;
}

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
  for (const { section: id } of song.form) totals.set(id, (totals.get(id) ?? 0) + 1);
  const seen = new Map<string, number>();
  // Lyric passes each section has used up so far.
  const sung = new Map<string, number>();

  const sections: SectionSpan[] = [];
  const bars: BarSpan[] = [];
  let beat = 0;
  let key = (song.key && parseKey(song.key)) || C_MAJOR;
  let lastChord: Chord | null = null;
  song.form.forEach(({ section: id, key: change }, sectionIndex) => {
    if (change) key = parseKey(change)!;
    const n = (seen.get(id) ?? 0) + 1;
    seen.set(id, n);
    const { bars: written, lyrics } = song.sections[id];
    const loopBars = repeatPeriod(written);
    const times = written.length / loopBars + (extraPasses[sectionIndex] ?? 0);
    const name = sectionName(song, id);
    const startBeat = beat;
    const startBar = bars.length;
    for (let i = 0; i < loopBars * times; i++) {
      // Extra passes replay the loop; bars as written keep their own details.
      const bar = written[i < written.length ? i : i % loopBars];
      const m = bar.timeSignature ? meter(bar.timeSignature) : songMeter;
      const chords = chordSlots(bar.chords, m.beats, key, lastChord);
      for (const slot of chords) lastChord = slot.chord ?? lastChord;
      let words = '';
      if (lyrics) {
        const group = lyrics[0].length;
        const pass = (sung.get(id) ?? 0) + Math.floor(i / group);
        words = lyrics[Math.min(pass, lyrics.length - 1)][i % group];
      }
      const pass = Math.floor(i / loopBars) + 1;
      const cues = (bar.cues ?? []).filter((c) => !c.pass || c.pass === pass);
      const q = quartersPerBeat(bar.timeSignature ?? song.timeSignature);
      bars.push({
        chords,
        sectionIndex,
        startBeat: beat,
        beats: m.beats,
        meter: m,
        key,
        cues,
        lyrics: words,
        melody: bar.melody ? parseMelody(bar.melody, q) : null,
        tiedIn: !!bar.tiedIn,
        lines: (bar.lines ?? []).map((l) => ({ part: l.part, notes: parseMelody(l.text, q), more: !!l.more })),
      });
      beat += m.beats;
    }
    if (lyrics) sung.set(id, (sung.get(id) ?? 0) + Math.ceil((loopBars * times) / lyrics[0].length));
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
  chord: ChordSlot;
  /** The bar's key, for showing chords. */
  key: Key;
  /** Next chord change, skipping repeats of the current chord; null at the end of the song. */
  next: { chord: ChordSlot; key: Key; inBeats: number } | null;
};

/** Where a beat falls in the song, or null before the start (count-in) and after the end. */
export function songPosition(c: CompiledSong, beat: number): SongPosition | null {
  if (beat < 0 || beat >= c.totalBeats) return null;
  const barIndex = barIndexAt(c, beat);
  const bar = c.bars[barIndex];
  const section = c.sections[bar.sectionIndex];
  const inBar = beat - bar.startBeat;
  const slot = slotAt(bar, inBar);
  const chord = bar.chords[slot];

  let next: SongPosition['next'] = null;
  for (let b = barIndex, s = slot + 1; b < c.bars.length && !next; b++, s = 0) {
    const { chords, startBeat, key } = c.bars[b];
    for (; s < chords.length; s++) {
      if (chords[s].name !== chord.name || key !== bar.key) {
        next = { chord: chords[s], key, inBeats: startBeat + chords[s].start - beat };
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
    key: bar.key,
    next,
  };
}

/** Index of the chord slot playing `inBar` beats into the bar. */
export function slotAt(bar: BarSpan, inBar: number): number {
  let i = 0;
  while (i < bar.chords.length - 1 && bar.chords[i + 1].start <= inBar + 1e-9) i++;
  return i;
}

/** The bar's cues for one part: its own and everyone's. */
export const cuesFor = (bar: BarSpan, part: Part) => bar.cues.filter((c) => !c.part || c.part === part);

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
