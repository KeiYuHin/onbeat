import { memo } from 'react';
import { PART_LABELS, type CompiledSong, type JpBar, type JpLine, type Note, type Part } from '@onbeat/shared';
import { ChordName } from './ChordName';
import { chordLabel, shortChord, type DisplaySettings } from './display';

/** Part names as a chart writes them in front of a part line (`Bs: 4. 4_ 5 -`). */
const PART_SHORT: Record<Part, string> = { guitar1: 'Gt1', guitar2: 'Gt2', bass: 'Bs', drums: 'Dr', keys: 'Key' };

type PassProps = {
  compiled: CompiledSong;
  display: DisplaySettings;
  bars: JpBar[];
  /** CSS state class of each bar: ' current', ' past', ' target' or ''. */
  state: (bar: number) => string;
  /** The playing bar and note, or -1. */
  current: number;
  note: number;
  onSeekBar: (sectionIndex: number, bar: number) => void;
};

/** One pass of a section as jianpu bars, wrapping into rows as the width allows. */
export function JianpuPass({ compiled, display, bars, state, current, note, onSeekBar }: PassProps) {
  // Every bar of the pass keeps a row for cues if one has any, so the notes stay lined up across the row.
  const cueRow = bars.some((b) => b.cues.length > 0);
  return (
    <div className="jp-pass">
      {bars.map((b) => (
        <JianpuBar
          key={b.bar}
          compiled={compiled}
          display={display}
          bar={b}
          state={state(b.bar)}
          note={b.bar === current ? note : -1}
          cueRow={cueRow}
          onSeekBar={onSeekBar}
        />
      ))}
    </div>
  );
}

type BarProps = {
  compiled: CompiledSong;
  display: DisplaySettings;
  bar: JpBar;
  state: string;
  note: number;
  cueRow: boolean;
  onSeekBar: (sectionIndex: number, bar: number) => void;
};

/** Memoized, so only the playing bar re-renders as its notes go by. */
const JianpuBar = memo(function JianpuBar({ compiled, display, bar, state, note, cueRow, onSeekBar }: BarProps) {
  const span = compiled.bars[bar.bar];
  const seek = () => onSeekBar(span.sectionIndex, bar.bar - compiled.sections[span.sectionIndex].startBar);
  const keyed = !!compiled.song.key;
  const melodic = !!span.melody;
  return (
    <div
      data-bar={bar.bar}
      className={`jp-bar${state}${bar.repeatStart ? ' repeat-start' : ''}${bar.repeatEnd ? ' repeat-end' : ''}`}
      style={{ flexGrow: span.beats }}
      onClick={seek}
    >
      {cueRow && (
        <div className="jp-cues">
          {bar.cues.map((c, i) => (
            <span key={i} className="jp-cue">
              {c.part && `${compiled.song.parts[c.part]?.label ?? PART_LABELS[c.part]}：`}
              {c.text}
            </span>
          ))}
        </div>
      )}
      <div className="jp-row">
        {bar.columns.map((col, i) => (
          <div key={i} className={`jp-col${col.index === note && note >= 0 ? ' now' : ''}`} style={{ flexGrow: col.beats }}>
            <div className="jp-chords">
              {col.chords.map(({ slot, key }, k) => (
                <ChordName key={k} className="jp-chord" label={shortChord(chordLabel(slot, key, display, keyed))} />
              ))}
            </div>
            {col.note ? (
              <NoteGlyph note={col.note} join={col.join} tiedIn={i === 0 && span.tiedIn} last={i === bar.columns.length - 1} />
            ) : (
              <div className="jp-note" />
            )}
            {melodic && <div className="jp-syllable">{col.syllable || ' '}</div>}
          </div>
        ))}
      </div>
      {bar.words && <div className="jp-words">{bar.words}</div>}
      {bar.lines.map((line) => (
        <PartLine key={line.part} line={line} />
      ))}
    </div>
  );
});

function PartLine({ line }: { line: JpLine }) {
  return (
    <div className="jp-line">
      {line.label && <span className="jp-line-label">{PART_SHORT[line.part]}:</span>}
      {line.notes.map(({ note, join }, i) => (
        <div key={i} className="jp-col" style={{ flexGrow: note.beats }}>
          <NoteGlyph note={note} join={join} last={i === line.notes.length - 1} />
        </div>
      ))}
      {line.more && <span className="jp-more">~</span>}
    </div>
  );
}

/**
 * A jianpu note: the number with its octave dots, underlines and dot. Underlines shared with the next note
 * run on to it; an arc reaches over to the next note. An arc over a barline is drawn in halves, one out of
 * the bar's last note and one into the next bar's first (`tiedIn`), so it still reads across a line break.
 */
function NoteGlyph({ note, join, tiedIn = false, last }: { note: Note; join: number; tiedIn?: boolean; last: boolean }) {
  const raised = note.octave > 0 ? ' raised' : '';
  const lines = Array.from({ length: note.underlines }, (_, k) => k + 1);
  const low = Math.max(0, -note.octave);
  return (
    <div className="jp-note">
      {note.octave > 0 && (
        <span className="jp-dots high">
          {Array.from({ length: note.octave }, (_, k) => (
            <i key={k} />
          ))}
        </span>
      )}
      {tiedIn && <span className={`jp-arc in${raised}`} />}
      {note.arc && <span className={`jp-arc${last ? ' out' : ''}${raised}`} />}
      <span className="jp-digit">
        {note.accidental && <sup className="jp-acc">{note.accidental === '#' ? '♯' : '♭'}</sup>}
        {note.degree ?? '–'}
        {note.dotted && <span className="jp-dot">.</span>}
      </span>
      {lines.map((k) => (
        <span key={k} className={`jp-underline${k <= join ? ' joined' : ''}`} style={{ top: `calc(1.62em + ${(k - 1) * 0.18}em)` }} />
      ))}
      {low > 0 && (
        <span className="jp-dots low" style={{ top: `calc(1.62em + ${note.underlines * 0.18 + 0.06}em)` }}>
          {Array.from({ length: low }, (_, k) => (
            <i key={k} />
          ))}
        </span>
      )}
    </div>
  );
}
