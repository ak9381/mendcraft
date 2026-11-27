// MORPH CARD: the small anchored card that appears when a pinch-hold (or
// long-press) arms a morph on a tile. It names the tile, opens the mic, and
// walks through listening -> working -> done/empty/error, each with its own
// auto-dismiss timer. This module owns ONLY the card's DOM and timers — the
// hold classifier (morphHold.ts), target resolution (morphTarget.ts) and the
// Gemini edit pipeline (morphEdit.ts) are separate; the orchestration that
// wires them together (morphFlow.ts) drives this module through the
// interface below. Do not change the interface — morphFlow.ts depends on it.

import { esc } from '../core/esc';

export interface MorphCardOpts {
  /** Cancel chip pressed (or Close in the done state). */
  onCancel(): void;
  /** Undo chip pressed (done state). */
  onUndo(): void;
  /** The card closed ITSELF (done/empty/error auto-dismiss timer). Never
   *  called for close()/onCancel/onUndo paths. */
  onAutoClose?(): void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export interface MorphCardUi {
  readonly el: HTMLElement;
  /** Show the card anchored to the tile rect (viewport px). */
  open(o: { label: string; rect: { left: number; top: number; width: number; height: number }; listening: boolean }): void;
  setListening(on: boolean): void;
  /** "Changing…" state while the model works (hides Cancel-as-abort semantics: keep the Cancel chip visible but it just dismisses the card). */
  showWorking(line: string): void;
  /** "Changed." + Undo chip; auto-closes after 6000 ms (then onAutoClose). */
  showDone(): void;
  /** "Didn't hear anything — hold the board again, or press Talk." auto-closes after 5000 ms. */
  showEmpty(): void;
  /** Error line, e.g. "Couldn't make that change." auto-closes after 5000 ms. */
  showError(line: string): void;
  close(): void;
  isOpen(): boolean;
  destroy(): void;
}

const DONE_MS = 6000;
const AUTO_MS = 5000;

const LISTENING_ON_HTML =
  '<span class="mc-morph-dot is-sage" aria-hidden="true"></span>Listening… say it, or Cancel.';
const LISTENING_OFF_HTML =
  '<span class="mc-morph-dot is-sage" aria-hidden="true"></span>Type it in the say box, or Cancel.';
const EMPTY_LINE = "Didn't hear anything — hold the board again, or press Talk.";

function viewportWidth(): number {
  return typeof innerWidth === 'number' ? innerWidth : 1280;
}
function viewportHeight(): number {
  return typeof innerHeight === 'number' ? innerHeight : 800;
}

export function mountMorphCard(root: HTMLElement, opts: MorphCardOpts): MorphCardUi {
  const doc = root.ownerDocument;
  const setT = opts.setTimer ?? setTimeout;
  const clearT = opts.clearTimer ?? clearTimeout;

  const el = doc.createElement('div');
  el.className = 'mc-morph-card';
  el.hidden = true;
  el.innerHTML =
    '<p class="mc-morph-card-title"></p>' +
    '<p class="mc-morph-card-line" aria-live="polite"></p>' +
    '<div class="mc-morph-chips">' +
    '<button type="button" class="mc-btn mc-morph-undo" hidden>Undo</button>' +
    '<button type="button" class="mc-btn mc-morph-cancel">Cancel</button>' +
    '</div>';
  root.append(el);

  const titleEl = el.querySelector<HTMLElement>('.mc-morph-card-title')!;
  const lineEl = el.querySelector<HTMLElement>('.mc-morph-card-line')!;
  const cancelBtn = el.querySelector<HTMLButtonElement>('.mc-morph-cancel')!;
  const undoBtn = el.querySelector<HTMLButtonElement>('.mc-morph-undo')!;

  let open_ = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearPendingTimer(): void {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
  }

  function scheduleAutoClose(ms: number): void {
    clearPendingTimer();
    timer = setT(() => {
      timer = null;
      open_ = false;
      el.hidden = true;
      opts.onAutoClose?.();
    }, ms);
  }

  function setTitle(label: string): void {
    // Build with escaped text rather than raw interpolation: `label` is
    // user/model-controlled and this lands in innerHTML.
    titleEl.innerHTML = `<strong>${esc(label)}</strong> — what do you want to do?`;
  }

  function place(rect: { left: number; top: number; width: number; height: number }): void {
    const vw = viewportWidth();
    const vh = viewportHeight();
    const below = rect.top < 140;
    el.style.position = 'fixed';
    if (below) {
      el.style.top = `${rect.top + rect.height + 10}px`;
      el.style.bottom = '';
    } else {
      // Pin the card's BOTTOM edge to rect.top - 10 without needing to
      // measure the card's own height: `bottom` in `position: fixed` is
      // measured from the viewport's bottom edge, so this holds regardless
      // of the card's actual rendered height (and works with no layout at
      // all, as in these node tests).
      el.style.bottom = `${Math.max(0, vh - rect.top + 10)}px`;
      el.style.top = '';
    }
    const left = Math.min(Math.max(8, rect.left), Math.max(8, vw - 8 - 280));
    el.style.left = `${left}px`;
    el.style.right = '';
  }

  function resetChipsForOpen(): void {
    undoBtn.hidden = true;
    cancelBtn.textContent = 'Cancel';
  }

  const ui: MorphCardUi = {
    el,
    open(o) {
      clearPendingTimer();
      open_ = true;
      el.hidden = false;
      resetChipsForOpen();
      setTitle(o.label);
      lineEl.innerHTML = o.listening ? LISTENING_ON_HTML : LISTENING_OFF_HTML;
      lineEl.classList.remove('is-amber');
      place(o.rect);
    },
    setListening(on) {
      lineEl.innerHTML = on ? LISTENING_ON_HTML : LISTENING_OFF_HTML;
    },
    showWorking(line) {
      clearPendingTimer();
      lineEl.innerHTML = `<span class="mc-morph-dot is-amber" aria-hidden="true"></span>${esc(line)}`;
    },
    showDone() {
      lineEl.innerHTML = '';
      lineEl.textContent = 'Changed.';
      undoBtn.hidden = false;
      cancelBtn.textContent = 'Close';
      scheduleAutoClose(DONE_MS);
    },
    showEmpty() {
      lineEl.innerHTML = '';
      lineEl.textContent = EMPTY_LINE;
      undoBtn.hidden = true;
      cancelBtn.textContent = 'Close';
      scheduleAutoClose(AUTO_MS);
    },
    showError(line) {
      lineEl.innerHTML = '';
      lineEl.textContent = line;
      undoBtn.hidden = true;
      cancelBtn.textContent = 'Close';
      scheduleAutoClose(AUTO_MS);
    },
    close() {
      clearPendingTimer();
      open_ = false;
      el.hidden = true;
    },
    isOpen() {
      return open_;
    },
    destroy() {
      clearPendingTimer();
      el.remove();
    },
  };

  cancelBtn.addEventListener('click', () => {
    clearPendingTimer();
    open_ = false;
    el.hidden = true;
    opts.onCancel();
  });
  undoBtn.addEventListener('click', () => {
    clearPendingTimer();
    open_ = false;
    el.hidden = true;
    opts.onUndo();
  });

  return ui;
}
