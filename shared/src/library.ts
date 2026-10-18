import { parseSong, type Song } from './song';

/**
 * Where songs come from and where saves go. The room logic only talks to this, so the same rooms
 * run on local files (`FsLibrary`), R2 behind a Worker, or memory in tests.
 */
export interface SongLibrary {
  /** The whole catalog. New rooms start on the first song. */
  list(): Promise<Song[]>;
  /**
   * Applies `edit` to the song's raw JSON (as written, `loop` notation and unknown fields intact),
   * validates the result, stores it and returns the updated song. A library without it is read-only.
   */
  save?(songId: string, edit: (raw: any) => unknown): Promise<Song>;
}

/** A writable library held in memory. Each entry is raw song JSON. */
export function memoryLibrary(raws: unknown[]): SongLibrary {
  const entries = new Map(raws.map((raw) => [parseSong(raw).id, structuredClone(raw)]));
  return {
    async list() {
      return [...entries.values()].map(parseSong);
    },
    async save(songId, edit) {
      const raw = entries.get(songId);
      if (raw === undefined) throw new Error(`no song "${songId}"`);
      const next = edit(structuredClone(raw));
      const song = parseSong(next);
      entries.set(songId, next);
      return song;
    },
  };
}
