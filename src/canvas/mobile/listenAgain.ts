// "Listen again" button wiring — a NORMAL button that pinch-clicks
// (handPointer turns a pinch-tap into a real `click`). Kept as a tiny
// element-agnostic helper so the hand-press path is unit-testable without a DOM.

export interface ListenAgainEl {
  addEventListener(type: string, fn: (e: unknown) => void): void;
}

export interface ListenAgainOptions {
  /** Called on each press (hand pinch, mouse, or touch). */
  onListen: () => void;
}

/** Wire Listen again: a `click` (incl. a hand pinch-tap) asks the phone to
 *  listen for the laptop chime again. */
export function wireListenAgainButton(btn: ListenAgainEl, opts: ListenAgainOptions): void {
  btn.addEventListener('click', () => {
    opts.onListen();
  });
}
