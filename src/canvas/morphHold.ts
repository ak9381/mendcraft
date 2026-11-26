// MORPH HOLD: the pure tap/hold/drag classifier behind "pinch-and-hold a
// tile, speak a change". Android's ViewConfiguration shape (classify by the
// first threshold crossed: movement past slop cancels the hold timer; the
// timer only fires if the pointer stayed inside the slop radius the whole
// time), with a hand-sized slop and an injected clock so every path — camera
// hand, mouse, touch, ?sim=1 — runs the exact same machine.
//
// Pinch flutter is NOT this module's problem: the hand adapter feeds it the
// debounced edges of handFeel's pinch FSM (engage/release frames + One Euro),
// so a 1–2 frame ratio dip never reaches arm/release here.

import type { Pt } from '../input/handLogic';

export type MorphPointerType = 'hand' | 'mouse' | 'touch';

export interface MorphFeelConfig {
  /** Continuous hold before the morph fires — reads as "about a second". */
  holdMs: number;
  /** Movement tolerance per pointer type; crossing it cancels the hold and
   *  the gesture falls through to whatever it already was. */
  slopPx: Record<MorphPointerType, number>;
  /** The amber fill ring starts showing progress from here (visionOS: show
   *  the hold, don't hide it in a timer). */
  fillStartMs: number;
  /** After a fire, no new hold can arm for this long (stops doubles). */
  refractoryMs: number;
  /** A tracking dropout (pointercancel / hand briefly lost) keeps the hold
   *  alive for this long; re-entry within it resumes the SAME hold with the
   *  dropout gap credited, instead of restarting the whole ~holdMs. */
  graceMs: number;
}

export const MORPH_FEEL: MorphFeelConfig = {
  holdMs: 900,
  slopPx: { hand: 28, mouse: 8, touch: 12 },
  fillStartMs: 250,
  refractoryMs: 500,
  graceMs: 200,
};

export type MorphHoldEvent = 'none' | 'fired' | 'cancelled';
export type MorphRelease = 'tap' | 'after-fire' | 'idle';

export interface MorphHold {
  /** Pointer down over a valid target (the caller resolves the target BEFORE
   *  arming — a hold over nothing never arms). False during refractory. */
  arm(p: Pt, type: MorphPointerType, now: number): boolean;
  /** Feed movement or the passage of time. Returns 'fired' exactly once per
   *  hold, 'cancelled' once when the slop radius is crossed. */
  update(p: Pt, now: number): MorphHoldEvent;
  /** Pointer up. 'tap' = released before the fire (the existing tap path
   *  runs unchanged; morph never saw it). */
  release(now: number): MorphRelease;
  /** pointercancel / tracking lost: abort silently (hard reset). */
  cancel(): void;
  /** A brief tracking dropout: keep the hold alive (frozen) for graceMs so a
   *  re-{@link arm} within the window resumes it. No-op unless armed & unfired. */
  pause(now: number): void;
  /** 0..1 amber fill (0 until fillStartMs, 1 at the fire). */
  progress(now: number): number;
  readonly armed: boolean;
  readonly fired: boolean;
  /** True while in the post-dropout grace window, awaiting re-arm. */
  readonly paused: boolean;
}

export function createMorphHold(cfg: MorphFeelConfig = MORPH_FEEL): MorphHold {
  let armed = false;
  let fired = false;
  let origin: Pt = { x: 0, y: 0 };
  let slop = cfg.slopPx.hand;
  let since = 0;
  let firedAt = -Infinity;
  let pausedAt: number | null = null;

  function reset(): void {
    armed = false;
    fired = false;
    pausedAt = null;
  }

  return {
    arm(p, type, now) {
      // Re-entry within the grace window resumes the SAME hold: credit the
      // dropout gap by sliding `since` forward, re-anchor the slop origin.
      if (pausedAt !== null && armed && !fired && now - pausedAt <= cfg.graceMs) {
        since += now - pausedAt;
        pausedAt = null;
        origin = { x: p.x, y: p.y };
        slop = cfg.slopPx[type];
        return true;
      }
      if (now - firedAt < cfg.refractoryMs) return false;
      armed = true;
      fired = false;
      pausedAt = null;
      origin = { x: p.x, y: p.y };
      slop = cfg.slopPx[type];
      since = now;
      return true;
    },
    update(p, now) {
      if (!armed || fired) return 'none';
      if (pausedAt !== null) {
        // Frozen during a dropout: cancel only once the grace window elapses.
        if (now - pausedAt > cfg.graceMs) { reset(); return 'cancelled'; }
        return 'none';
      }
      if (Math.hypot(p.x - origin.x, p.y - origin.y) > slop) {
        reset();
        return 'cancelled';
      }
      if (now - since >= cfg.holdMs) {
        fired = true;
        firedAt = now;
        return 'fired';
      }
      return 'none';
    },
    release(now) {
      void now;
      if (!armed && !fired) return 'idle';
      const was = fired ? 'after-fire' : 'tap';
      reset();
      return was;
    },
    cancel() {
      reset();
    },
    pause(now) {
      if (armed && !fired && pausedAt === null) pausedAt = now;
    },
    progress(now) {
      if (!armed) return 0;
      if (fired) return 1;
      const t = now - since;
      if (t <= cfg.fillStartMs) return 0;
      return Math.min(1, (t - cfg.fillStartMs) / Math.max(1, cfg.holdMs - cfg.fillStartMs));
    },
    get armed() {
      return armed;
    },
    get fired() {
      return fired;
    },
    get paused() {
      return pausedAt !== null;
    },
  };
}
