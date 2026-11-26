// Build cursors: small, labelled, colour-coded cursors on the canvas while a
// build turn runs. They only show what is really happening: ONE cursor for
// the model call this turn made, in that engine's colour, plus one cursor
// per tile the reply has actually produced so far (never more cursors than
// tiles, never a cursor for an engine that was not called). The pill says
// the same thing in words: "Nano · 1 call".
export type SwarmKind = 'gemini' | 'nano';
export type SwarmTask = 'dashboard' | 'floorplan' | 'kannada' | 'generic';

export interface SwarmAgentSpec {
  id: string;
  kind: SwarmKind;
  label: string;
  color: string;
  /** True for the cursor that stands for an actual model call; false for a
   *  tile cursor of that call. */
  real: boolean;
  /** Which board tile (0-based, matching the streamed plan's tile order)
   *  this cursor's "editing" phase lands on, if any. */
  tileIndex?: number;
}

export const REAL_CALL_CAP = 3;
// Warm-paper palette (no neon, no purple): two blue shades for Gemini,
// one green for Nano — matches the Gemini/Nano terminal accents.
const GEMINI_COLORS = ['#5A7BA6', '#7B9BC2'];
const NANO_COLOR = '#6B8F71';
const FLIGHT_MS = 1400;
/** A cursor stays on its tile this long after it lands, so a person can read
 *  the label and see which tile it filled before it leaves. */
export const LINGER_MS = 800;
/** Soonest a cursor can leave after it appears: its glide plus the linger. */
export const MIN_VISIBLE_MS = FLIGHT_MS + LINGER_MS;
/** The most tile cursors a turn ever shows (a plan has at most this many
 *  top-level tiles worth pointing at). */
export const MAX_TILE_CURSORS = 8;
/** Grid cells the cursors are laid out on — fixed, so a cursor that joins
 *  when a new tile arrives never moves the ones already placed. */
const SLOT_COUNT = 1 + MAX_TILE_CURSORS;

/** Pure, order-stable colour assignment: index N of a kind always gets the
 *  same colour for the same kind sequence. */
export function assignSwarmColor(kind: SwarmKind, indexWithinKind: number): string {
  if (kind === 'nano') return NANO_COLOR;
  return GEMINI_COLORS[indexWithinKind % GEMINI_COLORS.length];
}

export interface SwarmPlanInput {
  /** One entry per real model call this build turn makes. Truncated to
   *  REAL_CALL_CAP. */
  calls: { kind: SwarmKind; label: string }[];
  /** One entry per tile the call has really produced (or is editing). */
  subSteps: { kind: SwarmKind; label: string; tileIndex?: number }[];
}

export function buildSwarmAgents(input: SwarmPlanInput): SwarmAgentSpec[] {
  const calls = input.calls.slice(0, REAL_CALL_CAP);
  const seen: Record<SwarmKind, number> = { gemini: 0, nano: 0 };
  const next = (kind: SwarmKind): string => assignSwarmColor(kind, seen[kind]++);
  const agents: SwarmAgentSpec[] = calls.map((c, i) => ({
    id: `real-${i}`, kind: c.kind, label: c.label, color: next(c.kind), real: true,
  }));
  input.subSteps.forEach((s, i) => {
    agents.push({ id: `sub-${i}`, kind: s.kind, label: s.label, color: next(s.kind), real: false, tileIndex: s.tileIndex });
  });
  return agents;
}

const TASK_REAL_LABEL: Record<SwarmTask, Record<SwarmKind, string>> = {
  dashboard: { gemini: 'Gemini · board plan', nano: 'Nano · board draft' },
  floorplan: { gemini: 'Gemini · floor plan', nano: 'Nano · floor plan' },
  kannada: { gemini: 'Gemini · Kannada pack', nano: 'Nano · Kannada pack' },
  generic: { gemini: 'Gemini · reply', nano: 'Nano · reply' },
};

const ENGINE_NAME: Record<SwarmKind, string> = { gemini: 'Gemini', nano: 'Nano' };

export interface MixedSwarmOptions {
  /** Tiles the reply has really produced so far. 0 (the default) shows only
   *  the call's own cursor; capped at MAX_TILE_CURSORS. */
  tileCount?: number;
}

/** One tile cursor, in the engine that is really producing the tile. */
export function tileCursor(kind: SwarmKind, tileIndex: number): SwarmPlanInput['subSteps'][number] {
  return { kind, label: `${ENGINE_NAME[kind]} · tile ${tileIndex + 1}`, tileIndex };
}

/** The cursors for one real call by `realEngine`: the call itself, plus one
 *  per tile it has produced. Only that engine's cursors — a Nano call shows
 *  no Gemini cursor, a Gemini call shows no Nano cursor. */
export function buildMixedSwarmPlan(realEngine: SwarmKind, task: SwarmTask, opts: MixedSwarmOptions = {}): SwarmPlanInput {
  const tileCount = Math.max(0, Math.min(MAX_TILE_CURSORS, Math.floor(opts.tileCount ?? 0)));
  return {
    calls: [{ kind: realEngine, label: TASK_REAL_LABEL[task][realEngine] }],
    subSteps: Array.from({ length: tileCount }, (_, i) => tileCursor(realEngine, i)),
  };
}

/** What the cursors stand for, for the pill's tooltip. */
export function honestyNote(agents: SwarmAgentSpec[]): string {
  const real = agents.filter((a) => a.real).length;
  const tiles = agents.length - real;
  return `${real} model call${real === 1 ? '' : 's'}${tiles ? `; ${tiles} cursor${tiles === 1 ? '' : 's'} mark the tile${tiles === 1 ? '' : 's'} it has made so far` : ''}.`;
}

function formatBytesShort(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

/** The pill: which engine was really called, how many times, and what left.
 *  `gemini` / `nano` are REAL model calls — cursors are never counted. */
export function swarmPillText(s: { gemini: number; nano: number; bytes: number; simBytes?: number }): string {
  const calls = (name: string, n: number): string => (n ? `${name} · ${n} call${n === 1 ? '' : 's'}` : '');
  const who = [calls('Nano', s.nano), calls('Gemini', s.gemini)].filter(Boolean).join(' · ');
  const sim = s.simBytes ?? 0;
  // A SIM turn sent nothing: what it would send is labelled, never "to cloud".
  const bytes = sim > 0 && s.bytes <= 0 ? `SIM · would send ${formatBytesShort(sim)}`
    : `${formatBytesShort(s.bytes)} to cloud${sim > 0 ? ` · SIM · would send ${formatBytesShort(sim)}` : ''}`;
  return `${who ? `${who} · ` : ''}${bytes}`;
}

export interface SwarmPose { id: string; x: number; y: number; phase: 'flying' | 'editing' }

/** Tiny deterministic PRNG (mulberry32) so ?sim=1 always plays the same
 *  cursor moves for the same agent — safe to record on video. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic end slot for agent `index` of `total`: a grid cell spread
 *  across the board (not a random pile), with small per-agent jitter so
 *  cells don't look robotically aligned. Same seed+index+total always gives
 *  the same slot, and adjacent cells stay well separated. */
function gridSlot(index: number, total: number, seed: number): { x: number; y: number } {
  const cols = Math.max(1, Math.ceil(Math.sqrt(total)));
  const rows = Math.max(1, Math.ceil(total / cols));
  const col = index % cols;
  const row = Math.floor(index / cols) % rows;
  const jitter = mulberry32(seed + index * 104729);
  const cellW = 0.76 / cols;
  const cellH = 0.64 / rows;
  const jx = (jitter() - 0.5) * cellW * 0.3;
  const jy = (jitter() - 0.5) * cellH * 0.3;
  const x = 0.12 + cellW * (col + 0.5) + jx;
  const y = 0.18 + cellH * (row + 0.5) + jy;
  return { x: Math.max(0.05, Math.min(0.95, x)), y: Math.max(0.1, Math.min(0.9, y)) };
}

/** Deterministic position for one agent at elapsed time `tMs`: starts near
 *  a random edge, eases into its grid slot, then holds. Same seed + index +
 *  t always gives the same pose. */
export function poseAt(agent: SwarmAgentSpec, index: number, tMs: number, opts: { seed?: number; durationMs?: number; total?: number } = {}): SwarmPose {
  const durationMs = opts.durationMs ?? FLIGHT_MS;
  const seed = opts.seed ?? 1;
  const rand = mulberry32(seed + index * 7919);
  const sx = rand(); const sy = rand();
  const { x: ex, y: ey } = gridSlot(index, opts.total ?? 1, seed);
  const p = Math.max(0, Math.min(1, tMs / durationMs));
  const eased = 1 - Math.pow(1 - p, 3);
  return { id: agent.id, x: sx + (ex - sx) * eased, y: sy + (ey - sy) * eased, phase: p >= 1 ? 'editing' : 'flying' };
}

export interface SwarmLayer {
  start(input: SwarmPlanInput, seed?: number): void;
  /** The reply now holds `count` tiles: add a cursor for each new one (the
   *  cursors already placed stay where they are). `names[i]` labels tile i
   *  ("Nano · Lamp"). No-op when not running or already finishing. */
  setTiles(count: number, names?: readonly string[]): void;
  /** The real work is done. Cursors stay until the last tile has landed plus
   *  LINGER_MS (the call's own cursor at least MIN_VISIBLE_MS after it
   *  appeared), then the layer settles. Resolves true when it settled this way; false when
   *  it was cut short (a hard `settle()`, or a newer `start()`), in which case
   *  the caller must NOT settle: the layer now belongs to someone else. */
  finish(): Promise<boolean>;
  reportBytes(bytes: number, simBytes?: number): void;
  settle(): void;
  destroy(): void;
}

export interface SwarmLayerOptions {
  reducedMotion: boolean;
  doc?: Document;
  /** Injectable for tests; defaults to the real timers/RAF when present. */
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
  now?: () => number;
  /** Fired once per agent, the moment its cursor reaches its target tile
   *  (edge-triggered — never repeats for the same agent in one run). The
   *  host uses this to put the selection box / '+' crosshair on the real
   *  tile element, not on the cursor badge. */
  onReachTarget?: (tileIndex: number, kind: SwarmKind) => void;
  /** Optional cap on visible cursors per engine (default: one per agent, which
   *  is what the canvas uses). Over the cap an agent has no element but still
   *  counts in the pill and still lights its tile. */
  maxPerKind?: number;
  /** Where a visible cursor parks, as a fraction of the container: the tile
   *  it fills (`tileIndex`) or, with no tile, the board itself. null hides
   *  the cursor, so it never floats outside a board. Read every frame. */
  anchor?: (tileIndex: number | undefined) => { x: number; y: number } | null;
  /** Injectable timers (tests); default to the real ones. */
  timer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/** Mounts cursor elements into `container` and drives them with ONE shared
 *  rAF loop (never one loop per cursor). Cursors are `aria-hidden` and
 *  `pointer-events: none` so they never steal hand-pointer hit-testing; the
 *  pill is the single polite status a screen reader hears. */
export function createSwarmLayer(container: HTMLElement, opts: SwarmLayerOptions): SwarmLayer {
  const doc = opts.doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) throw new Error('createSwarmLayer needs a document');
  const raf = opts.raf ?? (typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : null);
  const caf = opts.caf ?? (typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : null);
  const now = opts.now ?? (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now());
  const timer = opts.timer ?? ((cb: () => void, ms: number): unknown => setTimeout(cb, ms));
  const clearTimer = opts.clearTimer ?? ((h: unknown): void => clearTimeout(h as ReturnType<typeof setTimeout>));
  /** How long after `born` a cursor is on its tile (reduced motion: at once). */
  const landMs = opts.reducedMotion ? 0 : FLIGHT_MS;

  container.setAttribute('aria-hidden', 'true');
  container.hidden = true;

  const pill = doc.createElement('p');
  pill.className = 'mc-swarm-pill';
  pill.setAttribute('role', 'status');
  pill.hidden = true;
  container.appendChild(pill);

  let agents: SwarmAgentSpec[] = [];
  /** The agents that currently have a cursor element. */
  let shown = new Set<string>();
  const els = new Map<string, HTMLElement>();
  /** When each cursor joined (ms on `now()`), so a late one flies in on its own clock. */
  const born = new Map<string, number>();
  let rafId: number | null = null;
  let seed = 1;
  let bytes = 0;
  let simBytes = 0;
  let reached = new Set<string>();
  let running = false;
  let finishing = false;
  /** When each cursor leaves (ms on `now()`); a call cursor has none until finish(). */
  const endAt = new Map<string, number>();
  const timers = new Set<unknown>();
  let finishDone: ((ok: boolean) => void) | null = null;

  function later(ms: number, cb: () => void): void {
    const h = timer(() => { timers.delete(h); cb(); }, Math.max(0, ms));
    timers.add(h);
  }
  function expire(id: string): void {
    els.get(id)?.remove();
    els.delete(id);
    shown.delete(id);
  }
  function leaveAt(id: string, at: number): void {
    endAt.set(id, at);
    later(at - now(), () => expire(id));
  }

  function renderPill(): void {
    const real = agents.filter((a) => a.real);
    pill.textContent = swarmPillText({ gemini: real.filter((a) => a.kind === 'gemini').length, nano: real.filter((a) => a.kind === 'nano').length, bytes, simBytes });
    pill.title = honestyNote(agents);
  }

  type Placed = { x: number; y: number; hidden: boolean };
  /** READ phase: where this agent's cursor goes (anchor rects are measured
   *  here, once per distinct tile per frame via `cache`, never after a write). */
  function place(agent: SwarmAgentSpec, pose: SwarmPose, t: number, cache: Map<number | undefined, { x: number; y: number } | null>): Placed {
    let x = pose.x;
    let y = pose.y;
    let hidden = false;
    if (opts.anchor) {
      const read = (i: number | undefined): { x: number; y: number } | null => {
        if (!cache.has(i)) cache.set(i, opts.anchor!(i));
        return cache.get(i) ?? null;
      };
      // The call's cursor parks on the board; each tile cursor flies from it
      // to the tile being filled (both inside the board).
      const to = read(agent.tileIndex);
      const from = read(undefined) ?? to;
      hidden = !to;
      if (to && from) {
        const p = Math.max(0, Math.min(1, t / FLIGHT_MS));
        const e = 1 - Math.pow(1 - p, 3);
        x = from.x + (to.x - from.x) * e;
        y = from.y + (to.y - from.y) * e;
      }
    }
    return { x, y, hidden };
  }

  /** WRITE phase. */
  function write(agent: SwarmAgentSpec, pose: SwarmPose, at: Placed): void {
    const el = els.get(agent.id);
    if (el) {
      if (opts.anchor) el.hidden = at.hidden;
      el.style.left = `${(at.x * 100).toFixed(2)}%`;
      el.style.top = `${(at.y * 100).toFixed(2)}%`;
      el.classList.toggle('is-editing', pose.phase === 'editing');
    }
    if (pose.phase === 'editing' && agent.tileIndex != null && !reached.has(agent.id)) {
      reached.add(agent.id);
      opts.onReachTarget?.(agent.tileIndex, agent.kind);
    }
  }

  function applyPose(agent: SwarmAgentSpec, pose: SwarmPose, t: number): void {
    write(agent, pose, place(agent, pose, t, new Map()));
  }

  /** Parked cursors still follow the board (pan / zoom / layout shifts):
   *  re-pose at most this often once nothing is flying. */
  const FOLLOW_MS = 100;
  let lastFollow = -Infinity;

  function frame(t: number): void {
    let flying = false;
    const cache = new Map<number | undefined, { x: number; y: number } | null>();
    const poses = agents.map((a, i) => {
      const elapsed = t - (born.get(a.id) ?? t);
      if (elapsed < FLIGHT_MS) flying = true;
      const pose = poseAt(a, i, elapsed, { seed, durationMs: FLIGHT_MS, total: SLOT_COUNT });
      return { a, pose, at: place(a, pose, elapsed, cache) };
    });
    poses.forEach(({ a, pose, at }) => write(a, pose, at));
    lastFollow = t;
    // Keep a throttled loop while cursors are up so parked ones follow pan/zoom.
    rafId = raf && (flying || running) ? raf(tick) : null;
  }
  function tick(t: number): void {
    if (t - lastFollow >= FOLLOW_MS || agents.some((a) => t - (born.get(a.id) ?? t) < FLIGHT_MS)) frame(t);
    else rafId = raf && running ? raf(tick) : null;
  }

  function clear(): void {
    els.forEach((el) => el.remove());
    els.clear();
    born.clear();
    endAt.clear();
    timers.forEach((h) => clearTimer(h));
    timers.clear();
    finishing = false;
    agents = [];
    shown = new Set();
    reached = new Set();
  }

  /** Over the per-engine cap: no element, but it still flies on its own
   *  clock (so it reaches and lights its tile) and counts in the pill. */
  function mount(a: SwarmAgentSpec, i: number): void {
    born.set(a.id, now());
    const cap = opts.maxPerKind ?? Infinity;
    if ([...shown].filter((id) => agents.find((b) => b.id === id)?.kind === a.kind).length >= cap) {
      if (opts.reducedMotion) applyPose(a, poseAt(a, i, FLIGHT_MS, { seed, total: SLOT_COUNT }), FLIGHT_MS);
      return;
    }
    shown.add(a.id);
    const el = doc!.createElement('div');
    el.className = `mc-swarm-cursor is-${a.kind}`;
    el.setAttribute('data-agent-id', a.id);
    el.style.setProperty('--mc-swarm-color', a.color);
    el.innerHTML = `<span class="mc-swarm-arrow"></span><span class="mc-swarm-label">${a.label}</span>`;
    container.appendChild(el);
    els.set(a.id, el);
    const t0 = opts.reducedMotion ? FLIGHT_MS : 0;
    applyPose(a, poseAt(a, i, t0, { seed, total: SLOT_COUNT }), t0);
    // A tile cursor leaves LINGER_MS after it lands on its tile.
    if (!a.real) leaveAt(a.id, born.get(a.id)! + landMs + LINGER_MS);
  }

  function settleNow(): void {
    if (rafId != null && caf) caf(rafId);
    rafId = null;
    running = false;
    clear();
    container.hidden = true;
    pill.hidden = true;
    const done = finishDone; finishDone = null; done?.(false);
  }

  return {
    start(input, s = 1) {
      if (rafId != null && caf) caf(rafId);
      rafId = null;
      const pending = finishDone; finishDone = null; pending?.(false);
      clear();
      seed = s;
      agents = buildSwarmAgents(input);
      agents.forEach(mount);
      running = true;
      container.hidden = false;
      pill.hidden = false;
      renderPill();
      if (!opts.reducedMotion && raf) rafId = raf(tick);
    },
    setTiles(count, names) {
      if (!running || finishing) return;
      const call = agents.find((a) => a.real);
      if (!call) return;
      const have = new Set(agents.filter((a) => a.tileIndex != null).map((a) => a.tileIndex));
      const want = Math.min(MAX_TILE_CURSORS, Math.max(0, Math.floor(count)));
      let added = false;
      for (let i = 0; i < want; i++) {
        if (have.has(i)) continue;
        const step = tileCursor(call.kind, i);
        const named = names?.[i];
        const agent: SwarmAgentSpec = { id: `tile-${i}`, kind: step.kind, label: named ? `${ENGINE_NAME[step.kind]} · ${named}` : step.label, color: call.color, real: false, tileIndex: i };
        agents.push(agent);
        mount(agent, agents.length - 1);
        added = true;
      }
      if (!added) return;
      renderPill();
      if (!opts.reducedMotion && raf && rafId == null) rafId = raf(tick);
    },
    finish() {
      if (!running) return Promise.resolve(false);
      if (finishing) return new Promise<boolean>((res) => { const prev = finishDone; finishDone = (ok) => { prev?.(ok); res(ok); }; });
      finishing = true;
      const t = now();
      let last = t;
      for (const at of endAt.values()) last = Math.max(last, at);
      for (const a of agents) {
        if (!a.real || !shown.has(a.id)) continue;
        const at = Math.max(Math.max(t, (born.get(a.id) ?? t) + landMs) + LINGER_MS, last);
        leaveAt(a.id, at);
        last = Math.max(last, at);
      }
      return new Promise<boolean>((res) => {
        finishDone = res;
        later(last - t, () => { const done = finishDone; finishDone = null; settleNow(); done?.(true); });
      });
    },
    reportBytes(b, sim = 0) { bytes = b; simBytes = sim; renderPill(); },
    settle: settleNow,
    destroy() {
      if (rafId != null && caf) caf(rafId);
      rafId = null;
      running = false;
      clear();
      const done = finishDone; finishDone = null; done?.(false);
    },
  };
}
