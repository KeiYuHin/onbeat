import { useCallback, useState } from 'react';
import { DEFAULT_SOUND_OPTIONS, type SoundOptions } from '@onbeat/shared';

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
const KEY = 'onbeat.sound';

function load(): SoundSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return { ...DEFAULTS, ...(typeof saved === 'object' && saved ? saved : {}) };
  } catch {
    return DEFAULTS;
  }
}

export function useSoundSettings(): [SoundSettings, (patch: Partial<SoundSettings>) => void] {
  const [settings, setSettings] = useState(load);
  const update = useCallback((patch: Partial<SoundSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode: settings just won't persist.
      }
      return next;
    });
  }, []);
  return [settings, update];
}
