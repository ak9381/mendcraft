// "Pin on this device" button wiring — a NORMAL button that pinch-clicks
// (handPointer turns a pinch-tap into a real `click`, so the same listener
// serves hand, mouse and touch). Flips aria-pressed + label and notifies the
// caller, which persists the pin (phonePin) against localStorage. Kept as a tiny
// element-agnostic helper so the hand-press path is unit-testable without a DOM.

/** The minimal element surface the pin button needs — a real HTMLButtonElement
 *  satisfies it, and tests pass a hand-rolled fake. */
export interface PinButtonEl {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  classList: { toggle(c: string, on?: boolean): void };
  textContent: string | null;
  addEventListener(type: string, fn: (e: unknown) => void): void;
}

export interface PinButtonOptions {
  pinnedLabel?: string;
  unpinnedLabel?: string;
  /** Called with the NEW pinned state on each press. */
  onToggle?: (pinned: boolean) => void;
}

/** Wire a pin button: a `click` (incl. a hand pinch-tap via handPointer) flips
 *  aria-pressed, the label and the `is-pinned` class, then calls onToggle. */
export function wirePinButton(btn: PinButtonEl, opts: PinButtonOptions = {}): void {
  const pinnedLabel = opts.pinnedLabel ?? 'Pinned on this device';
  const unpinnedLabel = opts.unpinnedLabel ?? 'Pin on this device';
  btn.addEventListener('click', () => {
    const next = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', String(next));
    btn.classList.toggle('is-pinned', next);
    btn.textContent = next ? pinnedLabel : unpinnedLabel;
    opts.onToggle?.(next);
  });
}
