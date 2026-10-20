// Jianpu (numbered notation) melody text, one string per bar, as on a 白玉米谱 chart. See SPEC.md, 目标谱面.
import { MELISMA, syllables } from './lyrics';

/**
 * One note of a bar. Durations are written in quarter notes (a plain number is a quarter, each underline
 * halves it) but kept here in the bar's beats, so 12/8 (four dotted-quarter beats) works like 4/4.
 */
export type Note = {
  /** 1–7, 0 for a rest, null for `-` (the note before it, even in the bar before, held one more quarter). */
  degree: number | null;
  accidental?: '#' | 'b';
  /** Octaves above (dots over the number) or below (dots under it). */
  octave: number;
  /** Lines under the number: 1 is an eighth, 2 a sixteenth. */
  underlines: number;
  dotted: boolean;
  /** An arc to the next note (`~`): a tie or a slur. Either way the next note is sung on the same syllable. */
  arc: boolean;
  /** Beats from the start of the bar. */
  start: number;
  beats: number;
};

const NOTE = /^([#b]?)([0-7])([',]*)([_=]*)(\.?)(~?)$/;
const HOLD = /^-(~?)$/;

/**
 * Parses one bar: notes separated by spaces, like `1'_ 1'= 1'=~ 7_ 6= 5= 5 -`. `quartersPerBeat` is 1 in
 * 4/4, 1.5 in compound meters, 0.5 in x/8 and 2 in x/2. Throws on anything it can't read; the bar's length
 * is checked separately (`melodyProblem`).
 */
export function parseMelody(text: string, quartersPerBeat = 1): Note[] {
  const notes: Note[] = [];
  let at = 0;
  for (const token of text.trim().split(/\s+/).filter(Boolean)) {
    let note: Omit<Note, 'start' | 'beats'>;
    let quarters: number;
    const hold = HOLD.exec(token);
    const m = NOTE.exec(token);
    if (hold) {
      // At the start of a bar, it holds the last note of the bar before.
      note = { degree: null, octave: 0, underlines: 0, dotted: false, arc: !!hold[1] };
      quarters = 1;
    } else if (m) {
      const [, acc, digit, octaves, lines, dot, arc] = m;
      const degree = Number(digit);
      const underlines = [...lines].reduce((n, c) => n + (c === '=' ? 2 : 1), 0);
      if (underlines > 2) throw new Error(`"${token}": at most two underlines (a sixteenth)`);
      if (degree === 0 && (acc || octaves || arc)) throw new Error(`"${token}": a rest takes no #, b, octave or ~`);
      const up = [...octaves].filter((c) => c === "'").length;
      if (up && up < octaves.length) throw new Error(`"${token}": mixes ' and ,`);
      note = {
        degree,
        ...(acc && { accidental: acc as '#' | 'b' }),
        octave: up || (octaves.length ? -octaves.length : 0),
        underlines,
        dotted: !!dot,
        arc: !!arc,
      };
      quarters = (dot ? 1.5 : 1) / 2 ** underlines;
    } else {
      throw new Error(`can't read "${token}" (a note is like #5'_. or 0 or -)`);
    }
    // Count in quarters so 12/8 thirds don't drift.
    notes.push({ ...note, start: at / quartersPerBeat, beats: quarters / quartersPerBeat });
    at += quarters;
  }
  return notes;
}

export const melodyBeats = (notes: Note[]) => notes.reduce((n, note) => n + note.beats, 0);

/** Why a parsed bar doesn't fill `beats`, or null when it does. */
export function melodyProblem(notes: Note[], beats: number, quartersPerBeat = 1): string | null {
  const total = melodyBeats(notes);
  if (Math.abs(total - beats) < 1e-9) return null;
  const q = (b: number) => +(b * quartersPerBeat).toFixed(3);
  return `adds up to ${q(total)} quarter notes, the bar has ${q(beats)}`;
}

/** Whether the note at `i` starts a new syllable: a pitch that no arc leads into. */
export function isSung(notes: Note[], i: number, tiedIn: boolean): boolean {
  if (!notes[i].degree) return false;
  return i === 0 ? !tiedIn : !notes[i - 1].arc;
}

export const sungCount = (notes: Note[], tiedIn: boolean) => notes.filter((_, i) => isSung(notes, i, tiedIn)).length;

/** Whether the bar's last note arcs over the barline into the next bar. */
export const arcsOut = (notes: Note[]) => notes.length > 0 && notes[notes.length - 1].arc;

/**
 * The bar's lyrics, one syllable per sung note in order (melisma marks become ''); null under rests, holds
 * and notes an arc leads into. Spare syllables are dropped and missing ones left null.
 */
export function alignSyllables(notes: Note[], tiedIn: boolean, lyrics: string): (string | null)[] {
  const words = syllables(lyrics);
  let next = 0;
  return notes.map((_, i) => {
    if (!isSung(notes, i, tiedIn) || next >= words.length) return null;
    const w = words[next++];
    return w === MELISMA ? '' : w;
  });
}

/**
 * How many underlines the note shares with the next one: notes within the same beat are joined, which is
 * what shows the beat on a jianpu chart.
 */
export function beamJoin(notes: Note[], i: number): number {
  const a = notes[i];
  const b = notes[i + 1];
  if (!b || !a.underlines || !b.underlines) return 0;
  return Math.floor(a.start + 1e-9) === Math.floor(b.start + 1e-9) ? Math.min(a.underlines, b.underlines) : 0;
}

/** Index of the note sounding `inBar` beats into the bar. */
export function noteAt(notes: Note[], inBar: number): number {
  let i = 0;
  while (i < notes.length - 1 && notes[i + 1].start <= inBar + 1e-9) i++;
  return i;
}
