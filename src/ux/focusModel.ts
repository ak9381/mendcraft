// Focus, not a cursor: snap to the nearest thing, optional numbers, and
// this / that / here resolution.

export type FocusKind = 'plan' | 'room' | 'wall' | 'door' | 'window' | 'stair' | 'view3d' | 'none';

export interface Focusable {
  id: string;
  kind: FocusKind;
  name: string;
  x: number;
  y: number;
}

export interface FocusContext {
  items: readonly Focusable[];
  /** Thing her hand points at while she speaks. */
  pointed?: Focusable | null;
  lastTouched?: Focusable | null;
  /** When true, each visible thing has a spoken number. */
  numbersVisible: boolean;
}

export type FocusResolve =
  | { kind: 'hit'; item: Focusable; how: 'pointed' | 'name' | 'number' | 'last' | 'snap' }
  | { kind: 'ask'; prompt: string; candidates: Focusable[] };

export function snapToNearest(items: readonly Focusable[], x: number, y: number): Focusable | null {
  const vis = items.filter((i) => i.kind !== 'none' && i.kind !== 'plan');
  if (!vis.length) return items.find((i) => i.kind === 'plan') ?? null;
  let best = vis[0];
  let bestD = Infinity;
  for (const it of vis) {
    const d = Math.hypot(it.x - x, it.y - y);
    if (d < bestD) { best = it; bestD = d; }
  }
  return best;
}

/** Number overlays in nearest-to-focus order (or left-to-right if no focus). */
export function numberOverlays(items: readonly Focusable[], around?: { x: number; y: number }): { id: string; n: number; name: string }[] {
  const vis = items.filter((i) => i.kind !== 'none' && i.kind !== 'plan');
  const sorted = [...vis].sort((a, b) => {
    if (around) return Math.hypot(a.x - around.x, a.y - around.y) - Math.hypot(b.x - around.x, b.y - around.y);
    return a.x - b.x || a.y - b.y;
  });
  return sorted.map((it, i) => ({ id: it.id, n: i + 1, name: it.name }));
}

const SHOW_NUMBERS = /\b(?:show numbers|show the numbers|number them)\b/i;
const THIS_RE = /\b(?:this|that|here|ಇಲ್ಲಿ)\b/i;

function namedHit(items: readonly Focusable[], utterance: string): Focusable | null {
  const t = utterance.toLowerCase();
  const scored = items
    .map((it) => {
      const name = it.name.toLowerCase();
      if (!name) return { it, n: 0 };
      if (t.includes(name)) return { it, n: name.length };
      const words = name.split(/\s+/).filter((w) => w.length >= 3);
      if (words.some((w) => t.includes(w))) return { it, n: 2 };
      return { it, n: 0 };
    })
    .filter((s) => s.n > 0)
    .sort((a, b) => b.n - a.n);
  return scored[0]?.it ?? null;
}

function numberHit(items: readonly Focusable[], utterance: string, around?: { x: number; y: number }): Focusable | null {
  const m = utterance.match(/\b(?:number\s+)?(\d{1,2})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  const overlays = numberOverlays(items, around);
  return overlays.find((o) => o.n === n)
    ? items.find((i) => i.id === overlays.find((o) => o.n === n)!.id) ?? null
    : null;
}

export function wantsNumbers(utterance: string): boolean {
  return SHOW_NUMBERS.test(utterance);
}

/**
 * Resolve this / that / here, a name, or a spoken number.
 * Order: pointed as she speaks; a named thing; a spoken number; last touched.
 * If still unclear: ask her to say a number.
 */
export function resolveFocus(utterance: string, ctx: FocusContext): FocusResolve {
  const deictic = THIS_RE.test(utterance);
  if (ctx.pointed) return { kind: 'hit', item: ctx.pointed, how: 'pointed' };
  const named = namedHit(ctx.items, utterance);
  if (named) return { kind: 'hit', item: named, how: 'name' };
  const num = numberHit(ctx.items, utterance, ctx.lastTouched ?? undefined);
  if (num && (ctx.numbersVisible || /\b\d{1,2}\b/.test(utterance))) {
    return { kind: 'hit', item: num, how: 'number' };
  }
  if (ctx.lastTouched && (deictic || !named)) {
    if (deictic) return { kind: 'hit', item: ctx.lastTouched, how: 'last' };
  }
  if (deictic || wantsNumbers(utterance)) {
    const candidates = numberOverlays(ctx.items).map((o) => ctx.items.find((i) => i.id === o.id)!).filter(Boolean);
    if (candidates.length > 1) {
      return { kind: 'ask', prompt: 'Which one? Say a number', candidates };
    }
    if (candidates.length === 1) return { kind: 'hit', item: candidates[0], how: 'snap' };
  }
  return { kind: 'ask', prompt: 'Which one? Say a number', candidates: ctx.items.filter((i) => i.kind !== 'none' && i.kind !== 'plan') };
}

export function kindLabel(kind: FocusKind): string {
  if (kind === 'view3d') return '3D view';
  if (kind === 'none') return 'nothing';
  if (kind === 'plan') return 'the plan';
  return kind;
}
