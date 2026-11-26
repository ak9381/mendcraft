// LEVEL CONTROLS by gesture (design 26 Nov, Akash: "anything with a slider —
// can I not have a gesture?"): the peace-and-move gesture over a level
// control steps it instead of scrolling — move up = more, down = less, one
// step per LEVEL_STEP_PX of hand travel.
//
// Contract with the dashboard tiles (gesture-first lamp / speaker tiles):
//  - a level control carries `data-level="volume|brightness|temp"` (and may
//    carry `data-level-step`, `aria-valuenow` / `data-level-value`,
//    `aria-valuemin` / `aria-valuemax`);
//  - it contains its own step buttons `[data-level-inc]` / `[data-level-dec]`;
//    adjustLevel() CLICKS them — the tile's existing handlers run, no
//    parallel action path.
// Native `<input type=range>` (floor-plan tools…) is stepped with
// stepUp()/stepDown() plus the input + change events a user drag fires.

export const LEVEL_STEP_PX = 30;
const LEVEL_SELECTOR = '[data-level], input[type=range]';

const LABEL: Record<string, string> = { volume: 'Volume', brightness: 'Brightness', temp: 'Colour temperature' };

/** The level control at (or around) an element, crossing shadow roots. */
export function levelControlAt(start: Element | null): HTMLElement | null {
  let el: Element | null = start;
  while (el) {
    const hit = (el as Element & { closest?: (s: string) => Element | null }).closest?.(LEVEL_SELECTOR) ?? null;
    if (hit) return hit as HTMLElement;
    const root = el.getRootNode?.() as (ShadowRoot & { host?: Element }) | Document | undefined;
    el = root && 'host' in root && root.host ? root.host : null;
  }
  return null;
}

/** Step a level control once: +1 = more, −1 = less. True if it stepped. */
export function adjustLevel(el: HTMLElement, dir: 1 | -1): boolean {
  if ((el as HTMLInputElement).type === 'range' && el.tagName === 'INPUT') {
    const input = el as HTMLInputElement;
    if (input.disabled) return false;
    const before = input.value;
    try { if (dir > 0) input.stepUp(); else input.stepDown(); } catch { return false; }
    if (input.value === before) return false; // at the end of its range
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }
  const scope: ParentNode = (el.shadowRoot as ParentNode | null) ?? el;
  const btn = scope.querySelector<HTMLElement>(dir > 0 ? '[data-level-inc]' : '[data-level-dec]')
    ?? el.querySelector<HTMLElement>(dir > 0 ? '[data-level-inc]' : '[data-level-dec]');
  if (!btn || (btn as HTMLButtonElement).disabled || btn.getAttribute('aria-disabled') === 'true') return false;
  btn.click();
  return true;
}

/** "Volume 60 %" — the big readout near the hand. */
export function levelReadout(el: HTMLElement): string {
  const kind = el.getAttribute('data-level') ?? '';
  const name = LABEL[kind] ?? el.getAttribute('aria-label') ?? (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Level');
  let v: number | null = null, lo = 0, hi = 100;
  if ((el as HTMLInputElement).type === 'range') {
    const i = el as HTMLInputElement;
    v = Number(i.value); lo = Number(i.min || 0); hi = Number(i.max || 100);
  } else {
    const raw = el.getAttribute('aria-valuenow') ?? el.getAttribute('data-level-value');
    if (raw != null && raw !== '' && Number.isFinite(Number(raw))) v = Number(raw);
    lo = Number(el.getAttribute('aria-valuemin') ?? 0);
    hi = Number(el.getAttribute('aria-valuemax') ?? 100);
  }
  if (v === null) return name;
  if (kind === 'temp' && hi > 100) return `${name} ${Math.round(v)} K`;
  const pct = hi > lo ? Math.round(((v - lo) / (hi - lo)) * 100) : Math.round(v);
  return `${name} ${pct} %`;
}

/** Hysteresis for stepping back: a step taken at n·stepPx is only undone
 *  once the hand is back past n·stepPx − LEVEL_BACK_PX. */
export const LEVEL_BACK_PX = 15;
/** At most one step per this long — every step can be a real device command
 *  (a WiZ lamp), so a wobble must never become a burst. */
export const LEVEL_MIN_GAP_MS = 150;

export interface LevelStepper {
  /** `up`: smoothed hand travel UP since the gesture started (px). Returns the
   *  step to apply now (+1 / −1) or 0. */
  update(up: number, now: number): 1 | -1 | 0;
  readonly steps: number;
  reset(): void;
}

/** Steps a level from hand travel: one step per stepPx, hysteresis backPx
 *  for undoing a step, at most one step per minGapMs (it catches up while
 *  the hand stays past the next threshold). */
export function createLevelStepper(opts: { stepPx?: number; backPx?: number; minGapMs?: number } = {}): LevelStepper {
  const step = opts.stepPx ?? LEVEL_STEP_PX;
  const back = opts.backPx ?? LEVEL_BACK_PX;
  const gap = opts.minGapMs ?? LEVEL_MIN_GAP_MS;
  let n = 0;
  let lastAt = -Infinity;
  return {
    update(up, now) {
      if (now - lastAt < gap) return 0;
      const upAt = n >= 0 ? (n + 1) * step : n * step + back;
      const downAt = n <= 0 ? (n - 1) * step : n * step - back;
      if (up >= upAt) { n += 1; lastAt = now; return 1; }
      if (up <= downAt) { n -= 1; lastAt = now; return -1; }
      return 0;
    },
    get steps() { return n; },
    reset() { n = 0; lastAt = -Infinity; },
  };
}
