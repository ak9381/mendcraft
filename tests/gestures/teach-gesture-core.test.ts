// C5 Gesture teaching: the pure recording/proposal core teachPanel.ts's DOM
// wraps (createGestureRecorder, createSurfaceProposal — the exact functions
// Keep/Reject and the sample loop call), driven with synthetic hand frames.
import { describe, expect, it } from 'vitest';
import { createGestureRecorder, SAMPLES_NEEDED } from '../../src/input/customGestures';
import { createSurfaceProposal } from '../../src/canvas/proposalBuffer';
import { buildHandPose } from '../../src/dev/trackingSim';
import type { Pt } from '../../src/input/handLogic';

/** Same construction teachPanel.ts's own ?sim=1 captureSample() uses: a held
 *  thumbs-up with a tiny repeatable wobble, 15 frames per ~2.5s sample. */
function sample(wrist: Pt): Pt[][] {
  return Array.from({ length: 15 }, (_, i) => {
    const jitter = Math.sin(i) * 0.004;
    return buildHandPose('thumbs-up', { x: wrist.x + jitter, y: wrist.y - jitter }, 0.22);
  });
}

// C077 (the "what should it do" field): no new test — describeAndPropose's
// form is a plain text input with no gesture-specific wiring, so the generic
// pinch-focus/auto-keyboard path already proven in say-box-hand-path.test.ts
// (C026) and keyboard-hand-path.test.ts (C025) covers it; see C-system-tests.md.

describe('C078/C079 Keep and Reject call the real SurfaceProposal accept()/reject()', () => {
  it('C078 Keep (accept) applies the held messages exactly once, even if clicked twice', () => {
    const applied: unknown[] = [];
    const proposal = createSurfaceProposal('teach-1', 'rules', 'save the canvas', [{ kind: 'noop' } as never], (m) => applied.push(...m));
    expect(proposal.accept()).toBe(true);
    expect(applied).toHaveLength(1);
    expect(proposal.accept()).toBe(false); // a second Keep pinch is a no-op, not a double-apply
    expect(applied).toHaveLength(1);
    expect(proposal.status()).toBe('accepted');
  });

  it('C079 Reject discards the gesture without ever applying it, and cannot un-reject', () => {
    const applied: unknown[] = [];
    const proposal = createSurfaceProposal('teach-2', 'rules', 'save the canvas', [{ kind: 'noop' } as never], (m) => applied.push(...m));
    expect(proposal.reject()).toBe(true);
    expect(applied).toHaveLength(0);
    expect(proposal.status()).toBe('rejected');
    expect(proposal.accept()).toBe(false); // rejected is terminal
    expect(applied).toHaveLength(0);
  });
});

describe('C088 either hand can teach a gesture — the recorder takes raw points only, no handedness', () => {
  it('three samples from a "left-side" wrist position record and finalize identically to any other position', () => {
    const rec = createGestureRecorder();
    let last;
    for (let n = 0; n < SAMPLES_NEEDED; n++) last = rec.addSample(sample({ x: 0.25, y: 0.6 })); // left-of-centre wrist, no label passed anywhere
    expect(last!.status).toBe('done');
    expect(last!.kind).toBe('pose');
  });
});

describe('C090 a stray hand briefly in frame (no full hand captured) is rejected, not recorded as a sample', () => {
  it('an empty frame set ("no full hand seen") asks to retry and leaves the sample count unchanged', () => {
    const rec = createGestureRecorder();
    const r = rec.addSample([]); // what a stray/incomplete glimpse produces
    expect(r.status).toBe('retry');
    expect(r.reason).toMatch(/No full hand seen/);
    expect(rec.samples()).toBe(0);
  });
});
