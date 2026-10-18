import { useCallback, useState } from 'react';

/** Settings kept in this device's localStorage under `key`, filled in from `defaults` for anything missing. */
export function useStoredSettings<T extends object>(key: string, defaults: T): [T, (patch: Partial<T>) => void] {
  const [settings, setSettings] = useState(() => load(key, defaults));
  const update = useCallback(
    (patch: Partial<T>) => {
      setSettings((s) => {
        const next = { ...s, ...patch };
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          // Private mode: settings just won't persist.
        }
        return next;
      });
    },
    [key],
  );
  return [settings, update];
}

function load<T extends object>(key: string, defaults: T): T {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? '{}');
    return { ...defaults, ...(typeof saved === 'object' && saved ? saved : {}) };
  } catch {
    return defaults;
  }
}
