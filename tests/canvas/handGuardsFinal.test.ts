// Hand guards: taught gestures obey the facing/grab guards; a registered
// operator's hands survive a face briefly hidden behind her own hand; the
// laptop camera stops while the tab is hidden; dead pinch wiring is gone.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindOperatorHands } from '../../src/input/presence';

const canvasApp = readFileSync('src/canvas/canvasApp.ts', 'utf8');

describe('taught gestures obey the hand guards (B4)', () => {
  it('matchFrame never runs while hands are locked (not facing) or a fist grab is running', () => {
    // The laptop hand router (handFacing.ts) calls the taught-gesture
    // matcher only behind the facing lock and the grab check.
    expect(canvasApp).toContain('teach: (hands, now) => teachPanel.matchFrame(');
    const router = readFileSync('src/canvas/handFacing.ts', 'utf8');
    const at = router.indexOf('d.teach?.(hands, now)');
    expect(at).toBeGreaterThan(-1);
    const line = router.slice(router.lastIndexOf('\n', at), at);
    expect(line).toContain('!locked()');
    expect(line).toContain('!d.pointer?.isGrabActive()');
  });
});

describe('a face hidden behind her own hand keeps her hands (B5)', () => {
  const box = { x: 0.4, y: 0.2, w: 0.2, h: 0.3, cx: 0.5, cy: 0.35 };
  it('not paused + a last-seen box: hands stay bound (through the gate grace)', () => {
    expect(bindOperatorHands(false, box)).toBe(true);
  });
  it('paused (gone past the grace), or no box: hands drop', () => {
    expect(bindOperatorHands(true, box)).toBe(false);
    expect(bindOperatorHands(false, null)).toBe(false);
  });
  it('presence uses the gate, not raw face presence, to drop hands', () => {
    const src = readFileSync('src/input/presence.ts', 'utf8');
    expect(src).toContain('if (!bindOperatorHands(paused, operator.lastBox))');
    expect(src).not.toContain('if (paused || !operatorPresent)');
  });
});

describe('laptop camera follows tab visibility (B6)', () => {
  it('mountCanvasHands stops on hidden and restarts on visible, and unhooks on stop', () => {
    const src = readFileSync('src/canvas/canvasHands.ts', 'utf8');
    expect(src).toContain("doc?.addEventListener('visibilitychange', onVisibility)");
    expect(src).toContain("doc?.removeEventListener('visibilitychange', onVisibility)");
    expect(src).toMatch(/if \(hidden\) \{ live\.stop\(\);/);
    expect(src).toContain('await live.start(');
  });
});

describe('dead pinch wiring is gone (B6)', () => {
  it('no pinch-twice calibration in the canvas', () => {
    expect(canvasApp).not.toMatch(/pinchTwice|finishPinchCalibrate|mc-pinch-cal/);
  });
  it('no pinch-point helpers or feedGesture on the canvas hands adapter', () => {
    const src = readFileSync('src/canvas/canvasHands.ts', 'utf8');
    expect(src).not.toMatch(/twoHandPinchPoints|oneHandPinchPoint|feedGesture|mapGestureToCanvasEvent/);
  });
});
