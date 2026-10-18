// Chords relative to the key, so a chart written in scale degrees (白玉米谱: "1 5/7 6m") and one written in
// letters ("C G/B Am") are the same thing, shown either way, in any key, with or without a capo.

/** Pitch class 0..11 (C = 0). */
type PitchClass = number;

export type Key = {
  /** As written in the song, e.g. "Ab", "F#". */
  name: string;
  tonic: PitchClass;
  /** Spell letters with flats (Bb, Eb) rather than sharps. */
  flats: boolean;
};

const NATURALS: Record<string, PitchClass> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
/** Major keys written with flats: F, Bb, Eb, Ab, Db. */
const FLAT_TONICS = new Set([5, 10, 3, 8, 1]);
/** Semitones above the tonic for scale degrees 1..7. */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
/** How each interval is written as a degree. */
const DEGREE_NAMES = ['1', 'b2', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'];
/** Notes outside the scale are spelled the way their degree is: b7 in C is Bb, #4 is F#. */
const OUT_OF_SCALE: Record<number, boolean> = { 1: true, 3: true, 8: true, 10: true, 6: false };

const mod12 = (n: number) => ((n % 12) + 12) % 12;
const accidental = (a: string) => (a === '#' ? 1 : a === 'b' ? -1 : 0);

/** "Ab", "F#", "C" → Key; null for anything else (minor keys are written by their relative major, like 1=C). */
export function parseKey(name: string): Key | null {
  const m = /^([A-G])([#b]?)$/.exec(name);
  if (!m) return null;
  const tonic = mod12(NATURALS[m[1]] + accidental(m[2]));
  return { name, tonic, flats: m[2] === 'b' || (m[2] === '' && tonic === 5) };
}

/** The key a capo turns `key` into for the fingering: capo 2 in B is played as A. */
export function capoKey(key: Key, capo: number): Key {
  if (!capo) return key;
  const tonic = mod12(key.tonic - capo);
  const flats = FLAT_TONICS.has(tonic);
  return { name: (flats ? FLAT_NAMES : SHARP_NAMES)[tonic], tonic, flats };
}

/**
 * A chord as semitones above the key's 1. `root` is null for a bass-only change ("/#5"), which keeps the
 * chord before it; compileSong fills those in.
 */
export type Chord = {
  root: number | null;
  /** Everything after the root, as written: "m7", "M7", "sus", "7". */
  quality: string;
  bass?: number;
  /** Written as a scale degree rather than a letter. */
  degree: boolean;
};

const LETTER = /^([A-G])([#b]?)(.*?)(?:\/([A-G])([#b]?))?$/;
const DEGREE = /^([#b]?)([1-7])(.*?)(?:\/([#b]?)([1-7]))?$/;
const BASS_ONLY_LETTER = /^\/([A-G])([#b]?)$/;
const BASS_ONLY_DEGREE = /^\/([#b]?)([1-7])$/;

const letterInterval = (key: Key, letter: string, acc: string) => mod12(NATURALS[letter] + accidental(acc) - key.tonic);
const degreeInterval = (acc: string, degree: string) => mod12(MAJOR_SCALE[Number(degree) - 1] + accidental(acc));

/**
 * Reads a chord written as letters ("D#m/A#") or scale degrees ("3m/7", "4M7", "b7", "37" = 3⁷), relative
 * to `key`. Null for anything else ("N.C.", "x"), which is shown as written.
 */
export function parseChord(raw: string, key: Key): Chord | null {
  let m = BASS_ONLY_DEGREE.exec(raw);
  if (m) return { root: null, quality: '', bass: degreeInterval(m[1], m[2]), degree: true };
  m = BASS_ONLY_LETTER.exec(raw);
  if (m) return { root: null, quality: '', bass: letterInterval(key, m[1], m[2]), degree: false };
  m = DEGREE.exec(raw);
  if (m)
    return {
      root: degreeInterval(m[1], m[2]),
      quality: m[3],
      ...(m[5] && { bass: degreeInterval(m[4], m[5]) }),
      degree: true,
    };
  m = LETTER.exec(raw);
  if (m)
    return {
      root: letterInterval(key, m[1], m[2]),
      quality: m[3],
      ...(m[4] && { bass: letterInterval(key, m[4], m[5]) }),
      degree: false,
    };
  return null;
}

/** Qualities written differently in the two styles: 白玉米谱 writes 4M7 where a letter chart writes Fmaj7. */
const LETTER_QUALITY: Record<string, string> = { M7: 'maj7', M9: 'maj9' };
const DEGREE_QUALITY = Object.fromEntries(Object.entries(LETTER_QUALITY).map(([d, l]) => [l, d]));

export type ChordStyle = 'letter' | 'degree';

/**
 * How a chord reads in one style. What is already in that style (and not moved by a capo) is shown exactly
 * as written; the rest is spelled from the key. Unreadable chords are always shown as written.
 */
export function chordText(raw: string, chord: Chord | null, key: Key, style: ChordStyle, capo = 0): string {
  if (!chord || chord.root === null) return raw;
  if (style === 'degree') {
    if (chord.degree) return raw;
    const bass = chord.bass === undefined ? '' : `/${DEGREE_NAMES[chord.bass]}`;
    return DEGREE_NAMES[chord.root] + (DEGREE_QUALITY[chord.quality] ?? chord.quality) + bass;
  }
  if (!chord.degree && !capo) return raw;
  const shape = capoKey(key, capo);
  const letter = (interval: number) =>
    ((OUT_OF_SCALE[interval] ?? shape.flats) ? FLAT_NAMES : SHARP_NAMES)[mod12(shape.tonic + interval)];
  const bass = chord.bass === undefined ? '' : `/${letter(chord.bass)}`;
  return letter(chord.root) + (LETTER_QUALITY[chord.quality] ?? chord.quality) + bass;
}

/** Sounding pitch class of the chord's lowest note: the slash bass, else the root. Null if it has neither. */
export function bassPitch(chord: Chord | null, key: Key): PitchClass | null {
  const interval = chord?.bass ?? chord?.root;
  return interval === undefined || interval === null ? null : mod12(key.tonic + interval);
}
