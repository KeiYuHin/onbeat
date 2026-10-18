// The private library key: arrives in a link's #k=, then lives in localStorage so later visits need no link.
const STORAGE_KEY = 'onbeat.key';

/** Moves a `#k=<key>` from the address bar into storage, so the key isn't left on screen or in history. */
export function takeKeyFromUrl() {
  const key = new URLSearchParams(location.hash.slice(1)).get('k');
  if (!key) return;
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {}
  history.replaceState(null, '', location.pathname + location.search);
}

export function savedKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function forgetKey() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

/** The link to send bandmates: the room, plus the key after `#` so it never reaches a server log. */
export function inviteUrl(room: string, key: string | null): string {
  return `${location.origin}/r/${room}${key ? `#k=${encodeURIComponent(key)}` : ''}`;
}
