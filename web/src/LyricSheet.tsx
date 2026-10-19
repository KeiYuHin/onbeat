import { Fragment, memo, useEffect, useMemo, useRef } from 'react';
import { lyricSheet, type CompiledSong } from '@onbeat/shared';
import { ChordName, type ChordNamer } from './ChordName';
import { chordLabel, shortChord, type DisplaySettings } from './display';

/** With a focus, sections further away than this aren't shown at all. */
const FOCUS_RANGE = 2;

/** After the reader touches or scrolls the sheet, it stops following the playing bar for this long. */
const MANUAL_SCROLL_MS = 4000;

type Props = {
  compiled: CompiledSong;
  display: DisplaySettings;
  /** The bar being played (or the one 开始 picks up from), or -1. */
  current: number;
  /** Where a pending seek lands, or -1. */
  target: number;
  /** Start of the looped section, if any. */
  loopStart: number | null;
  /**
   * The section being played (form index): only it is shown sharply, its neighbours blurred, and the rest
   * left out, like the lyrics in a music player. Omitted for the full score, which shows everything.
   */
  focus?: number;
  /** Must keep its identity across renders, or the sheet re-renders every frame. */
  onSeekBar: (sectionIndex: number, bar: number) => void;
};

/**
 * The whole song as a lyric sheet in playing order: chords above the words where they change, bars with
 * nothing sung as chord boxes. It follows the playing bar, and tapping a bar jumps the room there. Memoized:
 * it re-renders when the bar changes, not every frame.
 */
export const LyricSheet = memo(function LyricSheet({ compiled, display, current, target, loopStart, focus, onSeekBar }: Props) {
  const sheet = useMemo(() => lyricSheet(compiled, display.lyrics), [compiled, display.lyrics]);
  const scroller = useRef<HTMLDivElement>(null);
  const touched = useRef(-Infinity);
  const name: ChordNamer = (slot, key) => shortChord(chordLabel(slot, key, display, !!compiled.song.key));

  useEffect(() => {
    const box = scroller.current;
    if (!box || performance.now() - touched.current < MANUAL_SCROLL_MS) return;
    const bar = current >= 0 ? box.querySelector<HTMLElement>(`[data-bar="${current}"]`) : null;
    // Keep the playing bar a third of the way down, so what comes next is in view.
    const top = bar ? bar.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 3 : 0;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [current]);

  const state = (bar: number) => (bar === current ? ' current' : bar === target ? ' target' : bar < current ? ' past' : '');
  const seek = (bar: number) => {
    const sectionIndex = compiled.bars[bar].sectionIndex;
    onSeekBar(sectionIndex, bar - compiled.sections[sectionIndex].startBar);
  };
  const touch = () => (touched.current = performance.now());

  return (
    <div className="sheet" ref={scroller} onPointerDown={touch} onWheel={touch} onTouchMove={touch}>
      {sheet.map(({ sectionIndex, passes }) => {
        if (focus !== undefined && Math.abs(sectionIndex - focus) > FOCUS_RANGE) return null;
        const section = compiled.sections[sectionIndex];
        const looped = loopStart === section.startBeat;
        const blurred = focus !== undefined && sectionIndex !== focus;
        return (
          <section key={sectionIndex} className={`sheet-section${looped ? ' looped' : ''}${blurred ? ' blurred' : ''}`}>
            <h4>
              {looped && '🔁 '}
              {section.label}
              {section.times > 1 && <small> ×{section.times}</small>}
            </h4>
            {passes.map((blocks, p) => (
              <div key={p} className="sheet-pass">
                {blocks.map((block, k) =>
                  block.kind === 'bars' ? (
                    <div key={k} className="sheet-bars">
                      {block.bars.map(({ bar, text }) => (
                        <button key={bar} data-bar={bar} className={`sheet-bar${state(bar)}`} onClick={() => seek(bar)}>
                          <span className="sheet-bar-chords">
                            {compiled.bars[bar].chords.map((c, j) => (
                              <ChordName key={j} label={name(c, compiled.bars[bar].key)} />
                            ))}
                          </span>
                          {text && <small>{text}</small>}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p key={k} className="sheet-lines">
                      {block.phrases.map((phrase, j) => (
                        <Fragment key={j}>
                          {j > 0 && ' '}
                          <span className="sheet-phrase">
                            {phrase.map((frag, f) => (
                              <span key={f} data-bar={frag.bar} className={`sheet-frag${state(frag.bar)}`} onClick={() => seek(frag.bar)}>
                                {frag.pieces.map((piece, i) =>
                                  piece.chord ? (
                                    <span key={i} className="sheet-anchor">
                                      <span className="sheet-chord">
                                        <ChordName label={name(piece.chord.slot, piece.chord.key)} />
                                      </span>
                                      {piece.text}
                                    </span>
                                  ) : (
                                    piece.text
                                  ),
                                )}
                              </span>
                            ))}
                          </span>
                        </Fragment>
                      ))}
                    </p>
                  ),
                )}
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
});
