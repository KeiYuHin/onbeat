import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSong, type Song } from '@onbeat/shared';

/** Loads every *.json in `dir`, sorted by file name. Fails loudly on the first bad file. */
export function loadSongs(dir: string): Song[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const songs = files.map((f) => {
    try {
      return parseSong(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  });
  const ids = new Set<string>();
  for (const s of songs) {
    if (ids.has(s.id)) throw new Error(`duplicate song id "${s.id}"`);
    ids.add(s.id);
  }
  return songs;
}
