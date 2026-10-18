import { useState } from 'react';
import {
  beatAt,
  bpmAt,
  MAX_BPM,
  MIN_BPM,
  pendingJump,
  songPosition,
  type ClockSync,
  type Command,
  type CompiledSong,
  type PlaybackState,
} from '@onbeat/shared';

type Props = {
  clock: ClockSync;
  playback: PlaybackState;
  compiled: CompiledSong;
  onCommand: (cmd: Command) => void;
  /** Jumps and loops close the sheet so the score is visible again; tempo taps keep it open. */
  onDone: () => void;
};

const TEMPO_STEPS = [-5, -1, 1, 5];
const TEMPO_PERCENTS = [70, 80, 90, 100];

/** M3 controls shared by the whole room: tempo, jump to a section or bar, loop a section. */
export function RehearsalPanel({ clock, playback, compiled, onCommand, onDone }: Props) {
  const now = clock.serverNow();
  const songBpm = compiled.song.bpm;
  // While playing, a tempo change waits for the barline; show (and step from) where it's going.
  const bpm = pendingJump(playback, now)?.bpm ?? bpmAt(playback, now);
  const setBpm = (to: number) =>
    onCommand({ action: 'setBpm', bpm: Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(to))) });

  const current = songPosition(compiled, Math.max(0, playbackBeat(playback, now)))?.section;
  const loop = playback.loop;
  const [open, setOpen] = useState(() => (current ? compiled.sections.indexOf(current) : -1));

  const act = (cmd: Command) => {
    onCommand(cmd);
    onDone();
  };

  return (
    <div className="rehearsal">
      <h3>速度</h3>
      <div className="tempo">
        {TEMPO_STEPS.slice(0, 2).map((d) => (
          <button key={d} onClick={() => setBpm(bpm + d)}>
            {d}
          </button>
        ))}
        <span className="tempo-value">
          <strong>{bpm}</strong> BPM
          <small>
            原速 {songBpm} · {Math.round((bpm / songBpm) * 100)}%
          </small>
        </span>
        {TEMPO_STEPS.slice(2).map((d) => (
          <button key={d} onClick={() => setBpm(bpm + d)}>
            +{d}
          </button>
        ))}
      </div>
      <div className="row">
        {TEMPO_PERCENTS.map((p) => (
          <button
            key={p}
            className={Math.round((songBpm * p) / 100) === bpm ? 'selected' : ''}
            onClick={() => setBpm((songBpm * p) / 100)}
          >
            {p === 100 ? '原速' : `${p}%`}
          </button>
        ))}
      </div>
      <p className="muted">
        {playback.playing ? '播放中改动在下一个小节线生效，所有人一起变。' : '停止时改动马上生效，点「开始」后先有一小节预备拍。'}
      </p>

      <h3>跳转 / 循环</h3>
      <ol className="section-list">
        {compiled.sections.map((s, i) => {
          const looped = loop?.startBeat === s.startBeat;
          return (
            <li key={i} className={s === current ? 'current' : ''}>
              <div className="section-row">
                <button className="section-toggle" onClick={() => setOpen(open === i ? -1 : i)}>
                  <span className="caret">{open === i ? '▾' : '▸'}</span> {s.label}
                  {s.times > 1 && <small> ×{s.times}</small>}
                </button>
                <button onClick={() => act({ action: 'seek', sectionIndex: i, bar: 0 })}>跳到这里</button>
                <button
                  className={looped ? 'selected' : ''}
                  onClick={() => act({ action: 'setLoop', sectionIndex: looped ? null : i })}
                >
                  {looped ? '取消循环' : '循环'}
                </button>
              </div>
              {open === i && (
                <div className="bar-grid">
                  {compiled.bars.slice(s.startBar, s.startBar + s.barCount).map((bar, b) => (
                    <button key={b} onClick={() => act({ action: 'seek', sectionIndex: i, bar: b })}>
                      <span className="bar-number">{b + 1}</span>
                      <span className="bar-chords">{bar.chords.join(' ')}</span>
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Position for picking the current section: a pending seek's target (or the count-in's bar) counts as where we are. */
const playbackBeat = (playback: PlaybackState, now: number) =>
  pendingJump(playback, now)?.beat ?? beatAt(playback, now);
