// Wire protocol shared by server and web: JSON messages over a single WebSocket.
import type { DrumEdits, DrumPattern, ExtraPasses, SectionDrumEdit, Song } from './song';

export const PARTS = ['guitar1', 'guitar2', 'bass', 'drums', 'keys'] as const;
export type Part = (typeof PARTS)[number];

export const PART_LABELS: Record<Part, string> = {
  guitar1: '吉他1',
  guitar2: '吉他2',
  bass: '贝斯',
  drums: '鼓',
  keys: '键盘',
};

export const ROOM_CODE_RE = /^\d{6}$/;

/** The single source of truth for a room, broadcast by the server. */
export type PlaybackState = {
  songId: string;
  playing: boolean;
  bpm: number;
  anchorServerTime: number; // server clock (ms)
  anchorBeat: number; // beat count at the anchor, from song start, 0-based
  /** While set, reaching endBeat wraps back to startBeat (both on barlines). */
  loop?: { startBeat: number; endBeat: number };
  /** Sections played more times than written ("再绕一遍"); part of the timeline, so it lives here. */
  extraPasses?: ExtraPasses;
  /**
   * A change decided ahead of time, usually for the next barline: from `atServerTime` on, the position
   * continues from `beat` (a seek; omitted to just carry on) at `bpm`. Broadcast before it happens, so every
   * device switches at the same moment. Stays in the state after it fires until the next command folds it in.
   */
  jump?: Jump;
};

export type Jump = { atServerTime: number; beat?: number; bpm: number };

export const MIN_BPM = 20;
export const MAX_BPM = 300;

/** Room-level song changes that are not saved to the song file yet. */
export type RoomEdits = { songId: string; drums: DrumEdits };

export type Member = { id: string; part: Part };

export type Command =
  | { action: 'start' }
  | { action: 'stop' }
  | { action: 'selectSong'; songId: string }
  /** One more pass of the section at this form index; refused once it is (almost) over. */
  | { action: 'repeatSection'; sectionIndex: number }
  /** Go to a bar (0-based within the section at this form index). Playing: at the next barline. */
  | { action: 'seek'; sectionIndex: number; bar: number }
  /** Playing: at the next barline. */
  | { action: 'setBpm'; bpm: number }
  /** Loop the section at this form index (going there if needed), or stop looping with null. */
  | { action: 'setLoop'; sectionIndex: number | null }
  /**
   * Replace the drum pattern for a section (sectionId null: the whole-song default). Pattern 'default'
   * makes the section follow the whole-song pattern; null undoes the room's edit.
   */
  | { action: 'setDrums'; sectionId: string | null; pattern: SectionDrumEdit | null }
  /** Use one pattern for the whole song: it becomes the default and every section follows it. */
  | { action: 'setDrumsAll'; pattern: DrumPattern }
  /** Write the room's edits into the song file. `device` names who saved, for the commit message and logs. */
  | { action: 'saveSong'; device?: string };

export type ClientMsg =
  /**
   * `key` is a library key (from a `#k=` link). Creating with one binds the room to that library;
   * joining a room bound to a private library needs the same key. The LAN server ignores it.
   */
  | { type: 'create'; part: Part; key?: string }
  | { type: 'join'; room: string; part: Part; key?: string }
  | { type: 'ping'; c0: number }
  /** Switch this member's part without leaving the room. */
  | { type: 'setPart'; part: Part }
  | ({ type: 'cmd' } & Command);

export type ErrorCode =
  | 'bad-message'
  | 'room-not-found'
  | 'not-in-room'
  | 'song-not-found'
  | 'too-late'
  | 'looping'
  | 'bad-position'
  | 'bad-pattern'
  | 'save-failed'
  /** The song file changed elsewhere since this room loaded it (e.g. edited on a laptop and pushed). */
  | 'save-conflict'
  /** The key is unknown, or the room's private library needs one. */
  | 'bad-key'
  /** Too many failed joins on this room; try again in a minute. */
  | 'rate-limited';

export type ServerMsg =
  | { type: 'welcome'; room: string; memberId: string }
  | { type: 'error'; code: ErrorCode }
  | { type: 'pong'; c0: number; serverTime: number }
  | { type: 'state'; state: PlaybackState }
  | { type: 'members'; members: Member[] }
  | { type: 'songs'; songs: Song[] }
  | { type: 'edits'; edits: RoomEdits };

const isPart = (v: unknown): v is Part => PARTS.includes(v as Part);
const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
export const DEVICE_NAME_MAX = 40;
const isKey = (v: unknown) => v === undefined || (typeof v === 'string' && v.length > 0 && v.length <= 128);

/** Shape only; the server checks step counts and drum names against the song. */
const isPatternShape = (p: unknown): p is DrumPattern =>
  typeof p === 'object' &&
  p !== null &&
  !Array.isArray(p) &&
  Object.keys(p).length <= 16 &&
  Object.values(p).every((row) => typeof row === 'string' && row.length <= 64);

/** Validates untrusted client input; returns null for anything malformed. */
export function parseClientMsg(raw: string): ClientMsg | null {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof m !== 'object' || m === null) return null;
  switch (m.type) {
    case 'create':
      if (!isPart(m.part) || !isKey(m.key)) return null;
      return { type: 'create', part: m.part, ...(m.key !== undefined && { key: m.key }) };
    case 'join':
      if (typeof m.room !== 'string' || !ROOM_CODE_RE.test(m.room) || !isPart(m.part) || !isKey(m.key)) return null;
      return { type: 'join', room: m.room, part: m.part, ...(m.key !== undefined && { key: m.key }) };
    case 'ping':
      return Number.isFinite(m.c0) ? { type: 'ping', c0: m.c0 } : null;
    case 'setPart':
      return isPart(m.part) ? { type: 'setPart', part: m.part } : null;
    case 'cmd':
      if (m.action === 'start' || m.action === 'stop') return { type: 'cmd', action: m.action };
      if (m.action === 'selectSong' && typeof m.songId === 'string')
        return { type: 'cmd', action: 'selectSong', songId: m.songId };
      if (m.action === 'repeatSection' && Number.isInteger(m.sectionIndex) && m.sectionIndex >= 0)
        return { type: 'cmd', action: 'repeatSection', sectionIndex: m.sectionIndex };
      if (m.action === 'seek' && isIndex(m.sectionIndex) && isIndex(m.bar))
        return { type: 'cmd', action: 'seek', sectionIndex: m.sectionIndex, bar: m.bar };
      if (m.action === 'setBpm' && Number.isInteger(m.bpm) && m.bpm >= MIN_BPM && m.bpm <= MAX_BPM)
        return { type: 'cmd', action: 'setBpm', bpm: m.bpm };
      if (m.action === 'setLoop' && (m.sectionIndex === null || isIndex(m.sectionIndex)))
        return { type: 'cmd', action: 'setLoop', sectionIndex: m.sectionIndex };
      if (
        m.action === 'setDrums' &&
        (m.sectionId === null || typeof m.sectionId === 'string') &&
        (m.pattern === null || (m.pattern === 'default' && m.sectionId !== null) || isPatternShape(m.pattern))
      )
        return { type: 'cmd', action: 'setDrums', sectionId: m.sectionId, pattern: m.pattern };
      if (m.action === 'setDrumsAll' && isPatternShape(m.pattern))
        return { type: 'cmd', action: 'setDrumsAll', pattern: m.pattern };
      if (m.action === 'saveSong') {
        if (m.device !== undefined && !(typeof m.device === 'string' && m.device.trim().length > 0 && m.device.length <= DEVICE_NAME_MAX)) return null;
        return { type: 'cmd', action: 'saveSong', ...(m.device !== undefined && { device: m.device.trim() }) };
      }
      return null;
    default:
      return null;
  }
}
