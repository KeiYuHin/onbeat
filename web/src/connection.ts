import {
  ClockSync,
  type Command,
  type ErrorCode,
  type Member,
  type Part,
  type PlaybackState,
  type ServerMsg,
} from '@onbeat/shared';

export type Snapshot = {
  status: 'connecting' | 'open' | 'reconnecting';
  room: string | null;
  memberId: string | null;
  members: Member[];
  playback: PlaybackState | null;
  error: ErrorCode | null;
};

export type RoomTarget = { room: string } | { create: true };

const RECONNECT_MS = 1000;

/**
 * One room session: the socket (reconnecting on drop, e.g. when a phone wakes), clock sync,
 * and the latest server state. Exposes subscribe/getSnapshot for useSyncExternalStore.
 */
export class RoomConnection {
  readonly clock: ClockSync;
  private ws: WebSocket | null = null;
  private closed = false;
  private listeners = new Set<() => void>();
  private snap: Snapshot = {
    status: 'connecting',
    room: null,
    memberId: null,
    members: [],
    playback: null,
    error: null,
  };

  constructor(
    target: RoomTarget,
    private part: Part,
  ) {
    if ('room' in target) this.snap.room = target.room;
    this.clock = new ClockSync((c0) => this.send({ type: 'ping', c0 }));
    this.open();
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = () => this.snap;

  command(cmd: Command) {
    this.send({ type: 'cmd', ...cmd });
  }

  close() {
    this.closed = true;
    this.clock.stop();
    this.ws?.close();
  }

  private update(patch: Partial<Snapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((fn) => fn());
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.update({ status: 'open' });
      // Rejoining by code covers both the first join and reconnects after a create.
      const room = this.snap.room;
      this.send(room ? { type: 'join', room, part: this.part } : { type: 'create', part: this.part });
      // The server may have restarted, which resets its clock, so always resync on (re)connect.
      this.clock.start();
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(e.data) as ServerMsg);
    ws.onclose = () => {
      if (this.closed) return;
      this.update({ status: 'reconnecting' });
      setTimeout(() => !this.closed && this.open(), RECONNECT_MS);
    };
  }

  private onMessage(msg: ServerMsg) {
    switch (msg.type) {
      case 'pong':
        this.clock.handlePong(msg.c0, msg.serverTime);
        return;
      case 'welcome':
        return this.update({ room: msg.room, memberId: msg.memberId, error: null });
      case 'state':
        return this.update({ playback: msg.state });
      case 'members':
        return this.update({ members: msg.members });
      case 'error':
        return this.update({ error: msg.code });
    }
  }
}
