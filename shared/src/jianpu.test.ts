import { describe, expect, it } from 'vitest';
import { alignSyllables, arcsOut, beamJoin, melodyProblem, noteAt, parseMelody, sungCount } from './jianpu';

const shape = (text: string, q = 1) => parseMelody(text, q).map((n) => [n.start, n.beats]);

describe('parseMelody', () => {
  it('reads pitch, accidentals, octaves, underlines, dots and arcs', () => {
    const [a, b, c] = parseMelody("#5'_. b3,,= 1~");
    expect(a).toMatchObject({ degree: 5, accidental: '#', octave: 1, underlines: 1, dotted: true, arc: false });
    expect(b).toMatchObject({ degree: 3, accidental: 'b', octave: -2, underlines: 2, dotted: false });
    expect(c).toMatchObject({ degree: 1, octave: 0, underlines: 0, arc: true });
  });

  it('times notes in quarters: _ halves, = quarters, . adds half, - holds a quarter', () => {
    expect(shape('1_ 2= 3= 5_. 6= 0 -')).toEqual([
      [0, 0.5],
      [0.5, 0.25],
      [0.75, 0.25],
      [1, 0.75],
      [1.75, 0.25],
      [2, 1],
      [3, 1],
    ]);
    expect(parseMelody('1__')[0].underlines).toBe(2);
  });

  it('counts in the bar’s beats: a dotted quarter is one beat of 12/8', () => {
    expect(shape('1. 2_ 3_ 4_', 1.5)).toEqual([
      [0, 1],
      [1, 1 / 3],
      [4 / 3, 1 / 3],
      [5 / 3, 1 / 3],
    ]);
  });

  it.each([
    ['8', /can't read "8"/],
    ['1___', /two underlines/],
    ["0'", /rest/],
    ['0~', /rest/],
    ["1',", /mixes/],
  ])('rejects %s', (text, error) => {
    expect(() => parseMelody(text)).toThrow(error);
  });
});

describe('melodyProblem', () => {
  it('checks the bar is filled exactly', () => {
    expect(melodyProblem(parseMelody('1 2 3 4'), 4)).toBeNull();
    expect(melodyProblem(parseMelody('1 2 3'), 4)).toMatch(/3 quarter notes, the bar has 4/);
    expect(melodyProblem(parseMelody('1. 2_ 3 4', 1.5), 4, 1.5)).toMatch(/4 quarter notes, the bar has 6/);
  });
});

describe('syllables on notes', () => {
  it('sings every pitch except rests, holds and notes an arc leads into', () => {
    const notes = parseMelody('5 3_ 2=~ 1= 0 1');
    expect(sungCount(notes, false)).toBe(4);
    expect(sungCount(parseMelody('1 2 3 4'), true)).toBe(3);
    expect(alignSyllables(notes, false, '爱自_由')).toEqual(['爱', '自', '', null, null, '由']);
  });

  it('gives a melisma mark its note but nothing to show', () => {
    expect(alignSyllables(parseMelody('1 2 3 4'), false, 'oh_ no-o')).toEqual(['oh', '', 'no', 'o']);
  });

  it('knows when a bar arcs over its barline', () => {
    expect(arcsOut(parseMelody('1 2 3 -~'))).toBe(true);
    expect(arcsOut(parseMelody('1~ 2 3 4'))).toBe(false);
  });
});

describe('beamJoin', () => {
  it('joins underlines within a beat, as many as both notes have', () => {
    const notes = parseMelody('1_ 2= 3= 4_ 5_ 6= 7_.');
    expect(notes.map((_, i) => beamJoin(notes, i))).toEqual([1, 2, 0, 1, 0, 1, 0]);
  });

  it('never joins a note without underlines', () => {
    const notes = parseMelody('1. 2_ 3 4');
    expect(notes.map((_, i) => beamJoin(notes, i))).toEqual([0, 0, 0, 0]);
  });
});

describe('noteAt', () => {
  it('finds the note sounding at a point in the bar', () => {
    const notes = parseMelody('1_ 2_ 3 4 -');
    expect([0, 0.49, 0.5, 1.2, 2, 3.9].map((b) => noteAt(notes, b))).toEqual([0, 0, 1, 2, 3, 4]);
  });
});
