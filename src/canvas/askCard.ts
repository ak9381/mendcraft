// A yes/no question on screen (the gimbal ask): Yes / No buttons that answer
// by tap, palm, right thumbs up / down, or by saying it. Modal: a backdrop
// covers the canvas so nothing else is pressed while it waits, and the
// buttons carry the review classes, so the gesture layer already treats it
// like a review (only Approve / Reject act). Fixed code, no model.

export interface AskCard {
  show(question: string, labels?: { yes?: string; no?: string }): void;
  hide(): void;
  isOpen(): boolean;
}

export function mountAskCard(root: HTMLElement, on: { yes(): void; no(): void }, doc: Document = document): AskCard {
  const back = doc.createElement('div');
  back.className = 'mc-ask-backdrop';
  back.hidden = true;
  const card = doc.createElement('div');
  card.className = 'mc-ask-card';
  card.setAttribute('role', 'alertdialog');
  card.setAttribute('aria-modal', 'true');
  const q = doc.createElement('h2');
  q.className = 'mc-ask-question';
  q.id = 'mc-ask-question';
  card.setAttribute('aria-labelledby', q.id);
  const row = doc.createElement('div');
  row.className = 'mc-ask-actions';
  const no = doc.createElement('button');
  no.type = 'button';
  no.className = 'mc-btn mc-review-reject mc-ask-no';
  const yes = doc.createElement('button');
  yes.type = 'button';
  yes.className = 'mc-btn primary mc-review-approve mc-ask-yes';
  row.append(no, yes);
  const hint = doc.createElement('p');
  hint.className = 'mc-ask-hint';
  hint.textContent = 'Right thumbs up for yes, thumbs down for no. Or just say it.';
  card.append(q, row, hint);
  back.append(card);
  root.append(back);
  // The backdrop swallows presses so the board behind waits.
  back.addEventListener('pointerdown', (e) => { if (e.target === back) e.preventDefault(); });
  yes.addEventListener('click', () => on.yes());
  no.addEventListener('click', () => on.no());
  return {
    show(question, labels = {}) {
      q.textContent = question;
      yes.textContent = labels.yes ?? 'Yes';
      no.textContent = labels.no ?? 'No';
      back.hidden = false;
      try { yes.focus({ preventScroll: true }); } catch { /* jsdom */ }
    },
    hide() { back.hidden = true; },
    isOpen: () => !back.hidden,
  };
}
