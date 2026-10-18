// This device's name, sent with saves so the library's commit history says who saved.
import { useState } from 'react';
import { DEVICE_NAME_MAX, PART_LABELS, type Part } from '@onbeat/shared';

const STORAGE_KEY = 'onbeat.device';

/** A starting point like "iPhone 鼓"; the user can change it. */
function guess(part: Part): string {
  const ua = navigator.userAgent;
  const kind = /iPad/.test(ua)
    ? 'iPad'
    : /iPhone/.test(ua)
      ? 'iPhone'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : '设备';
  return `${kind} ${PART_LABELS[part]}`;
}

export function useDeviceName(part: Part): [string, (name: string) => void] {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? guess(part);
    } catch {
      return guess(part);
    }
  });
  const update = (next: string) => {
    const clipped = next.slice(0, DEVICE_NAME_MAX);
    setName(clipped);
    try {
      localStorage.setItem(STORAGE_KEY, clipped);
    } catch {}
  };
  return [name, update];
}
