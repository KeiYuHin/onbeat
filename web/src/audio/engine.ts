import {
  beatAt,
  DRUMS,
  serverTimeAtBeat,
  soundEvents,
  type ClockSync,
  type CompiledSong,
  type PlaybackState,
  type SoundEvent,
} from '@onbeat/shared';
import type { SoundSettings } from './settings';

/** Scheduler wake-up interval and how far ahead each wake-up schedules (SPEC: 25ms / 100ms). */
const TICK_MS = 25;
const LOOKAHEAD_MS = 100;
/** Re-measured audio↔performance offsets within this are smoothed; bigger changes (device switch) jump. */
const DELTA_JUMP_S = 0.02;

/** 'off': sound disabled here; 'locked': enabled but the browser needs a tap first; 'on': producing sound. */
export type AudioStatus = 'off' | 'locked' | 'on';

const SOUND_KEYS: (keyof SoundSettings)[] = ['enabled', 'metronome', 'subdivision', 'countIn', 'drums', 'fills', 'latencyMs'];

/**
 * Plays the metronome and drum machine for this device. Sound events come from the shared timeline
 * (`soundEvents`) and are placed on the AudioContext clock ahead of time, never fired from timers.
 */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private playback: PlaybackState | null = null;
  private compiled: CompiledSong | null = null;
  private settings: SoundSettings | null = null;
  /** Events before this beat are already scheduled; null re-derives it from "now". */
  private cursor: number | null = null;
  private pending = new Set<{ node: AudioScheduledSourceNode; at: number }>();
  /** audioContext time = performance.now() / 1000 + delta, measured where sound leaves the speaker. */
  private delta: number | null = null;
  private listeners = new Set<() => void>();
  private status: AudioStatus = 'off';

  constructor(private clock: ClockSync) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getStatus = () => this.status;

  /** Creates or resumes the AudioContext. Must run inside a tap handler (iOS). */
  unlock() {
    if (!this.ctx) {
      // iOS: play through the ring/silent switch like a music app (Safari 16.4+).
      const session = (navigator as any).audioSession;
      if (session) session.type = 'playback';
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.ctx.addEventListener('statechange', () => this.refresh());
      void this.loadKit();
    }
    // A silent buffer started inside the gesture unlocks older iOS versions.
    const silent = this.ctx.createBufferSource();
    silent.buffer = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    silent.connect(this.ctx.destination);
    silent.start();
    void this.ctx.resume().then(() => this.refresh());
  }

  update(playback: PlaybackState | null, compiled: CompiledSong | null, settings: SoundSettings) {
    const prev = this.settings;
    const soundChanged = !prev || SOUND_KEYS.some((k) => prev[k] !== settings[k]);
    const timelineChanged = playback !== this.playback || compiled !== this.compiled;
    this.playback = playback;
    this.compiled = compiled;
    this.settings = settings;
    if (this.master) this.master.gain.value = settings.volume;
    // Commands keep beatAt continuous, but the simplest correct answer to any change is to drop
    // what's queued and reschedule from now; the queue only reaches 100ms ahead.
    if (soundChanged || timelineChanged) this.reschedule();
    this.refresh();
  }

  dispose() {
    this.stopTimer();
    this.reschedule();
    void this.ctx?.close();
    this.ctx = null;
    this.listeners.clear();
  }

  private refresh() {
    const running = this.ctx?.state === 'running';
    const status: AudioStatus = !this.settings?.enabled ? 'off' : running ? 'on' : 'locked';
    if (status === 'on') this.startTimer();
    else this.stopTimer();
    if (status !== this.status) {
      this.status = status;
      this.listeners.forEach((fn) => fn());
    }
  }

  private startTimer() {
    if (this.timer) return;
    this.cursor = null;
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.tick();
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private reschedule() {
    this.cursor = null;
    const now = this.ctx?.currentTime ?? Infinity;
    for (const p of this.pending) {
      if (p.at > now) p.node.stop();
    }
    this.pending.clear();
  }

  private tick() {
    const { ctx, playback, compiled, settings } = this;
    if (!ctx || !playback?.playing || !compiled || !settings || !this.clock.synced) return;
    const delta = this.measureDelta();

    // Event at beat b should be *heard* at serverTimeAtBeat(b); emit it latencyMs earlier.
    // The window is measured on the audio clock: what reaches the speaker `outputMs` from now
    // is due at ctx.currentTime, and we queue LOOKAHEAD_MS beyond that.
    const perfNow = performance.now();
    const serverNow = this.clock.serverNow();
    const offset = serverNow - perfNow;
    const outputMs = Math.max(0, (ctx.currentTime - delta) * 1000 - perfNow);
    const nowBeat = beatAt(playback, serverNow + settings.latencyMs + outputMs);
    const to = beatAt(playback, serverNow + settings.latencyMs + outputMs + LOOKAHEAD_MS);
    // After a throttled gap (tab in background), skip what is already due instead of bursting it out.
    const from = Math.max(this.cursor ?? nowBeat, nowBeat);
    if (to <= from) return;
    this.cursor = to;

    for (const e of soundEvents(compiled, from, to, settings)) {
      const perfMs = serverTimeAtBeat(playback, e.beat) - offset - settings.latencyMs;
      const at = perfMs / 1000 + delta;
      if (at >= ctx.currentTime) this.play(ctx, e, at);
    }
  }

  /**
   * Maps performance.now() to AudioContext time at the speaker. getOutputTimestamp() pairs the
   * context time of the frame being output right now with its performance time, so output latency
   * is already included; without it, fall back to currentTime minus the reported output latency.
   */
  private measureDelta(): number {
    const ctx = this.ctx!;
    const ts = ctx.getOutputTimestamp?.();
    const d =
      ts?.performanceTime && ts.contextTime !== undefined
        ? ts.contextTime - ts.performanceTime / 1000
        : ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0) - performance.now() / 1000;
    if (this.delta === null || Math.abs(d - this.delta) > DELTA_JUMP_S) this.delta = d;
    else this.delta += (d - this.delta) * 0.1;
    return this.delta;
  }

  private play(ctx: AudioContext, e: SoundEvent, at: number) {
    const gain = ctx.createGain();
    gain.connect(this.master!);
    let node: AudioScheduledSourceNode;
    if (e.sound === 'click' || e.sound === 'clickAccent') {
      const osc = ctx.createOscillator();
      osc.frequency.value = e.sound === 'clickAccent' ? 1760 : 1175;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(e.gain * 0.6, at + 0.001);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
      osc.connect(gain);
      osc.start(at);
      osc.stop(at + 0.06);
      node = osc;
    } else {
      const buffer = this.buffers.get(e.sound);
      if (!buffer) return; // kit still loading
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      gain.gain.value = e.gain;
      src.connect(gain);
      src.start(at);
      node = src;
    }
    const entry = { node, at };
    this.pending.add(entry);
    node.onended = () => {
      this.pending.delete(entry);
      gain.disconnect();
    };
  }

  private async loadKit() {
    const ctx = this.ctx!;
    await Promise.all(
      DRUMS.map(async (name) => {
        try {
          const res = await fetch(`/kits/default/${name}.wav`);
          this.buffers.set(name, await ctx.decodeAudioData(await res.arrayBuffer()));
        } catch (err) {
          console.warn(`[OnBeat] could not load drum sample ${name}`, err);
        }
      }),
    );
  }
}
