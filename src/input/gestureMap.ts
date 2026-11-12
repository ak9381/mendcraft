// Pure gesture→action mapping with localStorage persistence and reset. DOM-free
// and storage-injectable so the persistence/reset logic is unit-testable.

import { ALL_GESTURES, type Gesture } from './gestures';

/** Actions a gesture can be bound to. Continuous actions (select/drag/pan/zoom)
 *  are driven by the pinch pointer; discrete ones fire on gesture onset. */
export type GestureAction =
  | 'select' | 'drag' | 'delete' | 'undo' | 'pan' | 'zoom'
  | 'open-palette' | 'confirm' | 'none';

export const ALL_ACTIONS: GestureAction[] = [
  'select', 'drag', 'delete', 'undo', 'pan', 'zoom', 'open-palette', 'confirm', 'none',
];

export const ACTION_LABELS: Record<GestureAction, string> = {
  select: 'Select',
  drag: 'Drag',
  delete: 'Delete selection',
  undo: 'Undo',
  pan: 'Pan',
  zoom: 'Zoom',
  'open-palette': 'Open palette',
  confirm: 'Confirm',
  none: 'Do nothing',
};

export type GestureMap = Record<Gesture, GestureAction>;

export const DEFAULT_GESTURE_MAP: GestureMap = {
  pinch: 'select',
  'double-pinch': 'open-palette',
  fist: 'drag',
  'open-palm': 'pan',
  point: 'select',
  'thumbs-up': 'confirm',
  'two-hand-zoom': 'zoom',
  none: 'none',
};

export const GESTURE_MAP_KEY = 'mendcraft.gestureMap';

function isAction(v: unknown): v is GestureAction {
  return typeof v === 'string' && (ALL_ACTIONS as string[]).includes(v);
}

/** Merge an untrusted partial map onto the defaults, dropping bad keys/values. */
export function coerceGestureMap(raw: unknown): GestureMap {
  const out: GestureMap = { ...DEFAULT_GESTURE_MAP };
  if (raw && typeof raw === 'object') {
    for (const g of ALL_GESTURES) {
      const v = (raw as Record<string, unknown>)[g];
      if (isAction(v)) out[g] = v;
    }
  }
  return out;
}

/** Minimal storage shape (window.localStorage satisfies it). */
export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

/** Load a saved map (or defaults). Never throws — storage may be blocked. */
export function loadGestureMap(storage?: StorageLike): GestureMap {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    const raw = s?.getItem(GESTURE_MAP_KEY);
    if (!raw) return { ...DEFAULT_GESTURE_MAP };
    return coerceGestureMap(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_GESTURE_MAP };
  }
}

/** Persist a map. Returns false if storage was unavailable/blocked. */
export function saveGestureMap(map: GestureMap, storage?: StorageLike): boolean {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined);
    if (!s) return false;
    s.setItem(GESTURE_MAP_KEY, JSON.stringify(map));
    return true;
  } catch {
    return false;
  }
}

/** A fresh copy of the defaults (for the panel's Reset button). */
export function resetGestureMap(): GestureMap {
  return { ...DEFAULT_GESTURE_MAP };
}
