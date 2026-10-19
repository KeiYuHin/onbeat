// Lyrics, one string per bar. Timing comes from the melody (M4c): each syllable takes one sounding note, so a
// bar's lyrics never need rewriting when its melody is added. See SPEC.md, 级数谱兼容 §4 and §12.

/** Holds the syllable before it over one more note (a melisma). */
export const MELISMA = '_';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}']/u;

/**
 * A bar's lyrics split into syllables, one per note: each Chinese character is one, English words split at
 * spaces and at `-` (`some-one`), and `_` is a note that holds the syllable before it. Spaces between Chinese
 * characters only mark phrases, and punctuation sticks to the syllable before it, so neither takes a note.
 */
export function syllables(text: string): string[] {
  const out: string[] = [];
  let word = '';
  // Punctuation before any syllable, like an opening quote: it goes on the next one.
  let lead = '';
  const push = (s: string) => {
    out.push(lead + s);
    lead = '';
  };
  const endWord = () => {
    if (word) push(word);
    word = '';
  };
  for (const ch of text) {
    if (CJK.test(ch)) {
      endWord();
      push(ch);
    } else if (ch === MELISMA) {
      endWord();
      out.push(MELISMA);
    } else if (WORD.test(ch)) {
      word += ch;
    } else if (/\s|-/.test(ch)) {
      endWord();
    } else if (word) {
      word += ch;
    } else if (out.length && out[out.length - 1] !== MELISMA) {
      out[out.length - 1] += ch;
    } else {
      lead += ch;
    }
  }
  endWord();
  return out;
}

/** A bar's lyrics as shown: melisma marks dropped and split words joined (`some-one` → `someone`). */
export const lyricText = (text: string) =>
  text
    .replaceAll(MELISMA, '')
    .replace(/(?<=\S)-|-(?=\S)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
