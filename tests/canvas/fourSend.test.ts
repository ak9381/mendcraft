// Four-finger send: four fingers up with the thumb in, held, then swept left
// or right — fires once per gesture, never on an open palm with the thumb out.
import { describe, expect, it } from 'vitest';
import { createFourSend, palmX } from '../../src/canvas/fourSend';
import { classifyHandShape } from '../../src/canvas/handShape';
import { mirrorHand, syntheticHand } from '../../src/canvas/handShapeFixtures';

const four = (x: number) => ({ four: true, x });
const open = (x: number) => ({ four: false, x });
/** Frames every 33 ms from `t0`: x moves from `x0` by `dx` over `ms`. */
function sweep(fs: ReturnType<typeof createFourSend>, t0: number, x0: number, dx: number, ms: number, hand = four) {
  const out: (string | null)[] = [];
  for (let t = 0; t <= ms; t += 33) out.push(fs.update([hand(x0 + (dx * t) / ms)], t0 + t));
  return out.filter(Boolean);
}

describe('createFourSend', () => {
  it('held, then swept right: fires once, "right"', () => {
    const fs = createFourSend();
    expect(sweep(fs, 0, 0.5, 0, 400)).toEqual([]); // the hold
    expect(sweep(fs, 433, 0.5, 0.2, 300)).toEqual(['right']);
    // Still showing four: never again.
    expect(sweep(fs, 800, 0.7, 0.2, 300)).toEqual([]);
  });
  it('swept left: "left"', () => {
    const fs = createFourSend();
    sweep(fs, 0, 0.6, 0, 400);
    expect(sweep(fs, 433, 0.6, -0.2, 300)).toEqual(['left']);
  });
  it('needs the hold: a sweep that starts at once never fires', () => {
    const fs = createFourSend();
    expect(sweep(fs, 0, 0.4, 0.3, 300)).toEqual([]);
  });
  it('re-arms only after the hand stops showing four', () => {
    const fs = createFourSend();
    sweep(fs, 0, 0.5, 0, 400);
    expect(sweep(fs, 433, 0.5, 0.2, 300)).toEqual(['right']);
    // One misread frame is not "stopped".
    fs.update([open(0.7)], 800);
    expect(sweep(fs, 833, 0.7, 0.2, 300)).toEqual([]);
    // Gone for a moment: armed again (hold, then sweep).
    fs.update([], 1200); fs.update([], 1400);
    sweep(fs, 1500, 0.5, 0, 400);
    expect(sweep(fs, 1933, 0.5, -0.2, 300)).toEqual(['left']);
  });
  it('a slow drift past the window never fires', () => {
    const fs = createFourSend();
    sweep(fs, 0, 0.3, 0, 400);
    expect(sweep(fs, 433, 0.3, 0.3, 5000)).toEqual([]);
  });
  it('an open palm with the thumb out never fires', () => {
    const fs = createFourSend();
    sweep(fs, 0, 0.5, 0, 400, open);
    expect(sweep(fs, 433, 0.5, 0.3, 300, open)).toEqual([]);
  });
  it('raw camera space (mirrored): the direction flips', () => {
    const fs = createFourSend({ selfie: false });
    sweep(fs, 0, 0.5, 0, 400);
    expect(sweep(fs, 433, 0.5, 0.2, 300)).toEqual(['left']);
  });
  it('two hands: follows the four hand, ignores the fist', () => {
    const fs = createFourSend();
    for (let t = 0; t <= 400; t += 33) fs.update([open(0.2), four(0.6)], t);
    const fired: (string | null)[] = [];
    for (let t = 0; t <= 300; t += 33) fired.push(fs.update([open(0.2), four(0.6 + (0.2 * t) / 300)], 433 + t));
    expect(fired.filter(Boolean)).toEqual(['right']);
  });
});

describe('handShape: four', () => {
  it('four fingers with the thumb in read four (shape stays open)', () => {
    for (const side of ['R', 'L'] as const) {
      for (const depth of [false, true]) {
        const r = classifyHandShape(syntheticHand('four', side, { depth }));
        expect(r.shape).toBe('open');
        expect(r.four).toBe(true);
      }
    }
  });
  it('an open palm with the thumb out is not four; nor a fist, three or peace', () => {
    expect(classifyHandShape(syntheticHand('open', 'R')).four).toBe(false);
    for (const s of ['fist', 'three', 'peace', 'one'] as const) expect(classifyHandShape(syntheticHand(s, 'R')).four).toBe(false);
  });
  it('mirror safe', () => {
    expect(classifyHandShape(mirrorHand(syntheticHand('four', 'R'))).four).toBe(true);
    expect(classifyHandShape(mirrorHand(syntheticHand('open', 'R'))).four).toBe(false);
  });
  it('palmX is the palm centre', () => {
    const h = syntheticHand('four', 'R', { at: { x: 0.6, y: 0.7 } });
    expect(palmX(h)).toBeGreaterThan(0.58);
    expect(palmX(h)).toBeLessThan(0.62);
  });
});
