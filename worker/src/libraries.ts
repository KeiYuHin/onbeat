// Song libraries on Cloudflare: the bundled public one, and private ones in R2 unlocked by a key.
import { parseSong, type Song, type SongLibrary } from '@onbeat/shared';
import exampleSong from '../../songs/example-song.json';

/** The library of the public repo's own songs. It needs no key and is bundled with the Worker. */
export const PUBLIC_LIBRARY = 'public';

const PUBLIC_SONGS: Song[] = [parseSong(exampleSong)];

export type LibraryEnv = {
  /** R2 bucket; library `<name>` keeps its songs under `<name>/songs/<id>.json`. */
  SONGS: R2Bucket;
  /** Secret: JSON `{ "<library name>": "<key>" }`. Unset means only the public library exists. */
  LIBRARY_KEYS?: string;
};

/**
 * The library a key unlocks: the public one without a key, null for a key that matches nothing.
 * Compares in constant time so a key can't be guessed byte by byte.
 */
export function libraryForKey(env: LibraryEnv, key: string | undefined): string | null {
  if (key === undefined) return PUBLIC_LIBRARY;
  let keys: Record<string, unknown>;
  try {
    keys = JSON.parse(env.LIBRARY_KEYS ?? '{}');
  } catch {
    console.error('LIBRARY_KEYS is not valid JSON');
    return null;
  }
  const given = new TextEncoder().encode(key);
  let found: string | null = null;
  for (const [name, k] of Object.entries(keys)) {
    if (typeof k !== 'string' || name === PUBLIC_LIBRARY) continue;
    const want = new TextEncoder().encode(k);
    if (want.byteLength === given.byteLength && crypto.subtle.timingSafeEqual(want, given)) found = name;
  }
  return found;
}

/** The named library, read-only for now: saving goes through GitHub (M3.9 step 6). */
export function songLibrary(env: LibraryEnv, name: string): SongLibrary {
  if (name === PUBLIC_LIBRARY) return { list: async () => PUBLIC_SONGS };
  return { list: () => listR2(env.SONGS, name) };
}

/**
 * A library's catalog from R2, sorted by file name like the LAN server. A song that fails
 * `parseSong` is skipped and logged rather than taking the whole library down mid-rehearsal
 * (the GitHub sync validates before uploading, so this should not happen).
 */
async function listR2(bucket: R2Bucket, name: string): Promise<Song[]> {
  const prefix = `${name}/songs/`;
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ prefix, cursor });
    keys.push(...page.objects.map((o) => o.key).filter((k) => k.endsWith('.json')));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  keys.sort();
  const songs = await Promise.all(
    keys.map(async (key) => {
      try {
        const obj = await bucket.get(key);
        return obj ? parseSong(await obj.json()) : null;
      } catch (e) {
        console.error(`skipping ${key}: ${(e as Error).message}`);
        return null;
      }
    }),
  );
  return songs.filter((s): s is Song => s !== null);
}
