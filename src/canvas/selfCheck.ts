// SELF-CHECK: after a tile is built (normal plan keep) or morphed (pinch-hold
// splice), dump its rendered structure as text, replay a dry-run tap on every
// control through the SAME dispatch path real hands/mouse use (handPointer's
// collectControls / createHandPointer, no camera), and assert the tile is
// sound: the right number of controls, each reachable, non-overlapping,
// labelled, and wired. One failed check gets at most one Gemini fix pass —
// never a loop. This is our own small TS module, not the Rust Rune framework.
import {
  collectControls, controlLabel, createHandPointer, deepElementFromPoint, interactiveAncestor,
  type HandPointer, type Rect,
} from './handPointer';
import type { TileSpec } from './surfacePlan';

export interface ControlDump { id: string; kind: string; label: string; rect: Rect; el: HTMLElement }
export interface TileDump { role: string; label: string; rect: Rect; controls: ControlDump[] }

/** Walks up parentElement, crossing into the host of an open shadow root —
 *  the same climb interactiveAncestor uses — so a tile's own shadow-DOM
 *  controls (an A2UI custom element) still count as "inside" it. */
function hostContains(host: HTMLElement, el: HTMLElement): boolean {
  let node: Element | null = el;
  while (node) {
    if (node === host) return true;
    node = node.parentElement ?? ((node.getRootNode() as ShadowRoot).host as Element | null) ?? null;
  }
  return false;
}

/** The tile's rendered structure: its own rect/role/label, and every usable
 *  control inside it (collectControls already crosses shadow roots). */
export function dumpTile(host: HTMLElement, doc: Document = document): TileDump {
  const rect = host.getBoundingClientRect();
  const role = host.getAttribute('role') || host.tagName.toLowerCase();
  const label = host.getAttribute('aria-label') || host.getAttribute('data-mc-tile') || role;
  // ignoreViewport: a sound tile below the fold used to look like it had
  // zero buttons, because collectControls clips anything off-screen.
  const controls = collectControls(doc, { ignoreViewport: true })
    .filter((el) => hostContains(host, el))
    .map((el, i) => ({
      id: el.id || el.getAttribute('data-action') || `${el.tagName.toLowerCase()}-${i}`,
      kind: el.tagName.toLowerCase(),
      label: controlLabel(el),
      rect: el.getBoundingClientRect(),
      el,
    }));
  return { role, label, rect, controls };
}

const r1 = (n: number) => Math.round(n);

/** Compact text dump — what gets streamed to the terminals and, on a
 *  failure, sent to Gemini alongside the corrective prompt. */
export function dumpText(dump: TileDump): string {
  const rectStr = (r: Rect) => `${r1(r.left)},${r1(r.top)} ${r1(r.width)}x${r1(r.height)}`;
  const lines = [`tile ${dump.role} "${dump.label}" @${rectStr(dump.rect)}`];
  dump.controls.forEach((c) => lines.push(`  control ${c.kind}#${c.id} "${c.label}" @${rectStr(c.rect)}`));
  return lines.join('\n');
}

export type SelfCheckFailure =
  | { kind: 'missing-control'; detail: string }
  | { kind: 'unreachable'; id: string }
  | { kind: 'overlap'; a: string; b: string }
  | { kind: 'empty-label'; id: string }
  | { kind: 'unwired'; id: string };

export function failureLine(f: SelfCheckFailure): string {
  switch (f.kind) {
    case 'missing-control': return `missing control: ${f.detail}`;
    case 'unreachable': return `unreachable control: ${f.id}`;
    case 'overlap': return `overlapping controls: ${f.a} / ${f.b}`;
    case 'empty-label': return `empty label: ${f.id}`;
    case 'unwired': return `tap on ${f.id} did not register`;
  }
}

/** How many real controls a tile's own schema implies — the "missing
 *  control" check compares this against what actually rendered. Mirrors the
 *  Tile grammar in aiTurn.ts's TILE_SCHEMA_LINE. */
export function expectedControlCount(spec: TileSpec): number {
  switch (spec.type) {
    case 'lamp': case 'switch': case 'music': case 'scene': case 'connect':
      return 1;
    case 'form':
      return spec.fields.length + 1; // one control per field, plus Submit
    case 'table':
      return spec.rowActionLabel ? spec.rows.length : 0;
    // 'plan' has no onXxx action in its catalogApi schema, unlike every
    // other case above — it embeds a self-contained mini CAD surface with
    // its own interaction model, not a single semantic HTML control, so
    // (like stat/chart) the self-check has nothing to require here.
    case 'stat': case 'chart': case 'plan':
      return 0;
    case 'visual':
      return (spec.markup.match(/data-action/g) ?? []).length;
    case 'row': case 'grid': case 'card':
      return spec.children.reduce((n, c) => n + expectedControlCount(c), 0);
    case 'tabs':
      return spec.tabs.reduce((n, t) => n + t.children.reduce((m, c) => m + expectedControlCount(c), 0), 0);
    case 'split':
      return [...spec.first, ...spec.second].reduce((n, c) => n + expectedControlCount(c), 0);
    default:
      return 0;
  }
}

export function assertControlCount(dump: TileDump, spec: TileSpec): SelfCheckFailure[] {
  const expected = expectedControlCount(spec);
  return dump.controls.length < expected
    ? [{ kind: 'missing-control', detail: `expected at least ${expected}, found ${dump.controls.length}` }]
    : [];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Reachable = its centre sits inside both the tile's own bounds and the
 *  viewport, AND a hit-test there (the same deep-shadow walk collectControls
 *  uses) resolves back to this same control. */
export function assertReachable(dump: TileDump, doc: Document = document): SelfCheckFailure[] {
  const out: SelfCheckFailure[] = [];
  const vw = typeof innerWidth !== 'undefined' ? innerWidth : Infinity;
  const vh = typeof innerHeight !== 'undefined' ? innerHeight : Infinity;
  for (const c of dump.controls) {
    const cx = c.rect.left + c.rect.width / 2;
    const cy = c.rect.top + c.rect.height / 2;
    const insideTile = cx >= dump.rect.left - 1 && cx <= dump.rect.left + dump.rect.width + 1 &&
      cy >= dump.rect.top - 1 && cy <= dump.rect.top + dump.rect.height + 1;
    const insideViewport = cx >= 0 && cx <= vw && cy >= 0 && cy <= vh;
    // Shadow-DOM buttons aren't in the host's light tree, so Node.contains
    // can't be used alone — hostContains already crosses shadow roots.
    const hitEl = interactiveAncestor(deepElementFromPoint(doc, clamp(cx, 0, Math.max(0, vw - 1)), clamp(cy, 0, Math.max(0, vh - 1))));
    const hit = !!(hitEl && (hitEl === c.el || c.el.contains(hitEl) || hitEl.contains(c.el) || hostContains(c.el, hitEl) || hostContains(hitEl, c.el)));
    // Off-viewport but still inside the tile: the board is taller than the
    // window, not a broken control. Only demand a hit-test when on screen.
    if (!insideTile || (insideViewport && !hit)) out.push({ kind: 'unreachable', id: c.id });
  }
  return out;
}

function rectsOverlap(a: Rect, b: Rect, tolerancePx = 2): boolean {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const top = Math.max(a.top, b.top);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  return right - left > tolerancePx && bottom - top > tolerancePx;
}

export function assertNonOverlapping(dump: TileDump): SelfCheckFailure[] {
  const out: SelfCheckFailure[] = [];
  const cs = dump.controls;
  for (let i = 0; i < cs.length; i++) {
    for (let j = i + 1; j < cs.length; j++) {
      if (rectsOverlap(cs[i].rect, cs[j].rect)) out.push({ kind: 'overlap', a: cs[i].id, b: cs[j].id });
    }
  }
  return out;
}

export function assertLabels(dump: TileDump): SelfCheckFailure[] {
  return dump.controls.filter((c) => !c.label.trim()).map((c) => ({ kind: 'empty-label' as const, id: c.id }));
}

export interface ReplayResult { id: string; activated: boolean }

/** Replays a tap/pinch on every control through handPointer's real
 *  pointAt/pinch dispatch, with its dry-run flag on so the click reaches the
 *  control and stops there — no real side effects. */
export function replayTaps(pointer: HandPointer, dump: TileDump): ReplayResult[] {
  return dump.controls.map((c) => {
    const cx = c.rect.left + c.rect.width / 2;
    const cy = c.rect.top + c.rect.height / 2;
    pointer.pointAt(cx, cy);
    pointer.pinch(true);
    pointer.pinch(false);
    return { id: c.id, activated: pointer.lastActivated === c.el };
  });
}

export function assertWired(replay: readonly ReplayResult[]): SelfCheckFailure[] {
  return replay.filter((r) => !r.activated).map((r) => ({ kind: 'unwired' as const, id: r.id }));
}

export interface CheckOutcome { ok: boolean; failures: SelfCheckFailure[]; dump: TileDump; replay: ReplayResult[] }

/** Dump + replay + every assertion, for one tile host. A fresh, short-lived
 *  dry-run hand pointer drives the replay, through the exact same dispatch
 *  code a real hand or mouse would — then is torn down immediately. */
export function checkTile(host: HTMLElement, spec: TileSpec, doc: Document = document): CheckOutcome {
  const dump = dumpTile(host, doc);
  if (expectedControlCount(spec) === 0) {
    return { ok: true, failures: [], dump: { ...dump, controls: [] }, replay: [] };
  }
  const pointer = createHandPointer(doc, { dryRun: true });
  const replay = replayTaps(pointer, dump);
  pointer.destroy();
  const failures: SelfCheckFailure[] = [
    ...assertControlCount(dump, spec),
    ...assertReachable(dump, doc),
    ...assertNonOverlapping(dump),
    ...assertLabels(dump),
    ...assertWired(replay),
  ];
  return { ok: failures.length === 0, failures, dump, replay };
}

/** "self-check: 4 controls, tap replay ok, 0 overlaps" — one terminal line. */
export function statusLine(outcome: CheckOutcome): string {
  const n = outcome.dump.controls.length;
  const overlaps = outcome.failures.filter((f) => f.kind === 'overlap').length;
  const replayOk = outcome.failures.every((f) => f.kind !== 'unwired');
  return `self-check: ${n} control${n === 1 ? '' : 's'}, tap replay ${replayOk ? 'ok' : 'failed'}, ${overlaps} overlap${overlaps === 1 ? '' : 's'}`;
}

/** The one-shot fix prompt: the text dump plus exactly what failed. */
export function buildFixPrompt(dump: TileDump, failures: readonly SelfCheckFailure[], spec: TileSpec): string {
  return [
    'A rendered tile failed an automated self-check. Reply with JSON only: the corrected tile, same "type" as the original.',
    `Original tile: ${JSON.stringify(spec)}`,
    'Rendered structure:',
    dumpText(dump),
    'Problems found:',
    ...failures.map((f) => `- ${failureLine(f)}`),
  ].join('\n');
}

/** Deterministic ?sim=1 / offline fallback: honest — our own tiles already
 *  pass, so there is nothing to fabricate a fix for; a seeded failure in the
 *  demo stays failed once, which is itself the honest "still failing" beat. */
export function scriptedFixJson(spec: TileSpec): string {
  return JSON.stringify(spec);
}

/** Pairs enumerateMorphTiles-style entries (container and leaf, in pre-order)
 *  with the host elements a render pass just produced in the same order,
 *  keeping only the ones matching `wantPath` (or every top-level entry when
 *  omitted) that actually rendered — the gate that decides whether a tile
 *  gets self-checked at all. */
export function selectSelfCheckTargets<E extends { path: number[] }>(
  entries: readonly E[],
  hosts: readonly (HTMLElement | undefined | null)[],
  wantPath?: number[],
): Array<E & { host: HTMLElement }> {
  const out: Array<E & { host: HTMLElement }> = [];
  entries.forEach((entry, i) => {
    const want = wantPath
      ? entry.path.length === wantPath.length && entry.path.every((v, j) => v === wantPath[j])
      : entry.path.length === 1;
    const host = hosts[i];
    if (want && host) out.push({ ...entry, host });
  });
  return out;
}

/** Defers `run` until any renders a Lit/A2UI surface just queued (its own,
 *  and every nested tile's — always scheduled via microtasks, however many
 *  levels deep) have actually flushed. The JS microtask queue always drains
 *  completely before the next macrotask runs, regardless of how many levels
 *  of nested `requestUpdate` chained into more microtasks, so waiting one
 *  macrotask tick (the default schedule) is enough no matter the tile tree's
 *  depth — unlike calling `run` synchronously right after kicking off the
 *  render, which is what left the self-check mark never actually running. */
export function afterTilesRendered(run: () => void, schedule: (cb: () => void) => void = (cb) => setTimeout(cb, 0)): void {
  schedule(run);
}

/** afterTilesRendered, then two animation frames so layout (scroll, flex,
 *  measure) has settled before dump/assert — a setTimeout(0) flush is
 *  enough for Lit to exist, but controls can still sit at a stale rect
 *  for a frame, which made a sound on-screen lamp look unreachable. */
export function waitForLayout(run: () => void, schedule?: (cb: () => void) => void): void {
  const raf = typeof requestAnimationFrame === 'function'
    ? (cb: () => void) => { requestAnimationFrame(cb); }
    : (cb: () => void) => { setTimeout(cb, 16); };
  afterTilesRendered(() => raf(() => raf(run)), schedule);
}

export type SelfCheckState = 'checking' | 'passed' | 'warning';

export interface SelfCheckBadge { setState(s: SelfCheckState): void; remove(): void }

/** Warm-paper checking mark: amber while checking, sage once passed, a
 *  restrained warning colour if it still fails after the one fix pass. No
 *  new colours — reuses the app's existing --action/--accent/--danger vars. */
export function mountSelfCheckBadge(host: HTMLElement, doc: Document = document): SelfCheckBadge {
  const el = doc.createElement('div');
  el.className = 'mc-self-check is-checking';
  el.setAttribute('aria-hidden', 'true');
  const r = host.getBoundingClientRect();
  el.style.left = `${r.left + r.width - 12}px`;
  el.style.top = `${r.top - 2}px`;
  doc.body.append(el);
  return {
    setState(s) { el.className = `mc-self-check is-${s}`; },
    remove() { el.remove(); },
  };
}

export interface SelfCheckLog { (engine: 'nano' | 'gemini', verb: string, detail: string): void }

export interface SelfCheckDeps {
  host: HTMLElement;
  spec: TileSpec;
  /** The tile's own stable id (the same one enumerateMorphTiles/
   *  selectSelfCheckTargets use, e.g. "lamp-wiz-desk") — lets a re-check of
   *  the SAME tile (after a drag/resize commit, a morph, another build)
   *  replace its own corner mark instead of leaving the old one in the DOM:
   *  without this, `.mc-self-check` marks pile up one per check, and
   *  `document.querySelector('.mc-self-check')` always finds the FIRST
   *  (oldest, stale-position) one — which is why the mark looked like it
   *  never followed a dragged tile. */
  tileId: string;
  doc?: Document;
  log: SelfCheckLog;
  now?: () => number;
  /** Ask Gemini to fix the tile; returns its raw reply text. Omit to skip the
   *  fix pass entirely (the tile just gets the warning mark). */
  requestFix?: (prompt: string) => Promise<string>;
  /** Parse, validate and splice the reply back in; returns the new tile's
   *  host element (for the re-check) or null if it could not be applied. */
  applyFix?: (rawReply: string) => Promise<HTMLElement | null> | HTMLElement | null;
  /** Restore the last good tile if the one-shot fix applied but the
   *  re-check still failed — never leave a worse state on the canvas. */
  rollbackFix?: () => Promise<HTMLElement | null> | HTMLElement | null;
  /** Commit the applied fix to undo history only after the re-check
   *  passed — a rolled-back attempt must not become an Undo step. */
  commitFix?: () => void;
  /** Human gate: return false to skip applying a fix that would change the
   *  tile (Reject / Ask else). A no-op or identical reply may be auto-true. */
  confirmFix?: (rawReply: string) => Promise<boolean> | boolean;
}

export interface SelfCheckStat { label: string; dumpReplayMs: number; fixPassS: number | null; passed: boolean }

/** Every self-check run this session — window.__mcSelfCheck.stats reads the
 *  same array, so a report script and a console line agree. */
export const selfCheckStats: SelfCheckStat[] = [];

if (typeof window !== 'undefined') {
  (window as unknown as { __mcSelfCheck?: { stats: SelfCheckStat[] } }).__mcSelfCheck = { stats: selfCheckStats };
}

/** One live corner mark per tile id — see SelfCheckDeps.tileId. */
const badgesByTileId = new Map<string, SelfCheckBadge>();


/** Scroll `host` into view for a dump/replay that needs on-screen hit-testing,
 *  then restore every scrollable ancestor so the canvas does not jump to the
 *  last tile mid-demo. */
export function withScrolledIntoView<T>(host: HTMLElement, run: () => T): T {
  if (typeof host.scrollIntoView !== 'function') return run();
  const snaps: Array<{ el: Element; top: number; left: number }> = [];
  try {
    let cur: Element | null = host;
    while (cur) {
      snaps.push({ el: cur, top: cur.scrollTop || 0, left: cur.scrollLeft || 0 });
      cur = cur.parentElement;
    }
    const se = host.ownerDocument?.scrollingElement;
    if (se && !snaps.some((s) => s.el === se)) snaps.push({ el: se, top: se.scrollTop || 0, left: se.scrollLeft || 0 });
    try { host.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch { /* jsdom */ }
    return run();
  } finally {
    for (const s of snaps) {
      try { (s.el as HTMLElement).scrollTop = s.top; (s.el as HTMLElement).scrollLeft = s.left; } catch { /* ignore */ }
    }
  }
}

/** The whole lifecycle for one tile: checking mark up immediately, dump +
 *  replay + assert, mark passed/warning — and if it failed, at most ONE
 *  Gemini fix pass, re-checked once, never looped. */
export async function runSelfCheck(deps: SelfCheckDeps): Promise<SelfCheckStat> {
  const doc = deps.doc ?? document;
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const logBoth = (detail: string): void => { deps.log('nano', 'note', detail); deps.log('gemini', 'note', detail); };
  badgesByTileId.get(deps.tileId)?.remove();
  const t0 = now();
  let outcome = withScrolledIntoView(deps.host, () => checkTile(deps.host, deps.spec, doc));
  let badge = mountSelfCheckBadge(deps.host, doc);
  badgesByTileId.set(deps.tileId, badge);
  const dumpReplayMs = now() - t0;
  const label = outcome.dump.label;
  logBoth(statusLine(outcome));
  let fixPassS: number | null = null;
  if (outcome.ok) {
    badge.setState('passed');
  } else if (deps.requestFix && deps.applyFix) {
    logBoth(`self-check: ${outcome.failures.length} problem${outcome.failures.length === 1 ? '' : 's'} — ${outcome.failures.map(failureLine).join('; ')}`);
    const tf0 = now();
    try {
      const reply = await deps.requestFix(buildFixPrompt(outcome.dump, outcome.failures, deps.spec));
      if (deps.confirmFix && !(await deps.confirmFix(reply))) {
        fixPassS = (now() - tf0) / 1000;
        badge.setState('warning');
        logBoth('self-check: fix declined — last good tile kept');
        const stat: SelfCheckStat = { label, dumpReplayMs, fixPassS, passed: false };
        selfCheckStats.push(stat);
        return stat;
      }
      const newHost = await deps.applyFix(reply);
      fixPassS = (now() - tf0) / 1000;
      if (newHost) {
        badge.remove();
        outcome = withScrolledIntoView(newHost, () => checkTile(newHost, deps.spec, doc));
        badge = mountSelfCheckBadge(newHost, doc);
        badgesByTileId.set(deps.tileId, badge);
        if (outcome.ok) {
          badge.setState('passed');
          deps.commitFix?.();
          logBoth(`self-check: fix verified in ${fixPassS.toFixed(2)}s, 0 problems`);
        } else {
          let restored: HTMLElement | null = null;
          if (deps.rollbackFix) {
            try { restored = await deps.rollbackFix(); } catch { restored = null; }
          }
          if (restored) {
            badge.remove();
            outcome = withScrolledIntoView(restored, () => checkTile(restored, deps.spec, doc));
            badge = mountSelfCheckBadge(restored, doc);
            badgesByTileId.set(deps.tileId, badge);
          }
          badge.setState('warning');
          logBoth(restored
            ? `self-check: still ${outcome.failures.length || 'some'} problem${(outcome.failures.length || 1) === 1 ? '' : 's'} after one fix — restored the last good tile`
            : `self-check: still ${outcome.failures.length} problem${outcome.failures.length === 1 ? '' : 's'} after one fix — leaving it up`);
          // A rolled-back tile is still a warning if it failed originally;
          // outcome.ok may be false on the restored (original) tile too.
          outcome = { ...outcome, ok: false };
        }
      } else {
        badge.setState('warning');
        logBoth('self-check: fix pass did not apply — leaving it up');
      }
    } catch {
      fixPassS = (now() - tf0) / 1000;
      let restored: HTMLElement | null = null;
      if (deps.rollbackFix) {
        try { restored = await deps.rollbackFix(); } catch { restored = null; }
      }
      if (restored) {
        badge.remove();
        badge = mountSelfCheckBadge(restored, doc);
        badgesByTileId.set(deps.tileId, badge);
      }
      badge.setState('warning');
      logBoth(restored
        ? 'self-check: fix pass failed — restored the last good tile'
        : 'self-check: fix pass failed — leaving it up');
    }
  } else {
    badge.setState('warning');
  }
  const stat: SelfCheckStat = { label, dumpReplayMs, fixPassS, passed: outcome.ok };
  selfCheckStats.push(stat);
  if (typeof console !== 'undefined') {
    console.log(`[self-check] ${label} dumpReplayMs=${dumpReplayMs.toFixed(1)} fixPassS=${fixPassS === null ? '-' : fixPassS.toFixed(2)} passed=${outcome.ok}`);
  }
  return stat;
}
