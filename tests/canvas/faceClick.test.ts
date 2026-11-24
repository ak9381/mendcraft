import { describe, expect, it } from 'vitest';
import { createFaceClick, FACE_CLICK, faceClickEnabled } from '../../src/canvas/faceClick';

describe('face click detector (jawOpen / browInnerUp, opt-in)', () => {
  it('thresholds: ≥0.6 held 250 ms fires, release below 0.4', () => {
    expect(FACE_CLICK.onScore).toBe(0.6);
    expect(FACE_CLICK.offScore).toBe(0.4);
    expect(FACE_CLICK.holdMs).toBe(250);
  });

  it('fires once after 250 ms of an open jaw, then only again after release below 0.4', () => {
    const d = createFaceClick();
    let fired = 0;
    for (let t = 0; t <= 600; t += 33) if (d.update({ jawOpen: 0.8 }, t)) fired++;
    expect(fired).toBe(1);
    // Dropping to 0.5 (between off and on) does not re-arm.
    for (let t = 633; t <= 900; t += 33) d.update({ jawOpen: 0.5 }, t);
    for (let t = 933; t <= 1400; t += 33) if (d.update({ jawOpen: 0.8 }, t)) fired++;
    expect(fired).toBe(1);
    d.update({ jawOpen: 0.1 }, 1433); // released
    for (let t = 1466; t <= 1900; t += 33) if (d.update({ jawOpen: 0.7 }, t)) fired++;
    expect(fired).toBe(2);
  });

  it('a brief (< 250 ms) mouth open or brow raise does nothing', () => {
    const d = createFaceClick();
    let fired = 0;
    for (let t = 0; t <= 200; t += 33) if (d.update({ browInnerUp: 0.9 }, t)) fired++;
    d.update({ browInnerUp: 0.1 }, 233);
    for (let t = 266; t <= 466; t += 33) if (d.update({ jawOpen: 0.9 }, t)) fired++;
    expect(fired).toBe(0);
  });

  it('browInnerUp counts the same as jawOpen; missing scores read as 0', () => {
    const d = createFaceClick();
    let fired = false;
    for (let t = 0; t <= 300; t += 33) fired = d.update({ browInnerUp: 0.7 }, t) || fired;
    expect(fired).toBe(true);
    expect(createFaceClick().update(null, 0)).toBe(false);
  });

  it('is off by default; on only when mc.faceClick === "1"', () => {
    const store = (v: string | null) => ({ getItem: () => v });
    expect(faceClickEnabled(store(null))).toBe(false);
    expect(faceClickEnabled(store('0'))).toBe(false);
    expect(faceClickEnabled(store('1'))).toBe(true);
    expect(faceClickEnabled({ getItem: () => { throw new Error('blocked'); } })).toBe(false);
    expect(faceClickEnabled(null)).toBe(false);
  });
});
