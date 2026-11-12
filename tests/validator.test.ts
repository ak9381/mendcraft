import { describe, expect, it } from 'vitest';
import { validateOp, LIMITS } from '../src/core/ops';

describe('validateOp', () => {
  it('accepts a well-formed add', () => {
    const v = validateOp({ op: 'add', shape: 'box', params: { w: 30, d: 20, h: 10 } });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.op).toEqual({ op: 'add', shape: 'box', params: { w: 30, d: 20, h: 10 } });
  });

  it('coerces numeric strings and clamps out-of-range sizes', () => {
    const v = validateOp({ op: 'add', shape: 'cylinder', params: { diameter: '20', height: 9999 } });
    expect(v.ok).toBe(true);
    if (v.ok && v.op.op === 'add')
      expect(v.op.params).toEqual({ diameter: 20, height: LIMITS.size.max });
  });

  it('rejects unknown ops and shapes', () => {
    expect(validateOp({ op: 'explode' }).ok).toBe(false);
    expect(validateOp({ op: 'add', shape: 'pyramid', params: {} }).ok).toBe(false);
    expect(validateOp('nope').ok).toBe(false);
    expect(validateOp(null).ok).toBe(false);
  });

  it('rejects ops missing required fields', () => {
    expect(validateOp({ op: 'move', target: 'selected' }).ok).toBe(false);
    expect(validateOp({ op: 'rotate', target: 'selected', deg: 45 }).ok).toBe(false);
    expect(validateOp({ op: 'scale', target: 'selected' }).ok).toBe(false);
    expect(validateOp({ op: 'union', targets: ['only-one'] }).ok).toBe(false);
    expect(validateOp({ op: 'hole', diameter: 5 }).ok).toBe(false);
  });

  it('defaults hole depth to through and axis to z', () => {
    const v = validateOp({ op: 'hole', target: 'selected', diameter: 6 });
    expect(v.ok).toBe(true);
    if (v.ok && v.op.op === 'hole') {
      expect(v.op.depth).toBe('through');
      expect(v.op.axis).toBe('z');
    }
  });

  it('rounds array count and clamps it into range', () => {
    const v = validateOp({ op: 'array', target: 'selected', count: 99, spacing: 20 });
    expect(v.ok).toBe(true);
    if (v.ok && v.op.op === 'array') expect(v.op.count).toBe(LIMITS.count.max);
  });
});
