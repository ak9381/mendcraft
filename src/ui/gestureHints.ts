// Visible gesture hints (DOM). Each button that has a gesture gets a small
// badge with the gesture glyph (aria-hidden, so its accessible name is
// unchanged; the gesture is added to its title instead). Also renders the
// Gestures guide: every default gesture grouped by scope, with a live
// highlight when one is recognised.

import { GESTURE_CATALOG, SCOPE_LABELS, catalogGesture, defaultGestureFor, type GestureScope } from '../input/gestureCatalog';
import { gestureForTarget } from '../input/gestureDispatch';
import type { ButtonBinding } from '../setup/setupState';
import type { GestureTemplate } from '../input/gestureTemplates';

const HINT_CLASS = 'mc-ghint';

export function gestureLabel(id: string, templates: readonly GestureTemplate[]): { glyph: string; label: string } | null {
  if (id.startsWith('custom:')) {
    const t = templates.find((x) => `custom:${x.id}` === id);
    return t ? { glyph: '★', label: `your gesture "${t.label}"` } : null;
  }
  const g = catalogGesture(id);
  return g ? { glyph: g.glyph, label: g.label.toLowerCase() } : null;
}

/** Add / refresh / remove the hint badge on every button with an id. */
export function applyGestureHints(
  root: ParentNode,
  bindings: readonly ButtonBinding[],
  templates: readonly GestureTemplate[],
  show: boolean,
): number {
  let count = 0;
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[id]')) {
    b.querySelector(`:scope > .${HINT_CLASS}`)?.remove();
    const base = b.dataset.baseTitle ?? b.getAttribute('title') ?? '';
    if (b.dataset.baseTitle === undefined) b.dataset.baseTitle = base;
    const gid = gestureForTarget(b.id, bindings, (t) => defaultGestureFor(t)?.id);
    const info = gid ? gestureLabel(gid, templates) : null;
    if (!info || !show) {
      if (base) b.setAttribute('title', base); else b.removeAttribute('title');
      b.classList.remove('mc-has-ghint');
      continue;
    }
    const badge = document.createElement('span');
    badge.className = HINT_CLASS;
    badge.setAttribute('aria-hidden', 'true');
    badge.textContent = info.glyph;
    b.append(badge);
    b.classList.add('mc-has-ghint');
    b.setAttribute('title', `${base ? `${base} · ` : ''}Gesture: ${info.label}`);
    count++;
  }
  return count;
}

export interface GestureGuide {
  readonly element: HTMLElement;
  highlight(id: string | null): void;
}

export function createGestureGuide(): GestureGuide {
  const root = document.createElement('details');
  root.className = 'mc-gguide';
  root.open = true;
  const sum = document.createElement('summary');
  sum.textContent = 'All gestures';
  root.append(sum);
  const rows = new Map<string, HTMLElement>();
  for (const scope of Object.keys(SCOPE_LABELS) as GestureScope[]) {
    const h = document.createElement('h3');
    h.textContent = SCOPE_LABELS[scope];
    root.append(h);
    const ul = document.createElement('ul');
    for (const g of GESTURE_CATALOG.filter((x) => x.scope === scope)) {
      const li = document.createElement('li');
      li.dataset.gesture = g.id;
      const glyph = document.createElement('span');
      glyph.className = 'mc-gguide-glyph';
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = g.glyph;
      const text = document.createElement('span');
      text.className = 'mc-gguide-text';
      const name = document.createElement('strong');
      name.textContent = g.label;
      const kn = document.createElement('span');
      kn.className = 'mc-gguide-kn';
      kn.lang = 'kn';
      kn.textContent = g.kn;
      const does = document.createElement('span');
      does.className = 'mc-gguide-does';
      does.textContent = g.wired ? g.does : `${g.does} (recognised; ${g.note ?? 'not wired yet'})`;
      text.append(name, kn, does);
      li.append(glyph, text);
      ul.append(li);
      rows.set(g.id, li);
    }
    root.append(ul);
  }
  let timer = 0;
  return {
    element: root,
    highlight(id) {
      for (const r of rows.values()) r.classList.remove('on');
      if (!id) return;
      rows.get(id)?.classList.add('on');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => rows.get(id)?.classList.remove('on'), 1500);
    },
  };
}
