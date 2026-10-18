import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  applyDrumEdits,
  beatAt,
  compileSong,
  PART_LABELS,
  PARTS,
  songPosition,
  type ErrorCode,
  type Part,
} from '@onbeat/shared';
import { AudioEngine } from './audio/engine';
import { useSoundSettings } from './audio/settings';
import { RoomConnection, type RoomTarget } from './connection';
import { DrumEditor } from './DrumEditor';
import { ScoreView } from './ScoreView';
import { Sheet } from './Sheet';
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

type Props = {
  part: Part;
  onPartChange: (part: Part) => void;
  onLeave: () => void;
  onRoom: (room: string) => void;
};

type Session = { conn: RoomConnection; audio: AudioEngine };

/** Owns the connection and the audio engine for as long as the user is in the room. */
export function Room({ target, ...props }: Props & { target: RoomTarget }) {
  const [session, setSession] = useState<Session | null>(null);
  // The connection outlives part switches (they're a message, not a rejoin), so only the first part matters here.
  const initialPart = useRef(props.part).current;
  useEffect(() => {
    const conn = new RoomConnection(target, initialPart);
    const audio = new AudioEngine(conn.clock);
    setSession({ conn, audio });
    return () => {
      conn.close();
      audio.dispose();
    };
  }, [target, initialPart]);
  return session && <RoomView {...session} {...props} />;
}

function RoomView({ conn, audio, part, onPartChange, onLeave, onRoom }: Props & Session) {
  const snap = useSyncExternalStore(conn.subscribe, conn.getSnapshot);
  const audioStatus = useSyncExternalStore(audio.subscribe, audio.getStatus);
  const wakeLock = useWakeLock();
  const [sound, setSound] = useSoundSettings();
  const [sheet, setSheet] = useState<null | 'sound' | { drums: string | null }>(null);

  useEffect(() => {
    if (snap.room && snap.memberId) onRoom(snap.room);
  }, [snap.room, snap.memberId, onRoom]);

  const songId = snap.playback?.songId;
  const baseSong = snap.songs.find((s) => s.id === songId);
  const drumEdits = snap.edits && snap.edits.songId === songId ? snap.edits.drums : null;
  // New state objects arrive for every command; only recompile when the passes actually change.
  const passesKey = JSON.stringify(snap.playback?.extraPasses ?? {});
  const compiled = useMemo(
    () => baseSong && compileSong(applyDrumEdits(baseSong, drumEdits), JSON.parse(passesKey)),
    [baseSong, drumEdits, passesKey],
  );

  const openDrumEditor = () => {
    const pos = snap.playback && compiled && songPosition(compiled, beatAt(snap.playback, conn.clock.serverNow()));
    setSheet({ drums: pos?.section.id ?? null });
  };

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
        <select
          className="me"
          aria-label="我的声部"
          value={part}
          onChange={(e) => {
            const p = e.target.value as Part;
            conn.setPart(p);
            onPartChange(p);
          }}
        >
          {PARTS.map((p) => (
            <option key={p} value={p}>
              {PART_LABELS[p]}
            </option>
          ))}
        </select>
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
        <button className={`sound-button${audioStatus === 'on' ? ' on' : ''}`} onClick={() => setSheet('sound')}>
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

      {snap.playback && compiled ? (
        <ScoreView
          clock={conn.clock}
          playback={snap.playback}
          compiled={compiled}
          part={part}
          flash={sound.flash}
          onRepeat={(sectionIndex) => conn.command({ action: 'repeatSection', sectionIndex })}
          onEditDrums={openDrumEditor}
        />
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

      {sheet === 'sound' && (
        <Sheet title="声音（只影响本机）" onClose={() => setSheet(null)}>
          <SoundPanel
            settings={sound}
            onChange={setSound}
            onEnable={() => audio.unlock()}
            onEditDrums={compiled ? openDrumEditor : undefined}
          />
        </Sheet>
      )}
      {typeof sheet === 'object' && sheet && compiled && (
        <Sheet title={`编辑鼓谱 · ${compiled.song.title}`} onClose={() => setSheet(null)}>
          {/* An error banner inside the sheet, since the room's banners are hidden behind it. */}
          {snap.error && <div className="banner">{ERROR_TEXT[snap.error]}</div>}
          <DrumEditor
            compiled={compiled}
            edits={drumEdits ?? {}}
            initialSectionId={sheet.drums}
            onSet={(sectionId, pattern) => conn.command({ action: 'setDrums', sectionId, pattern })}
            onSave={() => conn.command({ action: 'saveSong' })}
          />
        </Sheet>
      )}
    </main>
  );
}
