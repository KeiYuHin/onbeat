import type { Jump, PlaybackState } from './protocol';
import { barIndexAt, type CompiledSong } from './song';

/** Lead time before the count-in starts, so the start command reaches every device first. */
export const START_LEAD_MS = 1500;
/**
 * Seeks and tempo changes wait for the first barline at least this far away, so the new state reaches
 * every device before it takes effect (LAN round trips are ~10ms, but phones on busy Wi-Fi spike).
 */
export const CHANGE_LEAD_MS = 300;
export const DEFAULT_BEATS_PER_BAR = 4;

export const msPerBeat = (bpm: number) => 60000 / bpm;

/** The first barline at or after `beat`. A song's come from `barlines(compiled)`, since bars can differ in length. */
export type Barlines = (beat: number) => number;

/** Barlines every `n` beats from beat 0. */
export const everyBeats =
  (n: number): Barlines =>
  (beat) =>
    Math.ceil(beat / n - 1e-9) * n + 0; // + 0 turns -0 into 0

type Loop = NonNullable<PlaybackState['loop']>;

/** Stopped at the top of a song, at the song's own tempo. */
export function loadSong(song: { id: string; bpm: number }, serverNow = 0): PlaybackState {
  return { songId: song.id, playing: false, bpm: song.bpm, anchorServerTime: serverNow, anchorBeat: 0 };
}

/** A straight stretch of the timeline: at server time `from` the position was `beat`, moving at `bpm`. */
type Run = { from: number; beat: number; bpm: number };

/** Position `raw` on a run that set off from `base`, wrapped once it reaches the end of the loop. */
function wrap(loop: Loop | undefined, base: number, raw: number): number {
  if (!loop || base >= loop.endBeat || raw < loop.endBeat) return raw;
  return loop.startBeat + ((raw - loop.endBeat) % (loop.endBeat - loop.startBeat));
}

const along = (state: PlaybackState, run: Run, t: number) =>
  wrap(state.loop, run.beat, run.beat + (t - run.from) / msPerBeat(run.bpm));

/** The run the position is on at `t`: the anchor's, or the jump's once it has happened. */
function runAt(state: PlaybackState, t: number): Run {
  const anchor = { from: state.anchorServerTime, beat: state.anchorBeat, bpm: state.bpm };
  const j = state.jump;
  if (!j || t < j.atServerTime) return anchor;
  return { from: j.atServerTime, beat: j.beat ?? along(state, anchor, j.atServerTime), bpm: j.bpm };
}

/** Continuous beat position at a given server time. Negative beats are lead-in / count-in. */
export function beatAt(state: PlaybackState, serverNow: number): number {
  if (!state.playing) return state.anchorBeat;
  return along(state, runAt(state, serverNow), serverNow);
}

/** Tempo in effect at a given server time. */
export function bpmAt(state: PlaybackState, serverNow: number): number {
  return state.playing ? runAt(state, serverNow).bpm : state.bpm;
}

/** The jump still ahead at `serverNow` (a seek or tempo change waiting for its barline), if any. */
export function pendingJump(state: PlaybackState, serverNow: number): Jump | null {
  return state.playing && state.jump && serverNow < state.jump.atServerTime ? state.jump : null;
}

/** Between server times `from` and `to`, the position moves linearly from `beat` at `bpm`. */
export type Segment = { from: number; to: number; beat: number; bpm: number };

/** The timeline between two server times, split where it jumps or the loop wraps. Empty while stopped. */
export function segments(state: PlaybackState, from: number, to: number): Segment[] {
  const out: Segment[] = [];
  if (!state.playing) return out;
  const cut = state.jump?.atServerTime;
  if (cut !== undefined && from < cut && cut < to) {
    runSegments(state, from, cut, out);
    runSegments(state, cut, to, out);
  } else runSegments(state, from, to, out);
  return out;
}

function runSegments(state: PlaybackState, from: number, to: number, out: Segment[]) {
  const run = runAt(state, from);
  const mpb = msPerBeat(run.bpm);
  const loop = state.loop && run.beat < state.loop.endBeat ? state.loop : undefined;
  let t = from;
  let beat = along(state, run, from);
  for (;;) {
    const end = loop ? Math.min(to, t + (loop.endBeat - beat) * mpb) : to;
    if (end > t) out.push({ from: t, to: end, beat, bpm: run.bpm });
    if (!loop || end >= to) return;
    t = end;
    beat = loop.startBeat;
  }
}

/** Folds a jump that has already happened into the anchor. */
function settle(state: PlaybackState, t: number): PlaybackState {
  if (!state.playing || !state.jump || t < state.jump.atServerTime) return state;
  const { jump: _, ...rest } = state;
  const run = runAt(state, t);
  return { ...rest, anchorServerTime: run.from, anchorBeat: run.beat, bpm: run.bpm };
}

/** Same timeline, anchored at `t`, so a change to the loop only affects what comes after `t`. */
function reanchor(state: PlaybackState, t: number): PlaybackState {
  const s = settle(state, t);
  return s.playing ? { ...s, anchorServerTime: t, anchorBeat: beatAt(s, t) } : s;
}

/**
 * Starts so that one count-in bar begins START_LEAD_MS from now and jumps to `startBeat` right after it.
 */
export function startPlayback(
  state: PlaybackState,
  serverNow: number,
  { startBeat = 0, beatsPerBar = DEFAULT_BEATS_PER_BAR, leadMs = START_LEAD_MS } = {},
): PlaybackState {
  const { extraPasses, jump: _, ...rest } = state;
  const countIn = serverNow + leadMs;
  return {
    ...rest,
    // A fresh run from the top plays the song as written; starting further in keeps the bars where they are.
    ...(startBeat > 0 && extraPasses && { extraPasses }),
    playing: true,
    anchorServerTime: countIn,
    anchorBeat: -beatsPerBar,
    jump: { atServerTime: countIn + beatsPerBar * msPerBeat(state.bpm), beat: startBeat, bpm: state.bpm },
  };
}

/** Where 开始 picks up from a stopped state: the start of the bar it stopped in, or the top once the song is over. */
export function resumeBeat(state: PlaybackState, compiled: Pick<CompiledSong, 'bars' | 'totalBeats'>): number {
  const b = state.anchorBeat;
  if (b < 0 || b >= compiled.totalBeats) return 0;
  return compiled.bars[barIndexAt(compiled, b)].startBeat;
}

/**
 * Freezes the position where it is, re-anchored at `serverNow`. A seek still waiting for its barline (or the
 * bar a count-in leads to) wins, and so does a pending tempo change, so nothing that was asked for is lost.
 */
export function stopPlayback(state: PlaybackState, serverNow: number): PlaybackState {
  const s = settle(state, serverNow);
  const { jump, ...rest } = s;
  return {
    ...rest,
    playing: false,
    anchorServerTime: serverNow,
    anchorBeat: jump?.beat ?? beatAt(s, serverNow),
    bpm: jump?.bpm ?? s.bpm,
  };
}

/**
 * Applies a seek and/or tempo change. Stopped: right away. Playing: at the first barline at least `leadMs`
 * away, so beatAt is continuous up to that moment on every device. If a jump is already waiting (including
 * the count-in), the change rides along with it.
 */
function change(
  state: PlaybackState,
  serverNow: number,
  { beat, bpm }: { beat?: number; bpm?: number },
  barlines: Barlines,
  leadMs = CHANGE_LEAD_MS,
): PlaybackState {
  const s = settle(state, serverNow);
  if (!s.playing) return { ...s, anchorServerTime: serverNow, anchorBeat: beat ?? s.anchorBeat, bpm: bpm ?? s.bpm };
  const patch = { ...(beat !== undefined && { beat }), ...(bpm !== undefined && { bpm }) };
  if (s.jump) return { ...s, jump: { ...s.jump, ...patch } };
  // Find the barline from the (looped) position, then count beats from the anchor so the time comes out exact.
  // Loop ends are barlines, so the barline is never past the wrap.
  const mpb = msPerBeat(s.bpm);
  const raw = s.anchorBeat + (serverNow + leadMs - s.anchorServerTime) / mpb;
  const at = beatAt(s, serverNow + leadMs);
  const barline = barlines(at) + (raw - at);
  return { ...s, jump: { atServerTime: s.anchorServerTime + (barline - s.anchorBeat) * mpb, bpm: s.bpm, ...patch } };
}

/** Go to `beat` (a barline). Leaving the looped range ends the loop. */
export function seekTo(state: PlaybackState, serverNow: number, beat: number, barlines: Barlines): PlaybackState {
  const { loop } = state;
  const outside = loop && (beat < loop.startBeat || beat >= loop.endBeat);
  return change(outside ? setLoop(state, serverNow, null, barlines) : state, serverNow, { beat }, barlines);
}

export function setBpm(state: PlaybackState, serverNow: number, bpm: number, barlines: Barlines): PlaybackState {
  return change(state, serverNow, { bpm }, barlines);
}

/**
 * Loops `loop` (barlines), going to its start if the position isn't already inside it; null stops looping
 * and carries on from wherever the position is.
 */
export function setLoop(state: PlaybackState, serverNow: number, loop: Loop | null, barlines: Barlines): PlaybackState {
  const { loop: _, ...s } = reanchor(state, serverNow);
  if (!loop) return s;
  const target = (s.playing ? s.jump?.beat : undefined) ?? s.anchorBeat;
  const inside = target >= loop.startBeat && target < loop.endBeat;
  return inside ? { ...s, loop } : change({ ...s, loop }, serverNow, { beat: loop.startBeat }, barlines);
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
  if (beatAt(state, serverNow) >= section.endBeat - REPEAT_MARGIN_BEATS) return null;
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
