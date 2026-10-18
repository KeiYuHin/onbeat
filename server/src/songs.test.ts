import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { loadSongs } from './songs';

it('loads the repo songs', () => {
  const songs = loadSongs(fileURLToPath(new URL('../../songs', import.meta.url)));
  expect(songs.map((s) => s.id)).toContain('example-song');
});

it('names the offending file when a song is invalid', () => {
  const dir = mkdtempSync(join(tmpdir(), 'onbeat-songs-'));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ id: 'bad', title: 'x', bpm: 100 }));
  expect(() => loadSongs(dir)).toThrow(/^bad\.json: invalid song "bad": timeSignature/);
});
