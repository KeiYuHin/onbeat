import { describe, expect, it } from 'vitest';
import { capoKey, chordText, parseChord, parseKey, type ChordStyle } from './chord';

const key = (name: string) => parseKey(name)!;
/** How `raw`, read in `keyName`, shows in `style`. */
const show = (raw: string, keyName: string, style: ChordStyle, capo = 0) =>
  chordText(raw, parseChord(raw, key(keyName)), key(keyName), style, capo);

describe('parseKey', () => {
  it('reads major keys and how they are spelled', () => {
    expect(parseKey('Ab')).toEqual({ name: 'Ab', tonic: 8, flats: true });
    expect(parseKey('F#')).toEqual({ name: 'F#', tonic: 6, flats: false });
    expect(parseKey('F')!.flats).toBe(true);
    expect(parseKey('B')!.flats).toBe(false);
    expect(parseKey('Am')).toBeNull();
    expect(parseKey('H')).toBeNull();
  });

  it('turns a capo into the key of the fingering', () => {
    expect(capoKey(key('B'), 2)).toMatchObject({ name: 'A', tonic: 9 });
    expect(capoKey(key('Ab'), 1)).toMatchObject({ name: 'G', tonic: 7 });
    expect(capoKey(key('C'), 3)).toMatchObject({ name: 'A', tonic: 9 });
    expect(capoKey(key('C'), 0)).toEqual(key('C'));
  });
});

describe('parseChord', () => {
  it('reads letters and scale degrees as the same intervals', () => {
    const b = key('B');
    expect(parseChord('D#m/A#', b)).toEqual({ root: 4, quality: 'm', bass: 11, degree: false });
    expect(parseChord('3m/7', b)).toEqual({ root: 4, quality: 'm', bass: 11, degree: true });
    expect(parseChord('Emaj7', b)).toEqual({ root: 5, quality: 'maj7', degree: false });
    expect(parseChord('4M7', b)).toEqual({ root: 5, quality: 'M7', degree: true });
  });

  it('reads the 白玉米谱 spellings from the sample charts', () => {
    const c = key('C');
    expect(parseChord('b7', c)).toMatchObject({ root: 10, quality: '' });
    expect(parseChord('b3m', c)).toMatchObject({ root: 3, quality: 'm' });
    expect(parseChord('37', c)).toMatchObject({ root: 4, quality: '7' }); // 3⁷ with the superscript squashed
    expect(parseChord('6m7/5', c)).toMatchObject({ root: 9, quality: 'm7', bass: 7 });
    expect(parseChord('7m7-4/#4', c)).toMatchObject({ root: 11, quality: 'm7-4', bass: 6 });
    expect(parseChord('5sus', c)).toMatchObject({ root: 7, quality: 'sus' });
    expect(parseChord('/#5', c)).toEqual({ root: null, quality: '', bass: 8, degree: true });
    expect(parseChord('/G#', c)).toEqual({ root: null, quality: '', bass: 8, degree: false });
  });

  it('keeps slashes that are not bass notes in the quality', () => {
    expect(parseChord('C6/9', key('C'))).toEqual({ root: 0, quality: '6/9', degree: false });
  });

  it('gives up on things that are not chords', () => {
    expect(parseChord('N.C.', key('C'))).toBeNull();
    expect(parseChord('8', key('C'))).toBeNull();
  });
});

describe('chordText', () => {
  it('shows chords already in the wanted style exactly as written', () => {
    expect(show('Emaj7', 'B', 'letter')).toBe('Emaj7');
    expect(show('4M7', 'B', 'degree')).toBe('4M7');
  });

  it('spells degrees as letters in the key, with flats in flat keys', () => {
    expect(show('5/7', 'Ab', 'letter')).toBe('Eb/G');
    expect(show('4M7', 'Ab', 'letter')).toBe('Dbmaj7');
    expect(show('b7', 'C', 'letter')).toBe('Bb');
    expect(show('3m/7', 'B', 'letter')).toBe('D#m/A#');
    expect(show('6m', 'F#', 'letter')).toBe('D#m');
    expect(show('b3', 'G', 'letter')).toBe('Bb');
    expect(show('#4m7', 'C', 'letter')).toBe('F#m7');
    expect(show('b6', 'E', 'letter')).toBe('C');
  });

  it('spells letters as degrees', () => {
    expect(show('D#m/A#', 'B', 'degree')).toBe('3m/7');
    expect(show('Emaj7', 'B', 'degree')).toBe('4M7');
    expect(show('Bb', 'C', 'degree')).toBe('b7');
  });

  it('shows the fingering under a capo', () => {
    expect(show('B', 'B', 'letter', 2)).toBe('A');
    expect(show('D#m/A#', 'B', 'letter', 2)).toBe('C#m/G#');
    expect(show('5/7', 'Ab', 'letter', 1)).toBe('D/F#');
    // Degrees don't change with a capo.
    expect(show('5/7', 'Ab', 'degree', 1)).toBe('5/7');
  });

  it('shows unreadable chords as written', () => {
    expect(show('N.C.', 'C', 'letter', 3)).toBe('N.C.');
  });
});
