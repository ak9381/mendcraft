// The one Proposal card every AI feature uses.

import type { CatalogResult } from './routeCatalog';
import { formatWhatWasSent } from './routeCatalog';
import { GUESS, WAITING_FOR_YOU } from './wording';

export type ProposalStatus =
  | 'quick-working'
  | 'deep-working'
  | 'waiting'
  | 'guess'
  | 'changed'
  | 'kept'
  | 'dropped'
  | 'leave'
  | 'leave-sent';

export interface ProposalModel {
  id: string;
  title: string;
  youAsked?: string;
  why?: string;
  catalog: CatalogResult;
  status: ProposalStatus;
  /** Deep working: "about 15 s · keep working" already in catalog / label. */
  waitLabel?: string;
  leaveAction?: string;
  undoLabel?: string;
}

export function statusLabel(status: ProposalStatus): string {
  if (status === 'guess') return GUESS;
  if (status === 'waiting' || status === 'leave') return WAITING_FOR_YOU;
  if (status === 'quick-working') return 'Quick · on this device';
  if (status === 'deep-working') return 'Deep · online';
  if (status === 'changed') return 'Deep changed Quick’s guess';
  if (status === 'kept') return 'Kept';
  if (status === 'dropped') return 'Dropped';
  if (status === 'leave-sent') return 'Sent';
  return WAITING_FOR_YOU;
}

export function renderProposalCard(
  doc: Document,
  model: ProposalModel,
  handlers: {
    onKeep?: () => void;
    onDrop?: () => void;
    onHoldStart?: () => void;
    onHoldEnd?: () => void;
    onUndo?: () => void;
  } = {},
): HTMLElement {
  const card = doc.createElement('article');
  card.className = `mc-proposal is-${model.status}`;
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `Proposal: ${model.title}`);
  card.dataset.proposalId = model.id;

  const head = doc.createElement('header');
  head.className = 'mc-proposal-head';
  const title = doc.createElement('h2');
  title.className = 'mc-proposal-title';
  title.textContent = model.title;
  const badge = doc.createElement('span');
  badge.className = 'mc-proposal-badge';
  badge.textContent = statusLabel(model.status);
  head.append(title, badge);
  card.append(head);

  if (model.youAsked) {
    const p = doc.createElement('p');
    p.className = 'mc-proposal-asked';
    p.textContent = `You asked: “${model.youAsked}”`;
    card.append(p);
  }
  if (model.why) {
    const p = doc.createElement('p');
    p.className = 'mc-proposal-why';
    p.textContent = `Why: ${model.why}`;
    card.append(p);
  }

  const by = doc.createElement('p');
  by.className = 'mc-proposal-by';
  by.textContent = `By: ${model.catalog.byLine}`;
  card.append(by);

  const route = doc.createElement('p');
  route.className = 'mc-proposal-route';
  route.textContent = `${model.catalog.whyLabel}: ${model.catalog.routeLine}`;
  card.append(route);

  const sent = formatWhatWasSent(model.catalog);
  if (sent) {
    const details = doc.createElement('details');
    details.className = 'mc-proposal-sent';
    const sum = doc.createElement('summary');
    sum.textContent = 'What was sent';
    const p = doc.createElement('p');
    p.textContent = sent;
    details.append(sum, p);
    card.append(details);
  }

  if (model.waitLabel) {
    const p = doc.createElement('p');
    p.className = 'mc-proposal-wait';
    p.textContent = model.waitLabel;
    card.append(p);
  }

  const actions = doc.createElement('div');
  actions.className = 'mc-proposal-actions';

  if (model.status === 'waiting' || model.status === 'guess' || model.status === 'changed') {
    const keep = btn(doc, 'mc-proposal-keep', 'FIST TAP  keep', `Keep: ${model.title}`, handlers.onKeep);
    const drop = btn(doc, 'mc-proposal-drop', 'BRUSH  drop', `Drop: ${model.title}`, handlers.onDrop);
    actions.append(keep, drop);
  } else if (model.status === 'leave') {
    const hold = btn(doc, 'mc-proposal-hold', model.leaveAction || 'HOLD A FIST  send', `Hold to send: ${model.title}`, handlers.onKeep);
    hold.addEventListener('pointerdown', () => handlers.onHoldStart?.());
    hold.addEventListener('pointerup', () => handlers.onHoldEnd?.());
    hold.addEventListener('pointerleave', () => handlers.onHoldEnd?.());
    const drop = btn(doc, 'mc-proposal-drop', 'BRUSH  drop', `Drop: ${model.title}`, handlers.onDrop);
    actions.append(hold, drop);
  } else if (model.status === 'leave-sent' && model.undoLabel && handlers.onUndo) {
    actions.append(btn(doc, 'mc-proposal-undo', model.undoLabel, model.undoLabel, handlers.onUndo));
  }

  if (actions.childElementCount) card.append(actions);
  return card;
}

function btn(doc: Document, cls: string, label: string, aria: string, onClick?: () => void): HTMLButtonElement {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.setAttribute('aria-label', aria);
  if (onClick) b.addEventListener('click', onClick);
  return b;
}
