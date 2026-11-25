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
   *  cursors already placed stay where they are). No-op when not running. */
  setTiles(count: number): void;
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

  container.setAttribute('aria-hidden', 'true');
  container.hidden = true;

  const pill = doc.createElement('p');
  pill.className = 'mc-swarm-pill';
  pill.setAttribute('role', 'status');
  pill.hidden = true;
  container.appendChild(pill);

  let agents: SwarmAgentSpec[] = [];
  const els = new Map<string, HTMLElement>();
  /** When each cursor joined (ms on `now()`), so a late one flies in on its own clock. */
  const born = new Map<string, number>();
  let rafId: number | null = null;
  let seed = 1;
  let bytes = 0;
  let simBytes = 0;
  let reached = new Set<string>();
  let running = false;

  function renderPill(): void {
    const real = agents.filter((a) => a.real);
    pill.textContent = swarmPillText({ gemini: real.filter((a) => a.kind === 'gemini').length, nano: real.filter((a) => a.kind === 'nano').length, bytes, simBytes });
    pill.title = honestyNote(agents);
  }

  function applyPose(agent: SwarmAgentSpec, pose: SwarmPose): void {
    const el = els.get(agent.id);
    if (!el) return;
    el.style.left = `${(pose.x * 100).toFixed(2)}%`;
    el.style.top = `${(pose.y * 100).toFixed(2)}%`;
    el.classList.toggle('is-editing', pose.phase === 'editing');
    if (pose.phase === 'editing' && agent.tileIndex != null && !reached.has(agent.id)) {
      reached.add(agent.id);
      opts.onReachTarget?.(agent.tileIndex, agent.kind);
    }
  }

  function frame(t: number): void {
    let flying = false;
    agents.forEach((a, i) => {
      const elapsed = t - (born.get(a.id) ?? t);
      if (elapsed < FLIGHT_MS) flying = true;
      applyPose(a, poseAt(a, i, elapsed, { seed, durationMs: FLIGHT_MS, total: SLOT_COUNT }));
    });
    rafId = flying && raf ? raf(frame) : null;
  }

  function clear(): void {
    els.forEach((el) => el.remove());
    els.clear();
    born.clear();
    agents = [];
    reached = new Set();
  }

  function mount(a: SwarmAgentSpec, i: number): void {
    const el = doc!.createElement('div');
    el.className = `mc-swarm-cursor is-${a.kind}`;
    el.setAttribute('data-agent-id', a.id);
    el.style.setProperty('--mc-swarm-color', a.color);
    el.innerHTML = `<span class="mc-swarm-arrow"></span><span class="mc-swarm-label">${a.label}</span>`;
    container.appendChild(el);
    els.set(a.id, el);
    born.set(a.id, now());
    applyPose(a, poseAt(a, i, opts.reducedMotion ? FLIGHT_MS : 0, { seed, total: SLOT_COUNT }));
  }

  return {
    start(input, s = 1) {
      if (rafId != null && caf) caf(rafId);
      rafId = null;
      clear();
      seed = s;
      agents = buildSwarmAgents(input);
      agents.forEach(mount);
      running = true;
      container.hidden = false;
      pill.hidden = false;
      renderPill();
      if (!opts.reducedMotion && raf) rafId = raf(frame);
    },
    setTiles(count) {
      if (!running) return;
      const call = agents.find((a) => a.real);
      if (!call) return;
      const have = new Set(agents.filter((a) => a.tileIndex != null).map((a) => a.tileIndex));
      const want = Math.min(MAX_TILE_CURSORS, Math.max(0, Math.floor(count)));
      let added = false;
      for (let i = 0; i < want; i++) {
        if (have.has(i)) continue;
        const step = tileCursor(call.kind, i);
        const agent: SwarmAgentSpec = { id: `tile-${i}`, kind: step.kind, label: step.label, color: call.color, real: false, tileIndex: i };
        agents.push(agent);
        mount(agent, agents.length - 1);
        added = true;
      }
      if (!added) return;
      renderPill();
      if (!opts.reducedMotion && raf && rafId == null) rafId = raf(frame);
    },
    reportBytes(b, sim = 0) { bytes = b; simBytes = sim; renderPill(); },
    settle() {
      if (rafId != null && caf) caf(rafId);
      rafId = null;
      running = false;
      clear();
      container.hidden = true;
      pill.hidden = true;
    },
    destroy() {
      if (rafId != null && caf) caf(rafId);
      rafId = null;
      running = false;
      clear();
    },
  };
}
