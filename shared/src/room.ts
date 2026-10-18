// One rehearsal room, independent of transport: the Node `ws` server and a Durable Object both drive it.
import type { ClientMsg, Command, ErrorCode, Member, Part, PlaybackState, RoomEdits, ServerMsg } from './protocol';
import { checkDrumPattern, compileSong, type DrumEdits, type Song } from './song';
import { loadSong, repeatSection, resumeBeat, seekTo, setBpm, setLoop, startPlayback, stopPlayback } from './timeline';

/** What a room needs from whoever runs it. */
export type RoomHost = {
  /** Server time in ms; every client syncs its clock to this. */
  now(): number;
  /** The current catalog (at least one song). */
  songs(): Song[];
  /**
   * Writes drum edits into the song and tells every room about the new catalog (`songs`), then
   * resolves. Throws on failure. Without it the library is read-only and saving fails.
   */
  saveSong?(songId: string, drums: DrumEdits): Promise<void>;
  /** Called after the playback state or edits change, so a host that can be evicted can persist `snapshot()`. */
  changed?(): void;
};

/** What a room needs to resume after its host restarts. Members are not in it: they come back with their sockets. */
export type RoomSnapshot = { code: string; state: PlaybackState; edits: RoomEdits };

/** One connection in a room. Its id is the member id. */
export type Peer = { id: string; send(msg: ServerMsg): void };

/** Messages a room handles; `ping`, `create` and `join` belong to the transport. */
export type RoomMsg = Extract<ClientMsg, { type: 'setPart' | 'cmd' }>;

export type Room = ReturnType<typeof createRoom>;

/** A new room on the catalog's first song, or one resumed from `saved`. */
export function createRoom(code: string, host: RoomHost, saved?: RoomSnapshot) {
  const first = host.songs()[0];
  // A song removed from the library while the room was saved sends the room back to the first song.
  const resumable = saved && host.songs().some((s) => s.id === saved.state.songId);
  let state: PlaybackState = resumable ? saved.state : loadSong(first, host.now());
  let edits: RoomEdits = resumable ? saved.edits : { songId: first.id, drums: {} };
  const peers = new Map<string, Peer>();
  const members = new Map<string, Member>();

  const song = (id: string) => host.songs().find((s) => s.id === id);

  function broadcast(msg: ServerMsg) {
    for (const p of peers.values()) p.send(msg);
  }

  const broadcastMembers = () => broadcast({ type: 'members', members: [...members.values()] });

  function setEdits(next: RoomEdits) {
    edits = next;
    host.changed?.();
    broadcast({ type: 'edits', edits });
  }

  type PlaybackCommand = Exclude<Command, { action: 'setDrums' | 'setDrumsAll' | 'saveSong' }>;

  function applyCommand(cmd: PlaybackCommand): PlaybackState | ErrorCode {
    const t = host.now();
    const compiled = compileSong(song(state.songId)!, state.extraPasses);
    const bpb = compiled.beatsPerBar;
    switch (cmd.action) {
      case 'start': {
        // Picks up where it stopped (or where a seek put it), after a count-in.
        const parked = stopPlayback(state, t);
        return startPlayback(parked, t, { startBeat: resumeBeat(parked, compiled), beatsPerBar: bpb });
      }
      case 'stop':
        return stopPlayback(state, t);
      case 'selectSong': {
        const next = song(cmd.songId);
        return next ? loadSong(next, t) : 'song-not-found';
      }
      case 'repeatSection':
        // The loop's end is in beats, so growing a section under it would cut the loop short.
        if (state.loop) return 'looping';
        return repeatSection(state, compiled, cmd.sectionIndex, t) ?? 'too-late';
      case 'seek': {
        const section = compiled.sections[cmd.sectionIndex];
        if (!section || cmd.bar >= section.barCount) return 'bad-position';
        return seekTo(state, t, section.startBeat + cmd.bar * bpb, bpb);
      }
      case 'setBpm':
        return setBpm(state, t, cmd.bpm, bpb);
      case 'setLoop': {
        if (cmd.sectionIndex === null) return setLoop(state, t, null, bpb);
        const section = compiled.sections[cmd.sectionIndex];
        if (!section) return 'bad-position';
        return setLoop(state, t, { startBeat: section.startBeat, endBeat: section.startBeat + section.barCount * bpb }, bpb);
      }
    }
  }

  function setDrums(cmd: Extract<Command, { action: 'setDrums' | 'setDrumsAll' }>): ErrorCode | null {
    const current = song(state.songId)!;
    const pattern = cmd.pattern;
    if (pattern && pattern !== 'default' && checkDrumPattern(pattern, current.timeSignature[0] * 4)) return 'bad-pattern';
    let drums: DrumEdits;
    if (cmd.action === 'setDrumsAll') {
      // Sections with a pattern of their own in the song are told to follow the new default instead.
      const own = Object.entries(current.parts.drums?.sections ?? {}).filter(([, d]) => typeof d.pattern === 'object');
      drums = { default: cmd.pattern, sections: Object.fromEntries(own.map(([id]) => [id, 'default' as const])) };
    } else {
      if (cmd.sectionId !== null && !(cmd.sectionId in current.sections)) return 'bad-pattern';
      const { default: def, sections = {} } = edits.drums;
      drums = { ...(def && { default: def }), sections: { ...sections } };
      if (cmd.sectionId === null) {
        if (pattern && pattern !== 'default') drums.default = pattern;
        else delete drums.default;
      } else if (pattern) drums.sections![cmd.sectionId] = pattern;
      else delete drums.sections![cmd.sectionId];
    }
    setEdits({ songId: current.id, drums });
    return null;
  }

  async function save(): Promise<ErrorCode | null> {
    const { songId, drums } = edits;
    if (!host.saveSong) return 'save-failed';
    try {
      await host.saveSong(songId, drums);
    } catch (e) {
      console.error(`saving song "${songId}" failed:`, e);
      return 'save-failed';
    }
    // The song may have changed while saving; only clear edits that were just written.
    if (edits.songId === songId) setEdits({ songId, drums: {} });
    return null;
  }

  return {
    code,
    get size() {
      return peers.size;
    },
    broadcast,

    snapshot: (): RoomSnapshot => ({ code, state, edits }),

    /** The member's current part, or undefined if the peer is not in the room. */
    partOf: (peerId: string): Part | undefined => members.get(peerId)?.part,

    /** Puts back a peer whose socket survived a host restart, without messaging anyone. */
    restore(peer: Peer, part: Part) {
      peers.set(peer.id, peer);
      members.set(peer.id, { id: peer.id, part });
    },

    join(peer: Peer, part: Part) {
      peers.set(peer.id, peer);
      members.set(peer.id, { id: peer.id, part });
      peer.send({ type: 'welcome', room: code, memberId: peer.id });
      peer.send({ type: 'songs', songs: host.songs() });
      peer.send({ type: 'state', state });
      peer.send({ type: 'edits', edits });
      broadcastMembers();
    },

    leave(peerId: string) {
      if (!peers.delete(peerId)) return;
      members.delete(peerId);
      broadcastMembers();
    },

    handle(peerId: string, msg: RoomMsg) {
      const peer = peers.get(peerId);
      if (!peer) return;
      if (msg.type === 'setPart') {
        members.set(peerId, { id: peerId, part: msg.part });
        return broadcastMembers();
      }
      const fail = (code: ErrorCode | null) => code && peer.send({ type: 'error', code });
      if (msg.action === 'setDrums' || msg.action === 'setDrumsAll') return void fail(setDrums(msg));
      if (msg.action === 'saveSong') return void save().then(fail);
      const next = applyCommand(msg);
      if (typeof next === 'string') return void fail(next);
      state = next;
      host.changed?.();
      broadcast({ type: 'state', state });
      if (msg.action === 'selectSong') setEdits({ songId: next.songId, drums: {} });
    },
  };
}
