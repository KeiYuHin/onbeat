import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  applyDrumEdits,
  beatAt,
  compileSong,
  PART_LABELS,
  PARTS,
  resumeBeat,
  songPosition,
  type ErrorCode,
  type Part,
} from '@onbeat/shared';
import { AudioEngine } from './audio/engine';
import { useSoundSettings } from './audio/settings';
import { FATAL_ERRORS, RoomConnection, type RoomTarget } from './connection';
import { DrumEditor } from './DrumEditor';
import { Invite } from './Invite';
import { RehearsalPanel } from './RehearsalPanel';
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
  looping: '正在循环这一段，不用再绕一遍',
  'bad-position': '没有这个段落或小节',
  'bad-pattern': '鼓谱格式不对',
  'save-failed': '保存失败（看一下服务器窗口的报错）',
  'save-conflict': '歌曲文件已经在别处改过（比如电脑上改完推送了），这次没保存。等一分钟歌单更新后再保存',
  'bad-key': '这个房间用的是私有曲库，需要用乐队发的带密钥的链接打开',
  'rate-limited': '尝试次数太多，请一分钟后再试',
};

const WAKE_LOCK_HINT: Partial<Record<WakeLockStatus, string>> = {
  insecure: '屏幕常亮需要 HTTPS，局域网 http 下请把系统自动锁屏时间调长',
  unsupported: '这个浏览器不支持屏幕常亮，请把系统自动锁屏时间调长',
  denied: '无法保持屏幕常亮（可能是省电模式），请把系统自动锁屏时间调长',
};

type Props = {
  part: Part;
  libraryKey: string | null;
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
    const conn = new RoomConnection(target, initialPart, props.libraryKey);
    const audio = new AudioEngine(conn.clock);
    setSession({ conn, audio });
    return () => {
      conn.close();
      audio.dispose();
    };
  }, [target, initialPart, props.libraryKey]);
  return session && <RoomView {...session} {...props} />;
}

function RoomView({ conn, audio, part, libraryKey, onPartChange, onLeave, onRoom }: Props & Session) {
  const snap = useSyncExternalStore(conn.subscribe, conn.getSnapshot);
  const audioStatus = useSyncExternalStore(audio.subscribe, audio.getStatus);
  const wakeLock = useWakeLock();
  const [sound, setSound] = useSoundSettings();
  const [sheet, setSheet] = useState<null | 'sound' | 'rehearsal' | 'invite' | { drums: string | null }>(null);

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

  if (snap.error && FATAL_ERRORS.includes(snap.error)) {
    return (
      <main className="lobby">
        <p className="error">{ERROR_TEXT[snap.error]}</p>
        <button onClick={onLeave}>返回</button>
      </main>
    );
  }

  const playing = snap.playback?.playing ?? false;
  const ready = snap.status === 'open' && !!snap.memberId;
  // Stopped somewhere past the top: 开始 would pick up from there, so offer the way back.
  const parked = !playing && !!snap.playback && !!compiled && resumeBeat(snap.playback, compiled) > 0;

  return (
    <main className="room">
      <header className="topbar">
        <button className="code" disabled={!snap.room} onClick={() => setSheet('invite')} aria-label="邀请队友">
          {snap.room ?? '……'}
        </button>
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
          onSeek={(sectionIndex) => conn.command({ action: 'seek', sectionIndex, bar: 0 })}
          onLoop={(sectionIndex) => conn.command({ action: 'setLoop', sectionIndex })}
          onEditDrums={openDrumEditor}
        />
      ) : (
        <div className="score loading">加载中…</div>
      )}

      <div className="transport-row">
        {parked && (
          <button className="side" disabled={!ready} onClick={() => conn.command({ action: 'seek', sectionIndex: 0, bar: 0 })}>
            ⏮ 从头
          </button>
        )}
        <button
          className={`transport ${playing ? 'stop' : 'start'}`}
          disabled={!ready}
          onClick={() => conn.command({ action: playing ? 'stop' : 'start' })}
        >
          {playing ? '停止' : '开始'}
        </button>
        <button className="side" disabled={!ready || !compiled} onClick={() => setSheet('rehearsal')}>
          排练
        </button>
      </div>

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
      {sheet === 'invite' && snap.room && (
        <Sheet title="邀请队友" onClose={() => setSheet(null)}>
          <Invite room={snap.room} libraryKey={libraryKey} />
        </Sheet>
      )}
      {sheet === 'rehearsal' && snap.playback && compiled && (
        <Sheet title="排练控制（全房间同步）" onClose={() => setSheet(null)}>
          {snap.error && <div className="banner">{ERROR_TEXT[snap.error]}</div>}
          <RehearsalPanel
            clock={conn.clock}
            playback={snap.playback}
            compiled={compiled}
            onCommand={(cmd) => conn.command(cmd)}
            onDone={() => setSheet(null)}
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
            onSetAll={(pattern) => conn.command({ action: 'setDrumsAll', pattern })}
            onSave={(device) => conn.command({ action: 'saveSong', ...(device && { device }) })}
            part={part}
          />
        </Sheet>
      )}
    </main>
  );
}
