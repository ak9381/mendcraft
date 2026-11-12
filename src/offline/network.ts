// Online/offline awareness for the offline-first queue.
//
// Two concerns, kept apart so the decision is unit-testable without a browser:
//  1. routeBigJob() — a PURE decision: given the net state, does a big cloud job
//     run now, queue for later, or stay local-only (no cloud ever configured)?
//  2. createNetworkMonitor() — a thin wrapper over navigator.onLine plus the
//     window 'online'/'offline' events, so the shell can react to DevTools
//     offline mode / airplane mode. It takes its navigator + event target by
//     injection, so a test drives it with a fake.

export interface NetEnv {
  /** navigator.onLine (DevTools offline mode / airplane mode flip this). */
  online: boolean;
  /** Is Firebase AI Logic configured at all? If not, there is no cloud to wait
   *  for, so queueing would strand the job forever — run local instead. */
  cloudConfigured: boolean;
}

/** run-now = do the cloud job immediately; enqueue = offline, defer to reconnect;
 *  local-only = no cloud configured, serve the on-device/rules result and stop. */
export type JobRoute = 'run-now' | 'enqueue' | 'local-only';

export function routeBigJob(env: NetEnv): JobRoute {
  if (!env.cloudConfigured) return 'local-only';
  return env.online ? 'run-now' : 'enqueue';
}

/** Minimal navigator surface (just the bit we read). */
export interface NavigatorLike {
  readonly onLine: boolean;
}

/** Minimal event-target surface (window in the app; a fake EventTarget in tests). */
export interface EventTargetLike {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface NetworkMonitor {
  online(): boolean;
  /** Fires only on an actual online↔offline transition. Returns unsubscribe. */
  subscribe(fn: (online: boolean) => void): () => void;
  dispose(): void;
}

export function createNetworkMonitor(deps: {
  navigator: NavigatorLike;
  target: EventTargetLike;
}): NetworkMonitor {
  const { navigator, target } = deps;
  let online = navigator.onLine;
  const listeners = new Set<(online: boolean) => void>();

  const onChange = (): void => {
    const next = navigator.onLine;
    if (next === online) return; // debounce duplicate events
    online = next;
    for (const fn of listeners) fn(online);
  };

  target.addEventListener('online', onChange);
  target.addEventListener('offline', onChange);

  return {
    online: () => online,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      target.removeEventListener('online', onChange);
      target.removeEventListener('offline', onChange);
      listeners.clear();
    },
  };
}
