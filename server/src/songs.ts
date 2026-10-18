import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { formatJson, parseSong, type Song, type SongLibrary } from '@onbeat/shared';

export { formatJson };

/** A song as loaded, plus the JSON exactly as written, so saving keeps `loop` notation and unknown fields. */
export type SongFile = { song: Song; raw: any; path: string };

/** Loads every *.json in `dir`, sorted by file name. Fails loudly on the first bad file. */
export function loadSongFiles(dir: string): SongFile[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const songs = files.map((f) => {
    const path = join(dir, f);
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8'));
      return { song: parseSong(raw), raw, path };
    } catch (e) {
      throw new Error(`${f}: ${(e as Error).message}`);
    }
  });
  const ids = new Set<string>();
  for (const { song } of songs) {
    if (ids.has(song.id)) throw new Error(`duplicate song id "${song.id}"`);
    ids.add(song.id);
  }
  return songs;
}

export const loadSongs = (dir: string): Song[] => loadSongFiles(dir).map((f) => f.song);

/** The songs in `dir`, loaded once (failing loudly like `loadSongFiles`). Saves rewrite the file atomically. */
export function fsLibrary(dir: string): SongLibrary {
  const files = new Map(loadSongFiles(dir).map((f) => [f.song.id, f]));
  return {
    async list() {
      return [...files.values()].map((f) => f.song);
    },
    async save(songId, edit, meta) {
      const file = files.get(songId);
      if (!file) throw new Error(`no song "${songId}"`);
      const raw = edit(structuredClone(file.raw));
      const song = parseSong(raw);
      const tmp = `${file.path}.tmp`;
      writeFileSync(tmp, formatJson(raw) + '\n');
      renameSync(tmp, file.path);
      files.set(songId, { song, raw, path: file.path });
      const by = [meta?.device, meta?.room && `room ${meta.room}`].filter(Boolean).join(', ');
      console.log(`saved ${file.path}${by ? ` (${by})` : ''}`);
      return song;
    },
  };
}
