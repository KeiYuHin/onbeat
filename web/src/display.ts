import { capoKey, chordText, type ChordSlot, type Key } from '@onbeat/shared';
import { useStoredSettings } from './storedSettings';

/** Letters (C G/B Am), scale degrees (1 5/7 6m, as on 白玉米谱), or letters with the degree beside them. */
export type ChordNames = 'letter' | 'degree' | 'both';

/** The current pass of the section as bar cards, or the whole song in playing order. */
export type ScoreLayout = 'loop' | 'full';

/** How this device shows the chart; never synced, everyone picks their own. */
export type DisplaySettings = {
  chords: ChordNames;
  /** Guitar capo fret: letters show the fingering, degrees stay as they are. */
  capo: number;
  lyrics: boolean;
  layout: ScoreLayout;
};

export const MAX_CAPO = 9;

const DEFAULTS: DisplaySettings = { chords: 'letter', capo: 0, lyrics: true, layout: 'loop' };

export const useDisplaySettings = () => useStoredSettings('onbeat.display', DEFAULTS);

/** A chord as this device shows it: `main`, plus the scale degree beside it in 'both'. */
export type ChordLabel = { main: string; alt?: string };

/**
 * `keyed` says whether the song names its key; without one there are no degrees to show, so it is letters
 * only (as written, moved by the capo).
 */
export function chordLabel(slot: ChordSlot, key: Key, d: DisplaySettings, keyed: boolean): ChordLabel {
  const letter = chordText(slot.name, slot.chord, key, 'letter', d.capo);
  if (!keyed || d.chords === 'letter') return { main: letter };
  const degree = chordText(slot.name, slot.chord, key, 'degree');
  return d.chords === 'degree' ? { main: degree } : { main: letter, alt: degree };
}

/** The sheet's short spelling: maj7 → M7 (Cmaj7 → CM7), so chords take less room over the words. */
export const shortChord = (label: ChordLabel): ChordLabel => {
  const short = (s: string) => s.replace(/maj(?=\d)/g, 'M');
  return { main: short(label.main), ...(label.alt && { alt: short(label.alt) }) };
};

/** "B调", or "B调 · 变调夹 2 按 A" with a capo. */
export function keyText(key: Key, d: DisplaySettings): string {
  return d.capo ? `${key.name}调 · 变调夹 ${d.capo} 按 ${capoKey(key, d.capo).name}` : `${key.name}调`;
}
