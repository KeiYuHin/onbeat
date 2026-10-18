import type { PlaybackState } from './protocol';
import type { CompiledSong } from './song';

/** Lead time before the count-in starts, so the start command reaches every device first. */
export const START_LEAD_MS = 1500;
export const DEFAULT_BEATS_PER_BAR = 4;

export const msPerBeat = (bpm: number) => 60000 / bpm;

/** Stopped at the top of a song, at the song's own tempo. */
export function loadSong(song: { id: string; bpm: number }, serverNow = 0): PlaybackState {
  return { songId: song.id, playing: false, bpm: song.bpm, anchorServerTime: serverNow, anchorBeat: 0 };
}

/** Continuous beat position at a given server time. Negative beats are lead-in / count-in. */
export function beatAt(state: PlaybackState, serverNow: number): number {
  if (!state.playing) return state.anchorBeat;
  return state.anchorBeat + (serverNow - state.anchorServerTime) / msPerBeat(state.bpm);
}

/** Inverse of `beatAt` while playing: the server time at which `beat` is reached. */
export function serverTimeAtBeat(state: PlaybackState, beat: number): number {
  return state.anchorServerTime + (beat - state.anchorBeat) * msPerBeat(state.bpm);
}

/**
 * Starts so that one count-in bar begins START_LEAD_MS from now and `startBeat` lands right after it.
 */
export function startPlayback(
  state: PlaybackState,
  serverNow: number,
  { startBeat = 0, beatsPerBar = DEFAULT_BEATS_PER_BAR, leadMs = START_LEAD_MS } = {},
): PlaybackState {
  const { extraPasses: _, ...rest } = state; // a fresh run plays the song as written
  return {
    ...rest,
    playing: true,
    anchorServerTime: serverNow + leadMs,
    anchorBeat: startBeat - beatsPerBar,
  };
}

/** Freezes the position where it is, re-anchored at `serverNow`. */
export function stopPlayback(state: PlaybackState, serverNow: number): PlaybackState {
  return { ...state, playing: false, anchorServerTime: serverNow, anchorBeat: beatAt(state, serverNow) };
}

/**
 * Don't extend a section in its last beat: by the time the new state reaches every phone, some may
 * already show the next section and would jump back.
 */
export const REPEAT_MARGIN_BEATS = 1;

/**
 * "再绕一遍": play the section at `sectionIndex` once more. Only bars after the current position move,
 * so beatAt stays continuous. Returns null when that section is already over (or about to be).
 */
export function repeatSection(
  state: PlaybackState,
  compiled: CompiledSong,
  sectionIndex: number,
  serverNow: number,
): PlaybackState | null {
  const section = compiled.sections[sectionIndex];
  if (!section) return null;
  const end = section.startBeat + section.barCount * compiled.beatsPerBar;
  if (beatAt(state, serverNow) >= end - REPEAT_MARGIN_BEATS) return null;
  const extra = { ...state.extraPasses };
  extra[sectionIndex] = (extra[sectionIndex] ?? 0) + 1;
  return { ...state, extraPasses: extra };
}

export type BarPosition = {
  bar: number; // 1-based; 0 and below are count-in bars
  beatInBar: number; // 1-based
  phase: number; // 0..1 progress through the current beat
};

export function barPosition(beat: number, beatsPerBar = DEFAULT_BEATS_PER_BAR): BarPosition {
  const whole = Math.floor(beat);
  const beatIndex = ((whole % beatsPerBar) + beatsPerBar) % beatsPerBar;
  return {
    bar: Math.floor(whole / beatsPerBar) + 1,
    beatInBar: beatIndex + 1,
    phase: beat - whole,
  };
}
