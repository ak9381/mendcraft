// Hand-only text entry for the canvas. A hand user can pinch a text field to
// focus it but has no keys, so when the hand pointer focuses a field it fires
// HAND_TEXT_FOCUS and this docks the on-screen keyboard (shared with the old
// studio: src/ui/onscreenKeyboard.ts). Mouse or keyboard focus never opens it.
// Each key is a plain <button>, so the same pinch that clicks any control types;
// keys keep focus on the field (mousedown preventDefault) and insert at the
// caret with real 'input' events. Closes on Close, Escape, form submit, or a
// click/focus outside the field and the keys.

import { createOnScreenKeyboard, type OnScreenKeyboard } from '../ui/onscreenKeyboard';

export const HAND_TEXT_FOCUS = 'mc-hand-text-focus';

type EditableField = HTMLInputElement | HTMLTextAreaElement;

export interface HandKeyboard {
  readonly keyboard: OnScreenKeyboard;
  field(): EditableField | null;
  dispose(): void;
}

function isField(el: unknown): el is EditableField {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return ['text', 'search', 'url', 'email', 'tel', 'number', 'password', ''].includes((el.type || 'text').toLowerCase());
}

export function mountHandKeyboard(doc: Document = document): HandKeyboard {
  const kb = createOnScreenKeyboard();
  const root = kb.element;
  root.classList.add('mc-hand-kb');
  // Usable by the hand even while a modal (e.g. the connect sheet) scopes the
  // pointer's controls to that dialog — see collectControls.
  root.dataset.handAlways = '';
  doc.body.appendChild(root);
  let field: EditableField | null = null;
  let form: HTMLFormElement | null = null;

  const inside = (n: EventTarget | null) => n instanceof Node && (root.contains(n) || n === field);

  function close(): void {
    form?.removeEventListener('submit', close);
    form = null;
    field = null;
    kb.close();
    root.classList.remove('mc-hand-kb-top');
  }

  /** Dock at the bottom unless that would cover the field; then dock at the top. */
  function place(): void {
    if (!field) return;
    const r = field.getBoundingClientRect();
    const h = root.getBoundingClientRect().height || 0;
    const vh = doc.defaultView?.innerHeight ?? 0;
    root.classList.toggle('mc-hand-kb-top', h > 0 && r.bottom > vh - h - 16);
  }

  function onHandFocus(e: Event): void {
    const t = (e.composedPath?.()[0] ?? e.target) as unknown;
    if (!isField(t)) return;
    if (field !== t) close();
    field = t;
    form = t.form;
    form?.addEventListener('submit', close);
    kb.open(t);
    place();
  }

  function onKey(e: KeyboardEvent): void {
    if (!kb.isOpen() || e.key !== 'Escape') return;
    close();
    // Escape closes only the topmost thing — the keys — not also the tool
    // palette, a dialog behind, or the canvas zoom-out.
    e.preventDefault();
    e.stopPropagation();
  }

  function onOutside(e: Event): void {
    if (!kb.isOpen()) return;
    const t = e.composedPath?.()[0] ?? e.target;
    if (!inside(t)) close();
  }

  function onFieldBlur(e: FocusEvent): void {
    if (!kb.isOpen() || e.target !== field) return;
    if (!inside(e.relatedTarget)) close();
  }

  function onKeysClick(e: Event): void {
    // The Close key closes the inner keyboard; drop our field binding with it.
    if ((e.target as HTMLElement | null)?.closest?.('[data-key=Close]')) close();
  }

  doc.addEventListener(HAND_TEXT_FOCUS, onHandFocus);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('click', onOutside, true);
  doc.addEventListener('focusin', onOutside, true);
  doc.addEventListener('focusout', onFieldBlur, true);
  root.addEventListener('click', onKeysClick);

  return {
    keyboard: kb,
    field: () => field,
    dispose() {
      close();
      doc.removeEventListener(HAND_TEXT_FOCUS, onHandFocus);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('click', onOutside, true);
      doc.removeEventListener('focusin', onOutside, true);
      doc.removeEventListener('focusout', onFieldBlur, true);
      kb.dispose();
    },
  };
}
