import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyDrumEdits, parseSong, type DrumEdits, type Song } from '@onbeat/shared';

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

/** Writes drum edits into the song's file (atomically) and returns the updated entry. */
export function saveDrumEdits(file: SongFile, edits: DrumEdits): SongFile {
  // applyDrumEdits only touches `parts`, so it works on the raw JSON too.
  const raw = applyDrumEdits(file.raw, edits);
  const song = parseSong(raw);
  const tmp = `${file.path}.tmp`;
  writeFileSync(tmp, formatJson(raw) + '\n');
  renameSync(tmp, file.path);
  return { song, raw, path: file.path };
}

const MAX_INLINE = 100;

/** JSON with small objects and arrays kept on one line, the way song files are written by hand. */
export function formatJson(value: unknown, indent = '', keyWidth = 0): string {
  const flat = inline(value);
  if (typeof value !== 'object' || value === null || indent.length + keyWidth + flat.length <= MAX_INLINE) return flat;
  const inner = indent + '  ';
  const items = Array.isArray(value)
    ? value.map((v) => inner + formatJson(v, inner))
    : Object.entries(value).map(([k, v]) => {
        const key = `${JSON.stringify(k)}: `;
        return inner + key + formatJson(v, inner, key.length);
      });
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
  return `${open}\n${items.join(',\n')}\n${indent}${close}`;
}

function inline(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(inline).join(', ')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${inline(v)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}
