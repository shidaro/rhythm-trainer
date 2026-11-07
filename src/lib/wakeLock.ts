// Keeps the screen on during an exercise (Screen Wake Lock API, Safari 16.4+).

let sentinel: WakeLockSentinel | null = null;

export async function keepAwake(): Promise<void> {
  try {
    if ('wakeLock' in navigator && !sentinel) {
      sentinel = await navigator.wakeLock.request('screen');
      sentinel.addEventListener('release', () => {
        sentinel = null;
      });
    }
  } catch {
    /* not allowed or unsupported */
  }
}

export async function releaseAwake(): Promise<void> {
  try {
    await sentinel?.release();
  } catch {
    /* ignore */
  }
  sentinel = null;
}
