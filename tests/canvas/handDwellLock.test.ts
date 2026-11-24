// Target-locked dwell through the REAL createHandPointer().update() pipeline
// (palm anchor → active box → One-Euro in screen px → dead zone → magnet lock
// → dwell). Once a control captures the cursor, jitter inside the lock never
// restarts the 800 ms ring; leaving releases it; one click per visit.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHandPointer, type HandPointer } from '../../src/canvas/handPointer';
import { HAND_FEEL } from '../../src/canvas/handFeel';
import { synthHand } from '../helpers/synthHands';
import { fakeButton, fakeHandDoc, ringsOf, type FakeEl } from '../helpers/fakeHandDoc';

const W = 1000;
const H = 800;
const FRAME = 33;

describe('target-locked 800 ms dwell with magnet', () => {
  // A 60×52 button mid-screen (the size of a real toolbar chip).
  let btn: FakeEl;
  let hp: HandPointer;
  let doc: ReturnType<typeof fakeHandDoc>;
  let t: number;
  const at = (x: number, y: number, frames: number, jitter = 0) => {
    for (let i = 0; i < frames; i++) {
      t += FRAME;
      const j = jitter ? (i % 2 === 0 ? jitter : -jitter) : 0;
      const k = jitter ? (i % 3 === 0 ? jitter : -jitter) : 0;
      hp.update([synthHand(x + j, y + k, false, W, H)], t);
    }
  };

  beforeEach(() => {
    (globalThis as Record<string, unknown>).innerWidth = W;
    (globalThis as Record<string, unknown>).innerHeight = H;
    btn = fakeButton({ left: 470, top: 374, width: 60, height: 52 }); // centre (500, 400)
    doc = fakeHandDoc([btn]);
    hp = createHandPointer(doc, {});
    t = 0;
  });
  afterEach(() => {
    hp.destroy();
    delete (globalThis as Record<string, unknown>).innerWidth;
    delete (globalThis as Record<string, unknown>).innerHeight;
  });

  it('±8px jitter inside a 60×52 button for 800 ms → exactly one click (Review Focus 4)', () => {
    at(500, 400, 23, 8); // ≈760 ms locked, jittering ±8px on both axes
    expect(hp.target).toBe(btn);
    expect(btn.click).not.toHaveBeenCalled();
    const ring = ringsOf(doc)[0];
    expect(ring.hidden).toBe(false); // the ring is filling
    expect(Number(ring.style['--mc-dwell'])).toBeGreaterThan(0.8);
    at(500, 400, 8, 8); // past 800 ms
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('larger ±20px jitter that crosses the button edge still clicks once (lock margin)', () => {
    at(500, 400, 32, 20);
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('leaving the button at 500 ms → no click', () => {
    at(500, 400, 15, 8); // ≈500 ms
    at(800, 150, 40); // well past the 60px release
    expect(btn.click).not.toHaveBeenCalled();
    expect(hp.target).toBeNull();
  });

  it('after a click, staying on the button for 2 s → no second click', () => {
    at(500, 400, 30, 4);
    expect(btn.click).toHaveBeenCalledTimes(1);
    at(500, 400, 61, 4); // 2 s more
    expect(btn.click).toHaveBeenCalledTimes(1);
  });

  it('leave and re-enter → the dwell arms again', () => {
    at(500, 400, 30);
    expect(btn.click).toHaveBeenCalledTimes(1);
    at(800, 150, 25); // leave (≈825 ms, past the 600 ms cooldown)
    expect(hp.target).toBeNull();
    at(500, 400, 45); // come back and rest
    expect(btn.click).toHaveBeenCalledTimes(2);
  });

  it('a quick leave and re-enter inside the 600 ms cooldown waits out the cooldown before the ring restarts', () => {
    // Start the hand on the button so the lock begins on the first frame.
    at(500, 400, 26); // click at 800 ms after the first-frame lock
    expect(btn.click).toHaveBeenCalledTimes(1);
    const clickT = t;
    // Hop well off the button for a few frames, then straight back.
    at(900, 100, 4);
    expect(hp.target).toBeNull();
    at(500, 400, 1);
    // Back on it: no click before cooldown + full dwell since the click.
    while (t < clickT + HAND_FEEL.clickCooldownMs + HAND_FEEL.dwellMs - 2 * FRAME) {
      at(500, 400, 1);
    }
    expect(btn.click).toHaveBeenCalledTimes(1);
    at(500, 400, 10);
    expect(btn.click).toHaveBeenCalledTimes(2);
  });

  it('a point 35px outside the button snaps to it and clicks; 65px does not', () => {
    // 35px left of the left edge (470): x = 435.
    at(435, 400, 30);
    expect(hp.target).toBe(btn);
    expect(btn.click).toHaveBeenCalledTimes(1);

    const btn2 = fakeButton({ left: 470, top: 374, width: 60, height: 52 });
    const d2 = fakeHandDoc([btn2]);
    const hp2 = createHandPointer(d2, {});
    try {
      let t2 = 0;
      for (let i = 0; i < 40; i++) { t2 += FRAME; hp2.update([synthHand(405, 400, false, W, H)], t2); }
      expect(hp2.target).toBeNull();
      expect(btn2.click).not.toHaveBeenCalled();
    } finally {
      hp2.destroy();
    }
  });

  it('release hysteresis: captured at 35px stays locked out to 55px, released past 60px', () => {
    at(435, 400, 5); // captured
    expect(hp.target).toBe(btn);
    at(415, 400, 30); // 55px out: inside the 60px release — still locked
    expect(hp.target).toBe(btn);
    at(380, 400, 30); // 90px out: released
    expect(hp.target).toBeNull();
  });
});
