// Discreet WiZ lamp panel for the laptop editor — a float panel (like the pair /
// routing / ledger panels) holding the shared lamp control. No shell restyle;
// buttons work for mouse AND the pinch pointer. Wiring (bridge URL, publishing
// the lamp state to the control-room snapshot) stays in main.ts.

import { createWizClient, resolveBridgeUrl } from '../devices/wizClient';
import { createLampControl } from '../devices/lampControl';
import type { LampIntent, LampState } from '../devices/wiz';

export interface LampPanel {
  readonly element: HTMLElement;
  toggle(): void;
  open(): void;
  isOpen(): boolean;
  /** Run one lamp intent (recipe replay). Opens the panel so the result shows. */
  apply(intent: LampIntent): Promise<void>;
}

export function createLampPanel(opts: {
  onState?: (state: LampState | null, online: boolean) => void;
}): LampPanel {
  const root = document.createElement('section');
  root.className = 'mc-lamp-panel';
  root.hidden = true;
  root.setAttribute('aria-label', 'WiZ lamp');

  const head = document.createElement('div');
  head.className = 'mc-lamp-head';
  head.innerHTML = `<span class="mc-lamp-heading">Room lamp</span>
    <button type="button" class="mc-lamp-x" aria-label="Close lamp panel">✕</button>`;
  root.appendChild(head);

  const client = createWizClient(resolveBridgeUrl());
  const control = createLampControl(client, { onState: opts.onState });
  root.appendChild(control.element);

  const note = document.createElement('p');
  note.className = 'mc-lamp-note';
  note.textContent = `Bridge: ${client.baseUrl}`;
  root.appendChild(note);

  head.querySelector('.mc-lamp-x')!.addEventListener('click', () => {
    root.hidden = true;
  });

  let refreshed = false;
  return {
    element: root,
    open() {
      root.hidden = false;
      if (!refreshed) {
        refreshed = true;
        void control.refresh();
      }
    },
    toggle() {
      if (root.hidden) this.open();
      else root.hidden = true;
    },
    isOpen: () => !root.hidden,
    apply(intent) {
      this.open();
      return control.apply(intent);
    },
  };
}
