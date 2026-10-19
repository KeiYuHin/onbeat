import { describe, expect, it } from 'vitest';
import { lyricSheet, type SheetBlock } from './lyricSheet';
import { compileSong, parseSong } from './song';

const raw = {
  id: 'sheet',
  title: 'test',
  bpm: 80,
  timeSignature: [4, 4],
  key: 'C',
  sections: {
    verse: {
      loop: [['1'], ['6m']],
      times: 2,
      lyrics: [
        ['我最爱 昨天', '是她 曾经'],
        ['让我', '散落 可是'],
      ],
    },
    solo: { bars: [['4'], ['5']], lyrics: [['', ' 我不要']] },
    chorus: { bars: [['1', '5'], ['1']], lyrics: [['你曾经的梦', '都已']] },
  },
  form: ['verse', 'solo', 'chorus'],
  parts: {},
};
const song = parseSong(raw);

/** "[C]我最爱 昨天[Am]是她" for lines, "| F | G 我不要 |" for chord boxes; `/` between passes. */
function text(blocks: SheetBlock[]): string {
  return blocks
    .map((b) =>
      b.kind === 'bars'
        ? `| ${b.bars.map((x) => c.bars[x.bar].chords.map((s) => s.name).join(' ') + (x.text ? ` ${x.text}` : '')).join(' | ')} |`
        : b.phrases
            .map((ph) => ph.map((f) => f.pieces.map((p) => (p.chord ? `[${p.chord.slot.name}]` : '') + p.text).join('')).join(''))
            .join(' '),
    )
    .join(' / ');
}
const c = compileSong(song);

describe('lyricSheet', () => {
  const sheet = lyricSheet(c);
  const show = (i: number) => sheet[i].passes.map(text);

  it('puts each bar’s chord over its first syllable and lets pickups run into the next bar', () => {
    expect(show(0)[0]).toBe('[1]我最爱 昨天[6m]是她');
  });

  it('moves a pickup into the next pass to the start of its line, but not into a bar with nothing sung', () => {
    expect(show(0)[1]).toBe('曾经[1]让我[6m]散落 可是');
  });

  it('shows bars with nothing on the downbeat as chord boxes, their pickup moving to the next line', () => {
    expect(show(1)).toEqual(['| 4 | 5 |']);
    expect(show(2)).toEqual(['我不要[1]你曾经[5]的梦[1]都已']);
  });

  it('only repeats a chord at the start of a run of lines', () => {
    const again = lyricSheet(compileSong(parseSong({ ...raw, form: ['chorus', 'chorus'] })));
    expect(again.map((s) => s.passes.map(text)[0])).toEqual(['[1]你曾经[5]的梦[1]都已', '[1]你曾经[5]的梦[1]都已']);
  });

  it('is all chord boxes without lyrics', () => {
    expect(lyricSheet(c, false).map((s) => s.passes.map(text).join(' / '))).toEqual([
      '| 1 | 6m | / | 1 | 6m |',
      '| 4 | 5 |',
      '| 1 5 | 1 |',
    ]);
  });
});
