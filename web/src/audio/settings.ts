import { DEFAULT_SOUND_OPTIONS, type SoundOptions } from '@onbeat/shared';
import { useStoredSettings } from '../storedSettings';

/** Per-device sound settings; never synced, since usually only one device drives the speaker. */
export type SoundSettings = SoundOptions & {
  /** 本机出声: master switch for this device. */
  enabled: boolean;
  volume: number; // 0..1
  /** Plays this much earlier to make up for output delay (Bluetooth), -300..300. */
  latencyMs: number;
  /** Flash the chord panel on every beat (works with sound off). */
  flash: boolean;
  bassTone: BassTone;
};

export type BassTone = 'bass' | 'sine';

export const LATENCY_RANGE_MS = 300;

const DEFAULTS: SoundSettings = { ...DEFAULT_SOUND_OPTIONS, enabled: false, volume: 0.8, latencyMs: 0, flash: false, bassTone: 'bass' };
export const useSoundSettings = () => useStoredSettings('onbeat.sound', DEFAULTS);
