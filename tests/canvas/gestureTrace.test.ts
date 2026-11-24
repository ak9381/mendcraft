import { describe, expect, it } from 'vitest';
import {
  createGestureTrace,
  shouldEnableGestureTrace,
  targetIdOf,
  TRACE_CAP,
} from '../../src/canvas/gestureTrace';
import { isConfirmAction, CONFIRM_DWELL_MS } from '../../src/canvas/handPointer';
import { HAND_FEEL } from '../../src/canvas/handFeel';

describe('gesture trace', () => {
  it('is off by default and enables for ?debug=gestures or a pre-set flag', () => {
    expect(shouldEnableGestureTrace({ location: { search: '' } })).toBe(false);
    expect(shouldEnableGestureTrace({ location: { search: '?debug=gestures' } })).toBe(true);
    expect(shouldEnableGestureTrace({ location: { search: '?fresh=1&debug=gestures' } })).toBe(true);
    expect(shouldEnableGestureTrace({ location: { search: '' }, __mcTrace: true })).toBe(true);
    expect(shouldEnableGestureTrace({ location: { search: '' }, __mcTrace: { enabled: true } })).toBe(true);
  });

  it('keeps a ring buffer of frames once enabled', () => {
    const tr = createGestureTrace(3);
    tr.push({ t: 1, hand: 0, classification: 'point', pinchDistance: 0.2, focusedTargetId: null, raw: { x: 1, y: 1 }, eased: { x: 1, y: 1 }, clickTarget: null });
    expect(tr.frames).toHaveLength(0);
    tr.enable();
    for (let i = 0; i < 5; i++) {
      tr.push({ t: i, hand: 0, classification: 'pinch', pinchDistance: 0.02, focusedTargetId: 'Approve', raw: { x: i, y: 0 }, eased: { x: i, y: 0 }, clickTarget: null });
    }
    expect(tr.frames).toHaveLength(3);
    expect(tr.frames[0].t).toBe(2);
    expect(tr.dump()).toHaveLength(3);
    expect(TRACE_CAP).toBeGreaterThan(100);
  });

  it('targetIdOf prefers id, data-act, then aria-label', () => {
    const el = {
      getAttribute: (n: string) => (n === 'data-act' ? 'approve' : n === 'aria-label' ? 'Approve' : null),
      className: 'mc-review-approve',
      textContent: 'Approve',
      tagName: 'BUTTON',
    } as unknown as Element;
    expect(targetIdOf(el)).toBe('data-act=approve');
    expect(targetIdOf(null)).toBeNull();
  });
});

describe('confirm-action gates', () => {
  it('flags Approve / Reject / Ask else / delete / trash, not ordinary buttons', () => {
    const el = (cls: string, label: string) => ({
      matches: (sel: string) => sel.split(',').some((s) => s.trim() === `.${cls}` || s.trim().startsWith('.')),
      getAttribute: (n: string) => (n === 'aria-label' ? label : null),
      textContent: label,
    }) as unknown as HTMLElement;
    // Use aria/text path (matches may be broad); labels are the contract.
    const approve = { matches: () => false, getAttribute: (n: string) => n === 'aria-label' ? 'Approve' : null, textContent: 'Approve' } as unknown as HTMLElement;
    const cancel = { matches: () => false, getAttribute: (n: string) => n === 'aria-label' ? 'Cancel' : null, textContent: 'Cancel' } as unknown as HTMLElement;
    expect(isConfirmAction(approve)).toBe(true);
    expect(isConfirmAction({ matches: () => false, getAttribute: () => 'Reject', textContent: 'Reject' } as unknown as HTMLElement)).toBe(true);
    expect(isConfirmAction({ matches: () => false, getAttribute: () => 'Ask for something else', textContent: '' } as unknown as HTMLElement)).toBe(true);
    expect(isConfirmAction({ matches: () => false, getAttribute: () => 'Something else', textContent: '' } as unknown as HTMLElement)).toBe(true);
    expect(isConfirmAction({ matches: () => false, getAttribute: () => 'Delete tile', textContent: '' } as unknown as HTMLElement)).toBe(true);
    expect(isConfirmAction(cancel)).toBe(false);
    expect(CONFIRM_DWELL_MS).toBe(800);
    expect(CONFIRM_DWELL_MS).toBe(HAND_FEEL.dwellMs); // one dwell time, no duplicate constant
  });
});
