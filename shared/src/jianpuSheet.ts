// The song laid out as a jianpu chart, like a 白玉米谱 page: per bar, chord boxes over the notes they start
// on, the notes with their underlines joined within each beat, a syllable under each sung note, then part
// lines (`Bs: 4. 4_ 5 -`). Pure, so the web view only draws it.
import type { Key } from './chord';
import { alignSyllables, beamJoin, type Note } from './jianpu';
import { lyricPieces } from './lyrics';
import type { Part } from './protocol';
import type { BarSpan, ChordSlot, CompiledSong, Cue } from './song';

export type JpChord = { slot: ChordSlot; key: Key };

/**
 * One column of a bar, as wide as its share of the bar (`beats`) allows once every column has room for its
 * contents. A bar with a melody has a column per note; one without has a column per chord.
 */
export type JpColumn = {
  beats: number;
  /** The note and its index in the bar; absent in a bar without melody. */
  note?: Note;
  index?: number;
  /** Underlines shared with the next column's note. */
  join: number;
  /** Chords that change on this note. */
  chords: JpChord[];
  /** What is sung on it: a syllable, '' for a held syllable, or null. */
  syllable: string | null;
};

export type JpLine = {
  part: Part;
  notes: { note: Note; join: number }[];
  /** The last bar written: what follows carries on like it (`~`). */
  more: boolean;
  /** Show the part's name: the line starts here. */
  label: boolean;
};

export type JpBar = {
  bar: number;
  columns: JpColumn[];
  /** The lyrics of a bar without melody, as one string. */
  words?: string;
  lines: JpLine[];
  cues: Cue[];
  /** A section played more than once gets repeat signs around each pass. */
  repeatStart: boolean;
  repeatEnd: boolean;
};

export type JpSection = { sectionIndex: number; passes: JpBar[][] };

/** Whether any bar has a melody: such songs are shown as a jianpu chart rather than a lyric sheet. */
export const hasMelody = (c: CompiledSong) => c.bars.some((b) => b.melody);

const chordId = ({ slot, key }: JpChord) => `${slot.name}@${key.name}`;

/**
 * Lays the compiled song out pass by pass. A chord shows where it changes and at the start of every pass;
 * in a bar with a melody it sits over the note sounding when it starts. With `withLyrics` false, no
 * syllables or words are given.
 */
export function jianpuSheet(c: CompiledSong, withLyrics = true): JpSection[] {
  return c.sections.map((section, sectionIndex) => {
    const passes: JpBar[][] = [];
    const repeated = section.times > 1;
    for (let p = 0; p < section.times; p++) {
      const first = section.startBar + p * section.loopBars;
      const last = first + section.loopBars - 1;
      let shown = '';
      const pass: JpBar[] = [];
      for (let i = first; i <= last; i++) {
        const bar = c.bars[i];
        const before = i > first ? c.bars[i - 1] : null;
        const { columns, words, shownAfter } = layoutBar(bar, shown, withLyrics);
        shown = shownAfter;
        pass.push({
          bar: i,
          columns,
          ...(words && { words }),
          lines: bar.lines.map((l) => ({
            part: l.part,
            notes: l.notes.map((note, k) => ({ note, join: beamJoin(l.notes, k) })),
            more: l.more,
            label: !before?.lines.some((b) => b.part === l.part),
          })),
          cues: bar.cues,
          repeatStart: repeated && i === first,
          repeatEnd: repeated && i === last,
        });
      }
      passes.push(pass);
    }
    return { sectionIndex, passes };
  });
}

function layoutBar(bar: BarSpan, shown: string, withLyrics: boolean) {
  const chords = bar.chords.map((slot) => ({ slot, key: bar.key }));
  if (!bar.melody) {
    // Chord boxes, all of them: a bar without notes would otherwise be empty.
    const columns: JpColumn[] = chords.map((chord) => ({ beats: chord.slot.beats, join: 0, chords: [chord], syllable: null }));
    const words = withLyrics ? lyricPieces(bar.lyrics).join('').trim() : '';
    return { columns, words, shownAfter: chordId(chords[chords.length - 1]) };
  }
  const notes = bar.melody;
  const sung = withLyrics ? alignSyllables(notes, bar.tiedIn, bar.lyrics) : notes.map(() => null);
  const columns: JpColumn[] = notes.map((note, index) => ({
    beats: note.beats,
    note,
    index,
    join: beamJoin(notes, index),
    chords: [],
    syllable: sung[index],
  }));
  for (const chord of chords) {
    if (chordId(chord) === shown) continue;
    shown = chordId(chord);
    let k = 0;
    while (k < notes.length - 1 && notes[k + 1].start <= chord.slot.start + 1e-9) k++;
    columns[k].chords.push(chord);
  }
  return { columns, words: '', shownAfter: shown };
}
