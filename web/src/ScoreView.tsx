import { useEffect, useState, type CSSProperties } from 'react';
import {
  barPosition,
  beatAt,
  bpmAt,
  msPerBeat,
  pendingJump,
  DRUMS,
  partDetail,
  songPosition,
  strumIndex,
  type ClockSync,
  type CompiledSong,
  type Drum,
  type DrumPattern,
  type Meter,
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
  /** Jump to the start of the section at this form index. */
  onSeek: (sectionIndex: number) => void;
  onLoop: (sectionIndex: number | null) => void;
  onEditDrums: () => void;
};

/** Re-renders every animation frame; everything shown is derived from the shared clock, never counted locally. */
export function ScoreView({ clock, playback, compiled, part, flash, onRepeat, onSeek, onLoop, onEditDrums }: Props) {
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
  const now = clock.serverNow();
  const beat = beatAt(playback, now);
  const bpm = bpmAt(playback, now);
  const pending = pendingJump(playback, now);
  const loop = playback.loop;
  const pos = songPosition(compiled, beat);
  const countIn = playback.playing && beat < 0;
  const waiting = playback.playing && beat < -beatsPerBar;
  const ended = beat >= compiled.totalBeats;
  // Where a seek (or the count-in) is about to land.
  const target = pending?.beat !== undefined ? songPosition(compiled, pending.beat) : null;
  // Before the start (count-in or never started) show what's coming: the section and chord it starts on.
  const shown = pos ?? (ended ? null : (target ?? songPosition(compiled, 0)));
  const live = playback.playing && !!pos;
  // Stopped inside the song: 开始 picks up from this bar.
  const parked = !playback.playing && !!pos && beat > 0;
  // The bar being played, or the count-in bar before the song.
  const bar = pos && compiled.bars[pos.barIndex];
  const { beatInBar, phase } = bar ? { beatInBar: pos.beatInBar, phase: beat - Math.floor(beat) } : barPosition(beat, beatsPerBar);
  const ticking = playback.playing && !waiting && !ended;
  const beatFlash = flash && ticking && phase < 0.12;
  const detail = shown && partDetail(song, part, shown.section.id);
  const spec = song.parts[part];

  const location = pos && `${pos.section.label} · 第 ${pos.barInSection} 小节 · 第 ${pos.beatInBar} 拍`;
  const targetBar = target && `${target.section.label} 第 ${target.barInSection} 小节`;
  let where: string;
  if (ended) where = '结束';
  else if (!playback.playing) where = parked ? `从 ${pos!.section.label} 第 ${pos!.barInSection} 小节开始` : '准备好了';
  else if (waiting) where = targetBar && pending!.beat! > 0 ? `准备… 从 ${targetBar}` : '准备…';
  else if (countIn) where = `预备 ${beatInBar}${targetBar && pending!.beat! > 0 ? ` · 从 ${targetBar}` : ''}`;
  else where = location!;
  // A seek waiting for the barline; during the count-in the target is already in `where`.
  const jumpNotice = !countIn && targetBar && `下一小节 → ${targetBar}`;
  // The seek lands at the end of this bar: the current card previews where it goes.
  const barLeft = bar ? bar.startBeat + bar.beats - beat : 0;
  const jumpTo =
    live && target && pending && (pending.atServerTime - now) / msPerBeat(bpm) <= barLeft + 1e-3
      ? { chord: target.chord, label: target.section.label }
      : null;

  return (
    <div className="score">
      <div className="song-info">
        <span className="title">{song.title}</span>
        <span className="bpm">
          {bpm}
          {pending && pending.bpm !== bpm && <strong className="pending"> → {pending.bpm}</strong>} BPM
          {(pending?.bpm ?? bpm) !== song.bpm && <small>（原速 {song.bpm}）</small>}
          {song.key ? ` · ${song.key}` : ''}
        </span>
        <span className={`where${countIn && !waiting ? ' count-in' : ''}`}>{where}</span>
        {jumpNotice && <span className="pending">{jumpNotice}</span>}
        <Dots count={bar?.beats ?? beatsPerBar} current={ticking ? beatInBar : 0} flash={ticking && phase < 0.15} />
      </div>

      <div className={`chord-panel${beatFlash ? (beatInBar === 1 ? ' flash accent' : ' flash') : ''}`}>
        {shown ? (
          <LoopView
            compiled={compiled}
            shown={shown}
            beat={beat}
            live={live}
            parked={parked}
            looping={!!loop && loop.startBeat === shown.section.startBeat}
            jumpTo={jumpTo}
            onRepeat={playback.playing ? onRepeat : null}
            onUnloop={() => onLoop(null)}
          />
        ) : (
          <div className="chord dim">—</div>
        )}
      </div>

      <div className="part-panel">
        <div className="part-label">{spec?.label ?? part}</div>
        {detail ? (
          <PartDetails
            detail={detail}
            meter={bar?.meter ?? compiled.meter}
            beatInSection={live && shown ? beat - shown.section.startBeat : null}
            beatInBar={live && bar ? beat - bar.startBeat : null}
          />
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
          const progress = active ? (beat - s.startBeat) / (s.endBeat - s.startBeat) : 0;
          const looped = loop?.startBeat === s.startBeat;
          return (
            <li key={i} className={`${active ? 'active' : past ? 'past' : ''}${looped ? ' looped' : ''}`}>
              {/* Any member can jump; while playing it happens at the next barline. */}
              <button onClick={() => onSeek(i)}>
                {active && <span className="progress" style={{ width: `${progress * 100}%` }} />}
                <span className="name">
                  {looped && '🔁 '}
                  {s.label}
                  {s.times > 1 && <small> ×{s.times}</small>}
                </span>
              </button>
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
  parked,
  looping,
  jumpTo,
  onRepeat,
  onUnloop,
}: {
  compiled: CompiledSong;
  shown: SongPosition;
  beat: number;
  live: boolean;
  /** Stopped in this section: mark the bar 开始 picks up from. */
  parked: boolean;
  /** The room is looping this section, so there is no last pass and no next section. */
  looping: boolean;
  /** A seek landing at the end of the current bar. */
  jumpTo: NextUp | null;
  onRepeat: ((sectionIndex: number) => void) | null;
  onUnloop: () => void;
}) {
  const section = shown.section;
  const sectionIndex = compiled.sections.indexOf(section);
  // Bars can differ in length, so count bars rather than beats.
  const barInSection = shown.barInSection - 1;
  const placed = live || parked;
  const pass = placed ? Math.floor(barInSection / section.loopBars) : 0;
  const card = placed ? barInSection % section.loopBars : -1;
  const inBar = beat - compiled.bars[shown.barIndex].startBeat;
  const looped = section.times > 1;
  const lastPass = live && !looping && pass === section.times - 1;
  const remainingBars = section.barCount - barInSection;
  const next = compiled.sections[sectionIndex + 1];
  const bars = compiled.bars.slice(section.startBar, section.startBar + section.loopBars);
  const cols = Math.min(bars.length, 4);
  // The card whose bottom half shows the first chord of what comes next: the current card before a seek,
  // or the last card for the whole last pass, so the change is in view well before it happens.
  let split: { index: number } & NextUp = { index: -1, chord: '', label: '' };
  if (jumpTo && card >= 0) split = { index: card, ...jumpTo };
  else if (lastPass && next) split = { index: bars.length - 1, chord: compiled.bars[next.startBar].chords[0], label: next.label };

  return (
    <div className="loop">
      <div className="loop-head">
        <span className="section-name">{section.label}</span>
        {looping ? (
          <span className="pass looping">🔁 循环中{looped ? ` · 第 ${pass + 1} / ${section.times} 遍` : ''}</span>
        ) : (
          looped && (
            <span className={`pass${lastPass ? ' last' : ''}`}>
              {lastPass ? '最后一遍' : '第'} {pass + 1} / {section.times} {lastPass ? '' : '遍'}
            </span>
          )
        )}
        {looping ? (
          <button className="repeat" onClick={onUnloop}>
            取消循环
          </button>
        ) : (
          onRepeat && (
          <button className="repeat" onClick={() => onRepeat(sectionIndex)}>
            再绕一遍
            </button>
          )
        )}
      </div>
      <div className="cards" style={{ '--cols': cols, '--rows': Math.ceil(bars.length / cols) } as CSSProperties}>
        {bars.map((bar, i) => {
          const current = i === card;
          const slot = current ? Math.floor((inBar * bar.chords.length) / bar.beats) : -1;
          const chars = bar.chords.join(' ').length;
          const splitHere = i === split.index;
          return (
            <div
              key={i}
              className={`card${current ? ' current' : ''}${live || current ? '' : ' dim'}${splitHere ? ' split' : ''}`}
            >
              <div className="card-top">
                <div className="card-chords" style={{ '--scale': Math.min(1, 2.6 / chars) } as CSSProperties}>
                  {bar.chords.map((c, j) => (
                    <span key={j} className={j === slot && bar.chords.length > 1 ? 'now' : ''}>
                      {c}
                    </span>
                  ))}
                </div>
                <div className="card-dots">
                  {Array.from({ length: bar.beats }, (_, j) => (
                    <span key={j} className={live && current && j === Math.floor(inBar) ? 'on' : ''} />
                  ))}
                </div>
              </div>
              {splitHere && (
                <div className="card-next">
                  <span className="card-next-label">→ {split.label}</span>
                  <span
                    className="card-next-chord"
                    style={{ '--scale': Math.min(1, 2.6 / split.chord.length) } as CSSProperties}
                  >
                    {split.chord}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* Always takes its line, so the cards don't jump when the preview appears. */}
      <div className="preview">
        {live && next && lastPass && remainingBars <= Math.min(section.loopBars, 4) ? (
          <>
            下一段：<strong>{next.label}</strong> · {previewChords(compiled, next)}
          </>
        ) : (
          ' '
        )}
      </div>
    </div>
  );
}

/** First chord of what comes next, and the section it belongs to. */
type NextUp = { chord: string; label: string };

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

function PartDetails({
  detail,
  meter,
  beatInSection,
  beatInBar,
}: {
  detail: PartDetail;
  /** The current bar's meter. */
  meter: Meter;
  beatInSection: number | null;
  beatInBar: number | null;
}) {
  const { strum, pattern, groove } = detail;
  const current = strum && beatInSection !== null ? strumIndex(strum, beatInSection, meter.eighthsPerBeat) : -1;
  return (
    <>
      {strum && (
        <div className="strum">
          {[...strum].map((c, i) => (
            <span key={i} className={`${i === current ? 'current' : ''}${i % meter.eighthsPerBeat === 0 ? ' downbeat' : ''}`}>
              {STRUM_GLYPHS[c] ?? c}
            </span>
          ))}
        </div>
      )}
      {typeof pattern === 'string' && <div className="detail">{pattern}</div>}
      {groove && <div className="detail">{groove}</div>}
      {typeof pattern === 'object' && <DrumGrid pattern={pattern} meter={meter} beatInBar={beatInBar} />}
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

/** Step-sequencer view of the section's drum pattern, highlighting the current step. */
function DrumGrid({ pattern, meter, beatInBar }: { pattern: DrumPattern; meter: Meter; beatInBar: number | null }) {
  const rows = DRUMS.filter((d) => pattern[d]);
  const steps = pattern[rows[0]]?.length ?? 0;
  const spb = meter.stepsPerBeat;
  // Wraps like the drum machine does in a bar longer than the pattern.
  const current = beatInBar === null || !steps ? -1 : Math.floor(beatInBar * spb + 1e-9) % steps;
  return (
    <div className="drum-grid">
      {rows.map((d) => (
        <div key={d} className="drum-row">
          <span className="drum-name">{DRUM_LABELS[d]}</span>
          {[...pattern[d]!].map((hit, i) => (
            <span
              key={i}
              className={`step${hit === '.' ? '' : hit === 'X' ? ' hit accent' : ' hit'}${i === current ? ' current' : ''}${i % spb === 0 ? ' beat' : ''}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
