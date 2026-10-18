import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { compileSong, PART_LABELS, type ErrorCode, type Part } from '@onbeat/shared';
import { RoomConnection, type RoomTarget } from './connection';
import { ScoreView } from './ScoreView';
import { useWakeLock, type WakeLockStatus } from './wakeLock';

const ERROR_TEXT: Record<ErrorCode, string> = {
  'room-not-found': '房间不存在（可能已过期或服务器重启了）',
  'bad-message': '消息格式错误',
  'not-in-room': '还没有进入房间',
  'song-not-found': '找不到这首歌',
};

const WAKE_LOCK_HINT: Partial<Record<WakeLockStatus, string>> = {
  insecure: '屏幕常亮需要 HTTPS，局域网 http 下请把系统自动锁屏时间调长',
  unsupported: '这个浏览器不支持屏幕常亮，请把系统自动锁屏时间调长',
  denied: '无法保持屏幕常亮（可能是省电模式），请把系统自动锁屏时间调长',
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
  const wakeLock = useWakeLock();

  useEffect(() => {
    if (snap.room && snap.memberId) onRoom(snap.room);
  }, [snap.room, snap.memberId, onRoom]);

  const song = snap.songs.find((s) => s.id === snap.playback?.songId);
  const compiled = useMemo(() => song && compileSong(song), [song]);

  if (snap.error === 'room-not-found') {
    return (
      <main className="lobby">
        <p className="error">{ERROR_TEXT[snap.error]}</p>
        <button onClick={onLeave}>返回</button>
      </main>
    );
  }

  const playing = snap.playback?.playing ?? false;
  const ready = snap.status === 'open' && !!snap.memberId;

  return (
    <main className="room">
      <header className="topbar">
        <span className="code">{snap.room ?? '……'}</span>
        <span className="me">{PART_LABELS[part]}</span>
        {snap.songs.length > 1 && (
          <select
            className="song-select"
            value={snap.playback?.songId}
            disabled={!ready}
            onChange={(e) => conn.command({ action: 'selectSong', songId: e.target.value })}
          >
            {snap.songs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
        )}
        <ul className="members">
          {snap.members.map((m) => (
            <li key={m.id} className={m.id === snap.memberId ? 'self' : ''}>
              {PART_LABELS[m.part]}
            </li>
          ))}
        </ul>
        <button className="leave" onClick={onLeave}>
          离开
        </button>
      </header>

      {snap.status !== 'open' && (
        <div className="banner">{snap.status === 'reconnecting' ? '连接断开，正在重连…' : '连接中…'}</div>
      )}
      {snap.error && <div className="banner">{ERROR_TEXT[snap.error]}</div>}
      {WAKE_LOCK_HINT[wakeLock] && <div className="banner subtle">{WAKE_LOCK_HINT[wakeLock]}</div>}

      {snap.playback && compiled ? (
        <ScoreView clock={conn.clock} playback={snap.playback} compiled={compiled} part={part} />
      ) : (
        <div className="score loading">加载中…</div>
      )}

      <button
        className={`transport ${playing ? 'stop' : 'start'}`}
        disabled={!ready}
        onClick={() => conn.command({ action: playing ? 'stop' : 'start' })}
      >
        {playing ? '停止' : '开始'}
      </button>
    </main>
  );
}
