// The song laid out as a lyric sheet: flowing lines with chords above the words where they change, and bars
// with nothing on the downbeat as a row of chord boxes. Pure, so the web views only render it.
import type { Key } from './chord';
import { lyricPieces } from './lyrics';
import type { ChordSlot, CompiledSong } from './song';

/** A syllable (or ' '), with the chord that changes on it. `text` is a full-width space for a chord after the words. */
export type SheetPiece = { text: string; chord?: { slot: ChordSlot; key: Key } };
/** Consecutive pieces of one bar, so the view can highlight the bar and jump to it. */
export type SheetFrag = { bar: number; pieces: SheetPiece[] };
/** Words between spaces; lines only break between phrases. */
export type SheetPhrase = SheetFrag[];
export type SheetBlock =
  | { kind: 'lines'; phrases: SheetPhrase[] }
  /** Bars with nothing sung on the downbeat; `text` is what's sung later in the bar, if it stays there. */
  | { kind: 'bars'; bars: { bar: number; text?: string }[] };
/** One section of the form: its passes, each starting on a new line. */
export type SheetSection = { sectionIndex: number; passes: SheetBlock[][] };

const GAP = '　';

/**
 * Lays the compiled song out pass by pass. A bar's lyrics start on its downbeat, so its first chord goes over
 * its first syllable; later chords in the bar go over the syllable at the same fraction of the bar (exact
 * once a melody gives syllables their timing). A chord is shown where it changes, and again at the start of
 * every run of lines. Words after a bar's last space that lead into the next pass (or out of a bar with
 * nothing on the downbeat) are pickups: they move to the start of the next line, in front of the words they
 * lead into. With `withLyrics` false, every bar is a chord box.
 */
export function lyricSheet(c: CompiledSong, withLyrics = true): SheetSection[] {
  const pieces = c.bars.map((b) => (withLyrics ? lyricPieces(b.lyrics) : []));
  const sung = (i: number) => i < c.bars.length && pieces[i].length > 0 && pieces[i][0] !== ' ';
  const passStarts = new Set(
    c.sections.flatMap((s) => Array.from({ length: s.times }, (_, p) => s.startBar + p * s.loopBars)),
  );

  let pickup: SheetFrag | null = null;
  let shown = '';
  return c.sections.map((section, sectionIndex) => {
    const passes: SheetBlock[][] = [];
    for (let p = 0; p < section.times; p++) {
      const blocks: SheetBlock[] = [];
      const first = section.startBar + p * section.loopBars;
      for (let i = first; i < first + section.loopBars; i++) {
        const bar = c.bars[i];
        const all = pieces[i];
        const cut = all.lastIndexOf(' ');
        const trailing = cut >= 0 ? all.slice(cut + 1) : [];
        const carry = trailing.length > 0 && sung(i + 1) && (!sung(i) || passStarts.has(i + 1));
        const own = carry ? all.slice(0, cut) : all;

        if (sung(i)) {
          let block = blocks[blocks.length - 1];
          if (block?.kind !== 'lines') {
            block = { kind: 'lines', phrases: [pickup ? [pickup] : []] };
            blocks.push(block);
            pickup = null;
            shown = '';
          }
          const out: SheetPiece[] = own.map((text) => ({ text }));
          const syllableAt = own.flatMap((t, k) => (t === ' ' ? [] : [k]));
          const count = all.filter((t) => t !== ' ').length;
          let prev = -1;
          for (const slot of bar.chords) {
            const n = Math.max(prev + 1, Math.round((slot.start / bar.beats) * count));
            prev = n;
            const id = `${slot.name}@${bar.key.name}`;
            if (id === shown) continue;
            shown = id;
            const chord = { slot, key: bar.key };
            if (n < syllableAt.length) out[syllableAt[n]].chord = chord;
            else out.push({ text: GAP, chord });
          }
          let phrase = block.phrases[block.phrases.length - 1];
          let frag: SheetFrag = { bar: i, pieces: [] };
          for (const piece of out) {
            if (piece.text !== ' ') {
              frag.pieces.push(piece);
              continue;
            }
            if (frag.pieces.length) phrase.push(frag);
            phrase = [];
            block.phrases.push(phrase);
            frag = { bar: i, pieces: [] };
          }
          if (frag.pieces.length) phrase.push(frag);
        } else {
          let block = blocks[blocks.length - 1];
          if (block?.kind !== 'bars') blocks.push((block = { kind: 'bars', bars: [] }));
          const text = own.join('').trim();
          block.bars.push({ bar: i, ...(text && { text }) });
          shown = '';
        }
        if (carry) pickup = { bar: i, pieces: trailing.map((text) => ({ text })) };
      }
      passes.push(blocks);
    }
    return { sectionIndex, passes };
  });
}
