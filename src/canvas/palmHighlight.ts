// OPEN-PALM HIGHLIGHT (design 26 Nov): no free cursor for pressing. While an
// open palm is tracked (and no fist drag / pan runs) a highlight snaps to the
// nearest visible, enabled button or chip; a right thumbs-up held 2 s presses
// it (gestureBindings), and a fist tap clicks it as a backup.
//
//  - Sticky: the highlight moves to another target only when that one is
//    clearly closer (switchMarginPx and switchRatio), so a jittery palm never
//    flickers between neighbours.
//  - Slower where targets are dense: the palm's motion is scaled down
//    (denseGain) near a crowd, so small targets are easier to land on.
//  - A crowded group (≥ crowdMin targets within crowdPx) hovered with an
//    OPEN palm for the whole expandAfterMs magnifies into a spaced row; the palm then moves across
//    that row, and pressing a row slot presses the real button.
//
// The core is pure (rects in, choice out) and unit-tested; the DOM wrapper
// below draws the ring, the large name label and the magnified row.

import type { Pt } from '../input/handLogic';
import { collectControls, distToRect, mapToScreen } from './handPointer';
import { palmCenter, type ReachBox } from './handFeel';
import { handIconSvg } from './gestureIcons';
import type { HighlightHook } from './gestureControl';
import { nameOf } from './gestureControl';

export interface Rect { left: number; top: number; width: number; height: number }
export interface HighlightTarget<T> { item: T; rect: Rect }

export interface HighlightConfig {
  /** Only targets within this many px (rect edge) of the palm can be picked. */
  capturePx: number;
  /** Switch only when the new target scores this many px better… */
  switchMarginPx: number;
  /** …and at least this fraction better than the current one. */
  switchRatio: number;
  /** Density: targets within this radius of the palm slow it down. */
  denseRadiusPx: number;
  /** Palm gain with ≥3 / 2 targets that close (1 = no slow-down). */
  denseGain3: number;
  denseGain2: number;
  /** Per frame, the effective point eases back toward the palm (sparse areas only). */
  leak: number;
  /** A crowd: at least crowdMin targets within crowdPx of the palm… */
  crowdPx: number;
  crowdMin: number;
  /** …hovered this long (same highlight) magnifies into a spaced row. */
  expandAfterMs: number;
  /** The magnified row: slot size, gap, max slots. */
  slotW: number;
  slotH: number;
  slotGap: number;
  maxSlots: number;
  /** Leaving the row by more than this collapses it. */
  exitPx: number;
}

export const PALM_HIGHLIGHT: HighlightConfig = {
  capturePx: 160,
  switchMarginPx: 24,
  switchRatio: 0.25,
  denseRadiusPx: 80,
  denseGain3: 0.55,
  denseGain2: 0.8,
  leak: 0.12,
  crowdPx: 48,
  crowdMin: 4,
  expandAfterMs: 500,
  slotW: 168,
  slotH: 76,
  slotGap: 32,
  maxSlots: 6,
  exitPx: 110,
};

export interface HighlightView<T> {
  current: T | null;
  /** The effective (gain-adjusted) point the palm is at. */
  point: Pt | null;
  /** The current target's rect on screen (its slot while magnified). */
  rect: Rect | null;
  expanded: { items: T[]; slots: Rect[]; row: Rect } | null;
}

const centre = (r: Rect): Pt => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
/** Edge distance plus a quarter of the centre distance: inside a rect, being
 *  nearer its middle still counts, so two touching buttons hand over cleanly. */
export function targetScore(p: Pt, r: Rect): number {
  const c = centre(r);
  return distToRect(p, r) + 0.25 * Math.hypot(p.x - c.x, p.y - c.y);
}

export interface HighlightCore<T> {
  /** `open`: the palm is an open palm (a loose hand still moves the
   *  highlight, but only an open palm held still can magnify a crowd). */
  update(p: Pt | null, targets: readonly HighlightTarget<T>[], now: number, viewport?: { w: number; h: number }, open?: boolean): HighlightView<T>;
  /** The pointer is directly over this control: highlight it (ring and
   *  cursor never disagree). Collapses a magnified row. */
  adopt(item: T): void;
  reset(): void;
  readonly view: HighlightView<T>;
}

export function createHighlightCore<T>(cfg: Partial<HighlightConfig> = {}): HighlightCore<T> {
  const c: HighlightConfig = { ...PALM_HIGHLIGHT, ...cfg };
  let current: T | null = null;
  let eff: Pt | null = null;
  let prevRaw: Pt | null = null;
  let resumed = false;
  let crowdSince: number | null = null;
  let expanded: HighlightView<T>['expanded'] = null;
  let view: HighlightView<T> = { current: null, point: null, rect: null, expanded: null };

  function pick(p: Pt, cands: readonly HighlightTarget<T>[]): T | null {
    let best: HighlightTarget<T> | null = null;
    let bestScore = Infinity;
    for (const t of cands) {
      if (distToRect(p, t.rect) > c.capturePx) continue;
      const s = targetScore(p, t.rect);
      if (s < bestScore) { best = t; bestScore = s; }
    }
    const cur = current === null ? undefined : cands.find((t) => t.item === current);
    if (!best) return null;
    if (!cur || distToRect(p, cur.rect) > c.capturePx) return best.item;
    if (best.item === current) return current;
    const curScore = targetScore(p, cur.rect);
    return bestScore <= curScore - Math.max(c.switchMarginPx, c.switchRatio * curScore) ? best.item : current;
  }

  function layoutRow(items: HighlightTarget<T>[], vp: { w: number; h: number }): { slots: Rect[]; row: Rect } {
    const n = items.length;
    const width = n * c.slotW + (n - 1) * c.slotGap;
    const cx = items.reduce((a, t) => a + centre(t.rect).x, 0) / n;
    const cy = items.reduce((a, t) => a + centre(t.rect).y, 0) / n;
    const left = Math.max(16, Math.min(vp.w - 16 - width, cx - width / 2));
    const top = Math.max(16, Math.min(vp.h - 16 - c.slotH, cy - c.slotH / 2));
    const slots = items.map((_, i) => ({ left: left + i * (c.slotW + c.slotGap), top, width: c.slotW, height: c.slotH }));
    return { slots, row: { left, top, width, height: c.slotH } };
  }

  function rectOf(item: T | null, targets: readonly HighlightTarget<T>[]): Rect | null {
    if (item === null) return null;
    if (expanded) { const i = expanded.items.indexOf(item); return i >= 0 ? expanded.slots[i] : null; }
    return targets.find((t) => t.item === item)?.rect ?? null;
  }

  function update(p: Pt | null, targets: readonly HighlightTarget<T>[], now: number, viewport = { w: Infinity, h: Infinity }, open = true): HighlightView<T> {
    // A target that left the screen is dropped (and a row whose buttons went).
    if (expanded && !expanded.items.every((it) => targets.some((t) => t.item === it))) { expanded = null; crowdSince = null; }
    if (current !== null && !expanded && !targets.some((t) => t.item === current)) { current = null; crowdSince = null; }

    if (!p) {
      // No open palm this frame (a thumbs-up forming, a fist tap): freeze.
      if (prevRaw) resumed = true;
      view = { current, point: eff, rect: rectOf(current, targets), expanded };
      return view;
    }
    // Effective point: relative motion, slowed near a crowd.
    if (!eff || !prevRaw) {
      eff = { ...p };
    } else if (resumed) {
      resumed = false; // re-anchor: the hand moved while it wasn't open
    } else {
      const dx = p.x - prevRaw.x, dy = p.y - prevRaw.y;
      const near = expanded ? 0 : targets.filter((t) => distToRect(eff!, t.rect) <= c.denseRadiusPx).length;
      const gain = near >= 3 ? c.denseGain3 : near === 2 ? c.denseGain2 : 1;
      eff = { x: eff.x + dx * gain, y: eff.y + dy * gain };
      if (!expanded && gain === 1) eff = { x: eff.x + (p.x - eff.x) * c.leak, y: eff.y + (p.y - eff.y) * c.leak };
    }
    prevRaw = { ...p };
    eff = { x: Math.max(0, Math.min(viewport.w, eff.x)), y: Math.max(0, Math.min(viewport.h, eff.y)) };

    if (expanded) {
      if (distToRect(eff, expanded.row) > c.exitPx) {
        // Left the row: back to the real buttons, from where the hand is.
        expanded = null; crowdSince = null; eff = { ...p };
      } else {
        const slots = expanded.items.map((item, i) => ({ item, rect: expanded!.slots[i] }));
        // Inside the row every slot is in reach: nearest slot, same hysteresis.
        current = pick(eff, slots) ?? current;
        view = { current, point: eff, rect: rectOf(current, targets), expanded };
        return view;
      }
    }

    const prev = current;
    current = pick(eff, targets);
    if (current !== prev) crowdSince = null;
    if (current !== null && open) {
      const crowd = targets.filter((t) => distToRect(eff!, t.rect) <= c.crowdPx);
      if (crowd.length >= c.crowdMin) {
        if (crowdSince === null) crowdSince = now;
        if (now - crowdSince >= c.expandAfterMs && Number.isFinite(viewport.w)) {
          const group = crowd
            .slice()
            .sort((a, b) => targetScore(eff!, a.rect) - targetScore(eff!, b.rect))
            .slice(0, c.maxSlots)
            .sort((a, b) => centre(a.rect).x - centre(b.rect).x || centre(a.rect).y - centre(b.rect).y);
          if (!group.some((t) => t.item === current)) group[group.length - 1] = targets.find((t) => t.item === current)!;
          const { slots, row } = layoutRow(group, viewport);
          expanded = { items: group.map((t) => t.item), slots, row };
          const i = expanded.items.indexOf(current);
          eff = centre(slots[i]); // the palm continues from the highlighted slot
        }
      } else crowdSince = null;
    } else crowdSince = null;
    view = { current, point: eff, rect: rectOf(current, targets), expanded };
    return view;
  }

  return {
    update,
    adopt(item) {
      if (current === item && !expanded) return;
      current = item; expanded = null; crowdSince = null;
    },
    reset() {
      current = null; eff = null; prevRaw = null; resumed = false; crowdSince = null; expanded = null;
      view = { current: null, point: null, rect: null, expanded: null };
    },
    get view() { return view; },
  };
}

// ---------------------------------------------------------------- DOM

export interface PalmHighlightOptions {
  root: HTMLElement;
  /** Reach box (camera units → the full screen), as the hand pointer uses. */
  reach?: () => ReachBox;
  /** Hands gone this long → the highlight clears. */
  lostMs?: number;
  config?: Partial<HighlightConfig>;
}

/** Button-like controls only: no text fields, sliders or our own layers. */
function highlightable(el: HTMLElement): boolean {
  if (el.closest('.mc-gesture-layer, .mc-highlight-layer')) return false;
  if (el.matches('input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio]), textarea, select')) return false;
  return true;
}

/** The pointer honours the highlight only this long after the last frame
 *  in which the palm drove it (so a fist tap right after aiming works, but a
 *  stale highlight never steals a click). */
export const HIGHLIGHT_FORCE_MS = 300;

export function createPalmHighlight(opts: PalmHighlightOptions): HighlightHook & {
  view(): HighlightView<HTMLElement>;
  core: HighlightCore<HTMLElement>;
  /** For handPointer.targetOverride: the highlight, while fresh. */
  forced(now: number): HTMLElement | null;
} {
  const { root } = opts;
  const doc = root.ownerDocument;
  const core = createHighlightCore<HTMLElement>(opts.config);
  const lostMs = opts.lostMs ?? 1200;
  let active = false;
  let lastHandAt = -Infinity;
  let lastPalmAt = -Infinity;
  let smooth: Pt | null = null;
  let targets: HighlightTarget<HTMLElement>[] = [];
  let targetsAt = -Infinity;

  const layer = doc.createElement('div');
  layer.className = 'mc-highlight-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;
  const ring = doc.createElement('div');
  ring.className = 'mc-highlight-ring';
  const label = doc.createElement('div');
  label.className = 'mc-highlight-label';
  const rowEl = doc.createElement('div');
  rowEl.className = 'mc-highlight-row';
  rowEl.hidden = true;
  layer.append(rowEl, ring, label);
  root.append(layer);
  const hint = handIconSvg('thumbsUp');

  function refreshTargets(now: number, force = false): void {
    if (!force && now - targetsAt < 250) return;
    targetsAt = now;
    targets = collectControls(doc).filter(highlightable).map((el) => {
      const r = el.getBoundingClientRect();
      return { item: el, rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
    });
  }

  let shownRow = '';
  function render(v: HighlightView<HTMLElement>): void {
    const show = active && !!v.current && !!v.rect;
    layer.hidden = !show;
    if (!show) { shownRow = ''; rowEl.hidden = true; rowEl.innerHTML = ''; return; }
    const r = v.rect!;
    ring.style.transform = `translate(${r.left - 6}px, ${r.top - 6}px)`;
    ring.style.width = `${r.width + 12}px`;
    ring.style.height = `${r.height + 12}px`;
    const name = nameOf(v.current) || 'this';
    if (label.dataset.name !== name) {
      label.dataset.name = name;
      label.innerHTML = `<span class="mc-highlight-name"></span><span class="mc-highlight-how">${hint}<span>R · hold 2 s</span></span>`;
      label.querySelector('.mc-highlight-name')!.textContent = name;
    }
    const below = r.top < 90;
    label.classList.toggle('below', below);
    label.style.transform = `translate(${Math.round(r.left + r.width / 2)}px, ${Math.round(below ? r.top + r.height + 14 : r.top - 14)}px)`;
    if (v.expanded) {
      const key = v.expanded.items.map((el) => nameOf(el)).join('|');
      if (key !== shownRow) {
        shownRow = key;
        rowEl.innerHTML = '';
        v.expanded.items.forEach((el, i) => {
          const s = doc.createElement('div');
          s.className = 'mc-highlight-slot';
          s.textContent = nameOf(el) || '•';
          const sr = v.expanded!.slots[i];
          s.style.transform = `translate(${sr.left}px, ${sr.top}px)`;
          s.style.width = `${sr.width}px`;
          s.style.height = `${sr.height}px`;
          rowEl.append(s);
        });
        const row = v.expanded.row;
        rowEl.style.setProperty('--row-left', `${row.left - 14}px`);
        rowEl.style.setProperty('--row-top', `${row.top - 14}px`);
        rowEl.style.setProperty('--row-w', `${row.width + 28}px`);
        rowEl.style.setProperty('--row-h', `${row.height + 28}px`);
      }
      rowEl.hidden = false;
      Array.from(rowEl.children).forEach((s, i) => s.classList.toggle('is-current', v.expanded!.items[i] === v.current));
    } else {
      shownRow = ''; rowEl.hidden = true; rowEl.innerHTML = '';
    }
  }

  function clear(): void {
    core.reset(); smooth = null; lastPalmAt = -Infinity; render(core.view);
  }

  return {
    update(openPalm, now, ctx) {
      if (!active) return;
      if (ctx.blocked) { clear(); return; }
      if (ctx.anyHand) lastHandAt = now;
      else if (now - lastHandAt > lostMs) { if (core.view.current) clear(); return; }
      refreshTargets(now);
      // The cursor is directly on a control the highlight isn't on: adopt it.
      if (openPalm && ctx.direct && !core.view.expanded && ctx.direct !== core.view.current && highlightable(ctx.direct)) core.adopt(ctx.direct);
      let p: Pt | null = null;
      if (openPalm) {
        lastPalmAt = now;
        // Selfie space → camera space → the same reach-box map the pointer uses.
        const pc = palmCenter(openPalm);
        const raw = mapToScreen({ x: 1 - pc.x, y: pc.y }, innerWidth, innerHeight, true, opts.reach?.());
        smooth = smooth ? { x: smooth.x + (raw.x - smooth.x) * 0.5, y: smooth.y + (raw.y - smooth.y) * 0.5 } : raw;
        p = smooth;
      }
      render(core.update(p, targets, now, { w: innerWidth, h: innerHeight }, ctx.open));
    },
    current: () => (active ? core.view.current : null),
    forced: (now) => (active && now - lastPalmAt <= HIGHLIGHT_FORCE_MS ? core.view.current : null),
    lost: clear,
    setActive(on) { active = on; if (!on) clear(); else refreshTargets(0, true); },
    destroy() { clear(); layer.remove(); },
    view: () => core.view,
    core,
  };
}
