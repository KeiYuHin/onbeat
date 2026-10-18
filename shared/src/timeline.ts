import type { PlaybackState } from './protocol';

/** Lead time before the count-in starts, so the start command reaches every device first. */
export const START_LEAD_MS = 1500;
/** Fixed until songs (with time signatures) arrive in M2. */
export const DEFAULT_BEATS_PER_BAR = 4;
export const DEFAULT_BPM = 120;

export const msPerBeat = (bpm: number) => 60000 / bpm;

export function initialState(bpm = DEFAULT_BPM): PlaybackState {
  return { songId: null, playing: false, bpm, anchorServerTime: 0, anchorBeat: 0 };
}

/** Continuous beat position at a given server time. Negative beats are lead-in / count-in. */
export function beatAt(state: PlaybackState, serverNow: number): number {
  if (!state.playing) return state.anchorBeat;
  return state.anchorBeat + (serverNow - state.anchorServerTime) / msPerBeat(state.bpm);
}

/**
 * Starts so that one count-in bar begins START_LEAD_MS from now and `startBeat` lands right after it.
 */
export function startPlayback(
  state: PlaybackState,
  serverNow: number,
  { startBeat = 0, beatsPerBar = DEFAULT_BEATS_PER_BAR, leadMs = START_LEAD_MS } = {},
): PlaybackState {
  return {
    ...state,
    playing: true,
    anchorServerTime: serverNow + leadMs,
    anchorBeat: startBeat - beatsPerBar,
  };
}

/** Freezes the position where it is, re-anchored at `serverNow`. */
export function stopPlayback(state: PlaybackState, serverNow: number): PlaybackState {
  return { ...state, playing: false, anchorServerTime: serverNow, anchorBeat: beatAt(state, serverNow) };
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
