// Gaze / presence auto-sync — PURE decision + a thin injectable watcher. When
// Akash picks up a paired phone and LOOKS at it (front-camera FaceLandmarker,
// already in the stack), the web canvas pushes its current board to that phone.
// App focus / page visibility are the cheap fallback when the camera can't or
// shouldn't run.
//
// PRIVACY CONTRACT (honest ledger, enforced by construction):
//   • Camera frames and face landmarks NEVER leave the device. createGazeWatcher
//     only ever reads a boolean `facing` from the injected detector — no frame,
//     no landmark, ever reaches `onSync` or any wire payload.
//   • The watcher NEVER opens the front camera if a live camera stream already
//     exists. In that case it falls back to visibility/focus only, so it never
//     steals a camera another feature is using. (There is no separate gimbal
//     guard: no caller ever supplied one.)
//   • Opening the gaze camera records a ledger START event (on-device), so "I
//     looked at my phone" is counted honestly without any pixels leaving.

export type SyncReason = 'face' | 'focus' | 'hidden' | 'throttled' | 'idle';

export interface ShouldSyncInput {
  /** Page/tab visible (document.visibilityState === 'visible'). */
  visible: boolean;
  /** FaceLandmarker says the user is looking at this screen. */
  facing: boolean;
  /** Window has focus (tab/app foregrounded). */
  focused: boolean;
  /** When we last synced, or null if never. */
  lastSyncAt: number | null;
  now: number;
  /** Debounce so a flickering signal doesn't spam the hub. */
  minIntervalMs: number;
}

export interface ShouldSyncResult {
  sync: boolean;
  reason: SyncReason;
}

/**
 * Decide whether to sync now. A hidden page never syncs. Otherwise a face
 * looking at the screen (gaze) or a freshly focused+visible page triggers a
 * sync, throttled by `minIntervalMs`. Deterministic over its input.
 */
export function shouldSync(input: ShouldSyncInput): ShouldSyncResult {
  if (!input.visible) return { sync: false, reason: 'hidden' };
  const wants = input.facing ? 'face' : input.focused ? 'focus' : null;
  if (!wants) return { sync: false, reason: 'idle' };
  if (input.lastSyncAt !== null && input.now - input.lastSyncAt < input.minIntervalMs) {
    return { sync: false, reason: 'throttled' };
  }
  return { sync: true, reason: wants };
}

// ---- watcher ----------------------------------------------------------------

/** A running front-camera gaze probe. `facing()` is read-only presence; stop()
 *  releases the camera. Implementations keep all pixels on-device. */
export interface GazeProbe {
  facing(): boolean;
  stop(): void;
}

export interface GazeWatcherDeps {
  /** Open the front camera + FaceLandmarker. Only called when allowed to. */
  openGaze: () => Promise<GazeProbe> | GazeProbe;
  /** True when some other camera stream is already live (don't double-open). */
  hasLiveCameraStream: () => boolean;
  /** Current page visibility. */
  isVisible: () => boolean;
  /** Current window focus. */
  isFocused: () => boolean;
  now: () => number;
  /** Fired when a sync should happen; the reason is for the honest status line. */
  onSync: (reason: SyncReason) => void;
  /** Record that the gaze camera started — ON-DEVICE event, NO frames. */
  onGazeStart?: () => void;
  minIntervalMs?: number;
}

export interface GazeWatcher {
  /** Evaluate once (call from a visibility/focus listener or a poll tick). */
  tick(): void;
  /** Whether the front camera is being used for gaze (false in fallback mode). */
  usingCamera(): boolean;
  stop(): void;
}

/**
 * Build a gaze watcher. If a live camera stream exists,
 * it NEVER opens the front camera and runs in visibility/focus-only fallback.
 * Otherwise it opens the gaze probe lazily (recording the on-device start event)
 * and uses `facing` as the strongest sync trigger.
 */
export function createGazeWatcher(deps: GazeWatcherDeps): GazeWatcher {
  const minIntervalMs = deps.minIntervalMs ?? 4000;
  let probe: GazeProbe | null = null;
  let opening = false;
  let lastSyncAt: number | null = null;
  let stopped = false;

  const mayOpenCamera = (): boolean => !deps.hasLiveCameraStream();

  function ensureProbe(): void {
    if (stopped || probe || opening || !mayOpenCamera()) return;
    opening = true;
    Promise.resolve(deps.openGaze())
      .then((p) => {
        if (stopped) {
          p.stop();
          return;
        }
        probe = p;
        deps.onGazeStart?.(); // on-device start event — no frames leave
      })
      .catch(() => {
        // Camera denied/unavailable: stay in visibility/focus fallback.
      })
      .finally(() => {
        opening = false;
      });
  }

  function releaseProbe(): void {
    if (probe) {
      probe.stop();
      probe = null;
    }
  }

  return {
    tick() {
      if (stopped) return;
      // If a camera became live mid-session, back off the
      // front camera and fall back to visibility+focus.
      if (!mayOpenCamera()) releaseProbe();
      else ensureProbe();

      const facing = probe ? probe.facing() : false;
      const res = shouldSync({
        visible: deps.isVisible(),
        facing,
        focused: deps.isFocused(),
        lastSyncAt,
        now: deps.now(),
        minIntervalMs,
      });
      if (res.sync) {
        lastSyncAt = deps.now();
        deps.onSync(res.reason);
      }
    },
    usingCamera() {
      return probe !== null;
    },
    stop() {
      stopped = true;
      releaseProbe();
    },
  };
}
