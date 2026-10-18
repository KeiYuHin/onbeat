import { describe, expect, it } from 'vitest';
import { applyDrumEdits, formatJson, SaveConflictError } from '@onbeat/shared';
import { gitBlobSha, libraryForKey, PUBLIC_LIBRARY, songLibrary, type LibraryEnv } from './libraries';

/** Just enough of R2 for the library: objects with etags that change on every put. */
function fakeBucket(files: Record<string, string>) {
  let n = 0;
  const objects = new Map(Object.entries(files).map(([k, v]) => [k, { text: v, etag: `e${n++}` }]));
  const bucket = {
    objects,
    async head(key: string) {
      const o = objects.get(key);
      return o ? { etag: o.etag } : null;
    },
    async get(key: string) {
      const o = objects.get(key);
      return o ? { text: async () => o.text, json: async () => JSON.parse(o.text) } : null;
    },
    async list({ prefix }: { prefix: string }) {
      return { objects: [...objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), truncated: false };
    },
    async put(key: string, text: string) {
      const o = { text, etag: `e${n++}` };
      objects.set(key, o);
      return { etag: o.etag };
    },
  };
  return bucket;
}

const SONG = {
  id: 'tune',
  title: 'Tune',
  bpm: 100,
  timeSignature: [4, 4],
  sections: { a: { loop: [['C'], ['G']], times: 2 } },
  form: ['a'],
  parts: {},
};
const SONG_TEXT = formatJson(SONG) + '\n';
const PATTERN = { kick: 'x...x...x...x...' };

function setup(github: object | null = { repo: 'me/lib', token: 't0k' }) {
  const bucket = fakeBucket({
    'band/songs/tune.json': SONG_TEXT,
    'band/version': 'v1',
    'band/manifest.json': JSON.stringify({ 'band/songs/tune.json': 'hash-from-last-sync', 'band/assets/x.gp': 'h2' }),
  });
  const env = {
    SONGS: bucket as unknown as R2Bucket,
    LIBRARY_KEYS: JSON.stringify({ band: 'secret-key' }),
    ...(github && { LIBRARY_GITHUB: JSON.stringify({ band: github }) }),
  } satisfies LibraryEnv;
  const calls: { method: string; url: string; body?: any }[] = [];
  let remoteText = SONG_TEXT;
  let putStatus = 200;
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ method, url, body });
    if (method === 'GET') return Response.json({ sha: await gitBlobSha(remoteText) });
    return new Response('{}', { status: putStatus });
  }) as typeof fetch;
  return {
    bucket,
    library: songLibrary(env, 'band', fetchFn),
    /** Another room's view of the same library. */
    another: () => songLibrary(env, 'band', fetchFn),
    calls,
    setRemote: (text: string) => (remoteText = text),
    setPutStatus: (s: number) => (putStatus = s),
  };
}

describe('keys', () => {
  const env = { SONGS: null as unknown as R2Bucket, LIBRARY_KEYS: JSON.stringify({ band: 'secret-key' }) };
  it('maps a key to its library, no key to the public one, and anything else to nothing', () => {
    expect(libraryForKey(env, 'secret-key')).toBe('band');
    expect(libraryForKey(env, undefined)).toBe(PUBLIC_LIBRARY);
    expect(libraryForKey(env, 'secret-kez')).toBeNull();
    expect(libraryForKey({ SONGS: env.SONGS }, 'secret-key')).toBeNull();
  });
});

describe('R2 library', () => {
  it('lists the songs and notices when the version changes', async () => {
    const { library, bucket } = setup();
    expect((await library.list()).map((s) => s.id)).toEqual(['tune']);
    expect(await library.changed()).toBe(false);
    await bucket.put('band/version', 'v2');
    expect(await library.changed()).toBe(true);
  });

  it('is read-only without a GitHub entry', () => {
    expect(setup(null).library.save).toBeUndefined();
  });

  it('commits a save with the sha it read and the device in the message, then updates R2', async () => {
    const { library, bucket, calls, another } = setup();
    await library.list();
    const otherRoom = another();
    await otherRoom.list();
    const song = await library.save!('tune', (raw) => applyDrumEdits(raw, { default: PATTERN }), {
      device: 'iPhone 鼓手',
      room: '123456',
    });
    expect(song.parts.drums?.default.pattern).toEqual(PATTERN);

    const [get, put] = calls;
    expect(get.url).toBe('https://api.github.com/repos/me/lib/contents/songs/tune.json?ref=main');
    expect(put.method).toBe('PUT');
    expect(put.body.sha).toBe(await gitBlobSha(SONG_TEXT));
    expect(put.body.message).toBe('songs/tune.json: 保存鼓谱（iPhone 鼓手，房间 123456）');
    const committed = new TextDecoder().decode(Uint8Array.from(atob(put.body.content), (c) => c.charCodeAt(0)));
    expect(JSON.parse(committed).parts.drums.default.pattern).toEqual(PATTERN);
    // Loop notation survives, in the hand-written layout.
    expect(committed).toContain('"a": { "loop": [["C"], ["G"]], "times": 2 }');

    expect(bucket.objects.get('band/songs/tune.json')!.text).toBe(committed);
    // The next sync re-uploads the file from git, since R2 no longer holds what the manifest says.
    expect(JSON.parse(bucket.objects.get('band/manifest.json')!.text)).toEqual({ 'band/assets/x.gp': 'h2' });
    // This library bumped the version itself, so it doesn't reload its own save...
    expect(await library.changed()).toBe(false);
    // ...but another room's library sees the change.
    expect(await otherRoom.changed()).toBe(true);
  });

  it('refuses to save over a change made elsewhere, and writes nothing', async () => {
    const { library, bucket, calls, setRemote } = setup();
    await library.list();
    setRemote(SONG_TEXT.replace('"Tune"', '"Tune (edited on the laptop)"'));
    await expect(library.save!('tune', (raw) => applyDrumEdits(raw, { default: PATTERN }))).rejects.toBeInstanceOf(
      SaveConflictError,
    );
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(bucket.objects.get('band/songs/tune.json')!.text).toBe(SONG_TEXT);
  });

  it('treats GitHub refusing the sha as a conflict', async () => {
    const { library, setPutStatus } = setup();
    await library.list();
    setPutStatus(409);
    await expect(library.save!('tune', (raw) => applyDrumEdits(raw, { default: PATTERN }))).rejects.toBeInstanceOf(
      SaveConflictError,
    );
  });

  it('skips the commit when nothing changed, even if the file is laid out by hand', async () => {
    const { library, bucket, calls, setRemote } = setup();
    // Bars wrapped by hand: not formatJson's layout, but the same song.
    const handWritten = SONG_TEXT.replace('"loop": [["C"], ["G"]]', '"loop": [\n        ["C"], ["G"]\n      ]');
    expect(handWritten).not.toBe(SONG_TEXT);
    bucket.objects.set('band/songs/tune.json', { text: handWritten, etag: 'hand' });
    setRemote(handWritten);
    await library.list();
    await library.save!('tune', (raw) => raw);
    expect(calls.map((c) => c.method)).toEqual(['GET']);
    expect(bucket.objects.get('band/songs/tune.json')!.text).toBe(handWritten);
  });
});

it('computes the same blob sha as git, ignoring CRLF', async () => {
  // `printf 'hello\n' | git hash-object --stdin`
  expect(await gitBlobSha('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  expect(await gitBlobSha('hello\r\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
});
