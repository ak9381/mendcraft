// Accessibility panel: lists the deterministic issues from the active mode's
// checker, fills in cloud explanations as they arrive, and offers per-issue
// "Show" (canvas highlight) / "Fix" plus "Fix all". DOM only — checks live in
// plan/accessibility.ts and ui/design/accessibility.ts; the cloud call in
// ai/hybrid.ts. Ordinary buttons throughout, so the pinch pointer (which
// drives the same pointer events as the mouse) operates everything.

import type { A11yExplanation, A11yIssue } from '../core/a11y';
import type { Source } from '../ai/hybrid';

export interface A11yPanelCallbacks {
  /** Highlight the issue's targets on the canvas. */
  onShow(issue: A11yIssue): void;
  /** Apply one issue's fix op (validated + undoable via the op log). */
  onApply(issue: A11yIssue): void;
  /** Apply every remaining fix as one undoable step. */
  onApplyAll(issues: A11yIssue[]): void;
  /** Re-run the checks on the current document. */
  onRecheck(): void;
}

export interface A11yPanel {
  readonly element: HTMLElement;
  /** Replace the issue list (a fresh check run). `explainPending` shows the
   *  "asking the cloud…" placeholder while explainAccessibility is in flight. */
  setIssues(issues: A11yIssue[], explainPending?: boolean): void;
  /** Merge cloud explanations / alternative fixes into the visible rows. */
  setExplanations(items: A11yExplanation[], source: Source): void;
  open(): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

export function createA11yPanel(callbacks: A11yPanelCallbacks): A11yPanel {
  const root = document.createElement('section');
  root.className = 'mc-a11y-panel';
  root.hidden = true;
  root.setAttribute('aria-label', 'Accessibility issues');

  const head = document.createElement('div');
  head.className = 'mc-a11y-head';
  const title = document.createElement('span');
  title.className = 'mc-a11y-title';
  title.textContent = 'Accessibility';
  const sourceTag = document.createElement('span');
  sourceTag.className = 'mc-a11y-source';
  const fixAllBtn = document.createElement('button');
  fixAllBtn.type = 'button';
  fixAllBtn.textContent = 'Fix all';
  fixAllBtn.title = 'Apply every proposed fix as one undoable step';
  const recheckBtn = document.createElement('button');
  recheckBtn.type = 'button';
  recheckBtn.textContent = 'Re-check';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mc-a11y-x';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close accessibility panel');
  head.append(title, sourceTag, fixAllBtn, recheckBtn, closeBtn);

  const empty = document.createElement('p');
  empty.className = 'mc-a11y-empty';
  empty.textContent = 'No accessibility issues found.';

  const list = document.createElement('ul');
  list.className = 'mc-a11y-list';

  root.append(head, empty, list);

  let issues: A11yIssue[] = [];
  const rows = new Map<string, { explain: HTMLParagraphElement; fixBtn: HTMLButtonElement }>();

  function fixables(): A11yIssue[] {
    return issues.filter((i) => i.fix);
  }

  function renderRow(issue: A11yIssue, explainPending: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.className = `mc-a11y-row mc-a11y-${issue.severity}`;

    const line = document.createElement('div');
    line.className = 'mc-a11y-line';
    const dot = document.createElement('span');
    dot.className = `mc-a11y-dot mc-a11y-dot-${issue.severity}`;
    dot.setAttribute('aria-hidden', 'true');
    const msg = document.createElement('span');
    msg.className = 'mc-a11y-msg';
    msg.textContent = issue.message;
    line.append(dot, msg);

    const cite = document.createElement('p');
    cite.className = 'mc-a11y-cite';
    cite.textContent = issue.citation;

    const explain = document.createElement('p');
    explain.className = 'mc-a11y-explain';
    explain.textContent = explainPending ? 'Asking the cloud model for an explanation…' : '';
    explain.hidden = !explainPending;

    const actions = document.createElement('div');
    actions.className = 'mc-a11y-actions';
    const showBtn = document.createElement('button');
    showBtn.type = 'button';
    showBtn.textContent = 'Show';
    showBtn.title = 'Highlight on the canvas';
    showBtn.addEventListener('click', () => callbacks.onShow(issue));
    const fixBtn = document.createElement('button');
    fixBtn.type = 'button';
    fixBtn.textContent = issue.fixLabel ?? 'Fix';
    if (issue.fix) {
      fixBtn.addEventListener('click', () => callbacks.onApply(issue));
    } else {
      fixBtn.disabled = true;
      fixBtn.title = 'No automatic fix — see the explanation';
    }
    actions.append(showBtn, fixBtn);

    li.append(line, cite, explain, actions);
    rows.set(issue.id, { explain, fixBtn });
    return li;
  }

  function setIssues(next: A11yIssue[], explainPending = false): void {
    issues = next;
    rows.clear();
    list.innerHTML = '';
    sourceTag.textContent = '';
    empty.hidden = issues.length > 0;
    for (const issue of issues) list.appendChild(renderRow(issue, explainPending));
    fixAllBtn.disabled = fixables().length === 0;
    fixAllBtn.textContent = `Fix all (${fixables().length})`;
  }

  function setExplanations(items: A11yExplanation[], source: Source): void {
    sourceTag.textContent = source === 'rules' ? 'explanations: offline' : `explained by ${source}`;
    sourceTag.className = `mc-a11y-source badge-${source}`;
    for (const issue of issues) {
      const row = rows.get(issue.id);
      if (!row) continue;
      const item = items.find((i) => i.id === issue.id);
      if (!item) {
        // Rules floor: the deterministic message already explains itself.
        row.explain.textContent = '';
        row.explain.hidden = true;
        continue;
      }
      row.explain.textContent = item.explanation;
      row.explain.hidden = false;
      // A cloud-proposed fix only fills a gap — a code-computed fix stays.
      if (item.fix && !issue.fix) {
        issue.fix = item.fix;
        issue.fixLabel = 'Apply suggested fix';
        row.fixBtn.textContent = issue.fixLabel;
        row.fixBtn.disabled = false;
        row.fixBtn.title = `Proposed by the cloud model: ${JSON.stringify(item.fix)}`;
        row.fixBtn.addEventListener('click', () => callbacks.onApply(issue));
      }
    }
    fixAllBtn.disabled = fixables().length === 0;
    fixAllBtn.textContent = `Fix all (${fixables().length})`;
  }

  fixAllBtn.addEventListener('click', () => callbacks.onApplyAll(fixables()));
  recheckBtn.addEventListener('click', () => callbacks.onRecheck());
  closeBtn.addEventListener('click', () => {
    root.hidden = true;
  });

  return {
    element: root,
    setIssues,
    setExplanations,
    open() {
      root.hidden = false;
    },
    toggle() {
      root.hidden = !root.hidden;
    },
    isOpen: () => !root.hidden,
    dispose() {
      root.remove();
    },
  };
}
