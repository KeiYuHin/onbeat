import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { applyDrumEdits, type DrumEdits } from '@onbeat/shared';
import { formatJson, fsLibrary, loadSongFiles, loadSongs } from './songs';

const saveDrums = (dir: string, songId: string, edits: DrumEdits) =>
  fsLibrary(dir).save!(songId, (raw) => applyDrumEdits(raw, edits));

it('loads the repo songs', () => {
  const songs = loadSongs(fileURLToPath(new URL('../../songs', import.meta.url)));
  expect(songs.map((s) => s.id)).toContain('example-song');
});

it('names the offending file when a song is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'onbeat-songs-'));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'bad', title: 'x', bpm: 100 }));
  expect(() => loadSongs(dir)).toThrow(/^bad\.json: invalid song "bad": timeSignature/);
});

it('saves drum edits into the file, keeping loop notation and compact bars', async () => {
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
  const pattern = { kick: 'x...x...x...x...' };
  const saved = await saveDrums(dir, 'loopy', { sections: { verse: pattern } });

  const text = readFileSync(path, 'utf8');
  expect(JSON.parse(text)).toEqual({
    ...raw,
    parts: { ...raw.parts, drums: { label: '鼓', default: {}, sections: { verse: { pattern } } } },
  });
  expect(text).toContain('"verse": { "loop": [["C"], ["Am"], ["F"], ["G"]], "times": 4 }');
  expect(saved.parts.drums?.sections?.verse.pattern).toEqual(pattern);
  expect(loadSongFiles(dir)[0].song.sections.verse.bars).toHaveLength(16);
});

it('removes a section pattern that now follows the default', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'onbeat-songs-'));
  const own = { kick: 'x...x...x...x...' };
  const raw = {
    id: 's',
    title: 's',
    bpm: 100,
    timeSignature: [4, 4],
    sections: { a: { bars: [['C']] }, b: { bars: [['G']] } },
    form: ['a', 'b'],
    parts: { drums: { label: '鼓', default: {}, sections: { a: { pattern: own }, b: { groove: 'x', pattern: own } } } },
  };
  writeFileSync(join(dir, 's.json'), JSON.stringify(raw));
  await saveDrums(dir, 's', { default: own, sections: { a: 'default', b: 'default' } });
  expect(JSON.parse(readFileSync(join(dir, 's.json'), 'utf8')).parts.drums).toEqual({
    label: '鼓',
    default: { pattern: own },
    sections: { b: { groove: 'x' } },
  });
});

it('refuses an invalid save and leaves the file alone', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'onbeat-songs-'));
  const raw = { id: 's', title: 's', bpm: 100, timeSignature: [4, 4], sections: { a: { bars: [['C']] } }, form: ['a'], parts: {} };
  writeFileSync(join(dir, 's.json'), JSON.stringify(raw));
  const library = fsLibrary(dir);
  await expect(library.save!('s', (r) => ({ ...r, form: ['nope'] }))).rejects.toThrow(/form/);
  expect(JSON.parse(readFileSync(join(dir, 's.json'), 'utf8'))).toEqual(raw);
  expect((await library.list())[0].form).toEqual([{ section: 'a' }]);
});

it('keeps lines short when formatting', () => {
  const text = formatJson({ a: { b: Array.from({ length: 30 }, (_, i) => [`C${i}`]) }, c: [1, 2] });
  expect(text.split('\n').every((line) => line.length <= 100)).toBe(true);
  expect(text).toContain('"c": [1, 2]');
});
