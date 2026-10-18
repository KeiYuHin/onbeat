import { useEffect, useState } from 'react';
import {
  barPosition,
  beatAt,
  partDetail,
  songPosition,
  strumIndex,
  type ClockSync,
  type CompiledSong,
  type Part,
  type PartDetail,
  type PlaybackState,
} from '@onbeat/shared';

const STRUM_GLYPHS: Record<string, string> = { D: '↓', U: '↑', '-': '·' };

type Props = { clock: ClockSync; playback: PlaybackState; compiled: CompiledSong; part: Part };

/** Re-renders every animation frame; everything shown is derived from the shared clock, never counted locally. */
export function ScoreView({ clock, playback, compiled, part }: Props) {
  const [, setFrame] = useState(0);
  useEffect(() => {
    let id = requestAnimationFrame(function tick() {
      setFrame((f) => f + 1);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  if (!clock.synced) return <div className="score loading">同步时钟中…</div>;

  const { song, beatsPerBar, sections } = compiled;
  const beat = beatAt(playback, clock.serverNow());
  const pos = songPosition(compiled, beat);
  const countIn = playback.playing && beat < 0;
  const waiting = playback.playing && beat < -beatsPerBar;
  const ended = beat >= compiled.totalBeats;
  // Before the start (count-in or never started) show what's coming: the opening section and chord.
  const shown = pos ?? (ended ? null : songPosition(compiled, 0));
  const live = playback.playing && !!pos;
  const { beatInBar, phase } = barPosition(beat, beatsPerBar);
  const ticking = playback.playing && !waiting && !ended;
  const detail = shown && partDetail(song, part, shown.section.id);
  const spec = song.parts[part];

  const location = pos && `${pos.section.label} · 第 ${pos.barInSection} 小节 · 第 ${pos.beatInBar} 拍`;
  let where: string;
  if (ended) where = '结束';
  else if (!playback.playing) where = location && beat > 0 ? `已停止 · ${location}` : '准备好了';
  else if (waiting) where = '准备…';
  else if (countIn) where = `预备 ${beatInBar}`;
  else where = location!;

  return (
    <div className="score">
      <div className="song-info">
        <span className="title">{song.title}</span>
        <span className="bpm">
          {playback.bpm} BPM{song.key ? ` · ${song.key}` : ''}
        </span>
        <span className={`where${countIn && !waiting ? ' count-in' : ''}`}>{where}</span>
        <Dots count={beatsPerBar} current={ticking ? beatInBar : 0} flash={ticking && phase < 0.15} />
      </div>

      <div className="chord-panel">
        <div className={`chord${live ? '' : ' dim'}`}>{shown?.chord ?? '—'}</div>
        {shown?.next && (
          <div className="next">
            下一个 <strong>{shown.next.chord}</strong>
            {live && <span className="in"> {Math.ceil(shown.next.inBeats)} 拍后</span>}
          </div>
        )}
      </div>

      <div className="part-panel">
        <div className="part-label">{spec?.label ?? part}</div>
        {detail ? (
          <PartDetails detail={detail} beatInSection={live && shown ? beat - shown.section.startBeat : null} />
        ) : (
          <div className="detail muted">这首歌没有写这个声部，跟和弦走</div>
        )}
        {spec?.notes && <div className="notes">{spec.notes}</div>}
      </div>

      <ol className="timeline">
        {sections.map((s, i) => {
          const active = pos?.section === s;
          const past = !!pos && i < sections.indexOf(pos.section);
          const progress = active ? (beat - s.startBeat) / (s.barCount * beatsPerBar) : 0;
          return (
            <li key={i} className={active ? 'active' : past ? 'past' : ''}>
              {active && <span className="progress" style={{ width: `${progress * 100}%` }} />}
              <span className="name">{s.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Dots({ count, current, flash }: { count: number; current: number; flash: boolean }) {
  return (
    <span className="dots">
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={i + 1 === current ? (flash ? (i === 0 ? 'on flash accent' : 'on flash') : 'on') : ''}
        />
      ))}
    </span>
  );
}

function PartDetails({ detail, beatInSection }: { detail: PartDetail; beatInSection: number | null }) {
  const { strum, pattern, groove } = detail;
  const current = strum && beatInSection !== null ? strumIndex(strum, beatInSection) : -1;
  return (
    <>
      {strum && (
        <div className="strum">
          {[...strum].map((c, i) => (
            <span key={i} className={`${i === current ? 'current' : ''}${i % 2 === 0 ? ' downbeat' : ''}`}>
              {STRUM_GLYPHS[c] ?? c}
            </span>
          ))}
        </div>
      )}
      {typeof pattern === 'string' && <div className="detail">{pattern}</div>}
      {groove && <div className="detail">{groove}</div>}
    </>
  );
}
