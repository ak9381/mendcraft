// FIXED GESTURE TABLE (design 26 Nov, "as many fixed as possible"): which held
// hand shape presses which button. A binding never runs its own action — it
// names the real on-screen button (clicked exactly like a mouse click, so the
// app's existing handlers, review safety net and undo all apply) or, where no
// button exists (point at a device), a line for the app's own run() router.
//
// Context rules: R thumbs up = Approve while a review is open, else press the
// palm-highlighted button. R thumbs down = Reject while a review is open,
// else close the open dialog / menu / Tools.

import { MIXED_KEY, MIXED_KEY_MIRROR, keyShapes, keySide, type GestureKey } from './gestureHold';

export type GestureContext = 'approveOrPress' | 'declineOrClose';

export interface GestureBinding {
  key: GestureKey;
  /** What it does, for the light-up HUD and the activity line. */
  label: string;
  /** The bound button(s), in priority order: the badge sits on the first
   *  visible one, and the action clicks the first usable one. */
  targets: readonly string[];
  /** A contextual binding (see the header). */
  context?: GestureContext;
  /** No button: send this line through the app's run() router instead. */
  say?: string;
}

const chip = (n: number) => `.mc-next > button.mc-next-chip:nth-of-type(${n})`;

/** Laptop / tablet canvas. */
export const LAPTOP_GESTURES: readonly GestureBinding[] = [
  { key: 'R:thumbsUp', label: 'Approve', targets: ['.mc-review-approve', '.mc-proposal-keep'], context: 'approveOrPress' },
  { key: 'R:thumbsDown', label: 'Reject', targets: ['.mc-review-reject', '.mc-proposal-drop'], context: 'declineOrClose' },
  { key: 'R:one', label: 'Next step 1', targets: [chip(1)] },
  { key: 'R:peace', label: 'Next step 2', targets: [chip(2)] },
  { key: 'R:three', label: 'Next step 3', targets: [chip(3)] },
  { key: 'L:thumbsUp', label: 'Save', targets: ['[data-cmd=save]'] },
  { key: 'L:thumbsDown', label: 'Undo', targets: ['.mc-cluster-undo', '[data-cmd=undo]'] },
  { key: 'L:one', label: 'New board', targets: ['[data-cmd=new]'] },
  { key: 'L:peace', label: 'Tools', targets: ['.mc-tools-chip'] },
  { key: 'L:three', label: 'Talk', targets: ['.mc-fab-mic'] },
  // Both thumbs up opens More (AI monitor lives there, by voice and by palm).
  { key: '2:thumbsUp', label: 'More', targets: ['.mc-more-btn'] },
  // Mixed: left thumbs UP + right thumbs DOWN together = Hover to click.
  { key: MIXED_KEY, label: 'Hover to click', targets: ['[data-cmd=dwell]'] },
  // Its mirror: right thumbs UP + left thumbs DOWN = Read aloud on/off.
  { key: MIXED_KEY_MIRROR, label: 'Read aloud', targets: ['.mc-read-aloud'] },
  { key: '2:thumbsDown', label: 'Simulate offline', targets: ['[data-cmd=offline]'] },
  { key: '2:one', label: 'Point at a device', targets: [], say: "connect what I'm pointing at" },
  { key: '2:peace', label: 'Register', targets: ['.mc-register-chip', '.mc-blank-register', '[data-cmd=reregister]'] },
  { key: '2:three', label: 'Edit', targets: ['.mc-edit-toggle'] },
];

/** Phone shells (Android + the iPhone control layer), behind the Hands pill. */
export const PHONE_GESTURES: readonly GestureBinding[] = [
  { key: 'R:thumbsUp', label: 'Approve', targets: ['.mc-review-approve', '.mc-proposal-keep'], context: 'approveOrPress' },
  { key: 'R:thumbsDown', label: 'Reject', targets: ['.mc-review-reject', '.mc-proposal-drop'], context: 'declineOrClose' },
  { key: 'L:thumbsDown', label: 'Undo', targets: ['[data-cmd=undo]'] },
  { key: 'L:thumbsUp', label: 'Save', targets: ['[data-cmd=save]'] },
  { key: MIXED_KEY_MIRROR, label: 'Read aloud', targets: ['.mc-read-aloud'] },
];

/** No two bindings in one table share a gesture. */
export function duplicateKeys(table: readonly GestureBinding[]): GestureKey[] {
  const seen = new Set<GestureKey>();
  const dup: GestureKey[] = [];
  for (const b of table) { if (seen.has(b.key)) dup.push(b.key); seen.add(b.key); }
  return dup;
}

/** What the app gives the resolver (a DOM in the app; fakes in tests). */
export interface GestureEnv<E = HTMLElement> {
  /** First VISIBLE, enabled match for a selector (null when none). */
  visible(selector: string): E | null;
  /** First enabled match even if hidden (a tool inside the closed palette). */
  any(selector: string): E | null;
  /** The palm-highlighted button (open-palm highlight), if any. */
  highlighted(): E | null;
  /** The control that closes the top open dialog / menu / Tools (null: none open). */
  closer(): E | null;
}

export type GestureAction<E = HTMLElement> =
  | { kind: 'click'; el: E; label: string }
  | { kind: 'say'; text: string; label: string }
  | { kind: 'none'; label: string; why: string };

/** The button a held gesture would press right now — also what lights up. */
export function resolveGesture<E>(binding: GestureBinding, env: GestureEnv<E>): GestureAction<E> {
  const { label } = binding;
  if (binding.say) return { kind: 'say', text: binding.say, label };
  // Contextual bindings act on a VISIBLE review button only (a hidden review
  // is not "open").
  if (binding.context) {
    for (const s of binding.targets) {
      const el = env.visible(s);
      if (el) return { kind: 'click', el, label };
    }
    if (binding.context === 'approveOrPress') {
      const h = env.highlighted();
      return h ? { kind: 'click', el: h, label: 'Press' } : { kind: 'none', label: 'Press', why: 'Nothing is highlighted. Show an open palm to pick a button, then thumbs up.' };
    }
    const c = env.closer();
    return c ? { kind: 'click', el: c, label: 'Close' } : { kind: 'none', label: 'Close', why: 'Nothing open to close.' };
  }
  for (const s of binding.targets) {
    const el = env.visible(s) ?? env.any(s);
    if (el) return { kind: 'click', el, label };
  }
  return { kind: 'none', label, why: `${label} isn't on screen right now.` };
}

/** Selectors, in priority order, for "close what's open" (R thumbs down). */
export const CLOSER_SELECTORS: readonly string[] = [
  // Dialogs and sheets on top first …
  '.mc-scan-cancel',
  '.mc-teach-close',
  '.mc-connect-close',
  '.mc-menu-close',
  '[role=dialog] [data-act=close]',
  '[role=dialog]:not(.mc-review-dialog) [aria-label^="Close"]',
  // … then the Tools palette, then the AI drawer.
  '.mc-tools-chip[aria-expanded="true"]',
  '.mc-ai-close',
];

/** Short human name for a gesture key, e.g. "Right thumbs up", "Both peace". */
export function gestureName(key: GestureKey): string {
  if (key === MIXED_KEY) return 'Left thumbs up + right thumbs down';
  if (key === MIXED_KEY_MIRROR) return 'Right thumbs up + left thumbs down';
  const side = keySide(key);
  const shape = keyShapes(key)[0];
  const s = side === 'R' ? 'Right' : side === 'L' ? 'Left' : 'Both hands';
  const n: Record<string, string> = { thumbsUp: 'thumbs up', thumbsDown: 'thumbs down', one: '1 finger', peace: 'peace', three: '3 fingers' };
  return `${s} ${n[shape] ?? shape}`;
}
