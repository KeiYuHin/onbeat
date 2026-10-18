import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  barPosition,
  beatAt,
  DEFAULT_BEATS_PER_BAR,
  PART_LABELS,
  type ErrorCode,
  type Part,
  type PlaybackState,
} from '@onbeat/shared';
import { RoomConnection, type RoomTarget } from './connection';

const ERROR_TEXT: Record<ErrorCode, string> = {
  'room-not-found': '房间不存在（可能已过期或服务器重启了）',
  'bad-message': '消息格式错误',
  'not-in-room': '还没有进入房间',
  'song-not-found': '找不到这首歌',
};

type Props = { part: Part; onLeave: () => void; onRoom: (room: string) => void };

/** Owns the connection for as long as the user is in the room. */
export function Room({ target, ...props }: Props & { target: RoomTarget }) {
  const [conn, setConn] = useState<RoomConnection | null>(null);
  useEffect(() => {
    const c = new RoomConnection(target, props.part);
    setConn(c);
    return () => c.close();
  }, [target, props.part]);
  return conn && <RoomView conn={conn} {...props} />;
}

function RoomView({ conn, part, onLeave, onRoom }: Props & { conn: RoomConnection }) {
  const snap = useSyncExternalStore(conn.subscribe, conn.getSnapshot);

  useEffect(() => {
    if (snap.room && snap.memberId) onRoom(snap.room);
  }, [snap.room, snap.memberId, onRoom]);

  if (snap.error === 'room-not-found') {
    return (
      <main className="lobby">
        <p className="error">{ERROR_TEXT[snap.error]}</p>
        <button onClick={onLeave}>返回</button>
      </main>
    );
  }

  const playing = snap.playback?.playing ?? false;

  return (
    <main className="room">
      <header>
        <div>
          <span className="label">房间</span> <span className="code">{snap.room ?? '……'}</span>
        </div>
        <div className="me">{PART_LABELS[part]}</div>
        <button className="leave" onClick={onLeave}>
          离开
        </button>
      </header>

      {snap.status !== 'open' && <div className="banner">{snap.status === 'reconnecting' ? '连接断开，正在重连…' : '连接中…'}</div>}
      {snap.error && <div className="banner">{ERROR_TEXT[snap.error]}</div>}

      {snap.playback && <BeatDisplay conn={conn} playback={snap.playback} />}

      <div className="controls">
        <button
          className={playing ? 'stop' : 'start'}
          disabled={snap.status !== 'open' || !snap.memberId}
          onClick={() => conn.command({ action: playing ? 'stop' : 'start' })}
        >
          {playing ? '停止' : '开始'}
        </button>
      </div>

      <footer>
        <ul className="members">
          {snap.members.map((m) => (
            <li key={m.id} className={m.id === snap.memberId ? 'self' : ''}>
              {PART_LABELS[m.part]}
            </li>
          ))}
        </ul>
      </footer>
    </main>
  );
}

/** Re-renders every animation frame; the beat is derived from the shared clock, never counted locally. */
function BeatDisplay({ conn, playback }: { conn: RoomConnection; playback: PlaybackState }) {
  const [, setFrame] = useState(0);
  useEffect(() => {
    let id = requestAnimationFrame(function tick() {
      setFrame((f) => f + 1);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const { clock } = conn;
  if (!clock.synced) return <div className="beat-display">同步时钟中…</div>;

  const bpb = DEFAULT_BEATS_PER_BAR;
  const beat = beatAt(playback, clock.serverNow());
  const { bar, beatInBar, phase } = barPosition(beat, bpb);
  const waiting = playback.playing && beat < -bpb;
  const countIn = playback.playing && !waiting && beat < 0;
  const flash = playback.playing && !waiting && phase < 0.15;
  const accent = beatInBar === 1;

  let status: string;
  if (!playback.playing) status = '已停止';
  else if (waiting) status = '准备…';
  else if (countIn) status = '预备拍';
  else status = `第 ${bar} 小节`;

  return (
    <div className={`beat-display${flash ? (accent ? ' flash accent' : ' flash') : ''}`}>
      <div className="status">{status}</div>
      <div className="beat-number">{playback.playing && !waiting ? beatInBar : '–'}</div>
      <div className="dots">
        {Array.from({ length: bpb }, (_, i) => (
          <span key={i} className={playback.playing && !waiting && i + 1 === beatInBar ? 'on' : ''} />
        ))}
      </div>
      <div className="meta">
        {playback.bpm} BPM · 延迟 {clock.rtt?.toFixed(0)}ms
      </div>
    </div>
  );
}
