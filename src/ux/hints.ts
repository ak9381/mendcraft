import type { FocusKind, Focusable } from './focusModel';

export interface HintPhrase {
  id: string;
  text: string;
  kind: FocusKind | 'any';
}

export const HINT_PHRASES: readonly HintPhrase[] = [
  { id: 'draw-room', text: 'Try: draw a room 4 by 5 metres', kind: 'none' },
  { id: 'draw-wall', text: 'Try: draw a wall 4 metres north', kind: 'plan' },
  { id: 'make-wall', text: 'Try: make this 4 metres', kind: 'wall' },
  { id: 'door-here', text: 'Try: put a door here', kind: 'wall' },
  { id: 'check-room', text: 'Try: check this room', kind: 'room' },
  { id: 'walk-in', text: 'Try: walk in', kind: 'room' },
  { id: 'door-900', text: 'Try: make this 900 mm', kind: 'door' },
  { id: 'window-sill', text: 'Try: set the sill to 900 mm', kind: 'window' },
  { id: 'stair-check', text: 'Try: check this stair', kind: 'stair' },
  { id: 'light', text: 'Try: warm evening light, terracotta floor', kind: 'view3d' },
];

const USED_KEY = 'mendcraft:hint-used-v1';
const HIDDEN_KEY = 'mendcraft:hint-hidden';
const RETIRE_AFTER = 3;

export interface HintStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function usedMap(store: HintStore): Record<string, number> {
  try {
    const raw = JSON.parse(store.getItem(USED_KEY) || '{}') as unknown;
    if (!raw || typeof raw !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'number' && v > 0) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export function hintsHidden(store: HintStore): boolean {
  return store.getItem(HIDDEN_KEY) === '1';
}

export function setHintsHidden(store: HintStore, hidden: boolean): void {
  store.setItem(HIDDEN_KEY, hidden ? '1' : '0');
}

export function recordHintUsed(store: HintStore, id: string): void {
  const m = usedMap(store);
  m[id] = (m[id] ?? 0) + 1;
  store.setItem(USED_KEY, JSON.stringify(m));
}

export function hintForFocus(focus: Focusable | null, store: HintStore): HintPhrase | null {
  if (hintsHidden(store)) return null;
  const used = usedMap(store);
  const kind: FocusKind = focus?.kind ?? 'none';
  const candidates = HINT_PHRASES.filter((h) => h.kind === kind || (kind === 'none' && h.kind === 'plan'));
  const list = (candidates.length ? candidates : HINT_PHRASES.filter((h) => h.kind === 'none' || h.kind === 'plan'));
  return list.find((h) => (used[h.id] ?? 0) < RETIRE_AFTER) ?? null;
}
