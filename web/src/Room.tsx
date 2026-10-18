import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { compileSong, PART_LABELS, type ErrorCode, type Part } from '@onbeat/shared';
import { AudioEngine } from './audio/engine';
import { useSoundSettings } from './audio/settings';
import { RoomConnection, type RoomTarget } from './connection';
import { ScoreView } from './ScoreView';
import { SoundPanel } from './SoundPanel';
import { useWakeLock, type WakeLockStatus } from './wakeLock';

const ERROR_TEXT: Record<ErrorCode, string> = {
  'room-not-found': '房间不存在（可能已过期或服务器重启了）',
  'bad-message': '消息格式错误',
  'not-in-room': '还没有进入房间',
  'song-not-found': '找不到这首歌',
  'too-late': '这一段马上结束了，来不及再绕一遍',
  'bad-pattern': '鼓谱格式不对',
  'save-failed': '保存失败（看一下服务器窗口的报错）',
};

const WAKE_LOCK_HINT: Partial<Record<WakeLockStatus, string>> = {
  insecure: '屏幕常亮需要 HTTPS，局域网 http 下请把系统自动锁屏时间调长',
  unsupported: '这个浏览器不支持屏幕常亮，请把系统自动锁屏时间调长',
  denied: '无法保持屏幕常亮（可能是省电模式），请把系统自动锁屏时间调长',
};

type Props = { part: Part; onLeave: () => void; onRoom: (room: string) => void };

type Session = { conn: RoomConnection; audio: AudioEngine };

/** Owns the connection and the audio engine for as long as the user is in the room. */
export function Room({ target, ...props }: Props & { target: RoomTarget }) {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    const conn = new RoomConnection(target, props.part);
    const audio = new AudioEngine(conn.clock);
    setSession({ conn, audio });
    return () => {
      conn.close();
      audio.dispose();
    };
  }, [target, props.part]);
  return session && <RoomView {...session} {...props} />;
}

function RoomView({ conn, audio, part, onLeave, onRoom }: Props & Session) {
  const snap = useSyncExternalStore(conn.subscribe, conn.getSnapshot);
  const audioStatus = useSyncExternalStore(audio.subscribe, audio.getStatus);
  const wakeLock = useWakeLock();
  const [sound, setSound] = useSoundSettings();
  const [showSound, setShowSound] = useState(false);

  useEffect(() => {
    if (snap.room && snap.memberId) onRoom(snap.room);
  }, [snap.room, snap.memberId, onRoom]);

  const song = snap.songs.find((s) => s.id === snap.playback?.songId);
  const compiled = useMemo(() => song && compileSong(song), [song]);

  useEffect(() => {
    audio.update(snap.playback, compiled ?? null, sound);
  }, [audio, snap.playback, compiled, sound]);

  // Sound was left on from last time, but browsers only start audio from a tap: take the first one anywhere.
  useEffect(() => {
    if (audioStatus !== 'locked') return;
    const unlock = () => audio.unlock();
    document.addEventListener('pointerdown', unlock, { once: true });
    return () => document.removeEventListener('pointerdown', unlock);
  }, [audio, audioStatus]);

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
        <button
          className={`sound-button${audioStatus === 'on' ? ' on' : ''}`}
          aria-expanded={showSound}
          onClick={() => setShowSound((v) => !v)}
        >
          {audioStatus === 'off' ? '🔇' : '🔊'} 声音
        </button>
        <button className="leave" onClick={onLeave}>
          离开
        </button>
      </header>

      {snap.status !== 'open' && (
        <div className="banner">{snap.status === 'reconnecting' ? '连接断开，正在重连…' : '连接中…'}</div>
      )}
      {snap.error && <div className="banner">{ERROR_TEXT[snap.error]}</div>}
      {WAKE_LOCK_HINT[wakeLock] && <div className="banner subtle">{WAKE_LOCK_HINT[wakeLock]}</div>}
      {audioStatus === 'locked' && <div className="banner">点一下屏幕开启声音</div>}
      {showSound && <SoundPanel settings={sound} onChange={setSound} onEnable={() => audio.unlock()} />}

      {snap.playback && compiled ? (
        <ScoreView clock={conn.clock} playback={snap.playback} compiled={compiled} part={part} flash={sound.flash} />
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
