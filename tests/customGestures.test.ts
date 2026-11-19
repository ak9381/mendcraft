import { describe, expect, it } from 'vitest';
import { buildHandPose } from '../src/dev/trackingSim';
import {
  builtinConflict,
  coerceCustomGesture,
  createGestureRecorder,
  createMemoryGestureStore,
  matchCustomGestures,
  type CustomGesture,
} from '../src/input/customGestures';
import type { Pt } from '../src/input/handLogic';

function heldSample(pose: Parameters<typeof buildHandPose>[0], frames = 6): Pt[][] {
  return Array.from({ length: frames }, () => buildHandPose(pose, { x: 0.6, y: 0.6 }, 0.22));
}

describe('createGestureRecorder — pose samples', () => {
  it('needs a minimum of two consistent samples before it is ready, then finalises at three', () => {
    const rec = createGestureRecorder();
    const r1 = rec.addSample(heldSample('thumbs-up'));
    expect(r1.status).toBe('retry'); // need-more signalled as retry with reason ''
    expect(r1.reason).toBe('');
    const r2 = rec.addSample(heldSample('thumbs-up'));
    expect(r2.status).toBe('ready');
    const r3 = rec.addSample(heldSample('thumbs-up'));
    expect(r3.status).toBe('done');
    if (r3.status === 'done') {
      expect(r3.kind).toBe('pose');
      expect(r3.pose?.vector).toHaveLength(42);
    }
  });

  it('rejects an inconsistent third try and keeps the first two', () => {
    const rec = createGestureRecorder();
    rec.addSample(heldSample('thumbs-up'));
    rec.addSample(heldSample('thumbs-up'));
    const bad = rec.addSample(heldSample('open'));
    expect(bad.status).toBe('retry');
    expect(bad.samples).toBe(2); // the bad try was dropped, not counted
  });

  it('finishes early at two samples via finishEarly', () => {
    const rec = createGestureRecorder();
    rec.addSample(heldSample('thumbs-up'));
    rec.addSample(heldSample('thumbs-up'));
    const done = rec.finishEarly();
    expect(done?.status).toBe('done');
  });

  it('finishEarly returns null before the minimum is met', () => {
    const rec = createGestureRecorder();
    rec.addSample(heldSample('thumbs-up'));
    expect(rec.finishEarly()).toBeNull();
  });

  it('reports a kind mismatch when a try moves after a held first try', () => {
    const rec = createGestureRecorder();
    rec.addSample(heldSample('thumbs-up'));
    const open = buildHandPose('open', { x: 0.5, y: 0.6 }, 0.22);
    const fist = buildHandPose('fist', { x: 0.5, y: 0.6 }, 0.22);
    const moving = Array.from({ length: 10 }, (_, i) => {
      const t = i / 9;
      return open.map((p, j) => ({ x: p.x + (fist[j].x - p.x) * t, y: p.y + (fist[j].y - p.y) * t }));
    });
    const r = rec.addSample(moving);
    expect(r.status).toBe('retry');
    expect(r.reason).toMatch(/moved/);
  });
});

describe('builtinConflict', () => {
  it('flags thumbs-up as a conflict with the built-in catalog gesture', () => {
    const g = builtinConflict(heldSample('thumbs-up'), 'pose');
    expect(g?.id).toBe('thumbs-up');
  });

  it('is undefined for a pose with no built-in match', () => {
    // A mid-curl pose that is neither a clean fist, point, nor open palm.
    const half = buildHandPose('open', { x: 0.6, y: 0.6 }, 0.22).map((p, i) => {
      const fist = buildHandPose('fist', { x: 0.6, y: 0.6 }, 0.22)[i];
      return { x: (p.x + fist.x) / 2, y: (p.y + fist.y) / 2 };
    });
    expect(builtinConflict([half], 'pose')).toBeUndefined();
  });
});

describe('matchCustomGestures — threshold, margin and runtime precedence', () => {
  function makeTaught(name: string, pose: Parameters<typeof buildHandPose>[0], conflictsWith?: string): CustomGesture {
    const rec = createGestureRecorder();
    rec.addSample(heldSample(pose));
    rec.addSample(heldSample(pose));
    const done = rec.finishEarly();
    if (done?.status !== 'done' || !done.pose) throw new Error('setup failed');
    return {
      id: name, name, kind: 'pose', pose: { ...done.pose, id: name, label: name },
      action: { type: 'save' }, actionSummary: 'Save the canvas', conflictsWith, createdAt: 0,
    };
  }

  it('fires the acknowledged overlap (thumbs-up taught with conflictsWith set)', () => {
    const taught = makeTaught('save-gesture', 'thumbs-up', 'thumbs-up');
    const match = matchCustomGestures(heldSample('thumbs-up'), [taught]);
    expect(match?.gesture.id).toBe('save-gesture');
  });

  it('defers to an unrelated built-in when conflictsWith was not acknowledged for it', () => {
    // Taught against 'point' (no conflict), but the live pose is thumbs-up —
    // an unrelated built-in neither the template nor conflictsWith expects.
    const taught = makeTaught('weird-gesture', 'point');
    const match = matchCustomGestures(heldSample('thumbs-up'), [taught]);
    expect(match).toBeNull();
  });

  it('returns null when nothing is close enough', () => {
    const taught = makeTaught('save-gesture', 'thumbs-up', 'thumbs-up');
    expect(matchCustomGestures(heldSample('open'), [taught])).toBeNull();
  });

  it('returns null when two taught gestures are too close to call (margin)', () => {
    const a = makeTaught('a', 'thumbs-up', 'thumbs-up');
    const b = makeTaught('b', 'thumbs-up', 'thumbs-up');
    expect(matchCustomGestures(heldSample('thumbs-up'), [a, b])).toBeNull();
  });
});

describe('storage', () => {
  it('round-trips through the memory store', async () => {
    const gesture: CustomGesture = {
      id: 'g1', name: 'Thumbs up', kind: 'pose',
      pose: { id: 'g1', label: 'Thumbs up', vector: new Array(42).fill(0), createdAt: 1 },
      action: { type: 'save' }, actionSummary: 'Save the canvas', createdAt: 1,
    };
    const store = createMemoryGestureStore();
    await store.put(gesture);
    const loaded = await store.load();
    expect(loaded).toEqual([gesture]);
    await store.remove('g1');
    expect(await store.load()).toEqual([]);
  });

  it('coerceCustomGesture rejects malformed records', () => {
    expect(coerceCustomGesture(null)).toBeNull();
    expect(coerceCustomGesture({ id: 'x' })).toBeNull();
    expect(coerceCustomGesture({ id: 'x', name: 'x', kind: 'pose', action: {}, actionSummary: 'x', pose: { id: 'x', label: 'x', vector: [1] } })).toBeNull();
  });
});
