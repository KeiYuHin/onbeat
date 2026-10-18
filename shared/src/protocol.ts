// Wire protocol shared by server and web: JSON messages over a single WebSocket.

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
  songId: string | null; // null until songs land in M2
  playing: boolean;
  bpm: number;
  anchorServerTime: number; // server clock (ms)
  anchorBeat: number; // beat count at the anchor, from song start, 0-based
  loop?: { startBeat: number; endBeat: number };
};

export type Member = { id: string; part: Part };

export type Command = { action: 'start' } | { action: 'stop' };

export type ClientMsg =
  | { type: 'create'; part: Part }
  | { type: 'join'; room: string; part: Part }
  | { type: 'ping'; c0: number }
  | ({ type: 'cmd' } & Command);

export type ErrorCode = 'bad-message' | 'room-not-found' | 'not-in-room';

export type ServerMsg =
  | { type: 'welcome'; room: string; memberId: string }
  | { type: 'error'; code: ErrorCode }
  | { type: 'pong'; c0: number; serverTime: number }
  | { type: 'state'; state: PlaybackState }
  | { type: 'members'; members: Member[] };

const isPart = (v: unknown): v is Part => PARTS.includes(v as Part);

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
      return isPart(m.part) ? { type: 'create', part: m.part } : null;
    case 'join':
      return typeof m.room === 'string' && ROOM_CODE_RE.test(m.room) && isPart(m.part)
        ? { type: 'join', room: m.room, part: m.part }
        : null;
    case 'ping':
      return Number.isFinite(m.c0) ? { type: 'ping', c0: m.c0 } : null;
    case 'cmd':
      return m.action === 'start' || m.action === 'stop' ? { type: 'cmd', action: m.action } : null;
    default:
      return null;
  }
}
