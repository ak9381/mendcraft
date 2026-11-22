// Registration scan state machine: guided face -> left palm -> right palm
// capture, pure and clock-injected (no camera, no DOM).
import { describe, expect, it } from 'vitest';
import {
  createScanFlow,
  SCAN_DEFAULTS,
  SCAN_SIM,
  SCAN_PROMPTS,
  replayInputFor,
  openPalmLandmarks,
  loadOwner,
  storeOwner,
  OWNER_STORAGE_KEY,
  ownerHandsOf,
  registerButtonLabel,
  type ScanFrameInput,
  type OwnerRecord,
} from '../../src/canvas/scanRegistration';
import type { FaceSignature } from '../../src/input/faceLogic';
import type { Pt } from '../../src/input/handLogic';

const FACE_SIG: FaceSignature = {
  ratios: [1, 1, 1, 1, 1, 1, 1, 1],
  box: { x: 0.4, y: 0.25, w: 0.2, h: 0.26, cx: 0.5, cy: 0.38 },
};

function faceFrame(now: number, center = { x: 0.5, y: 0.38 }): ScanFrameInput {
  return { faceSig: FACE_SIG, faceCenter: center, hands: [], now };
}

function handFrame(now: number, label: string | undefined, points: readonly Pt[]): ScanFrameInput {
  return { faceSig: null, faceCenter: null, hands: [{ label, points }], now };
}

// A fist: all 21 landmarks collapsed to one point classifies as a non-palm pose.
const fistLandmarks: Pt[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5 }));

describe('face step', () => {
  it('accumulates progress while the face is stable, then advances to left', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    let state = flow.update(faceFrame(0));
    expect(state.progress).toBe(0); // first frame: dt is 0 (no previous `now`)
    for (let t = 100; t <= 800; t += 100) state = flow.update(faceFrame(t));
    expect(state.progress).toBeGreaterThan(0);
    expect(state.progress).toBeLessThan(1);
    expect(state.step).toBe('face');
    // Stop exactly on the frame that crosses holdMs — justAdvanced is only true on that frame.
    let t = 900;
    while (state.step === 'face') {
      state = flow.update(faceFrame(t));
      t += 100;
    }
    expect(state.step).toBe('left');
    expect(state.justAdvanced).toBe(true);
    expect(state.prompt).toBe(SCAN_PROMPTS.left);
  });

  it('a moving face resets the hold', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    let state = flow.update(faceFrame(0));
    for (let t = 100; t <= 800; t += 100) state = flow.update(faceFrame(t));
    expect(state.progress).toBeGreaterThan(0);
    // Face centre jumps by 0.2 — well past stableDist (0.08) — breaking the hold.
    state = flow.update(faceFrame(900, { x: 0.7, y: 0.38 }));
    state = flow.update(faceFrame(1000, { x: 0.7, y: 0.38 }));
    expect(state.progress).toBeLessThan(0.2); // restarted, only one stable frame counted
    expect(state.step).toBe('face');
  });

  it('no face resets progress to 0', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    flow.update(faceFrame(0));
    for (let t = 100; t <= 800; t += 100) flow.update(faceFrame(t));
    const state = flow.update({ faceSig: null, faceCenter: null, hands: [], now: 900 });
    expect(state.progress).toBe(0);
    expect(state.step).toBe('face');
  });
});

function advanceThroughFace(flow: ReturnType<typeof createScanFlow>, cfg = SCAN_DEFAULTS): void {
  flow.update(faceFrame(0));
  let t = 0;
  while (flow.step === 'face') {
    t += 100;
    flow.update(faceFrame(t));
  }
}

describe('left step', () => {
  it('an open LEFT palm held for holdMs advances to right', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    advanceThroughFace(flow);
    let state = flow.update(handFrame(2000, 'Left', openPalmLandmarks()));
    // Stop exactly on the advancing frame — justAdvanced is only true on that frame.
    let t = 2100;
    while (state.step === 'left') {
      state = flow.update(handFrame(t, 'Left', openPalmLandmarks()));
      t += 100;
    }
    expect(state.step).toBe('right');
    expect(state.justAdvanced).toBe(true);
  });

  it('a RIGHT-labelled palm does not advance the left step', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    advanceThroughFace(flow);
    let state = flow.update(handFrame(2000, 'Right', openPalmLandmarks()));
    for (let t = 2100; t <= 4000; t += 100) state = flow.update(handFrame(t, 'Right', openPalmLandmarks()));
    expect(state.step).toBe('left');
    expect(state.progress).toBe(0); // wrong-label frames never accumulate hold
  });

  it('a non-palm (fist) hand does not accumulate hold', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    advanceThroughFace(flow);
    let state = flow.update(handFrame(2000, 'Left', fistLandmarks));
    for (let t = 2100; t <= 3600; t += 100) state = flow.update(handFrame(t, 'Left', fistLandmarks));
    expect(state.step).toBe('left');
    expect(state.progress).toBe(0);
  });
});

function advanceThroughLeft(flow: ReturnType<typeof createScanFlow>): void {
  let t = 2000;
  flow.update(handFrame(t, 'Left', openPalmLandmarks()));
  while (flow.step === 'left') {
    t += 100;
    flow.update(handFrame(t, 'Left', openPalmLandmarks()));
  }
}

describe('right step and completion', () => {
  it('an open RIGHT palm held for holdMs completes the scan', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    advanceThroughFace(flow);
    advanceThroughLeft(flow);
    expect(flow.step).toBe('right');
    let t = 4000;
    let state = flow.update(handFrame(t, 'Right', openPalmLandmarks()));
    while (state.step === 'right') {
      t += 100;
      state = flow.update(handFrame(t, 'Right', openPalmLandmarks()));
    }
    expect(state.step).toBe('done');
    expect(flow.result()).not.toBeNull();
    const result = flow.result()!;
    expect(result.left.label).toBe('Left');
    expect(result.right.label).toBe('Right');
    // The face ratio input was constant across samples, so the average matches it.
    result.face.ratios.forEach((v) => expect(v).toBeCloseTo(1, 5));
  });

  it('result() is null before the scan reaches done', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    expect(flow.result()).toBeNull();
    advanceThroughFace(flow);
    expect(flow.result()).toBeNull();
  });
});

describe('reset', () => {
  it('returns the flow to face and clears the result', () => {
    const flow = createScanFlow(SCAN_DEFAULTS);
    advanceThroughFace(flow);
    advanceThroughLeft(flow);
    flow.reset();
    expect(flow.step).toBe('face');
    expect(flow.result()).toBeNull();
  });
});

describe('sim replay', () => {
  it('drives a fresh flow through face -> left -> right -> done quickly', () => {
    const flow = createScanFlow(SCAN_SIM);
    let now = 0;
    let iterations = 0;
    while (flow.step !== 'done' && iterations < 500) {
      flow.update(replayInputFor(flow.step, now));
      now += 60;
      iterations += 1;
    }
    expect(flow.step).toBe('done');
    expect(now).toBeLessThan(4000); // well under ~4 simulated seconds
    expect(flow.result()).not.toBeNull();
  });
});

describe('owner storage', () => {
  // Minimal in-memory Storage-shaped stand-in (no DOM/localStorage available in node env).
  function memoryStorage(): Storage {
    const map = new Map<string, string>();
    return {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => { map.set(k, v); },
      removeItem: (k: string) => { map.delete(k); },
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  }

  function sampleOwner(): OwnerRecord {
    return {
      face: { ratios: [1, 1, 1, 1], box: { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.5 } },
      left: { ratios: [0.1, 0.2], label: 'Left' },
      right: { ratios: [0.3, 0.4], label: 'Right' },
    };
  }

  it('round-trips an OwnerRecord through storeOwner/loadOwner', () => {
    const storage = memoryStorage();
    const owner = sampleOwner();
    storeOwner(storage, owner);
    expect(storage.getItem(OWNER_STORAGE_KEY)).not.toBeNull();
    expect(loadOwner(storage)).toEqual(owner);
  });

  it('storeOwner(null) removes the stored record', () => {
    const storage = memoryStorage();
    storeOwner(storage, sampleOwner());
    storeOwner(storage, null);
    expect(loadOwner(storage)).toBeNull();
  });

  it('rejects non-JSON junk', () => {
    const storage = memoryStorage();
    storage.setItem(OWNER_STORAGE_KEY, 'not json');
    expect(loadOwner(storage)).toBeNull();
  });

  it('rejects JSON missing the expected shape', () => {
    const storage = memoryStorage();
    storage.setItem(OWNER_STORAGE_KEY, JSON.stringify({ nope: 1 }));
    expect(loadOwner(storage)).toBeNull();
  });

  it('rejects a record whose left hand is mislabeled', () => {
    const storage = memoryStorage();
    const bad = sampleOwner();
    bad.left = { ratios: [0.1, 0.2], label: 'Right' }; // left.label must be 'Left'
    storage.setItem(OWNER_STORAGE_KEY, JSON.stringify(bad));
    expect(loadOwner(storage)).toBeNull();
  });

  it('returns null when storage itself is null', () => {
    expect(loadOwner(null)).toBeNull();
  });

  it('ownerHandsOf maps an OwnerRecord to {left, right}', () => {
    const owner = sampleOwner();
    expect(ownerHandsOf(owner)).toEqual({ left: owner.left, right: owner.right });
  });

  it('registerButtonLabel says "Register" with no owner yet, "Re-register" once one exists', () => {
    expect(registerButtonLabel(null)).toBe('Register');
    expect(registerButtonLabel(sampleOwner())).toBe('Re-register');
  });
});
