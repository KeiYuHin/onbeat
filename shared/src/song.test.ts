import { describe, expect, it } from 'vitest';
import exampleJson from './fixtures/example-song.json';
import { chordText } from './chord';
import {
  applyDrumEdits,
  barIndexAt,
  barlines,
  cuesFor,
  meter,
  checkDrumPattern,
  compileSong,
  parseSong,
  partDetail,
  repeatPeriod as findPeriod,
  songPosition,
  strumIndex,
  type CompiledSong,
  type Song,
} from './song';

const example = parseSong(exampleJson);

const waltz = parseSong({
  id: 'waltz',
  title: 'test',
  bpm: 90,
  timeSignature: [3, 4],
  sections: {
    a: { label: 'A段', bars: [['C', 'G/B', 'Am'], ['F']] },
    b: { bars: [['F'], ['F'], ['G']] },
  },
  form: ['a', 'b', 'a'],
  parts: {},
});

describe('parseSong', () => {
  it('accepts the bundled example song', () => {
    expect(example.id).toBe('example-song');
  });

  it.each([
    [{ form: ['nope'] }, /unknown section "nope"/],
    [{ timeSignature: [4] }, /timeSignature/],
    [{ sections: { intro: { bars: [[]] } }, form: ['intro'] }, /bar 1/],
    [{ parts: { banjo: { default: {} } } }, /unknown part "banjo"/],
    [{ parts: { guitar1: { label: 'x', default: { strum: 'DXU' } } } }, /strum/],
    [{ parts: { drums: { label: 'x', default: { pattern: { cowbell: 'x'.repeat(16) } } } } }, /unknown drum "cowbell"/],
    [{ parts: { drums: { label: 'x', default: { pattern: { kick: 'x...' } } } } }, /16 steps/],
    [{ parts: { drums: { label: 'x', default: {}, sections: { coda: {} } } } }, /unknown section "coda"/],
    [{ parts: { drums: { label: 'x', default: {}, sections: { verse: { strum: 'Q' } } } } }, /section "verse" strum/],
  ])('rejects %j', (patch, error) => {
    expect(() => parseSong({ ...example, ...patch })).toThrow(error);
  });
});

describe('compileSong', () => {
  it('unrolls the form into bars and numbered sections', () => {
    const c = compileSong(example);
    expect(c.beatsPerBar).toBe(4);
    expect(c.bars).toHaveLength(4 + 8 + 8 + 8 + 8 + 8);
    expect(c.totalBeats).toBe(44 * 4);
    expect(c.sections.map((s) => s.label)).toEqual(['前奏', '主歌 1', '副歌 1', '主歌 2', '副歌 2', '副歌 3']);
    expect(c.sections[2]).toMatchObject({ id: 'chorus', startBar: 12, startBeat: 48, barCount: 8 });
  });

  it('uses custom labels and the time signature numerator', () => {
    const c = compileSong(waltz);
    expect(c.beatsPerBar).toBe(3);
    expect(c.sections.map((s) => s.label)).toEqual(['A段 1', 'b', 'A段 2']);
    expect(c.totalBeats).toBe(7 * 3);
  });
});

describe('meters', () => {
  // 4/4 with a 2/4 bar in the middle, like the turnaround in Someone Like You.
  const odd = parseSong({
    ...example,
    sections: { a: { bars: [['C'], { chords: ['F', 'G'], timeSignature: [2, 4] }, ['C']] } },
    form: ['a', 'a'],
    parts: {},
  });

  it('counts compound meters in dotted quarters', () => {
    expect(meter([12, 8])).toEqual({ beats: 4, compound: true, eighthsPerBeat: 3, stepsPerBeat: 3 });
    expect(meter([6, 8]).beats).toBe(2);
    expect(meter([3, 8])).toMatchObject({ beats: 3, compound: false, eighthsPerBeat: 1 });
    expect(meter([2, 2])).toMatchObject({ beats: 2, eighthsPerBeat: 4 });
  });

  it('lays bars out by their own length', () => {
    const c = compileSong(odd);
    expect(c.bars.map((b) => [b.startBeat, b.beats])).toEqual([[0, 4], [4, 2], [6, 4], [10, 4], [14, 2], [16, 4]]);
    expect(c.sections[1]).toMatchObject({ startBeat: 10, endBeat: 20, startBar: 3 });
    expect(c.totalBeats).toBe(20);
  });

  it('finds position, chord slots and the next change in a short bar', () => {
    const c = compileSong(odd);
    expect(songPosition(c, 5.5)).toMatchObject({ barIndex: 1, beatInBar: 2, chord: { name: 'G' }, next: { chord: { name: 'C' }, inBeats: 0.5 } });
    expect(songPosition(c, 6)).toMatchObject({ barIndex: 2, barInSection: 3, beatInBar: 1, chord: { name: 'C' } });
    expect(barIndexAt(c, 19.99)).toBe(5);
  });

  it('puts barlines where the bars are, and past the end in the last bar length', () => {
    const at = barlines(compileSong(odd));
    expect([0, 0.5, 4, 4.1, 5.9, 6, 19, 20, 21].map(at)).toEqual([0, 4, 4, 6, 6, 6, 20, 20, 24]);
    expect(at(-3)).toBe(0);
    expect(at(-4.5)).toBe(-4);
  });

  it('only folds identical bars into a loop', () => {
    const two = { chords: ['C'], timeSignature: [2, 4] as [number, number] };
    expect(findPeriod([{ chords: ['C'] }, two, { chords: ['C'] }, two])).toBe(2);
    expect(findPeriod([{ chords: ['C'] }, { chords: ['C'] }, { chords: ['C'] }, two])).toBe(4);
  });

  it('checks drum patterns against compound bars', () => {
    const slow = { ...example, timeSignature: [12, 8], parts: { drums: { label: '鼓', default: { pattern: { kick: 'x'.repeat(16) } } } } };
    expect(() => parseSong(slow)).toThrow(/12 steps/);
  });

  it.each([
    [{ timeSignature: [4, 3] }, /timeSignature/],
    [{ sections: { a: { bars: [{ chords: ['C'], timeSignature: [0, 4] }] } }, form: ['a'], parts: {} }, /bar 1 timeSignature/],
    [{ sections: { a: { bars: [{ timeSignature: [2, 4] }] } }, form: ['a'], parts: {} }, /bar 1 needs/],
  ])('rejects %j', (patch, error) => {
    expect(() => parseSong({ ...example, ...patch })).toThrow(error);
  });
});

describe('chords on beats and keys', () => {
  // The start of 明年今日: 1 for three beats and 5/7 for one, 6m, then a bass-only change.
  const chart = parseSong({
    id: 'ming-nian',
    title: '明年今日',
    bpm: 62,
    timeSignature: [4, 4],
    key: 'Ab',
    sections: {
      a: { bars: [['1', '-', '-', '5/7'], ['6m'], ['37', '/#5']] },
      b: { bars: [['4M7']] },
    },
    form: ['a', { section: 'b', key: 'G' }, 'a'],
    parts: {},
  });
  const c = compileSong(chart);

  it('holds a chord over the beats after it', () => {
    expect(c.bars[0].chords.map((s) => [s.name, s.start, s.beats])).toEqual([
      ['1', 0, 3],
      ['5/7', 3, 1],
    ]);
    expect(songPosition(c, 2.5)).toMatchObject({ chord: { name: '1' }, next: { chord: { name: '5/7' }, inBeats: 0.5 } });
    expect(songPosition(c, 3)!.chord.name).toBe('5/7');
  });

  it('lets a bass-only change keep the chord before it', () => {
    expect(c.bars[2].chords[1]).toMatchObject({ name: '/#5', chord: { root: 4, quality: '7', bass: 8 } });
    expect(chordText('/#5', c.bars[2].chords[1].chord, c.bars[2].key, 'letter')).toBe('C7/E');
  });

  it('changes key from a form entry on, for every section after it', () => {
    expect(chart.form).toEqual([{ section: 'a' }, { section: 'b', key: 'G' }, { section: 'a' }]);
    expect(c.bars.map((b) => b.key.name)).toEqual(['Ab', 'Ab', 'Ab', 'G', 'G', 'G', 'G']);
    const fourth = c.bars[3].chords[0];
    expect(chordText(fourth.name, fourth.chord, c.bars[3].key, 'letter')).toBe('Cmaj7');
  });

  it('counts a key change as a chord change even when the name stays the same', () => {
    const pos = songPosition(c, 3 * 4 + 0.5)!; // 4M7 in G, then 1 in G
    expect(pos.next).toMatchObject({ chord: { name: '1' }, key: { name: 'G' }, inBeats: 3.5 });
  });

  it('keeps cues on the bars they were written on, for one part or everyone', () => {
    const song = parseSong({
      ...chart,
      sections: { a: { loop: [{ chords: ['1'], cues: [{ part: 'keys', text: '钢琴' }] }, ['5']], times: 2 } },
      form: ['a', { section: 'a', key: 'G' }],
    });
    const withCues = parseSong({ ...song, sections: { a: { bars: [{ chords: ['1'], cues: ['rit.', { part: 'drums', text: '起鼓' }] }] } } });
    const bar = compileSong(withCues).bars[0];
    expect(bar.cues).toEqual([{ text: 'rit.' }, { part: 'drums', text: '起鼓' }]);
    expect(cuesFor(bar, 'drums').map((c) => c.text)).toEqual(['rit.', '起鼓']);
    expect(cuesFor(bar, 'bass').map((c) => c.text)).toEqual(['rit.']);
    expect(compileSong(song).bars.map((b) => b.cues.length)).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
  });

  it.each([
    [{ sections: { a: { bars: [{ chords: ['1'], cues: [{ part: 'vocals', text: 'x' }] }] } } }, /cue for unknown part "vocals"/],
    [{ sections: { a: { bars: [{ chords: ['1'], cues: [{}] }] } } }, /cues must be text/],
    [{ sections: { a: { bars: [['-', 'C']] } } }, /bar 1 can't start with "-"/],
    [{ key: undefined }, /scale-degree chord "1", which needs the song's "key"/],
    [{ key: 'Am' }, /key must be a major key/],
    [{ form: [{ section: 'a', key: 'H' }] }, /form entry 1 key/],
    [{ form: [{ key: 'G' }] }, /form entry 1 must be/],
  ])('rejects %j', (patch, error) => {
    expect(() => parseSong({ ...chart, form: ['a'], ...patch })).toThrow(error);
  });
});

describe('songPosition', () => {
  const c = compileSong(example);

  it('is null during count-in and after the end', () => {
    expect(songPosition(c, -0.5)).toBeNull();
    expect(songPosition(c, c.totalBeats)).toBeNull();
  });

  it('finds section, bar, beat and chord', () => {
    expect(songPosition(c, 49.5)).toMatchObject({
      section: { label: '副歌 1' },
      barIndex: 12,
      barInSection: 1,
      beatInBar: 2,
      chord: { name: 'F' },
      next: { chord: { name: 'G' }, inBeats: 2.5 },
    });
  });

  it('skips repeats of the current chord when looking for the next one', () => {
    // Chorus ends C, C, then the next section starts on C again before Am.
    const lastChorusBar = c.sections[2].startBar + 6;
    const pos = songPosition(c, lastChorusBar * 4)!;
    expect(pos.chord.name).toBe('C');
    expect(pos.next).toMatchObject({ chord: { name: 'Am' }, inBeats: 3 * 4 }); // C, C, then verse C
  });

  it('has no next chord at the very end', () => {
    expect(songPosition(c, c.totalBeats - 0.1)!.next).toBeNull();
  });

  it('splits several chords in a bar evenly across its beats', () => {
    const w = compileSong(waltz);
    expect(songPosition(w, 0)!.chord.name).toBe('C');
    expect(songPosition(w, 1)).toMatchObject({ chord: { name: 'G/B' }, next: { chord: { name: 'Am' }, inBeats: 1 } });
    expect(songPosition(w, 2.9)!.chord.name).toBe('Am');
    expect(songPosition(w, 3)!.chord.name).toBe('F');
  });
});

describe('partDetail', () => {
  it('applies section overrides on top of the default', () => {
    expect(partDetail(example, 'guitar1', 'verse')).toEqual({ strum: 'D-DU-UDU' });
    expect(partDetail(example, 'drums', 'verse')?.groove).toBe('基本 8beat');
    expect(partDetail(example, 'drums', 'chorus')).toMatchObject({ groove: '8beat + 叮叮镲', pattern: { ride: expect.any(String) } });
  });

  it('is null for parts the song does not have', () => {
    expect(partDetail(waltz, 'bass', 'a')).toBeNull();
  });
});

describe('strumIndex', () => {
  it('advances one character per eighth note and wraps', () => {
    expect(strumIndex('D-DU-UDU', 0)).toBe(0);
    expect(strumIndex('D-DU-UDU', 0.5)).toBe(1);
    expect(strumIndex('D-DU-UDU', 3.99)).toBe(7);
    expect(strumIndex('D-DU-UDU', 4)).toBe(0);
  });
});

describe('loops', () => {
  it('expands { loop, times } into bars and leaves the input untouched', () => {
    const raw = { ...example, sections: { ...example.sections, verse: { loop: [['C'], ['G']], times: 3 } } };
    const before = JSON.stringify(raw);
    const song = parseSong(raw);
    expect(song.sections.verse.bars.map((b) => b.chords)).toEqual([['C'], ['G'], ['C'], ['G'], ['C'], ['G']]);
    expect(JSON.stringify(raw)).toBe(before);
  });

  it('rejects a loop without a valid times', () => {
    expect(() => parseSong({ ...example, sections: { ...example.sections, verse: { loop: [['C']] } } })).toThrow(/times/);
  });

  it('detects the smallest repeating period', () => {
    const repeatPeriod = (bars: string[][]) => findPeriod(bars.map((chords) => ({ chords })));
    expect(repeatPeriod([['C'], ['Am'], ['F'], ['G'], ['C'], ['Am'], ['F'], ['G']])).toBe(4);
    expect(repeatPeriod([['C'], ['C'], ['C']])).toBe(1);
    expect(repeatPeriod([['C', 'G'], ['C']])).toBe(2);
    expect(repeatPeriod([['F'], ['G'], ['C'], ['Am'], ['F'], ['G'], ['C'], ['C']])).toBe(8);
  });

  it('compiles sections as loopBars x times', () => {
    const c = compileSong(example);
    expect(c.sections.map((s) => [s.loopBars, s.times])).toEqual([
      [4, 1],
      [4, 2],
      [8, 1],
      [4, 2],
      [8, 1],
      [8, 1],
    ]);
  });

  it('adds extra passes and shifts everything after', () => {
    const plain = compileSong(example);
    const c = compileSong(example, { 1: 2 });
    expect(c.sections[1]).toMatchObject({ times: 4, barCount: 16 });
    expect(c.sections[2].startBeat).toBe(plain.sections[2].startBeat + 8 * 4);
    expect(c.totalBeats).toBe(plain.totalBeats + 8 * 4);
    expect(c.bars[c.sections[1].startBar + 12].chords.map((ch) => ch.name)).toEqual(['C']);
  });
});

describe('lyrics', () => {
  const song = parseSong({
    id: 'lyrics',
    title: 'test',
    bpm: 80,
    timeSignature: [4, 4],
    sections: {
      intro: { bars: [['C'], ['G']] },
      verse: { loop: [['C'], ['G']], times: 2, lyrics: [['一', '二'], ['三', '四'], ['五', '六']] },
      chorus: { bars: [['F'], ['G'], ['C'], ['C']], lyrics: [['副', '歌', '', '他']] },
    },
    form: ['intro', 'verse', 'chorus', 'verse', 'chorus'],
    parts: {},
  });
  const sung = (c: CompiledSong, section: number) => {
    const s = c.sections[section];
    return c.bars.slice(s.startBar, s.startBar + s.barCount).map((b) => b.lyrics);
  };

  it('sings the next pass each time round, counting on across the form, and repeats the last', () => {
    const c = compileSong(song);
    expect(sung(c, 0)).toEqual(['', '']);
    expect(sung(c, 1)).toEqual(['一', '二', '三', '四']);
    expect(sung(c, 2)).toEqual(['副', '歌', '', '他']);
    expect(sung(c, 3)).toEqual(['五', '六', '五', '六']);
    expect(sung(c, 4)).toEqual(['副', '歌', '', '他']);
  });

  it('counts an extra pass as a pass', () => {
    const c = compileSong(song, { 1: 1 });
    expect(sung(c, 1)).toEqual(['一', '二', '三', '四', '五', '六']);
    expect(sung(c, 3)).toEqual(['五', '六', '五', '六']);
  });

  it('needs one string per bar of the loop in every pass', () => {
    const withVerse = (verse: object) => () => parseSong({ ...song, sections: { ...song.sections, verse } });
    expect(withVerse({ loop: [['C'], ['G']], times: 2, lyrics: [['一']] })).toThrow(/pass 1 needs 2 strings, one per bar of the loop/);
    expect(withVerse({ bars: [['C'], ['G']], lyrics: ['一', '二'] })).toThrow(/list of passes/);
    expect(withVerse({ bars: [['C'], ['G']], lyrics: [['一', 2]] })).toThrow(/pass 1 needs 2 strings/);
  });
});

describe('drum edits', () => {
  const pattern = { kick: 'x'.repeat(16) };

  it('overrides the default and single sections', () => {
    const song = applyDrumEdits(example, { default: pattern, sections: { verse: { snare: 'x'.repeat(16) } } });
    expect(partDetail(song, 'drums', 'intro')).toMatchObject({ groove: '基本 8beat', pattern });
    expect(partDetail(song, 'drums', 'verse')?.pattern).toEqual({ snare: 'x'.repeat(16) });
    expect(partDetail(song, 'drums', 'chorus')?.pattern).toHaveProperty('ride');
    expect(partDetail(example, 'drums', 'intro')?.pattern).not.toEqual(pattern);
  });

  it('lets a section drop its own pattern and follow the default', () => {
    const song = applyDrumEdits(example, { default: pattern, sections: { chorus: 'default' } });
    expect(partDetail(song, 'drums', 'chorus')).toEqual({ groove: '8beat + 叮叮镲', pattern });
    const bare = applyDrumEdits(
      { ...example, parts: { drums: { label: '鼓', default: {}, sections: { chorus: { pattern } } } } },
      { sections: { chorus: 'default', verse: 'default' } },
    );
    expect(bare.parts.drums).toEqual({ label: '鼓', default: {} });
  });

  it('creates a drums part when the song has none', () => {
    const song = applyDrumEdits(waltz, { default: { kick: 'x.'.repeat(6) } });
    expect(partDetail(song, 'drums', 'a')?.pattern).toEqual({ kick: 'x.'.repeat(6) });
  });

  it('checks patterns against the bar length', () => {
    expect(checkDrumPattern(pattern, 16)).toBeNull();
    expect(checkDrumPattern(pattern, 12)).toMatch(/12 steps/);
    expect(checkDrumPattern({ cowbell: 'x' }, 1)).toMatch(/cowbell/);
  });
});
