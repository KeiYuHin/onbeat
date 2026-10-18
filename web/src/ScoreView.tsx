import { useEffect, useState, type CSSProperties } from 'react';
import {
  barPosition,
  beatAt,
  DRUMS,
  partDetail,
  songPosition,
  strumIndex,
  type ClockSync,
  type CompiledSong,
  type Drum,
  type DrumPattern,
  type Part,
  type PartDetail,
  type PlaybackState,
  type SectionSpan,
  type SongPosition,
} from '@onbeat/shared';

const STRUM_GLYPHS: Record<string, string> = { D: '↓', U: '↑', '-': '·' };

type Props = {
  clock: ClockSync;
  playback: PlaybackState;
  compiled: CompiledSong;
  part: Part;
  flash: boolean;
  /** "再绕一遍" for the section at this form index. */
  onRepeat: (sectionIndex: number) => void;
  onEditDrums: () => void;
};

/** Re-renders every animation frame; everything shown is derived from the shared clock, never counted locally. */
export function ScoreView({ clock, playback, compiled, part, flash, onRepeat, onEditDrums }: Props) {
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
  const beatFlash = flash && ticking && phase < 0.12;
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

      <div className={`chord-panel${beatFlash ? (beatInBar === 1 ? ' flash accent' : ' flash') : ''}`}>
        {shown ? (
          <LoopView
            compiled={compiled}
            shown={shown}
            beat={beat}
            live={live}
            onRepeat={playback.playing ? onRepeat : null}
          />
        ) : (
          <div className="chord dim">—</div>
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
        {part === 'drums' && (
          <button className="small edit-drums" onClick={onEditDrums}>
            编辑鼓谱
          </button>
        )}
      </div>

      <ol className="timeline">
        {sections.map((s, i) => {
          const active = pos?.section === s;
          const past = !!pos && i < sections.indexOf(pos.section);
          const progress = active ? (beat - s.startBeat) / (s.barCount * beatsPerBar) : 0;
          return (
            <li key={i} className={active ? 'active' : past ? 'past' : ''}>
              {active && <span className="progress" style={{ width: `${progress * 100}%` }} />}
              <span className="name">
                {s.label}
                {s.times > 1 && <small> ×{s.times}</small>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Bars of one pass shown as cards; the cursor goes round them while the pass counter climbs. */
function LoopView({
  compiled,
  shown,
  beat,
  live,
  onRepeat,
}: {
  compiled: CompiledSong;
  shown: SongPosition;
  beat: number;
  live: boolean;
  onRepeat: ((sectionIndex: number) => void) | null;
}) {
  const { beatsPerBar: bpb } = compiled;
  const section = shown.section;
  const sectionIndex = compiled.sections.indexOf(section);
  const loopBeats = section.loopBars * bpb;
  const inSection = beat - section.startBeat;
  const pass = live ? Math.floor(inSection / loopBeats) : 0;
  const card = live ? Math.floor(inSection / bpb) % section.loopBars : -1;
  const inBar = inSection - Math.floor(inSection / bpb) * bpb;
  const looped = section.times > 1;
  const lastPass = live && pass === section.times - 1;
  const remainingBars = section.barCount - Math.floor(inSection / bpb);
  const next = compiled.sections[sectionIndex + 1];
  const bars = compiled.bars.slice(section.startBar, section.startBar + section.loopBars);
  const cols = Math.min(bars.length, 4);

  return (
    <div className="loop">
      <div className="loop-head">
        <span className="section-name">{section.label}</span>
        {looped && (
          <span className={`pass${lastPass ? ' last' : ''}`}>
            {lastPass && '最后一遍 · '}第 {pass + 1} / {section.times} 遍
          </span>
        )}
        {onRepeat && (
          <button className="repeat" onClick={() => onRepeat(sectionIndex)}>
            再绕一遍
          </button>
        )}
      </div>
      <div className="cards" style={{ '--cols': cols, '--rows': Math.ceil(bars.length / cols) } as CSSProperties}>
        {bars.map((bar, i) => {
          const current = i === card;
          const slot = current ? Math.floor((inBar * bar.chords.length) / bpb) : -1;
          const chars = bar.chords.join(' ').length;
          return (
            <div key={i} className={`card${current ? ' current' : ''}${live ? '' : ' dim'}`}>
              <div className="card-chords" style={{ '--scale': Math.min(1, 2.6 / chars) } as CSSProperties}>
                {bar.chords.map((c, j) => (
                  <span key={j} className={j === slot && bar.chords.length > 1 ? 'now' : ''}>
                    {c}
                  </span>
                ))}
              </div>
              <div className="card-dots">
                {Array.from({ length: bpb }, (_, j) => (
                  <span key={j} className={current && j === Math.floor(inBar) ? 'on' : ''} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {live && next && lastPass && remainingBars <= Math.min(section.loopBars, 4) && (
        <div className="preview">
          下一段：<strong>{next.label}</strong> · {previewChords(compiled, next)}
        </div>
      )}
    </div>
  );
}

/** "F G C Am": the chords of one pass of a section, repeats of the same chord merged. */
function previewChords(compiled: CompiledSong, section: SectionSpan): string {
  const chords = compiled.bars
    .slice(section.startBar, section.startBar + section.loopBars)
    .flatMap((b) => b.chords)
    .filter((c, i, all) => i === 0 || c !== all[i - 1]);
  return chords.length > 8 ? `${chords.slice(0, 8).join(' ')} …` : chords.join(' ');
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
      {typeof pattern === 'object' && <DrumGrid pattern={pattern} beatInSection={beatInSection} />}
    </>
  );
}

const DRUM_LABELS: Record<Drum, string> = {
  kick: '底鼓',
  snare: '军鼓',
  hat: '踩镲',
  crash: '吊镲',
  ride: '叮叮',
  tom: '通鼓',
};

/** Step-sequencer view of the section's drum pattern, highlighting the current sixteenth. */
function DrumGrid({ pattern, beatInSection }: { pattern: DrumPattern; beatInSection: number | null }) {
  const rows = DRUMS.filter((d) => pattern[d]);
  const steps = pattern[rows[0]]?.length ?? 0;
  // Sections start on a barline, so this is also the step within the current bar.
  const current = beatInSection === null || !steps ? -1 : Math.floor(beatInSection * 4) % steps;
  return (
    <div className="drum-grid">
      {rows.map((d) => (
        <div key={d} className="drum-row">
          <span className="drum-name">{DRUM_LABELS[d]}</span>
          {[...pattern[d]!].map((hit, i) => (
            <span
              key={i}
              className={`step${hit === '.' ? '' : hit === 'X' ? ' hit accent' : ' hit'}${i === current ? ' current' : ''}${i % 4 === 0 ? ' beat' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
