// Phone hand profile: the front camera's mirrored, portrait reach box, the
// wider magnet and the idle throttle — and the REAL pointer pipeline run with
// that profile on a 390×844 phone screen (fist tap clicks, mirroring holds).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HAND_FEEL, PHONE_HAND_FEEL, palmCenter, phoneReach, phoneTrackIntervalMs, type ReachBox } from '../../src/canvas/handFeel';
import { createHandPointer, mapToScreen, type HandPointer } from '../../src/canvas/handPointer';
import { synthFist, synthHand } from '../helpers/synthHands';
import { fakeButton, fakeHandDoc } from '../helpers/fakeHandDoc';
import type { Pt } from '../../src/input/handLogic';

const W = 390;
const H = 844;
const PORTRAIT = 640 / 480; // a portrait front-camera frame (h ÷ w)

/** Re-place a laptop-box synthetic hand so its palm maps to (px, py) through
 *  the PHONE box (mirrored), keeping its shape. */
function onPhone(lm: Pt[], px: number, py: number, box: ReachBox = PHONE_HAND_FEEL.reachPortrait): Pt[] {
  const c = palmCenter(lm);
  const target = { x: 1 - (box.x0 + (px / W) * (box.x1 - box.x0)), y: box.y0 + (py / H) * (box.y1 - box.y0) };
  return lm.map((p) => ({ x: target.x + (p.x - c.x), y: target.y + (p.y - c.y) }));
}

describe('phone reach profile', () => {
  it('portrait frames use the portrait box; landscape frames the landscape box; unknown = portrait', () => {
    expect(phoneReach(PORTRAIT)).toEqual(PHONE_HAND_FEEL.reachPortrait);
    expect(phoneReach(480 / 640)).toEqual(PHONE_HAND_FEEL.reachLandscape);
    expect(phoneReach(null)).toEqual(PHONE_HAND_FEEL.reachPortrait);
    expect(phoneReach(0)).toEqual(PHONE_HAND_FEEL.reachPortrait);
  });

  it('documented numbers: portrait box, magnet 48 px, 30/10 fps', () => {
    const p = PHONE_HAND_FEEL.reachPortrait;
    expect(p).toEqual({ x0: 0.22, x1: 0.78, y0: 0.28, y1: 0.78 });
    // A phone-distance palm (wrist ~0.15 below the palm centre) at the
    // box's bottom keeps its wrist clear of the camera-edge guard (0.94).
    expect(p.y1 + 0.15).toBeLessThan(0.94);
    expect(PHONE_HAND_FEEL.reachLandscape.y1 + 0.19).toBeLessThan(0.94);
    expect(PHONE_HAND_FEEL.magnetCapturePx).toBe(48);
    expect(PHONE_HAND_FEEL.magnetReleasePx - PHONE_HAND_FEEL.magnetCapturePx)
      .toBe(HAND_FEEL.magnetReleasePx - HAND_FEEL.magnetCapturePx);
    expect(PHONE_HAND_FEEL.activeIntervalMs).toBeLessThanOrEqual(50); // ≥ 20 fps
    expect(PHONE_HAND_FEEL.idleIntervalMs).toBe(100); // 10 fps idle
    expect(PHONE_HAND_FEEL.mirror).toBe(true);
  });

  it('the front camera is mirrored: a hand on the RAW frame’s left lands on the screen’s right', () => {
    const box = phoneReach(PORTRAIT);
    const right = mapToScreen({ x: box.x0, y: 0.6 }, W, H, PHONE_HAND_FEEL.mirror, box);
    const left = mapToScreen({ x: box.x1, y: 0.6 }, W, H, PHONE_HAND_FEEL.mirror, box);
    expect(right.x).toBeGreaterThan(W - 40);
    expect(left.x).toBeLessThan(40);
    // The box's centre is the screen's centre; its corners reach the margins.
    const mid = mapToScreen({ x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }, W, H, true, box);
    expect(mid.x).toBeCloseTo(W / 2, 5);
    expect(mid.y).toBeCloseTo(H / 2, 5);
    const top = mapToScreen({ x: 0.5, y: box.y0 }, W, H, true, box);
    const bottom = mapToScreen({ x: 0.5, y: box.y1 }, W, H, true, box);
    expect(top.y).toBeLessThan(40);
    expect(bottom.y).toBeGreaterThan(H - 40);
  });

  it('the bottom pills are reached with the palm at 0.76 of the frame (the laptop box needs 0.83)', () => {
    const phone = mapToScreen({ x: 0.5, y: 0.76 }, W, H, true, phoneReach(PORTRAIT));
    const laptop = mapToScreen({ x: 0.5, y: 0.76 }, W, H, true, HAND_FEEL.reach);
    expect(phone.y).toBeGreaterThan(H * 0.94);
    expect(laptop.y).toBeLessThan(H * 0.85);
  });

  it('tracking interval: full rate while a hand was seen in the last 2 s, 10 fps after', () => {
    expect(phoneTrackIntervalMs(1000, 900)).toBe(PHONE_HAND_FEEL.activeIntervalMs);
    expect(phoneTrackIntervalMs(5000, 3000)).toBe(PHONE_HAND_FEEL.activeIntervalMs);
    expect(phoneTrackIntervalMs(5001, 3000)).toBe(PHONE_HAND_FEEL.idleIntervalMs);
    expect(phoneTrackIntervalMs(10, -Infinity)).toBe(PHONE_HAND_FEEL.idleIntervalMs);
    expect(phoneTrackIntervalMs(10, 10, false)).toBe(PHONE_HAND_FEEL.idleIntervalMs);
  });
});

describe('the live pointer with the phone profile (390×844)', () => {
  let hp: HandPointer;
  let t = 0;
  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
    t = 0;
  });
  afterEach(() => {
    hp?.destroy();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });
  const mount = (btns: ReturnType<typeof fakeButton>[]) => {
    hp = createHandPointer(fakeHandDoc(btns), {
      reach: () => phoneReach(PORTRAIT),
      snapPx: PHONE_HAND_FEEL.magnetCapturePx,
      dwellClick: () => false,
    });
  };
  const feed = (lm: Pt[], n: number) => { for (let i = 0; i < n; i++) { t += 33; hp.update([lm], t); } };

  it('a fist tap clicks the phone control under the palm (mapped through the phone box)', () => {
    const btn = fakeButton({ left: 255, top: 770, width: 120, height: 44 }); // bottom-right Hands pill
    mount([btn]);
    const px = 315, py = 792;
    feed(onPhone(synthHand(0, 0, false, W, H), px, py), 8);
    feed(onPhone(synthFist(0, 0, W, H), px, py), 4);
    feed(onPhone(synthHand(0, 0, false, W, H), px, py), 4);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('the same hand through the LAPTOP box would aim elsewhere (the profile matters)', () => {
    const lm = onPhone(synthHand(0, 0, false, W, H), 315, 800);
    const viaLaptop = mapToScreen(palmCenter(lm), W, H);
    expect(Math.hypot(viaLaptop.x - 315, viaLaptop.y - 800)).toBeGreaterThan(40);
  });

  it('the 48 px magnet captures a small control the laptop 40 px magnet would miss', () => {
    const btn = fakeButton({ left: 100, top: 400, width: 30, height: 30 });
    mount([btn]);
    // Palm 44 px right of the button's right edge.
    feed(onPhone(synthHand(0, 0, false, W, H), 174, 415), 10);
    expect(hp.target).toBe(btn as unknown as HTMLElement);
    hp.destroy();
    hp = createHandPointer(fakeHandDoc([btn]), { reach: () => phoneReach(PORTRAIT), dwellClick: () => false });
    feed(onPhone(synthHand(0, 0, false, W, H), 174, 415), 10);
    expect(hp.target).toBeNull();
  });

  it('facing gate on the phone: explicit "not facing" locks taps; unknown (null) stays allowed', () => {
    const btn = fakeButton({ left: 150, top: 400, width: 90, height: 60 });
    mount([btn]);
    const tap = () => {
      feed(onPhone(synthHand(0, 0, false, W, H), 195, 430), 8);
      feed(onPhone(synthFist(0, 0, W, H), 195, 430), 4);
      feed(onPhone(synthHand(0, 0, false, W, H), 195, 430), 4);
    };
    hp.setFacing?.(null, t);
    tap();
    expect(btn.click).toHaveBeenCalledTimes(1);
    hp.setFacing?.(false, t);
    t += 400; hp.setFacing?.(false, t);
    expect(hp.handsLocked?.()).toBe(true);
    tap();
    expect(btn.click).toHaveBeenCalledTimes(1);
    hp.setFacing?.(true, t);
    expect(hp.handsLocked?.()).toBe(false);
    t += 500;
    tap();
    expect(btn.click).toHaveBeenCalledTimes(2);
  });
});
