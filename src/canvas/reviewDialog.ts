import { SCREEN_MARGIN_PX } from './handEdge';
import { mountDraggablePanel } from './dragPanel';

// Compact floating review window: whenever a Proposal needs a human
// decision it opens here (~360px, top-right inside the 24px safe zone) so
// the board stays visible behind it. Fist-grab or mouse-drag the title bar
// to move it. Esc / ✕ close WITHOUT deciding — the proposal stays waiting
// so voice/pinch keep·drop still work. Approve/Reject proxy-click the same
// .mc-proposal-keep/.mc-proposal-drop buttons already on the card.

export type ReviewAction = 'approve' | 'reject' | 'ask-else';

/** Pure mapping used by tests and by the dialog itself: what each button does
 *  to the underlying proposal. 'ask-else' never keeps or drops. */
export function reviewActionFor(action: ReviewAction): 'keep' | 'drop' | null {
  if (action === 'approve') return 'keep';
  if (action === 'reject') return 'drop';
  return null;
}

/** Width of the floating review window (px). */
export const REVIEW_WINDOW_WIDTH = 360;

/** Starting top-right origin, inside the screen margin and clear of the
 *  tools bar and the always-open AI drawer. */
export function reviewWindowStart(
  vp: { width: number; height: number },
  opts: { barH?: number; aiW?: number; aiRight?: number } = {},
): { top: number; right: number } {
  const margin = SCREEN_MARGIN_PX;
  const barH = opts.barH ?? 0;
  const aiW = opts.aiW ?? 0;
  const aiRight = opts.aiRight ?? 16;
  const top = Math.max(margin, barH + margin);
  const width = Math.min(REVIEW_WINDOW_WIDTH, Math.max(160, vp.width - margin * 2));
  const right = Math.min(
    margin + (aiW > 0 ? aiW + aiRight : 0),
    Math.max(margin, vp.width - width - margin),
  );
  return { top, right };
}

export interface ReviewDialogModel {
  title: string;
  /** The rendered Proposal card (keep/drop buttons already wired). */
  card: HTMLElement;
  /** Extra context: what each model did, prompts sent, stayed-local strip. */
  extra?: HTMLElement | null;
}

export interface ReviewDialog {
  open(model: ReviewDialogModel): void;
  close(): void;
  isOpen(): boolean;
  currentCard(): HTMLElement | null;
  destroy(): void;
}

function btn(doc: Document, cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = `mc-btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

export function mountReviewDialog(
  root: HTMLElement,
  handlers: { onAskElse?: () => void } = {},
  doc: Document = document,
): ReviewDialog {
  const dialog = doc.createElement('div');
  dialog.className = 'mc-review-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'false');
  dialog.setAttribute('aria-labelledby', 'mc-review-title');
  dialog.hidden = true;

  const head = doc.createElement('div');
  head.className = 'mc-review-head';
  const drag = doc.createElement('div');
  drag.className = 'mc-review-drag';
  drag.setAttribute('data-mc-drag-handle', '');
  drag.setAttribute('role', 'button');
  drag.setAttribute('tabindex', '0');
  drag.setAttribute('aria-label', 'Move review window');
  const body = doc.createElement('div');
  body.className = 'mc-review-body';
  const titleEl = doc.createElement('h2');
  titleEl.className = 'mc-review-title';
  titleEl.id = 'mc-review-title';
  const extraEl = doc.createElement('div');
  extraEl.className = 'mc-review-extra';
  const cardHost = doc.createElement('div');
  cardHost.className = 'mc-review-card-host';
  const actions = doc.createElement('div');
  actions.className = 'mc-review-actions';

  let open = false;
  let card: HTMLElement | null = null;
  let lastFocused: HTMLElement | null = null;

  function clickCard(cls: string): void {
    card?.querySelector<HTMLButtonElement>(cls)?.click();
  }
  function run(action: ReviewAction): void {
    const mapped = reviewActionFor(action);
    if (mapped === 'keep') clickCard('.mc-proposal-keep');
    else if (mapped === 'drop') clickCard('.mc-proposal-drop');
    else handlers.onAskElse?.();
    close();
  }
  const approveBtn = btn(doc, 'mc-review-approve', 'Approve', () => run('approve'));
  const rejectBtn = btn(doc, 'mc-review-reject', 'Reject', () => run('reject'));
  const askElseBtn = btn(doc, 'mc-review-ask-else', 'Ask for something else', () => run('ask-else'));
  actions.append(approveBtn, rejectBtn, askElseBtn);
  // A visible, pinch-sized ✕ that maps to Escape semantics (A5-005): closes
  // WITHOUT deciding, so the proposal stays waiting and voice/pinch keep·drop
  // still resume it. It sits in the dialog's top-right corner — a direct child
  // of the dialog, never inside .mc-review-actions — so it can never cover
  // Approve/Reject/Ask-else (which are sticky at the bottom).
  const closeBtn = btn(doc, 'mc-review-close', '✕', () => close());
  closeBtn.setAttribute('aria-label', 'Close without deciding');
  closeBtn.setAttribute('title', 'Close — decide later with voice or a pinch');
  drag.append(titleEl);
  head.append(drag, closeBtn);
  body.append(extraEl, cardHost, actions);
  dialog.append(head, body);
  root.append(dialog);

  const canDrag = typeof (dialog as HTMLElement).getBoundingClientRect === 'function';
  const dragCtl = canDrag
    ? mountDraggablePanel(dialog, drag, { id: 'review', alreadyFixed: true }, () => {
        const spacer = doc.createElement('div');
        spacer.hidden = true;
        return spacer;
      })
    : null;

  function onKeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const items = [approveBtn, rejectBtn, askElseBtn].filter((el) => !el.hidden);
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  dialog.addEventListener('keydown', onKeydown);

  function close(): void {
    if (!open) return;
    dialog.hidden = true;
    open = false;
    card = null;
    cardHost.innerHTML = '';
    lastFocused?.focus?.();
  }

  return {
    open(model) {
      card = model.card;
      titleEl.textContent = model.title;
      extraEl.innerHTML = '';
      if (model.extra) extraEl.append(model.extra);
      cardHost.innerHTML = '';
      cardHost.append(model.card);
      dragCtl?.resetPosition();
      dialog.hidden = false;
      open = true;
      lastFocused = (doc.activeElement as HTMLElement) ?? null;
      approveBtn.focus();
    },
    close,
    isOpen() { return open; },
    currentCard() { return card; },
    destroy() {
      dragCtl?.destroy();
      dialog.removeEventListener('keydown', onKeydown);
      dialog.remove();
    },
  };
}
