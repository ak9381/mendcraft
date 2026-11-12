// Routing dev panel: a small toggleable overlay listing recent hybrid-router
// decisions (planned path → actual source · reason, confidence, latency). Pure
// formatting lives in ai/router.ts (formatLogEntry); this file is DOM only.
// It is a dev affordance pinned over the canvas — not a shell redesign.

import { formatLogEntry, type RouteLogEntry } from '../ai/router';

export interface RouterPanel {
  readonly element: HTMLElement;
  add(entry: RouteLogEntry): void;
  toggle(): void;
  isOpen(): boolean;
  dispose(): void;
}

const MAX_ENTRIES = 30;

export function createRouterPanel(): RouterPanel {
  const root = document.createElement('section');
  root.className = 'mc-router-panel';
  root.hidden = true;
  root.setAttribute('role', 'log');
  root.setAttribute('aria-label', 'AI routing decisions');

  const head = document.createElement('div');
  head.className = 'mc-router-head';
  const title = document.createElement('span');
  title.className = 'mc-router-title';
  title.textContent = 'Routing';
  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'mc-router-clear';
  clearBtn.textContent = 'Clear';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mc-router-x';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close routing panel');
  head.append(title, clearBtn, closeBtn);

  const list = document.createElement('ul');
  list.className = 'mc-router-list';

  const empty = document.createElement('p');
  empty.className = 'mc-router-empty';
  empty.textContent = 'No commands routed yet. Say or type one.';

  root.append(head, empty, list);

  clearBtn.addEventListener('click', () => {
    list.innerHTML = '';
    empty.hidden = false;
  });
  closeBtn.addEventListener('click', () => {
    root.hidden = true;
  });

  function add(entry: RouteLogEntry): void {
    empty.hidden = true;
    const li = document.createElement('li');
    li.className = `mc-router-row mc-router-${entry.source}`;
    const dot = document.createElement('span');
    dot.className = `mc-router-dot badge-${entry.source}`;
    dot.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = formatLogEntry(entry);
    li.append(dot, text);
    list.prepend(li);
    while (list.children.length > MAX_ENTRIES) list.lastElementChild?.remove();
  }

  return {
    element: root,
    add,
    toggle() { root.hidden = !root.hidden; },
    isOpen: () => !root.hidden,
    dispose() { root.remove(); },
  };
}
