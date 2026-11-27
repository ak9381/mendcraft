// One suggestion at a time, from the section 4 table. Dropped twice, it
// stops appearing (it still lives on the Here card). Never on idle alone.

export type SuggestionLevel = 1 | 2 | 3 | 4;

export type SuggestionId =
  | 'draw'
  | 'check'
  | 'stair'
  | 'walk'
  | 'materials'
  | 'email'
  | 'site'
  | 'sync'
  | 'connect';

export interface Suggestion {
  id: SuggestionId;
  text: string;
  say: string;
  minLevel: SuggestionLevel;
}

export const SUGGESTIONS: readonly Suggestion[] = [
  { id: 'draw', text: 'Try: draw a room 4 by 5 metres', say: 'Draw a room 4 by 5 metres', minLevel: 1 },
  { id: 'check', text: 'This room is worth a look. Check it?', say: 'Check this room', minLevel: 2 },
  { id: 'stair', text: 'Floor to floor is 3.0 m. Make a stair here?', say: 'Make a stair here', minLevel: 2 },
  { id: 'walk', text: 'Walk in?', say: 'Walk in', minLevel: 2 },
  { id: 'materials', text: 'Add materials and light? Online, about 15 s', say: 'Warm evening light, terracotta floor', minLevel: 3 },
  { id: 'email', text: 'Tell the client what changed today?', say: 'Email the client about today', minLevel: 3 },
  { id: 'site', text: 'Going to site? I can answer from the plan.', say: 'Site visit', minLevel: 4 },
  { id: 'sync', text: 'A second device is here. Join it?', say: 'Join my iPad', minLevel: 4 },
  { id: 'connect', text: 'Connect the lamp? Deep writes the link; you approve what it can do.', say: 'Connect the lamp', minLevel: 4 },
];

export interface SuggestionSituation {
  level: SuggestionLevel;
  hasClosedRoom?: boolean;
  hasLevelChange?: boolean;
  enteredWalk?: boolean;
  keptChanges?: number;
  offline?: boolean;
  secondDevice?: boolean;
  mentionedDevice?: string | null;
  emptyCanvas?: boolean;
  /** Something she did or something that changed — required. */
  trigger: 'kept-change' | 'room-closed' | 'entered-walk' | 'went-offline' | 'device-joined' | 'device-mentioned' | 'empty-plan' | 'first-open';
}

const DROP_KEY = 'mendcraft:suggest-drops-v1';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

function drops(store: KV): Record<string, number> {
  try {
    const raw = JSON.parse(store.getItem(DROP_KEY) || '{}') as unknown;
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

export function recordSuggestionDrop(store: KV, id: SuggestionId): number {
  const m = drops(store);
  m[id] = (m[id] ?? 0) + 1;
  store.setItem(DROP_KEY, JSON.stringify(m));
  return m[id];
}

export function isRetired(store: KV, id: SuggestionId): boolean {
  return (drops(store)[id] ?? 0) >= 2;
}

export function discoveryLevel(s: {
  hasClosedRoom?: boolean;
  enteredWalk?: boolean;
  roomCount?: number;
  offline?: boolean;
  secondDevice?: boolean;
  mentionedDevice?: boolean;
}): SuggestionLevel {
  if (s.offline || s.secondDevice || s.mentionedDevice) return 4;
  if ((s.roomCount ?? 0) >= 3 || s.enteredWalk) return 3;
  if (s.hasClosedRoom) return 2;
  return 1;
}

function eligible(sit: SuggestionSituation, store: KV): Suggestion[] {
  return SUGGESTIONS.filter((s) => {
    if (s.minLevel > sit.level) return false;
    if (isRetired(store, s.id)) return false;
    if (s.id === 'draw') return sit.emptyCanvas === true || sit.trigger === 'first-open' || sit.trigger === 'empty-plan';
    if (s.id === 'check') return sit.hasClosedRoom === true && (sit.trigger === 'kept-change' || sit.trigger === 'room-closed');
    if (s.id === 'stair') return sit.hasLevelChange === true;
    if (s.id === 'walk') return sit.hasClosedRoom === true && (sit.trigger === 'room-closed' || sit.trigger === 'kept-change');
    if (s.id === 'materials') return sit.enteredWalk === true || sit.trigger === 'entered-walk';
    if (s.id === 'email') return (sit.keptChanges ?? 0) >= 5;
    if (s.id === 'site') return sit.offline === true || sit.trigger === 'went-offline';
    if (s.id === 'sync') return sit.secondDevice === true || sit.trigger === 'device-joined';
    if (s.id === 'connect') return !!sit.mentionedDevice || sit.trigger === 'device-mentioned';
    return false;
  });
}

/** At most one suggestion. Prefer the most situation-specific (highest minLevel, then table order). */
export function pickSuggestion(sit: SuggestionSituation, store: KV): Suggestion | null {
  const list = eligible(sit, store).sort((a, b) => b.minLevel - a.minLevel);
  return list[0] ?? null;
}
