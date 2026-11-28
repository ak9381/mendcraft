// Four-finger send: four fingers up with the thumb folded in (handShape's
// `four`), held still for a moment, then swept left or right — the board goes
// to the phone on that side. Pure: the caller feeds each frame's hands (their
// `four` read and palm x) and gets 'left' / 'right' once per gesture.
//
// Guards: the shape must be HELD (holdMs) before any travel counts, so a hand
// passing through four fingers on its way to an open palm never fires; the
// sweep must happen within windowMs of the hold (a slow drift re-anchors);
// it fires once and re-arms only after the hand stops showing four.

export type FourSide = 'left' | 'right';
export interface FourHand { four: boolean; /** Palm x, 0..1 of the camera frame. */ x: number }

export interface FourSendOptions {
  holdMs?: number;
  /** Horizontal sweep that sends, as a fraction of the frame width. */
  travel?: number;
  /** After the hold, the sweep must finish within this long. */
  windowMs?: number;
  /** A hand that leaves four for this long ends the gesture (one frame of
   *  misread never does). */
  graceMs?: number;
  /** Points are selfie space (x grows to her right) — the default. False:
   *  raw camera space (mirrored), so the direction flips. */
  selfie?: boolean;
}

export interface FourSend {
  update(hands: readonly FourHand[], now: number): FourSide | null;
  reset(): void;
}

export function createFourSend(o: FourSendOptions = {}): FourSend {
  const holdMs = o.holdMs ?? 350;
  const travel = o.travel ?? 0.12;
  const windowMs = o.windowMs ?? 1500;
  const graceMs = o.graceMs ?? 150;
  const selfie = o.selfie ?? true;
  let arm: { since: number; lastX: number; anchorX: number | null; anchorAt: number; fired: boolean; lostAt: number | null } | null = null;
  return {
    reset() { arm = null; },
    update(hands, now) {
      const fours = hands.filter((h) => h.four && Number.isFinite(h.x));
      if (!fours.length) {
        if (arm) {
          arm.lostAt ??= now;
          if (now - arm.lostAt >= graceMs) arm = null;
        }
        return null;
      }
      // The four hand nearest the one we follow (two hands: the other may be a fist).
      const h = arm ? fours.reduce((a, b) => (Math.abs(b.x - arm!.lastX) < Math.abs(a.x - arm!.lastX) ? b : a)) : fours[0]!;
      if (!arm) arm = { since: now, lastX: h.x, anchorX: null, anchorAt: now, fired: false, lostAt: null };
      arm.lostAt = null;
      arm.lastX = h.x;
      if (arm.fired) return null;
      if (now - arm.since < holdMs) return null;
      if (arm.anchorX === null || now - arm.anchorAt > windowMs) { arm.anchorX = h.x; arm.anchorAt = now; return null; }
      const dx = (h.x - arm.anchorX) * (selfie ? 1 : -1);
      if (Math.abs(dx) < travel) return null;
      arm.fired = true;
      return dx > 0 ? 'right' : 'left';
    },
  };
}

/** Palm centre x of 21 landmarks (wrist + the four knuckles). */
export function palmX(lm: readonly { x: number }[]): number {
  const idx = [0, 5, 9, 13, 17];
  return idx.reduce((s, i) => s + (lm[i]?.x ?? 0), 0) / idx.length;
}
