// HAND HOVER / MAGNETIC SNAP (no persistent cursor dot).
//
// Industry norm for hands-free pointing (visionOS: no cursor, the target
// highlights; HoloLens 2: a ring only near targets; Ultraleap TouchFree:
// hover + soft snapping on the target, a faint shadow elsewhere) is that the
// POINTER disappears into the target. So instead of drawing an always-on
// cursor, the one DOM element the hand is over gets a `.hand-hover` class
// (outline + slight scale — not colour alone, and it never steals focus),
// and the visual cursor position eases toward that element's centre.

export interface HandHover {
  /** Highlight `el` (removing the previous highlight); null clears it. */
  setTarget(el: HTMLElement | null): void;
  readonly current: HTMLElement | null;
}

const HOVER_CLASS = 'hand-hover';

export function createHandHover(): HandHover {
  let current: HTMLElement | null = null;
  return {
    setTarget(el) {
      if (el === current) return;
      current?.classList.remove(HOVER_CLASS);
      current = el;
      current?.classList.add(HOVER_CLASS);
    },
    get current() { return current; },
  };
}

export interface Rect { x: number; y: number; width: number; height: number }

/** Ease a point toward a rect's centre by `strength` (0 = no pull, 1 = snap
 *  straight to the centre). Pure so the pull math is unit-testable. */
export function magnetPull(point: { x: number; y: number }, rect: Rect, strength: number): { x: number; y: number } {
  const k = Math.max(0, Math.min(1, strength));
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  return { x: point.x + (cx - point.x) * k, y: point.y + (cy - point.y) * k };
}
