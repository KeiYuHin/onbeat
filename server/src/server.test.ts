import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyDrumEdits } from '@onbeat/shared';
import { startServer } from './server';
import { TEST_SONGS, TestClient } from './testClient';

let server: Awaited<ReturnType<typeof startServer>>;
const clients: TestClient[] = [];
const connect = async () => {
  const c = await TestClient.connect(server.port);
  clients.push(c);
  return c;
};

beforeEach(async () => {
  server = await startServer({ songs: TEST_SONGS, port: 0, emptyRoomTtlMs: 50 });
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await server.close();
});

describe('rooms', () => {
  it('creates a room with a 6-digit code and sends the initial state', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'bass' });
    const welcome = await a.next('welcome');
    expect(welcome.room).toMatch(/^\d{6}$/);
    expect((await a.next('state')).state.playing).toBe(false);
    expect((await a.next('members')).members).toEqual([{ id: welcome.memberId, part: 'bass' }]);
  });

  it('lets others join and tracks members coming and going', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    const { room } = await a.next('welcome');
    await a.next('members');

    const b = await connect();
    b.send({ type: 'join', room, part: 'drums' });
    await b.next('welcome');
    expect((await a.next('members')).members.map((m) => m.part)).toEqual(['guitar1', 'drums']);

    b.close();
    expect((await a.next('members')).members.map((m) => m.part)).toEqual(['guitar1']);
  });

  it("switches a member's part in place", async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    const { memberId } = await a.next('welcome');
    await a.next('members');
    a.send({ type: 'setPart', part: 'keys' });
    expect((await a.next('members')).members).toEqual([{ id: memberId, part: 'keys' }]);
  });

  it('rejects unknown rooms and malformed messages', async () => {
    const a = await connect();
    a.send({ type: 'join', room: '000000', part: 'keys' });
    expect((await a.next('error')).code).toBe('room-not-found');
    a.send({ type: 'join', room: 'abc', part: 'keys' } as never);
    expect((await a.next('error')).code).toBe('bad-message');
    a.send({ type: 'cmd', action: 'start' });
    expect((await a.next('error')).code).toBe('not-in-room');
  });

  it('broadcasts start and stop to everyone in the room', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    const { room } = await a.next('welcome');
    await a.next('state');
    const b = await connect();
    b.send({ type: 'join', room, part: 'bass' });
    await b.next('state');

    b.send({ type: 'cmd', action: 'start' });
    const [sa, sb] = await Promise.all([a.next('state'), b.next('state')]);
    expect(sa.state.playing).toBe(true);
    expect(sb.state).toEqual(sa.state);

    a.send({ type: 'cmd', action: 'stop' });
    expect((await b.next('state')).state.playing).toBe(false);
  });

  it('sends the song catalog and starts new rooms on the first song', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    expect((await a.next('songs')).songs.map((s) => s.id)).toEqual(['four', 'waltz']);
    expect((await a.next('state')).state).toMatchObject({ songId: 'four', bpm: 120, playing: false, anchorBeat: 0 });
  });

  it('switches songs, resetting tempo and position, and counts in by the time signature', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    await a.next('state');
    a.send({ type: 'cmd', action: 'start' });
    expect((await a.next('state')).state.anchorBeat).toBe(-4);

    a.send({ type: 'cmd', action: 'selectSong', songId: 'waltz' });
    expect((await a.next('state')).state).toMatchObject({ songId: 'waltz', bpm: 90, playing: false, anchorBeat: 0 });
    a.send({ type: 'cmd', action: 'start' });
    expect((await a.next('state')).state.anchorBeat).toBe(-3);

    a.send({ type: 'cmd', action: 'selectSong', songId: 'nope' });
    expect((await a.next('error')).code).toBe('song-not-found');
  });

  it('forgets a room once it has been empty for the TTL', async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'guitar1' });
    const { room } = await a.next('welcome');
    a.close();
    await new Promise((r) => setTimeout(r, 150));
    const b = await connect();
    b.send({ type: 'join', room, part: 'bass' });
    expect((await b.next('error')).code).toBe('room-not-found');
  });
});

describe('rehearsal edits', () => {
  const inRoom = async () => {
    const a = await connect();
    a.send({ type: 'create', part: 'drums' });
    const { room } = await a.next('welcome');
    await a.next('state');
    await a.next('edits');
    const b = await connect();
    b.send({ type: 'join', room, part: 'bass' });
    await b.next('state');
    await b.next('edits');
    return [a, b];
  };

  it('repeats the current section for everyone, and refuses once it is over', async () => {
    const [a, b] = await inRoom();
    a.send({ type: 'cmd', action: 'repeatSection', sectionIndex: 0 }); // stopped at the top: still ahead
    expect((await b.next('state')).state.extraPasses).toEqual({ 0: 1 });
    a.send({ type: 'cmd', action: 'repeatSection', sectionIndex: 5 });
    expect((await a.next('error')).code).toBe('too-late');
  });

  it('syncs drum edits to the room, validates them, and clears them on song change', async () => {
    const [a, b] = await inRoom();
    const pattern = { kick: 'x...'.repeat(4) };
    a.send({ type: 'cmd', action: 'setDrums', sectionId: 'a', pattern });
    expect((await b.next('edits')).edits).toEqual({ songId: 'four', drums: { sections: { a: pattern } } });
    a.send({ type: 'cmd', action: 'setDrums', sectionId: null, pattern: { kick: 'x...' } });
    expect((await a.next('error')).code).toBe('bad-pattern');
    a.send({ type: 'cmd', action: 'setDrums', sectionId: 'nope', pattern });
    expect((await a.next('error')).code).toBe('bad-pattern');
    a.send({ type: 'cmd', action: 'selectSong', songId: 'waltz' });
    expect((await b.next('edits')).edits).toEqual({ songId: 'waltz', drums: {} });
  });

  it('applies one pattern to every section', async () => {
    await server.close();
    const own = { kick: 'x'.repeat(16) };
    const songs = [{ ...TEST_SONGS[0], parts: { drums: { label: '鼓', default: {}, sections: { a: { pattern: own } } } } }];
    server = await startServer({ songs, port: 0 });
    const [a, b] = await inRoom();
    const pattern = { snare: '....x.......x...' };
    a.send({ type: 'cmd', action: 'setDrums', sectionId: 'a', pattern });
    await b.next('edits');
    a.send({ type: 'cmd', action: 'setDrumsAll', pattern });
    expect((await b.next('edits')).edits.drums).toEqual({ default: pattern, sections: { a: 'default' } });
    a.send({ type: 'cmd', action: 'setDrums', sectionId: null, pattern: 'default' } as never);
    expect((await a.next('error')).code).toBe('bad-message');
  });

  it('saves edits through the hook and sends everyone the updated song', async () => {
    await server.close();
    const saved: unknown[] = [];
    server = await startServer({
      songs: TEST_SONGS,
      port: 0,
      saveSong: (songId, drums) => {
        saved.push([songId, drums]);
        return applyDrumEdits(TEST_SONGS.find((s) => s.id === songId)!, drums);
      },
    });
    const [a, b] = await inRoom();
    const pattern = { snare: '....x.......x...' };
    a.send({ type: 'cmd', action: 'setDrums', sectionId: null, pattern });
    await b.next('edits');
    a.send({ type: 'cmd', action: 'saveSong' });
    const { songs } = await b.next('songs', (m) => !!m.songs[0].parts.drums);
    expect(songs[0].parts.drums?.default.pattern).toEqual(pattern);
    expect((await b.next('edits')).edits.drums).toEqual({});
    expect(saved).toEqual([['four', { default: pattern, sections: {} }]]);
  });

  it('fails to save without a hook', async () => {
    const [a] = await inRoom();
    a.send({ type: 'cmd', action: 'saveSong' });
    expect((await a.next('error')).code).toBe('save-failed');
  });
});
