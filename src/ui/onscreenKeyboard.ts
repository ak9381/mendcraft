// On-screen keyboard for pinch / hover typing. A big-key QWERTY + number row
// with Backspace, Enter, Shift, Space and Close. Opens automatically when a text
// field is focused (in hands mode) or via a toggle button. Keys fire on mouse
// click, on a pinch tap routed in from the hand pointer, or on hover-dwell.
// Pure key math lives in input/keyboardLogic.ts; this module only touches the
// DOM and the focused field, inserting at the caret and firing real input events
// so every existing handler runs unchanged.

import { KEY_ROWS, pressKey, type FieldState, type SpecialKey } from '../input/keyboardLogic';

type EditableField = HTMLInputElement | HTMLTextAreaElement;

export interface OnScreenKeyboard {
  readonly element: HTMLElement;
  open(field?: EditableField): void;
  close(): void;
  isOpen(): boolean;
  /** Should focusing a text field auto-open the keyboard? (hands mode). */
  setAutoOpen(on: boolean): void;
  /** Hand cursor hovering a client point — starts a dwell. True if over the keys. */
  hoverAt(clientX: number, clientY: number): boolean;
  /** Pinch tap at a client point — presses immediately. True if consumed. */
  pressAt(clientX: number, clientY: number): boolean;
  dispose(): void;
}

const DWELL_MS = 600;

function isEditable(el: EventTarget | null): el is EditableField {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const t = (el.type || 'text').toLowerCase();
    return ['text', 'search', 'url', 'email', 'tel', 'number', 'password', ''].includes(t);
  }
  return false;
}

export function createOnScreenKeyboard(): OnScreenKeyboard {
  const root = document.createElement('div');
  root.className = 'mc-keyboard';
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'On-screen keyboard');

  let field: EditableField | null = null;
  let shift = false;
  let autoOpen = false;
  let dwellKey: HTMLButtonElement | null = null;
  let dwellTimer: number | null = null;
  const letterKeys: HTMLButtonElement[] = [];

  // ─── build keys ───────────────────────────────────────────────────────────
  function row(): HTMLDivElement {
    const r = document.createElement('div');
    r.className = 'mc-key-row';
    root.appendChild(r);
    return r;
  }

  for (const keys of KEY_ROWS) {
    const r = row();
    for (const k of keys) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mc-key';
      b.textContent = k;
      b.dataset.key = k;
      b.setAttribute('aria-label', k);
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => press(k));
      r.appendChild(b);
      if (/[a-z]/.test(k)) letterKeys.push(b);
    }
  }

  // Bottom control row.
  const ctl = row();
  const mkCtl = (label: string, data: SpecialKey, cls: string, grow: number) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `mc-key mc-key-ctl ${cls}`;
    b.textContent = label;
    b.dataset.key = data;
    b.style.flexGrow = String(grow);
    b.setAttribute('aria-label', data);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', () => press(data));
    ctl.appendChild(b);
    return b;
  };
  const shiftBtn = mkCtl('⇧ Shift', 'Shift', 'mc-key-shift', 2);
  mkCtl('␣ Space', 'Space', 'mc-key-space', 5);
  mkCtl('⌫', 'Backspace', 'mc-key-back', 2);
  mkCtl('⏎ Enter', 'Enter', 'mc-key-enter', 2);
  mkCtl('✕ Close', 'Close', 'mc-key-close', 1);

  function refreshShift(): void {
    shiftBtn.classList.toggle('active', shift);
    shiftBtn.setAttribute('aria-pressed', String(shift));
    for (const b of letterKeys) b.textContent = shift ? b.dataset.key!.toUpperCase() : b.dataset.key!;
  }

  // ─── apply a key to the focused field ───────────────────────────────────────
  function press(key: string): void {
    if (!field) return;
    const state: FieldState = {
      value: field.value,
      start: field.selectionStart ?? field.value.length,
      end: field.selectionEnd ?? field.value.length,
    };
    const r = pressKey(state, key, shift);
    shift = r.shift;
    refreshShift();

    if (r.close) { close(); return; }

    if (r.submit) {
      field.focus();
      if (field.form) {
        field.form.requestSubmit();
      } else {
        field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
      return;
    }

    // Insert at the caret and fire a real input event so existing handlers run.
    field.value = r.value;
    try { field.setSelectionRange(r.start, r.start); } catch { /* number inputs reject this */ }
    field.dispatchEvent(new InputEvent('input', { bubbles: true, data: key }));
    field.focus();
  }

  // ─── hover-dwell + pinch hit-testing ────────────────────────────────────────
  function keyAt(clientX: number, clientY: number): HTMLButtonElement | null {
    const el = document.elementFromPoint(clientX, clientY);
    const key = el?.closest('.mc-key');
    return key instanceof HTMLButtonElement && root.contains(key) ? key : null;
  }

  function overKeyboard(clientX: number, clientY: number): boolean {
    if (root.hidden) return false;
    const r = root.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  function clearDwell(): void {
    if (dwellTimer !== null) { clearTimeout(dwellTimer); dwellTimer = null; }
    dwellKey?.classList.remove('dwelling');
    dwellKey = null;
  }

  function startDwell(btn: HTMLButtonElement): void {
    if (btn === dwellKey) return;
    clearDwell();
    dwellKey = btn;
    btn.classList.add('dwelling');
    dwellTimer = window.setTimeout(() => {
      btn.classList.remove('dwelling');
      dwellKey = null;
      dwellTimer = null;
      btn.click();
    }, DWELL_MS);
  }

  function hoverAt(clientX: number, clientY: number): boolean {
    if (root.hidden) return false;
    const btn = keyAt(clientX, clientY);
    if (btn) startDwell(btn);
    else clearDwell();
    return overKeyboard(clientX, clientY);
  }

  function pressAt(clientX: number, clientY: number): boolean {
    if (root.hidden) return false;
    clearDwell();
    const btn = keyAt(clientX, clientY);
    if (btn) { btn.click(); return true; }
    return overKeyboard(clientX, clientY);
  }

  // Mouse hover-dwell as well, so a mouse user can dwell like a hand.
  root.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse') return; // mouse users click; dwell is for touch/pen
    const btn = (e.target as HTMLElement).closest('.mc-key');
    if (btn instanceof HTMLButtonElement) startDwell(btn);
  });
  root.addEventListener('pointerleave', clearDwell);

  // ─── auto-open on text-field focus ──────────────────────────────────────────
  function onFocusIn(e: FocusEvent): void {
    if (!autoOpen) return;
    if (root.contains(e.target as Node)) return; // don't recurse on our own buttons
    if (isEditable(e.target)) open(e.target);
  }
  document.addEventListener('focusin', onFocusIn);

  function open(target?: EditableField): void {
    const candidate = target ?? (isEditable(document.activeElement) ? (document.activeElement as EditableField) : null);
    if (candidate) field = candidate;
    if (!field) return;
    root.hidden = false;
    refreshShift();
  }

  function close(): void {
    clearDwell();
    root.hidden = true;
  }

  return {
    element: root,
    open,
    close,
    isOpen: () => !root.hidden,
    setAutoOpen(on) { autoOpen = on; },
    hoverAt,
    pressAt,
    dispose() {
      clearDwell();
      document.removeEventListener('focusin', onFocusIn);
      root.remove();
    },
  };
}
