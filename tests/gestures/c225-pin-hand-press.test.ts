// C225: "Pin on this device" responds to a HAND press, not only a mouse click().
// A pinch-tap arrives as a `click` on the button (handPointer's activate() →
// el.click()), so firing the real click listener the way the hand would proves
// the button's own wiring flips aria-pressed, the label and persists the pin.
import { describe, expect, it } from 'vitest';
import { wirePinButton, type PinButtonEl } from '../../src/canvas/mobile/pinButton';

function fakeButton(initial = false): PinButtonEl & { fire: (t: string) => void; pinned: boolean; label: string } {
  const handlers: Record<string, Array<(e: unknown) => void>> = {};
  const attrs: Record<string, string> = { 'aria-pressed': String(initial) };
  const classes = new Set<string>();
  return {
    pinned: initial,
    label: initial ? 'Pinned on this device' : 'Pin on this device',
    get textContent() { return this.label; },
    set textContent(v: string) { this.label = v; },
    getAttribute: (n) => attrs[n] ?? null,
    setAttribute: (n, v) => { attrs[n] = v; },
    classList: { toggle: (c: string, on?: boolean) => { const n = on ?? !classes.has(c); n ? classes.add(c) : classes.delete(c); } },
    addEventListener: (t, f) => { (handlers[t] ??= []).push(f); },
    fire: (t) => handlers[t]?.forEach((f) => f({})),
  };
}

describe('C225 Pin on this device — hand press', () => {
  it('a hand pinch (click) flips aria-pressed and the label, and notifies', () => {
    const btn = fakeButton(false);
    const pins: boolean[] = [];
    wirePinButton(btn, { onToggle: (p) => pins.push(p) });

    btn.fire('click'); // the pinch-tap, via handPointer → el.click()
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.label).toBe('Pinned on this device');
    expect(pins).toEqual([true]);

    btn.fire('click'); // pinch again → unpin
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.label).toBe('Pin on this device');
    expect(pins).toEqual([true, false]);
  });
});
