import { useEffect, useState } from 'react';

export type WakeLockStatus = 'pending' | 'on' | 'insecure' | 'unsupported' | 'denied';

/** Keeps the screen on while mounted. The browser drops the lock when the tab is hidden, so re-acquire on return. */
export function useWakeLock(): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>(() =>
    !window.isSecureContext ? 'insecure' : 'wakeLock' in navigator ? 'pending' : 'unsupported',
  );

  useEffect(() => {
    if (status === 'insecure' || status === 'unsupported') return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (disposed) return void s.release();
        sentinel = s;
        setStatus('on');
      } catch {
        setStatus('denied');
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', acquire);
      void sentinel?.release();
    };
  }, []); // `status` is only read here as the initial capability check

  return status;
}
