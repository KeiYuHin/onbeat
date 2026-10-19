import { Fragment, memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { lyricSheet, type CompiledSong } from '@onbeat/shared';
import { ChordName, type ChordNamer } from './ChordName';
import { chordLabel, shortChord, type DisplaySettings } from './display';

/**
 * How a section shows relative to the one being played: it and the next are sharp, the one before and the
 * one after next are blurred, and the rest are left out.
 */
function focusClass(sectionIndex: number, focus: number): 'sharp' | 'blurred' | null {
  const d = sectionIndex - focus;
  return d === 0 || d === 1 ? 'sharp' : d === -1 || d === 2 ? 'blurred' : null;
}

/** After the reader touches or scrolls the sheet, it stops following the playing bar (and shows every section) for this long. */
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
   * The section being played (form index): the sheet shows only the sections around it, like the lyrics in a
   * music player (see `focusClass`), and everything while the reader scrolls. Omitted for the full score,
   * which always shows everything.
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
  // Scrolling by hand shows every section, sharp, until the reader has left the sheet alone for a while.
  const [browsing, setBrowsing] = useState(false);
  const browseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // The section at the top of the view when sections appear or disappear, to keep it where it was.
  const anchor = useRef<{ section: string; top: number } | null>(null);
  // A new section drops the one above it off the sheet, which would pull everything up at once and make the
  // smooth scroll start from the wrong place. Before that render reaches the page (the DOM is still the old
  // one here), note where the outgoing section sits: it stays, blurred, and goes back to the same spot.
  const lastFocus = useRef(focus);
  if (focus !== lastFocus.current) {
    const el =
      lastFocus.current !== undefined && !browsing
        ? scroller.current?.querySelector<HTMLElement>(`[data-section="${lastFocus.current}"]`)
        : null;
    anchor.current = el ? { section: String(lastFocus.current), top: el.getBoundingClientRect().top } : anchor.current;
    lastFocus.current = focus;
  }
  const name: ChordNamer = (slot, key) => shortChord(chordLabel(slot, key, display, !!compiled.song.key));

  useEffect(() => {
    const box = scroller.current;
    if (!box || performance.now() - touched.current < MANUAL_SCROLL_MS) return;
    const bar = current >= 0 ? box.querySelector<HTMLElement>(`[data-bar="${current}"]`) : null;
    // Keep the playing bar a third of the way down, so what comes next is in view.
    const top = bar ? bar.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight / 3 : 0;
    box.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [current, browsing]);

  useLayoutEffect(() => {
    const box = scroller.current;
    const a = anchor.current;
    anchor.current = null;
    const el = a && box?.querySelector<HTMLElement>(`[data-section="${a.section}"]`);
    if (box && el) box.scrollTop += el.getBoundingClientRect().top - a.top;
  }, [browsing, focus]);

  useEffect(() => () => clearTimeout(browseTimer.current), []);

  const state = (bar: number) => (bar === current ? ' current' : bar === target ? ' target' : bar < current ? ' past' : '');
  const seek = (bar: number) => {
    const sectionIndex = compiled.bars[bar].sectionIndex;
    onSeekBar(sectionIndex, bar - compiled.sections[sectionIndex].startBar);
  };
  const touch = () => (touched.current = performance.now());
  /** Wheel or finger scrolling: show everything, keeping the section in view where it is. */
  const browse = () => {
    touch();
    clearTimeout(browseTimer.current);
    browseTimer.current = setTimeout(() => {
      remember();
      setBrowsing(false);
      // Just past the pause, so following the playing bar picks up again straight away.
    }, MANUAL_SCROLL_MS + 50);
    if (focus !== undefined && !browsing) {
      remember();
      setBrowsing(true);
    }
  };
  const remember = () => {
    const box = scroller.current;
    const top = box?.getBoundingClientRect().top ?? 0;
    const first = [...(box?.querySelectorAll<HTMLElement>('[data-section]') ?? [])].find(
      (el) => el.getBoundingClientRect().bottom > top,
    );
    anchor.current = first ? { section: first.dataset.section!, top: first.getBoundingClientRect().top } : null;
  };

  return (
    <div className="sheet" ref={scroller} onPointerDown={touch} onWheel={browse} onTouchMove={browse}>
      {sheet.map(({ sectionIndex, passes }) => {
        const shown = focus === undefined || browsing ? 'sharp' : focusClass(sectionIndex, focus);
        if (!shown) return null;
        const section = compiled.sections[sectionIndex];
        const looped = loopStart === section.startBeat;
        return (
          <section
            key={sectionIndex}
            data-section={sectionIndex}
            className={`sheet-section${looped ? ' looped' : ''}${shown === 'blurred' ? ' blurred' : ''}`}
          >
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
