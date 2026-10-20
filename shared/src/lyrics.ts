// Lyrics, one string per bar. Timing comes from the melody (M4c): each syllable takes one sounding note, so a
// bar's lyrics never need rewriting when its melody is added. See SPEC.md, 目标谱面.

/** Holds the syllable before it over one more note (a melisma). */
export const MELISMA = '_';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const WORD = /[\p{L}\p{N}']/u;

type Token = { syllable: string } | 'space' | 'melisma';

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  let word = '';
  // Punctuation before any syllable, like an opening quote: it goes on the next one.
  let lead = '';
  const push = (s: string) => {
    out.push({ syllable: lead + s });
    lead = '';
  };
  const endWord = () => {
    if (word) push(word);
    word = '';
  };
  const last = () => {
    for (let i = out.length - 1; i >= 0; i--) {
      const t = out[i];
      if (t === 'melisma') return null;
      if (t !== 'space') return t;
    }
    return null;
  };
  for (const ch of text) {
    if (CJK.test(ch)) {
      endWord();
      push(ch);
    } else if (ch === MELISMA) {
      endWord();
      out.push('melisma');
    } else if (WORD.test(ch)) {
      word += ch;
    } else if (/\s/.test(ch)) {
      endWord();
      out.push('space');
    } else if (ch === '-') {
      endWord();
    } else if (word) {
      word += ch;
    } else {
      const prev = last();
      if (prev && out[out.length - 1] !== 'space') prev.syllable += ch;
      else lead += ch;
    }
  }
  endWord();
  return out;
}

/**
 * A bar's lyrics split into syllables, one per note: each Chinese character is one, English words split at
 * spaces and at `-` (`some-one`), and `_` is a note that holds the syllable before it. Spaces between Chinese
 * characters only mark phrases, and punctuation sticks to the syllable before it, so neither takes a note.
 */
export const syllables = (text: string): string[] =>
  tokenize(text).flatMap((t) => (t === 'space' ? [] : t === 'melisma' ? [MELISMA] : [t.syllable]));

/**
 * A bar's lyrics as shown: syllables in order, with ' ' where the text has a space (a phrase or word break),
 * melisma marks dropped. Pieces join without gaps, so `some-one` shows as "someone". A leading ' ' means
 * nothing is sung on the downbeat: the words start later in the bar.
 */
export function lyricPieces(text: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(text)) {
    if (t === 'melisma') continue;
    if (t !== 'space') out.push(t.syllable);
    else if (out[out.length - 1] !== ' ') out.push(' ');
  }
  if (out.length === 1 && out[0] === ' ') return [];
  while (out[out.length - 1] === ' ') out.pop();
  return out;
}
