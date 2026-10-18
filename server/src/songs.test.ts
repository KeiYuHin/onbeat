import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { formatJson, loadSongFiles, loadSongs, saveDrumEdits } from './songs';

it('loads the repo songs', () => {
  const songs = loadSongs(fileURLToPath(new URL('../../songs', import.meta.url)));
  expect(songs.map((s) => s.id)).toContain('example-song');
});

it('names the offending file when a song is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'onbeat-songs-'));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'bad', title: 'x', bpm: 100 }));
  expect(() => loadSongs(dir)).toThrow(/^bad\.json: invalid song "bad": timeSignature/);
});

it('saves drum edits into the file, keeping loop notation and compact bars', () => {
  const dir = mkdtempSync(join(tmpdir(), 'onbeat-songs-'));
  const path = join(dir, 'song.json');
  const raw = {
    id: 'loopy',
    title: 'Loopy',
    bpm: 100,
    timeSignature: [4, 4],
    sections: { verse: { loop: [['C'], ['Am'], ['F'], ['G']], times: 4 } },
    form: ['verse'],
    parts: { bass: { label: '贝斯', default: { pattern: '根音' } } },
    lyrics: 'kept',
  };
  writeFileSync(path, JSON.stringify(raw));
  const [file] = loadSongFiles(dir);
  const pattern = { kick: 'x...x...x...x...' };
  const saved = saveDrumEdits(file, { sections: { verse: pattern } });

  const text = readFileSync(path, 'utf8');
  expect(JSON.parse(text)).toEqual({
    ...raw,
    parts: { ...raw.parts, drums: { label: '鼓', default: {}, sections: { verse: { pattern } } } },
  });
  expect(text).toContain('"verse": { "loop": [["C"], ["Am"], ["F"], ["G"]], "times": 4 }');
  expect(saved.song.parts.drums?.sections?.verse.pattern).toEqual(pattern);
  expect(loadSongFiles(dir)[0].song.sections.verse.bars).toHaveLength(16);
});

it('keeps lines short when formatting', () => {
  const text = formatJson({ a: { b: Array.from({ length: 30 }, (_, i) => [`C${i}`]) }, c: [1, 2] });
  expect(text.split('\n').every((line) => line.length <= 100)).toBe(true);
  expect(text).toContain('"c": [1, 2]');
});
