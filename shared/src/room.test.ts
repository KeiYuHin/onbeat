import { expect, it } from 'vitest';
import exampleJson from './fixtures/example-song.json';
import type { ServerMsg } from './protocol';
import { createRoom, type RoomHost } from './room';
import { parseSong } from './song';

const song = parseSong(exampleJson);

function setup(host: Partial<RoomHost> = {}) {
  let t = 1000;
  const room = createRoom('123456', { now: () => t, songs: () => [song], ...host });
  const peer = (id: string) => {
    const inbox: ServerMsg[] = [];
    room.join({ id, send: (m) => inbox.push(m) }, 'bass');
    return inbox;
  };
  return { room, peer, advance: (ms: number) => (t += ms) };
}

it('welcomes a peer with the room, catalog, state and edits, then tells everyone about members', () => {
  const { peer } = setup();
  const a = peer('a');
  const b = peer('b');
  expect(b.map((m) => m.type)).toEqual(['welcome', 'songs', 'state', 'edits', 'members']);
  expect(a.at(-1)).toEqual({ type: 'members', members: [{ id: 'a', part: 'bass' }, { id: 'b', part: 'bass' }] });
});

it('broadcasts a new state on start, anchored at host time', () => {
  const { room, peer, advance } = setup();
  const a = peer('a');
  const b = peer('b');
  advance(500);
  room.handle('a', { type: 'cmd', action: 'start' });
  const state = b.at(-1);
  expect(state?.type).toBe('state');
  expect(state?.type === 'state' && state.state.playing).toBe(true);
  expect(a.at(-1)).toEqual(state);
});

it('answers only the sender on a bad command, and ignores peers that are not in the room', () => {
  const { room, peer } = setup();
  const a = peer('a');
  const b = peer('b');
  const before = b.length;
  room.handle('a', { type: 'cmd', action: 'selectSong', songId: 'nope' });
  expect(a.at(-1)).toEqual({ type: 'error', code: 'song-not-found' });
  expect(b.length).toBe(before);
  room.handle('ghost', { type: 'cmd', action: 'start' });
  expect(b.length).toBe(before);
});

it('fails to save without a host save, and clears edits after a successful one', async () => {
  const pattern = { kick: 'x...x...x...x...' };
  const readOnly = setup();
  const a = readOnly.peer('a');
  readOnly.room.handle('a', { type: 'cmd', action: 'saveSong' });
  await Promise.resolve();
  expect(a.at(-1)).toEqual({ type: 'error', code: 'save-failed' });

  const saved: unknown[] = [];
  const writable = setup({ saveSong: async (...args) => void saved.push(args) });
  const b = writable.peer('b');
  writable.room.handle('b', { type: 'cmd', action: 'setDrums', sectionId: null, pattern });
  writable.room.handle('b', { type: 'cmd', action: 'saveSong' });
  await new Promise((r) => setTimeout(r));
  expect(saved).toEqual([[song.id, { default: pattern, sections: {} }]]);
  expect(b.at(-1)).toEqual({ type: 'edits', edits: { songId: song.id, drums: {} } });
});

it('resumes from a snapshot and takes back surviving peers silently', () => {
  let changes = 0;
  const { room, peer } = setup({ changed: () => changes++ });
  peer('a');
  room.handle('a', { type: 'cmd', action: 'start' });
  expect(changes).toBe(1);

  const resumed = createRoom('123456', { now: () => 9999, songs: () => [song] }, room.snapshot());
  const inbox: ServerMsg[] = [];
  resumed.restore({ id: 'a', send: (m) => inbox.push(m) }, 'drums');
  expect(inbox).toEqual([]);
  expect(resumed.snapshot()).toEqual(room.snapshot());
  expect(resumed.partOf('a')).toBe('drums');
  resumed.handle('a', { type: 'cmd', action: 'stop' });
  expect(inbox.at(-1)?.type).toBe('state');
});

it('starts over on the first song when the saved song is gone', () => {
  const { room } = setup();
  const saved = { ...room.snapshot(), state: { ...room.snapshot().state, songId: 'deleted' } };
  expect(createRoom('123456', { now: () => 0, songs: () => [song] }, saved).snapshot().state.songId).toBe(song.id);
});

it('stops broadcasting to a peer that left', () => {
  const { room, peer } = setup();
  const a = peer('a');
  peer('b');
  room.leave('a');
  const before = a.length;
  room.handle('b', { type: 'cmd', action: 'start' });
  expect(a.length).toBe(before);
  expect(room.size).toBe(1);
});
