import { describe, expect, it } from 'vitest';
import { hasMelody, jianpuSheet, type JpBar } from './jianpuSheet';
import { compileSong, parseSong } from './song';

const song = parseSong({
  id: 'jianpu',
  title: 'test',
  bpm: 80,
  timeSignature: [4, 4],
  key: 'C',
  sections: {
    verse: {
      loop: [
        { chords: ['4', '-', '5', '-'], cues: [{ text: '只有钢琴', pass: 2 }] },
        ['1'],
      ],
      times: 2,
      melody: ['1_ 2_ 3 4_ 5_ 6~', '6 5 0 -'],
      lyrics: [['我们 一起唱歌', '啊'], ['第二遍 的词呀', '嗯']],
      lines: { bass: ['4. 4_ 5 -'] },
    },
    outro: { bars: [['1', '5'], ['1']], lyrics: [['再见', '']] },
  },
  form: ['verse', 'outro'],
  parts: {},
});
const compiled = compileSong(song);
const sheet = jianpuSheet(compiled);

/** "[4]1:我 2:们 3:一 ..." for a bar's columns. */
const text = (bar: JpBar) =>
  bar.columns
    .map((c) => `${c.chords.map((ch) => `[${ch.slot.name}]`).join('')}${c.note ? (c.note.degree ?? '-') : ''}${c.syllable ? `:${c.syllable}` : ''}`)
    .join(' ');

describe('jianpuSheet', () => {
  it('puts each chord over the note it starts on and each syllable under a sung note', () => {
    const [verse] = sheet;
    expect(text(verse.passes[0][0])).toBe('[4]1:我 2:们 3:一 [5]4:起 5:唱 6:歌');
    // The arc carries the 6 over the barline: the next bar's first note isn't sung again.
    expect(text(verse.passes[0][1])).toBe('[1]6 5:啊 0 -');
    expect(text(verse.passes[1][0])).toBe('[4]1:第 2:二 3:遍 [5]4:的 5:词 6:呀');
  });

  it('shows every chord of a bar without melody, and its words as a line', () => {
    const outro = sheet[1].passes[0];
    expect(outro[0].columns.map((c) => c.chords[0].slot.name)).toEqual(['1', '5']);
    expect(outro[0].words).toBe('再见');
    expect(outro[1].words).toBeUndefined();
  });

  it('marks repeats, pass-only cues and part lines', () => {
    const [p1, p2] = sheet[0].passes;
    expect([p1[0].repeatStart, p1[0].repeatEnd, p1[1].repeatEnd]).toEqual([true, false, true]);
    expect(sheet[1].passes[0][0].repeatStart).toBe(false);
    expect(p1[0].cues).toEqual([]);
    expect(p2[0].cues).toEqual([{ text: '只有钢琴', pass: 2 }]);
    expect(p1[0].lines).toMatchObject([{ part: 'bass', more: true, label: true }]);
    expect(p1[1].lines).toEqual([]);
  });

  it('leaves the words out when lyrics are off', () => {
    expect(text(jianpuSheet(compiled, false)[0].passes[0][0])).toBe('[4]1 2 3 [5]4 5 6');
  });

  it('tells songs with a melody from those without', () => {
    expect(hasMelody(compiled)).toBe(true);
    const plain = parseSong({ ...song, sections: { outro: song.sections.outro }, form: ['outro'] });
    expect(hasMelody(compileSong(plain))).toBe(false);
  });
});

describe('melody in parseSong', () => {
  const base = {
    id: 'm',
    title: 'test',
    bpm: 80,
    timeSignature: [4, 4],
    sections: { a: { bars: [['C'], ['G']] } },
    form: ['a'],
    parts: {},
  };
  const withA = (a: object) => ({ ...base, sections: { a: { bars: [['C'], ['G']], ...a } } });

  it.each([
    [{ melody: ['1 2 3 4'] }, /melody needs 2 strings/],
    [{ melody: ['1 2 3', ''] }, /melody bar 1 adds up to 3 quarter notes/],
    [{ melody: ['1 2 3 9', ''] }, /melody bar 1: can't read "9"/],
    [{ melody: ['1 2 3 4', ''], lyrics: [['一二三', '']] }, /bar 1 has 3 syllables for 4 sung notes/],
    [{ melody: ['1 2 3 4~', '4 5 6 7'], lyrics: [['一二三四', '五六七八']] }, /bar 2 has 4 syllables for 3 sung notes/],
    [{ lines: { banjo: ['1 2 3 4'] } }, /unknown part "banjo"/],
    [{ lines: { bass: ['1 2 3 4', '1', '1'] } }, /lines.bass needs 1 to 2 strings/],
    [{ lines: { bass: ['1 2 3'] } }, /lines.bass bar 1 adds up to 3/],
  ])('rejects %j', (a, error) => {
    expect(() => parseSong(withA(a))).toThrow(error);
  });

  it('accepts a melody with an arc over the barline and a held syllable', () => {
    const s = parseSong(withA({ melody: ['1 2 3 4~', '4 5 6 7'], lyrics: [['一二三四', '五六_']] }));
    expect(s.sections.a.bars[1]).toMatchObject({ melody: '4 5 6 7', tiedIn: true });
  });

  it('does not fold bars with the same chords but a different melody into a loop', () => {
    const c = compileSong(parseSong({ ...base, sections: { a: { bars: [['C'], ['C']], melody: ['1 2 3 4', '5 6 7 1'] } } }));
    expect(c.sections[0]).toMatchObject({ loopBars: 2, times: 1 });
  });

  it('measures 12/8 in dotted quarters', () => {
    expect(() => parseSong({ ...withA({ melody: ['1. 2. 3. 4.', '5. 0. 0. 0.'] }), timeSignature: [12, 8] })).not.toThrow();
  });

  it('rejects a cue pass that is not a positive whole number', () => {
    expect(() => parseSong({ ...base, sections: { a: { bars: [{ chords: ['C'], cues: [{ text: 'x', pass: 0 }] }] } } })).toThrow(/pass/);
  });
});
