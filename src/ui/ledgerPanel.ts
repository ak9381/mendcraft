// "What left this device" panel: a live ledger of every cloud call — what was
// sent (abstract design ops + text only, never camera/face/hand/voice), its
// size, and why it was routed out — beside a running count of the private
// on-device events that stayed local. Pure accounting lives in core/ledger.ts;
// this file is DOM only. A discreet affordance pinned over the canvas, toggled
// from the toolbar — not a shell redesign.

import { type Ledger, type CloudCall, formatBytes } from '../core/ledger';

export interface LedgerPanel {
  readonly element: HTMLElement;
  /** Re-render from the ledger's current state. */
  render(): void;
  toggle(): void;
  open(): void;
  isOpen(): boolean;
  dispose(): void;
}

const MAX_ROWS = 40;

export function createLedgerPanel(ledger: Ledger): LedgerPanel {
  const root = document.createElement('section');
  root.className = 'mc-ledger-panel';
  root.hidden = true;
  root.setAttribute('role', 'log');
  root.setAttribute('aria-label', 'What left this device');

  const head = document.createElement('div');
  head.className = 'mc-ledger-head';
  const title = document.createElement('span');
  title.className = 'mc-ledger-title';
  title.textContent = 'What left this device';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'mc-ledger-clear';
  clearBtn.textContent = 'Clear';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mc-ledger-x';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close ledger');
  head.append(title, clearBtn, closeBtn);

  // Summary chips: cloud bytes out vs. private events kept local.
  const summary = document.createElement('div');
  summary.className = 'mc-ledger-summary';
  const cloudChip = document.createElement('span');
  cloudChip.className = 'mc-ledger-chip badge-cloud';
  const privateChip = document.createElement('span');
  privateChip.className = 'mc-ledger-chip badge-on-device';
  summary.append(cloudChip, privateChip);

  const note = document.createElement('p');
  note.className = 'mc-ledger-note';
  note.textContent =
    'Only abstract design ops and text are ever sent to the cloud. The camera, face, hand landmarks and voice audio never leave this device.';

  const empty = document.createElement('p');
  empty.className = 'mc-ledger-empty';
  empty.textContent = 'Nothing has left this device yet. Private events stay on the left count.';

  const list = document.createElement('ul');
  list.className = 'mc-ledger-list';

  root.append(head, summary, note, empty, list);

  clearBtn.addEventListener('click', () => {
    ledger.clear(); // ledger subscription calls render()
  });
  closeBtn.addEventListener('click', () => {
    root.hidden = true;
  });

  function rowFor(call: CloudCall): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'mc-ledger-row';

    const top = document.createElement('div');
    top.className = 'mc-ledger-row-top';
    const dot = document.createElement('span');
    dot.className = 'mc-ledger-dot badge-cloud';
    dot.setAttribute('aria-hidden', 'true');
    const job = document.createElement('span');
    job.className = 'mc-ledger-job';
    job.textContent = call.job;
    const reason = document.createElement('span');
    reason.className = 'mc-ledger-reason';
    reason.textContent = call.reason ? `· ${call.reason}` : '';
    const size = document.createElement('span');
    size.className = 'mc-ledger-size';
    size.textContent = `${formatBytes(call.bytes)}${typeof call.ms === 'number' ? ` · ${Math.round(call.ms)} ms` : ''}`;
    top.append(dot, job, reason, size);

    const sent = document.createElement('pre');
    sent.className = 'mc-ledger-sent';
    sent.textContent = call.sent;

    li.append(top, sent);

    if (call.redactions > 0) {
      const warn = document.createElement('span');
      warn.className = 'mc-ledger-redacted';
      warn.textContent = `${call.redactions} device-only field(s) scrubbed before sending`;
      li.append(warn);
    }
    return li;
  }

  function render(): void {
    const c = ledger.counts();
    cloudChip.textContent = `${c.cloud} cloud · ${formatBytes(c.bytesSent)} out`;
    privateChip.textContent = `${c.private} private on-device (${c.onDevice} AI · ${c.rules} rules)`;
    const calls = ledger.calls();
    empty.hidden = calls.length > 0;
    // Newest first, capped — the ledger itself keeps the full history.
    const rows = calls.slice(-MAX_ROWS).reverse().map(rowFor);
    list.replaceChildren(...rows);
  }

  const unsubscribe = ledger.subscribe(() => render());
  render();

  return {
    element: root,
    render,
    toggle() { root.hidden = !root.hidden; if (!root.hidden) render(); },
    open() { root.hidden = false; render(); },
    isOpen: () => !root.hidden,
    dispose() { unsubscribe(); root.remove(); },
  };
}
