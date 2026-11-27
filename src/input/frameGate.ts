// One tracking run per NEW camera frame. requestAnimationFrame fires at the
// display's rate (60 or 120 Hz) while the webcam delivers ~30 fps: without
// this gate MediaPipe ran two to four times on the same picture, for hours
// (final review M13, a long session froze its renderer). A webview whose
// video clock does not move for a live stream still runs, at most every
// STALE_CLOCK_MS (about the camera's own rate), and never stops.

export const STALE_CLOCK_MS = 40;

export interface FrameGate {
  /** True once per distinct video time (a new camera frame), or when the
   *  clock has not moved for STALE_CLOCK_MS. */
  isNewFrame(videoTime: number, now?: number): boolean;
  /** Forget the last frame (a new stream starts). */
  reset(): void;
}

export function createFrameGate(): FrameGate {
  let last = Number.NaN;
  let lastAt = -Infinity;
  return {
    isNewFrame(videoTime, now = typeof performance !== 'undefined' ? performance.now() : Date.now()) {
      if (!Number.isFinite(videoTime) || videoTime !== last || now - lastAt >= STALE_CLOCK_MS) {
        last = videoTime;
        lastAt = now;
        return true;
      }
      return false;
    },
    reset() { last = Number.NaN; lastAt = -Infinity; },
  };
}
