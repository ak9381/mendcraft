// Gestures settings panel: a floating dialog that maps each recognised hand
// gesture to an action, persists the map to localStorage, resets to defaults,
// and shows a short live preview of the gesture currently recognised (and the
// action it would trigger). Recognition + persistence are pure (input/gestures,
// input/gestureMap); this module is the DOM + wiring. Operator lock is respected
// upstream: the frames fed to feedPreview() already contain only operator hands.

import { ALL_GESTURES, GESTURE_LABELS, type Gesture } from '../input/gestures';
import {
  ALL_ACTIONS, ACTION_LABELS, loadGestureMap, saveGestureMap, resetGestureMap,
  type GestureMap, type GestureAction,
} from '../input/gestureMap';

export interface GesturesPanel {
  readonly element: HTMLElement;
  open(): void;
  close(): void;
  toggle(): void;
  isOpen(): boolean;
  /** Current (saved) gesture→action map. */
  getMap(): GestureMap;
  /** Feed the live preview the currently recognised gesture. */
  feedPreview(gesture: Gesture): void;
  dispose(): void;
}

export interface GesturesPanelOptions {
  /** Called whenever the map changes (save or reset) so the recogniser updates. */
  onChange(map: GestureMap): void;
}

// Gestures the panel lets you bind (everything except the no-op placeholder).
const BINDABLE = ALL_GESTURES.filter((g) => g !== 'none');

export function createGesturesPanel(opts: GesturesPanelOptions): GesturesPanel {
  let map = loadGestureMap();

  const root = document.createElement('section');
  root.className = 'mc-gestures-panel';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'false');
  root.setAttribute('aria-label', 'Gesture settings');

  const selects = new Map<Gesture, HTMLSelectElement>();

  const header = document.createElement('div');
  header.className = 'mc-panel-head';
  const title = document.createElement('h2');
  title.textContent = 'Gestures';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mc-panel-x';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close gesture settings');
  closeBtn.addEventListener('click', () => close());
  header.append(title, closeBtn);

  const list = document.createElement('div');
  list.className = 'mc-gesture-rows';

  for (const g of BINDABLE) {
    const r = document.createElement('div');
    r.className = 'mc-gesture-row';
    const id = `mc-g-${g}`;

    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = GESTURE_LABELS[g];

    const sel = document.createElement('select');
    sel.id = id;
    for (const a of ALL_ACTIONS) {
      const o = document.createElement('option');
      o.value = a;
      o.textContent = ACTION_LABELS[a];
      sel.appendChild(o);
    }
    sel.value = map[g];
    sel.addEventListener('change', () => {
      map = { ...map, [g]: sel.value as GestureAction };
      saveGestureMap(map);
      opts.onChange(map);
    });
    selects.set(g, sel);

    r.append(label, sel);
    list.appendChild(r);
  }

  // Live preview.
  const preview = document.createElement('div');
  preview.className = 'mc-gesture-preview';
  preview.setAttribute('role', 'status');
  preview.setAttribute('aria-live', 'polite');
  const previewG = document.createElement('span');
  previewG.className = 'mc-prev-gesture';
  const previewA = document.createElement('span');
  previewA.className = 'mc-prev-action';
  const prevHint = document.createElement('span');
  prevHint.className = 'mc-prev-hint';
  prevHint.textContent = 'Live: ';
  preview.append(prevHint, previewG, previewA);
  setPreview('none');

  // Footer.
  const footer = document.createElement('div');
  footer.className = 'mc-panel-foot';
  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'mc-btn-reset';
  resetBtn.textContent = 'Reset to defaults';
  resetBtn.addEventListener('click', () => {
    map = resetGestureMap();
    saveGestureMap(map);
    for (const [g, sel] of selects) sel.value = map[g];
    opts.onChange(map);
  });
  const note = document.createElement('p');
  note.className = 'mc-panel-note';
  note.textContent = 'Saved on this device. Select / Drag / Pan / Zoom follow the pinch pointer; Delete, Undo, Open palette and Confirm fire once when the gesture is recognised.';
  footer.append(resetBtn);

  root.append(header, list, preview, note, footer);

  function setPreview(g: Gesture): void {
    previewG.textContent = GESTURE_LABELS[g];
    const action = g === 'none' ? 'none' : map[g];
    previewA.textContent = g === 'none' ? '' : ` → ${ACTION_LABELS[action]}`;
    root.classList.toggle('mc-live', g !== 'none');
  }

  let lastPreview: Gesture = 'none';
  function feedPreview(g: Gesture): void {
    if (g === lastPreview) return;
    lastPreview = g;
    setPreview(g);
  }

  function open(): void {
    // Reflect any changes made elsewhere (defensive) before showing.
    for (const [g, sel] of selects) sel.value = map[g];
    root.hidden = false;
    closeBtn.focus();
  }
  function close(): void { root.hidden = true; }

  return {
    element: root,
    open,
    close,
    toggle() { root.hidden ? open() : close(); },
    isOpen: () => !root.hidden,
    getMap: () => map,
    feedPreview,
    dispose() { root.remove(); },
  };
}
