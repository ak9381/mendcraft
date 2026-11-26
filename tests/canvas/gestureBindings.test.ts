// The fixed gesture table and its context rules (no DOM: a fake env).
import { describe, expect, it } from 'vitest';
import {
  LAPTOP_GESTURES, PHONE_GESTURES, duplicateKeys, gestureName, resolveGesture,
  type GestureBinding, type GestureEnv,
} from '../../src/canvas/gestureBindings';
import type { GestureKey } from '../../src/canvas/gestureHold';

type El = { id: string };

function env(opts: { visible?: Record<string, string>; hidden?: Record<string, string>; highlighted?: string; closer?: string } = {}): GestureEnv<El> {
  return {
    visible: (s) => (opts.visible?.[s] ? { id: opts.visible[s] } : null),
    any: (s) => (opts.visible?.[s] ? { id: opts.visible[s] } : opts.hidden?.[s] ? { id: opts.hidden[s] } : null),
    highlighted: () => (opts.highlighted ? { id: opts.highlighted } : null),
    closer: () => (opts.closer ? { id: opts.closer } : null),
  };
}
const bind = (key: GestureKey, table: readonly GestureBinding[] = LAPTOP_GESTURES) => table.find((b) => b.key === key)!;

describe('the fixed gesture table (design 26 Nov)', () => {
  it('matches the design table, one gesture per action', () => {
    const map = Object.fromEntries(LAPTOP_GESTURES.map((b) => [b.key, b.label]));
    expect(map).toEqual({
      'R:thumbsUp': 'Approve', 'R:thumbsDown': 'Reject',
      'R:one': 'Next step 1', 'R:peace': 'Next step 2', 'R:three': 'Next step 3',
      'L:thumbsUp': 'Save', 'L:thumbsDown': 'Undo', 'L:one': 'New board', 'L:peace': 'Tools', 'L:three': 'Talk',
      '2:thumbsUp': 'More', '2:lUpRDown': 'Hover to click', '2:rUpLDown': 'Read aloud', '2:thumbsDown': 'Simulate offline', '2:one': 'Point at a device',
      '2:peace': 'Register', '2:three': 'Edit',
    });
  });

  it('no duplicate gestures in either table', () => {
    expect(duplicateKeys(LAPTOP_GESTURES)).toEqual([]);
    expect(duplicateKeys(PHONE_GESTURES)).toEqual([]);
    expect(duplicateKeys([...LAPTOP_GESTURES, LAPTOP_GESTURES[0]])).toEqual(['R:thumbsUp']);
  });

  it('never binds open palm or fist (they drive the highlight / grab)', () => {
    for (const b of [...LAPTOP_GESTURES, ...PHONE_GESTURES]) expect(b.key).not.toMatch(/open|fist/);
  });

  it('phones: R TU Approve, R TD Decline, L TD Undo, L TU Save', () => {
    expect(Object.fromEntries(PHONE_GESTURES.map((b) => [b.key, b.label]))).toEqual({
      'R:thumbsUp': 'Approve', 'R:thumbsDown': 'Reject', 'L:thumbsDown': 'Undo', 'L:thumbsUp': 'Save', '2:rUpLDown': 'Read aloud',
    });
  });
});

describe('resolveGesture', () => {
  it('R thumbs up = Approve while the review is open', () => {
    const a = resolveGesture(bind('R:thumbsUp'), env({ visible: { '.mc-review-approve': 'approve' }, highlighted: 'save' }));
    expect(a).toEqual({ kind: 'click', el: { id: 'approve' }, label: 'Approve' });
  });

  it('R thumbs up presses the palm-highlighted button when nothing is under review', () => {
    expect(resolveGesture(bind('R:thumbsUp'), env({ highlighted: 'save' }))).toEqual({ kind: 'click', el: { id: 'save' }, label: 'Press' });
    expect(resolveGesture(bind('R:thumbsUp'), env()).kind).toBe('none');
  });

  it('a hidden review button never counts as "open"', () => {
    const a = resolveGesture(bind('R:thumbsUp'), env({ hidden: { '.mc-review-approve': 'approve' }, highlighted: 'tools' }));
    expect(a).toMatchObject({ kind: 'click', el: { id: 'tools' } });
  });

  it('R thumbs down = Reject in a review, else closes what is open', () => {
    expect(resolveGesture(bind('R:thumbsDown'), env({ visible: { '.mc-review-reject': 'reject' }, closer: 'x' }))).toMatchObject({ el: { id: 'reject' }, label: 'Reject' });
    expect(resolveGesture(bind('R:thumbsDown'), env({ closer: 'tools-chip' }))).toMatchObject({ el: { id: 'tools-chip' }, label: 'Close' });
    expect(resolveGesture(bind('R:thumbsDown'), env())).toMatchObject({ kind: 'none', why: 'Nothing open to close.' });
  });

  it('a fixed button is pressed even when it sits in the closed Tools palette', () => {
    expect(resolveGesture(bind('L:thumbsUp'), env({ hidden: { '[data-cmd=save]': 'save' } }))).toEqual({ kind: 'click', el: { id: 'save' }, label: 'Save' });
  });

  it('chips 1–3 by finger count; missing chip says so', () => {
    const chips = {
      '.mc-next > button.mc-next-chip:nth-of-type(1)': 'c1',
      '.mc-next > button.mc-next-chip:nth-of-type(2)': 'c2',
    };
    expect(resolveGesture(bind('R:one'), env({ visible: chips }))).toMatchObject({ el: { id: 'c1' } });
    expect(resolveGesture(bind('R:peace'), env({ visible: chips }))).toMatchObject({ el: { id: 'c2' } });
    expect(resolveGesture(bind('R:three'), env({ visible: chips }))).toMatchObject({ kind: 'none' });
  });

  it('point at a device (no button) goes through run()', () => {
    expect(resolveGesture(bind('2:one'), env())).toEqual({ kind: 'say', text: "connect what I'm pointing at", label: 'Point at a device' });
  });

  it('register prefers the visible cluster chip', () => {
    expect(resolveGesture(bind('2:peace'), env({ visible: { '.mc-register-chip': 'chip' }, hidden: { '[data-cmd=reregister]': 'bar' } }))).toMatchObject({ el: { id: 'chip' } });
  });
});

describe('gestureName', () => {
  it('reads plainly', () => {
    expect(gestureName('R:thumbsUp')).toBe('Right thumbs up');
    expect(gestureName('L:three')).toBe('Left 3 fingers');
    expect(gestureName('2:peace')).toBe('Both hands peace');
  });
});
