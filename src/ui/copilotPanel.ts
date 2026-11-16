// Copilot panel: three tabs with big pinchable targets.
//  • Review   — AI changes waiting for her OK (accept / reject each, or all),
//               the latest answer, and guideline-check findings.
//  • Checklist — site questions saved offline; per item "Ask Gemini" or
//               include in "Email the client" (draft shown; opening her mail
//               app needs her confirm; nothing is ever sent from here).
//  • History  — every change: who (you / Nano / Gemini / rules), what, when,
//               why, before → after; revert any applied entry.
// DOM only; the state lives in cad/changeLog and cad/siteChecklist.

import { ACTOR_LABEL, agoLabel, type ChangeEntry } from '../cad/changeLog';
import { GUIDELINE_LABEL, GUIDELINE_NOTE, GUIDELINE_SETS, REGION_IDS, type GuidelineIssue, type RegionId } from '../cad/guidelines';
import type { ChecklistItem, EmailDraft } from '../cad/siteChecklist';

export type CopilotTab = 'review' | 'checklist' | 'history';

export interface CopilotAnswerView {
  question: string;
  text: string;
  /** "From your drawing · on this device", "Gemini · cloud", … */
  by: string;
}

export interface CopilotPanelDeps {
  onAccept(id: string): void;
  onReject(id: string): void;
  onAcceptAll(): void;
  onRevert(id: string): void;
  onIssueShow(issue: GuidelineIssue): void;
  onIssueFix(issue: GuidelineIssue): void;
  onRegion(region: RegionId): void;
  onRecheck(): void;
  onAskGemini(id: string): void;
  onRemoveItem(id: string): void;
  onEmailClient(): void;
  /** Her confirm: open the draft in her own mail app (never sends). */
  onOpenDraft(draft: EmailDraft): void;
  onCancelDraft(): void;
}

export interface CopilotPanel {
  readonly element: HTMLElement;
  open(tab?: CopilotTab): void;
  close(): void;
  isOpen(): boolean;
  tab(): CopilotTab;
  setChanges(entries: ChangeEntry[]): void;
  setChecklist(items: ChecklistItem[], online: boolean): void;
  setReport(issues: GuidelineIssue[] | null, region: RegionId, summary: string): void;
  setAnswer(a: CopilotAnswerView | null): void;
  setDraft(d: { draft: EmailDraft; by: string } | null): void;
  setBusy(text: string | null): void;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function btn(label: string, cls: string, onClick: () => void, aria?: string): HTMLButtonElement {
  const b = h('button', `mc-cp-btn ${cls}`, label);
  b.type = 'button';
  if (aria) b.setAttribute('aria-label', aria);
  b.addEventListener('click', onClick);
  return b;
}

const STATUS_LABEL: Record<ChangeEntry['status'], string> = {
  pending: 'Waiting for you', applied: 'Applied', rejected: 'Rejected', reverted: 'Reverted',
};

export function createCopilotPanel(deps: CopilotPanelDeps): CopilotPanel {
  const root = h('section', 'mc-copilot');
  root.hidden = true;
  root.setAttribute('aria-label', 'Copilot');

  const head = h('div', 'mc-cp-head');
  const title = h('span', 'mc-cp-title', 'Copilot');
  const x = btn('✕', 'mc-panel-x', () => close(), 'Close copilot');
  head.append(title, x);

  const tabs = h('div', 'mc-cp-tabs');
  tabs.setAttribute('role', 'tablist');
  const tabBtns: Record<CopilotTab, HTMLButtonElement> = {
    review: btn('Review', 'mc-cp-tab', () => open('review')),
    checklist: btn('Site checklist', 'mc-cp-tab', () => open('checklist')),
    history: btn('History', 'mc-cp-tab', () => open('history')),
  };
  for (const b of Object.values(tabBtns)) { b.setAttribute('role', 'tab'); tabs.appendChild(b); }

  const busy = h('p', 'mc-cp-busy');
  busy.hidden = true;
  busy.setAttribute('role', 'status');

  const body = h('div', 'mc-cp-body');
  root.append(head, tabs, busy, body);

  let current: CopilotTab = 'review';
  let changes: ChangeEntry[] = [];
  let items: ChecklistItem[] = [];
  let online = true;
  let report: { issues: GuidelineIssue[]; region: RegionId; summary: string } | null = null;
  let region: RegionId = 'international';
  let answer: CopilotAnswerView | null = null;
  let draft: { draft: EmailDraft; by: string } | null = null;

  function changeCard(e: ChangeEntry, review: boolean): HTMLElement {
    const card = h('article', `mc-cp-card mc-cp-${e.status} mc-cp-by-${e.actor}`);
    const top = h('div', 'mc-cp-card-top');
    top.append(h('span', `mc-cp-who who-${e.actor}`, ACTOR_LABEL[e.actor]), h('span', 'mc-cp-when', agoLabel(e.decidedAt ?? e.at)));
    const what = h('p', 'mc-cp-what', e.title);
    card.append(top, what);
    if (e.why) card.appendChild(h('p', 'mc-cp-why', `Why: ${e.why}`));
    const ba = h('p', 'mc-cp-ba');
    ba.textContent = e.after ? `Before: ${e.before}  →  After: ${e.after}` : `Plan now: ${e.before}`;
    card.appendChild(ba);
    const foot = h('div', 'mc-cp-card-foot');
    foot.appendChild(h('span', `mc-cp-status st-${e.status}`, STATUS_LABEL[e.status]));
    if (e.status === 'pending' && review) {
      foot.append(
        btn('Accept', 'mc-cp-accept', () => deps.onAccept(e.id), `Accept: ${e.title}`),
        btn('Reject', 'mc-cp-reject ghost', () => deps.onReject(e.id), `Reject: ${e.title}`),
      );
    } else if (e.status === 'applied') {
      foot.appendChild(btn('Revert', 'mc-cp-revert ghost', () => deps.onRevert(e.id), `Revert: ${e.title}`));
    }
    card.appendChild(foot);
    return card;
  }

  function renderReview(): void {
    const pend = changes.filter((c) => c.status === 'pending');
    const sec = h('div', 'mc-cp-sec');
    const hd = h('div', 'mc-cp-sec-head');
    hd.appendChild(h('h3', '', pend.length ? `${pend.length} change${pend.length === 1 ? '' : 's'} waiting for you` : 'Nothing waiting'));
    if (pend.length > 1) hd.appendChild(btn('Accept all', 'mc-cp-accept', () => deps.onAcceptAll()));
    sec.appendChild(hd);
    if (!pend.length) sec.appendChild(h('p', 'mc-cp-empty', 'When Nano or Gemini suggests a change, it waits here until you accept it. Pinch Accept, or say "accept".'));
    for (const e of pend) sec.appendChild(changeCard(e, true));
    body.appendChild(sec);

    if (answer) {
      const a = h('div', 'mc-cp-sec mc-cp-answer');
      a.append(h('h3', '', answer.question), h('p', 'mc-cp-answer-text', answer.text), h('p', 'mc-cp-by', answer.by));
      body.appendChild(a);
    }

    const g = h('div', 'mc-cp-sec mc-cp-guide');
    const gh = h('div', 'mc-cp-sec-head');
    gh.appendChild(h('h3', '', GUIDELINE_LABEL));
    const sel = h('select', 'mc-cp-region');
    sel.setAttribute('aria-label', 'Guideline region');
    for (const id of REGION_IDS) {
      const o = h('option', '', GUIDELINE_SETS[id].label);
      o.value = id;
      if (id === region) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => deps.onRegion(sel.value as RegionId));
    gh.append(sel, btn('Check now', 'mc-cp-check', () => deps.onRecheck()));
    g.append(gh, h('p', 'mc-cp-note', GUIDELINE_NOTE));
    if (report) {
      g.appendChild(h('p', 'mc-cp-summary', report.summary));
      const ul = h('ul', 'mc-cp-issues');
      for (const i of report.issues) {
        const li = h('li', `mc-cp-issue sev-${i.severity}`);
        li.appendChild(h('span', 'mc-cp-sev', i.severity === 'fail' ? 'Fix' : 'Look'));
        li.appendChild(h('span', 'mc-cp-msg', i.message));
        const row = h('div', 'mc-cp-issue-btns');
        row.appendChild(btn('Show', 'ghost', () => deps.onIssueShow(i), `Show on plan: ${i.message}`));
        if (i.fix) row.appendChild(btn(i.fixLabel ?? 'Suggest fix', 'mc-cp-fix', () => deps.onIssueFix(i)));
        li.appendChild(row);
        ul.appendChild(li);
      }
      g.appendChild(ul);
    }
    body.appendChild(g);
  }

  function renderChecklist(): void {
    const sec = h('div', 'mc-cp-sec');
    const open = items.filter((i) => i.status !== 'done');
    sec.appendChild(h('h3', '', open.length ? `${open.length} question${open.length === 1 ? '' : 's'} from the site` : 'No site questions yet'));
    sec.appendChild(h('p', 'mc-cp-note', online
      ? 'You are online. Ask Gemini about any item, or email the client the list.'
      : 'No signal. Questions you ask are saved here and wait for the network.'));
    if (!items.length) sec.appendChild(h('p', 'mc-cp-empty', 'At the site with no signal, ask anything. Nano answers what the drawing can answer; the rest is saved here.'));
    const ul = h('ul', 'mc-cp-items');
    for (const it of items) {
      const li = h('li', `mc-cp-item it-${it.status}`);
      li.appendChild(h('p', 'mc-cp-q', it.question));
      const meta = h('p', 'mc-cp-meta', `${agoLabel(it.askedAt)}${it.askedOffline ? ' · asked offline' : ''} · ${it.status === 'open' ? 'open' : it.status}`);
      li.appendChild(meta);
      if (it.answer) li.appendChild(h('p', 'mc-cp-a', `${it.answeredBy === 'gemini' ? 'Gemini' : 'Note'}: ${it.answer}`));
      const row = h('div', 'mc-cp-issue-btns');
      if (it.status === 'open' || it.status === 'answered') {
        const ask = btn(it.answer ? 'Ask again' : 'Ask Gemini', 'mc-cp-ask', () => deps.onAskGemini(it.id), `Ask Gemini: ${it.question}`);
        ask.disabled = !online;
        row.appendChild(ask);
      }
      row.appendChild(btn('Remove', 'ghost', () => deps.onRemoveItem(it.id), `Remove: ${it.question}`));
      li.appendChild(row);
      ul.appendChild(li);
    }
    sec.appendChild(ul);
    if (items.some((i) => i.status !== 'done')) {
      const email = btn('Email the client', 'mc-cp-email', () => deps.onEmailClient());
      sec.appendChild(email);
    }
    body.appendChild(sec);

    if (draft) {
      const d = h('div', 'mc-cp-sec mc-cp-draft');
      d.appendChild(h('h3', '', 'Email draft. Nothing is sent from here.'));
      d.appendChild(h('p', 'mc-cp-by', draft.by));
      const to = h('input', 'mc-cp-to');
      to.type = 'email';
      to.placeholder = 'Client email (optional)';
      to.setAttribute('aria-label', 'Client email');
      to.value = draft.draft.to;
      const subj = h('input', 'mc-cp-subj');
      subj.value = draft.draft.subject;
      subj.setAttribute('aria-label', 'Subject');
      const ta = h('textarea', 'mc-cp-body-text');
      ta.value = draft.draft.body;
      ta.rows = 9;
      ta.setAttribute('aria-label', 'Email text');
      const row = h('div', 'mc-cp-issue-btns');
      row.append(
        btn('Open in my mail app', 'mc-cp-accept', () => deps.onOpenDraft({ to: to.value.trim(), subject: subj.value, body: ta.value })),
        btn('Cancel', 'ghost', () => deps.onCancelDraft()),
      );
      d.append(to, subj, ta, h('p', 'mc-cp-note', 'This opens your own mail app with the draft. You press send there.'), row);
      body.appendChild(d);
    }
  }

  function renderHistory(): void {
    const sec = h('div', 'mc-cp-sec');
    sec.appendChild(h('h3', '', changes.length ? 'Every change, newest first' : 'No changes yet'));
    sec.appendChild(h('p', 'mc-cp-note', 'Who made it, what changed, when and why. Revert any applied change.'));
    for (const e of [...changes].reverse()) sec.appendChild(changeCard(e, true));
    body.appendChild(sec);
  }

  function render(): void {
    body.replaceChildren();
    for (const [k, b] of Object.entries(tabBtns)) {
      b.setAttribute('aria-selected', String(k === current));
      b.classList.toggle('active', k === current);
    }
    const pend = changes.filter((c) => c.status === 'pending').length;
    tabBtns.review.textContent = pend ? `Review (${pend})` : 'Review';
    const openItems = items.filter((i) => i.status === 'open').length;
    tabBtns.checklist.textContent = openItems ? `Site checklist (${openItems})` : 'Site checklist';
    if (current === 'review') renderReview();
    else if (current === 'checklist') renderChecklist();
    else renderHistory();
  }

  function open(tab?: CopilotTab): void {
    if (tab) current = tab;
    root.hidden = false;
    render();
  }
  function close(): void {
    root.hidden = true;
  }

  return {
    element: root,
    open,
    close,
    isOpen: () => !root.hidden,
    tab: () => current,
    setChanges(e) { changes = e; if (!root.hidden) render(); },
    setChecklist(i, on) { items = i; online = on; if (!root.hidden) render(); },
    setReport(issues, r, summary) { region = r; report = issues ? { issues, region: r, summary } : null; if (!root.hidden) render(); },
    setAnswer(a) { answer = a; if (!root.hidden) render(); },
    setDraft(d) { draft = d; if (!root.hidden) render(); },
    setBusy(text) { busy.hidden = !text; busy.textContent = text ?? ''; },
  };
}

/** Big on-screen walk controls (pinch / dwell / click), shown in walk mode. */
export function createWalkControls(onStep: (step: string) => void, onExit: () => void): { element: HTMLElement; show(on: boolean): void } {
  const root = h('div', 'mc-walk');
  root.hidden = true;
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Walkthrough controls');
  const mk = (label: string, step: string) => btn(label, `mc-walk-btn walk-${step}`, () => onStep(step), label);
  root.append(
    mk('↺ Turn left', 'turn_left'),
    mk('↑ Forward', 'forward'),
    mk('↻ Turn right', 'turn_right'),
    mk('↓ Back', 'back'),
    btn('Exit walk', 'mc-walk-btn walk-exit', onExit),
  );
  return { element: root, show(on) { root.hidden = !on; } };
}
