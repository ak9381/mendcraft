// C4 Register flow: cancel-at-any-step, tremor accommodation, and
// accidental-touch rejection, against the real createScanFlow() state machine.
import { describe, expect, it } from 'vitest';
import {
  createScanFlow, openPalmLandmarks, SCAN_DEFAULTS, SCAN_SIM, type ScanFrameInput,
} from '../../src/canvas/scanRegistration';
import { handSignatureRatios } from '../../src/input/handSignature';
import type { Pt } from '../../src/input/handLogic';
import type { FaceSignature } from '../../src/input/faceLogic';

const FACE: FaceSignature = {
  ratios: [0.9, 1.6, 0.95, 1.9, 1.1, 0.8, 0.8, 1.2],
  box: { x: 0.4, y: 0.25, w: 0.2, h: 0.26, cx: 0.5, cy: 0.38 },
};
const faceFrame = (now: number): ScanFrameInput => ({ faceSig: FACE, faceCenter: { x: 0.5, y: 0.38 }, now, hands: [] });
const palmFrame = (label: string, points: Pt[], now: number): ScanFrameInput => ({ faceSig: null, faceCenter: null, hands: [{ label, points }], now });

/** update() clamps dt to 100ms/call (anti-cheat against a single big time
 *  jump), so reaching a real hold duration needs repeated 100ms-spaced frames. */
function feedFace(flow: ReturnType<typeof createScanFlow>, startNow: number, totalMs: number, step = 100) {
  let now = startNow;
  let r = flow.update(faceFrame(now));
  for (let held = 0; held < totalMs; held += step) { now += step; r = flow.update(faceFrame(now)); }
  return r;
}
function feedPalm(flow: ReturnType<typeof createScanFlow>, label: string, points: Pt[], startNow: number, totalMs: number, step = 100) {
  let now = startNow;
  let r = flow.update(palmFrame(label, points, now));
  for (let held = 0; held < totalMs; held += step) { now += step; r = flow.update(palmFrame(label, points, now)); }
  return r;
}

/** A different person's left palm: same pose/label, different bone proportions
 *  (stretched from the wrist, same technique handSignature.test.ts uses). */
function strangerPalm(): Pt[] {
  const base = openPalmLandmarks();
  const wrist = base[0];
  return base.map((p, i) => (i < 5 ? { ...p } : { x: wrist.x + (p.x - wrist.x) * 2.2, y: wrist.y + (p.y - wrist.y) * 2.2 }));
}

describe('C058 cancel (reset) mid-face-step wipes all progress', () => {
  it('a reset() partway through the face hold returns to face/0 with no leaked samples', () => {
    const flow = createScanFlow(SCAN_SIM); // 600ms hold
    feedFace(flow, 0, 300); // partway — not yet complete
    expect(flow.step).toBe('face');
    expect(flow.progress).toBeGreaterThan(0);
    flow.reset(); // what the Cancel button's handler ultimately calls
    expect(flow.step).toBe('face');
    expect(flow.progress).toBe(0);
    expect(flow.result()).toBeNull();
    // A fresh, full-length hold afterwards still completes cleanly — no
    // leftover samples from the cancelled attempt bleed into the new one.
    const r = feedFace(flow, 10_000, 600);
    expect(r.step).toBe('left');
  });
});

describe('C059 cancel (reset) mid-palm-step returns all the way to face, not just the current step', () => {
  it('a reset() during the left-palm hold goes back to step "face"', () => {
    const flow = createScanFlow(SCAN_SIM);
    feedFace(flow, 0, 600); // completes face, advances to 'left'
    expect(flow.step).toBe('left');
    const palm = openPalmLandmarks();
    feedPalm(flow, 'Left', palm, 1000, 300); // partway into the left hold
    expect(flow.progress).toBeGreaterThan(0);
    flow.reset();
    expect(flow.step).toBe('face'); // the whole flow restarts, like a fresh registration
    expect(flow.result()).toBeNull();
  });
});

describe('C067 registration\'s hold time is fixed, with no tremor/low-effort relaxation', () => {
  it('SCAN_DEFAULTS.holdMs is a constant 1500ms, unrelated to handProfile.ts\'s per-profile dwellMs', () => {
    // No HandProfile/assist-profile concept is threaded into ScanConfig at
    // all — createScanFlow() only ever takes { holdMs, stableDist }. A
    // tremor-prone user who needs more time gets the same 1500ms as anyone.
    expect(SCAN_DEFAULTS.holdMs).toBe(1500);
    const flow = createScanFlow(); // default config — no profile parameter exists to pass
    const almost = feedFace(flow, 0, 1400); // short of 1500ms — still waiting, regardless of how shaky the hold was
    expect(almost.step).toBe('face');
    const done = feedFace(flow, 100_000, 1500);
    expect(done.step).toBe('left');
  });
});

describe('C068 a stranger\'s hand mid-hold contaminates the capture instead of being rejected', () => {
  // BUG: the per-frame match only checks pose + handedness label, never hand
  // identity (handSignature.ts isn't consulted until the *end* of the hold,
  // to build the result — not during it). A second person's hand with the
  // right pose and label silently donates samples to someone else's in-
  // progress registration instead of being ignored or resetting the hold.
  it.fails('frames from a second hand during an in-progress hold should not be folded into the captured signature', () => {
    const flow = createScanFlow(SCAN_SIM); // 600ms hold
    feedFace(flow, 0, 600); // advance to 'left'

    const owner = openPalmLandmarks();
    const stranger = strangerPalm();
    let now = 10_000;
    const upd = (points: Pt[]) => { now += 100; return flow.update(palmFrame('Left', points, now)); };

    upd(owner); upd(owner);     // 200ms of the real registrant holding still
    upd(stranger);               // +100ms — a passerby's hand, same pose/label
    upd(owner); upd(owner);
    const r = upd(owner);        // crosses 600ms total → completes

    expect(r.step).toBe('done');
    const captured = flow.result()!.left.ratios;
    const ownerOnly = handSignatureRatios(owner);
    // Desired: the captured signature should match the owner's hand alone.
    // Actual: it is an average contaminated by the stranger's one frame.
    expect(captured).toEqual(ownerOnly);
  });
});
