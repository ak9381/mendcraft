// Full-screen review: whenever a Proposal needs a human decision (board
// plan, floor plan, Kannada pack, taught gesture) it opens here instead of a
// cramped inline card. Esc closes WITHOUT deciding — the proposal stays
// waiting so voice/pinch keep·drop still work. Approve/Reject proxy-click the
// same .mc-proposal-keep/.mc-proposal-drop buttons already on the card, so
// every existing path into keep()/drop() keeps working unchanged.

export type ReviewAction = 'approve' | 'reject' | 'ask-else';

/** Pure mapping used by tests and by the dialog itself: what each button does
 *  to the underlying proposal. 'ask-else' never keeps or drops. */
export function reviewActionFor(action: ReviewAction): 'keep' | 'drop' | null {
  if (action === 'approve') return 'keep';
  if (action === 'reject') return 'drop';
  return null;
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
  dialog.setAttribute('aria-modal', 'true');
  dialog.hidden = true;

  const body = doc.createElement('div');
  body.className = 'mc-review-body';
  const titleEl = doc.createElement('h2');
  titleEl.className = 'mc-review-title';
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
  body.append(titleEl, extraEl, cardHost, actions);
  dialog.append(body);
  root.append(dialog);

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
      dialog.hidden = false;
      open = true;
      lastFocused = (doc.activeElement as HTMLElement) ?? null;
      approveBtn.focus();
    },
    close,
    isOpen() { return open; },
    currentCard() { return card; },
    destroy() {
      dialog.removeEventListener('keydown', onKeydown);
      dialog.remove();
    },
  };
}
