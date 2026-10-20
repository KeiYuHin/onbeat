// Song libraries on Cloudflare: the bundled public one, and private ones in R2 unlocked by a key.
// Git is the source of truth for private ones: saves commit to the library's GitHub repo, then
// write R2 so they show up at once; the library repo's Action syncs R2 on every push.
import { formatJson, parseSong, SaveConflictError, type Song, type SongLibrary } from '@onbeat/shared';
import exampleSong from '../../songs/example-song.json';
import jianpuSong from '../../songs/jianpu-example.json';

/** The library of the public repo's own songs. It needs no key and is bundled with the Worker. */
export const PUBLIC_LIBRARY = 'public';

const PUBLIC_SONGS: Song[] = [parseSong(exampleSong), parseSong(jianpuSong)];

export type LibraryEnv = {
  /** R2 bucket; library `<name>` keeps its songs under `<name>/songs/<id>.json`. */
  SONGS: R2Bucket;
  /** Secret: JSON `{ "<library name>": "<key>" }`. Unset means only the public library exists. */
  LIBRARY_KEYS?: string;
  /**
   * Secret: JSON `{ "<library name>": { "repo": "<owner>/<name>", "token": "<token>", "branch"?: "main" } }`.
   * The token needs Contents read/write on that repo only. A library without an entry is read-only.
   * `"api"` overrides https://api.github.com, for testing against a local stub.
   */
  LIBRARY_GITHUB?: string;
};

/**
 * A library a room can follow. `version()` names the catalog the last `list()` (or save) produced;
 * `changed()` says whether the stored catalog has moved on since.
 */
export type CatalogLibrary = SongLibrary & { changed(): Promise<boolean>; version(): string | null };

/**
 * The library a key unlocks: the public one without a key, null for a key that matches nothing.
 * Compares in constant time so a key can't be guessed byte by byte.
 */
export function libraryForKey(env: LibraryEnv, key: string | undefined): string | null {
  if (key === undefined) return PUBLIC_LIBRARY;
  const keys = secretJson(env.LIBRARY_KEYS, 'LIBRARY_KEYS');
  const given = new TextEncoder().encode(key);
  let found: string | null = null;
  for (const [name, k] of Object.entries(keys)) {
    if (typeof k !== 'string' || name === PUBLIC_LIBRARY) continue;
    const want = new TextEncoder().encode(k);
    if (sameBytes(want, given)) found = name;
  }
  return found;
}

export function songLibrary(env: LibraryEnv, name: string, fetchFn: typeof fetch = fetch): CatalogLibrary {
  if (name === PUBLIC_LIBRARY) return { list: async () => PUBLIC_SONGS, changed: async () => false, version: () => null };
  return r2Library(env, name, fetchFn);
}

type GitHubConfig = { repo: string; token: string; branch?: string; api?: string };

/** One song as this library last read it: its R2 key and exact text, for the conflict check on save. */
type Loaded = { key: string; text: string };

/**
 * A private library in R2. `<name>/version` changes on every sync and save; rooms compare its etag
 * to notice a new catalog. A song that fails `parseSong` is skipped and logged rather than taking
 * the whole library down mid-rehearsal (the sync validates first, so this should not happen).
 */
function r2Library(env: LibraryEnv, name: string, fetchFn: typeof fetch): CatalogLibrary {
  const bucket = env.SONGS;
  const prefix = `${name}/`;
  const versionKey = `${prefix}version`;
  const loaded = new Map<string, Loaded>();
  let version: string | null = null;

  const currentVersion = async () => (await bucket.head(versionKey))?.etag ?? null;

  const library: CatalogLibrary = {
    async list() {
      version = await currentVersion();
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await bucket.list({ prefix: `${prefix}songs/`, cursor });
        keys.push(...page.objects.map((o) => o.key).filter((k) => k.endsWith('.json')));
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
      keys.sort();
      const songs = await Promise.all(
        keys.map(async (key) => {
          try {
            const text = await (await bucket.get(key))!.text();
            const song = parseSong(JSON.parse(text));
            loaded.set(song.id, { key, text });
            return song;
          } catch (e) {
            console.error(`skipping ${key}: ${(e as Error).message}`);
            return null;
          }
        }),
      );
      return songs.filter((s): s is Song => s !== null);
    },

    async changed() {
      return (await currentVersion()) !== version;
    },

    version: () => version,
  };

  const github = githubConfig(env, name);
  if (!github) return library;

  library.save = async (songId, edit, meta) => {
    const entry = loaded.get(songId);
    if (!entry) throw new Error(`no song "${songId}" in library ${name}`);
    const path = entry.key.slice(prefix.length); // songs/<id>.json, same as in the repo
    const api = `${github.api ?? 'https://api.github.com'}/repos/${github.repo}/contents/${path}`;
    const branch = github.branch ?? 'main';
    const headers = {
      Authorization: `Bearer ${github.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'onbeat-worker',
    };

    // Refuse if the file in git is not the one this room loaded: someone changed it on a laptop
    // and pushed, and the sync hasn't reached this room yet. Saving now would overwrite that.
    const current = await fetchFn(`${api}?ref=${encodeURIComponent(branch)}`, { headers });
    if (current.status === 404) throw new SaveConflictError(songId);
    if (!current.ok) throw new Error(`GitHub read ${path}: ${current.status} ${await current.text()}`);
    const { sha } = (await current.json()) as { sha: string };
    if (sha !== (await gitBlobSha(entry.text))) throw new SaveConflictError(songId);

    const raw = edit(JSON.parse(entry.text));
    const song = parseSong(raw);
    // Compare content, not text: the file's own layout (hand-wrapped bars, say) isn't formatJson's,
    // so re-serializing an unchanged song would otherwise commit a pure reformat.
    if (JSON.stringify(raw) === JSON.stringify(JSON.parse(entry.text))) return song;
    const text = formatJson(raw) + '\n';

    const by = [meta?.device, meta?.room && `房间 ${meta.room}`].filter(Boolean).join('，');
    const put = await fetchFn(api, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      // `sha` makes GitHub refuse the write if the file moved since we read it.
      body: JSON.stringify({ message: `${path}: 保存鼓谱${by ? `（${by}）` : ''}`, content: base64(text), sha, branch }),
    });
    if (put.status === 409 || put.status === 422) throw new SaveConflictError(songId);
    if (!put.ok) throw new Error(`GitHub write ${path}: ${put.status} ${await put.text()}`);

    // Show it everywhere now rather than after the sync; bumping the version tells other rooms.
    await bucket.put(entry.key, text, { httpMetadata: { contentType: 'application/json' } });
    await forgetInManifest(bucket, `${prefix}manifest.json`, entry.key);
    version = (await bucket.put(versionKey, `saved ${songId} ${new Date().toISOString()}`))?.etag ?? null;
    loaded.set(songId, { key: entry.key, text });
    return song;
  };
  return library;
}

/**
 * The sync's manifest records what it last uploaded. A save just wrote this key behind its back,
 * so drop the entry: the next sync then re-uploads the file from git whatever it holds, even if
 * git went back to exactly what the manifest remembers.
 */
async function forgetInManifest(bucket: R2Bucket, manifestKey: string, key: string) {
  const obj = await bucket.get(manifestKey);
  if (!obj) return;
  const manifest = (await obj.json()) as Record<string, string>;
  if (!(key in manifest)) return;
  delete manifest[key];
  await bucket.put(manifestKey, JSON.stringify(manifest, null, 2), { httpMetadata: { contentType: 'application/json' } });
}

function githubConfig(env: LibraryEnv, name: string): GitHubConfig | null {
  const entry = secretJson(env.LIBRARY_GITHUB, 'LIBRARY_GITHUB')[name] as Partial<GitHubConfig> | undefined;
  if (!entry) return null;
  if (typeof entry.repo !== 'string' || typeof entry.token !== 'string') {
    console.error(`LIBRARY_GITHUB.${name} needs "repo" and "token"`);
    return null;
  }
  return entry as GitHubConfig;
}

/** Constant-time for equal lengths (Workers' timingSafeEqual is not in Node, where the tests run). */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function secretJson(value: string | undefined, label: string): Record<string, unknown> {
  try {
    return JSON.parse(value ?? '{}');
  } catch {
    console.error(`${label} is not valid JSON`);
    return {};
  }
}

/** The sha git (and the GitHub API) gives this text. Line endings are normalized as git stores them. */
export async function gitBlobSha(text: string): Promise<string> {
  const body = new TextEncoder().encode(text.replace(/\r\n/g, '\n'));
  const header = new TextEncoder().encode(`blob ${body.byteLength}\0`);
  const all = new Uint8Array(header.byteLength + body.byteLength);
  all.set(header);
  all.set(body, header.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
