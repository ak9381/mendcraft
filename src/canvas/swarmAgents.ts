// Swarm-style build cursors: ~10-20 small, labelled, colour-coded cursors
// that fly around the canvas while a build turn runs. Every visible cursor
// stands for a real sub-step of the model work already happening elsewhere
// (aiTurn.ts's onSent/onGhost) — never decoration invented on top of it.
// Real model calls stay capped at REAL_CALL_CAP (matching raceHedged's
// primary+backup path in src/ai/hedge.ts); the rest of the cursors are
// sub-steps of the one real call this turn made, flagged `real: false`.
export type SwarmKind = 'gemini' | 'nano';
export type SwarmTask = 'dashboard' | 'floorplan' | 'kannada' | 'generic';

export interface SwarmAgentSpec {
  id: string;
  kind: SwarmKind;
  label: string;
  color: string;
  /** True for the handful of cursors standing in for an actual network
   *  call; false for a sub-step cursor of one of those calls. */
  real: boolean;
  /** Which board tile (0-based, matching the streamed plan's tile order)
   *  this cursor's "editing" phase lands on, if any. Two cursors (one
   *  Gemini, one Nano) usually share a tileIndex: Gemini frames it first,
   *  Nano labels it after — the two visible stages a tile fills in. */
  tileIndex?: number;
}

export const REAL_CALL_CAP = 3;
// Warm-paper palette (no neon, no purple): two blue shades for Gemini,
// one green for Nano — matches the Gemini/Nano terminal accents.
const GEMINI_COLORS = ['#5A7BA6', '#7B9BC2'];
const NANO_COLOR = '#6B8F71';
const DEFAULT_SUB_STEPS = 14;
const FLIGHT_MS = 1400;
const MIN_TILE_COUNT = 4;
const MAX_TILE_COUNT = 8;

/** Pure, order-stable colour assignment: index N of a kind always gets the
 *  same colour for the same kind sequence. */
export function assignSwarmColor(kind: SwarmKind, indexWithinKind: number): string {
  if (kind === 'nano') return NANO_COLOR;
  return GEMINI_COLORS[indexWithinKind % GEMINI_COLORS.length];
}

export interface SwarmPlanInput {
  /** One entry per real model call this build turn makes. Truncated to
   *  REAL_CALL_CAP — anything past that is a sub-step of an in-flight call,
   *  not a new network call. */
  calls: { kind: SwarmKind; label: string }[];
  /** Honest sub-steps already implied by the real call (e.g. one per tile
   *  a plan can carry) — never more than what the real work could produce. */
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
  dashboard: { gemini: 'Gemini · planner', nano: 'Nano · labels' },
  floorplan: { gemini: 'Gemini · layout', nano: 'Nano · room labels' },
  kannada: { gemini: 'Gemini · translation plan', nano: 'Nano · Kannada swaps' },
  generic: { gemini: 'Gemini · planner', nano: 'Nano · labels' },
};

export interface MixedSwarmOptions {
  /** How many tiles the plan is actually carrying, so the swarm follows the
   *  real work instead of a fixed-size mob. Clamped to [4, 8]. */
  tileCount?: number;
  /** A name was redacted from this turn's prompt — adds an honest
   *  "Nano · redaction" cursor instead of inventing one unconditionally. */
  redactedName?: boolean;
}

/** The mixed Gemini+Nano swarm for one real call (`realEngine`). Gemini
 *  cursors stand for planning/layout/frame work; Nano cursors stand for
 *  labelling, device values, redaction and (for the Kannada turn) word
 *  swaps — honest sub-steps of the one real network call this turn made,
 *  landing in the ~10-20 cursor range the demo calls for. */
export function buildMixedSwarmPlan(realEngine: SwarmKind, task: SwarmTask, opts: MixedSwarmOptions = {}): SwarmPlanInput {
  const tileCount = Math.max(MIN_TILE_COUNT, Math.min(MAX_TILE_COUNT, opts.tileCount ?? 6));
  const calls = [{ kind: realEngine, label: TASK_REAL_LABEL[task][realEngine] }];
  const geminiRoles = ['Gemini · layout', 'Gemini · structure', 'Gemini · tile frames'];
  const nanoRoles = task === 'kannada'
    ? ['Nano · Kannada swaps', 'Nano · device values', 'Nano · labels']
    : opts.redactedName
    ? ['Nano · redaction', 'Nano · device values', 'Nano · labels']
    : ['Nano · labels', 'Nano · device values'];
  const subSteps: SwarmPlanInput['subSteps'] = [];
  if (realEngine === 'nano') {
    // The one real call ran on this device: every sub-step is Nano's. No
    // Gemini cursor may appear next to "0 B sent to cloud".
    for (let i = 0; i < tileCount; i++) subSteps.push({ kind: 'nano', label: `Nano · tile ${i + 1}`, tileIndex: i });
    for (let i = 0; i < tileCount; i++) subSteps.push({ kind: 'nano', label: nanoRoles[i % nanoRoles.length], tileIndex: i });
    subSteps.push({ kind: 'nano', label: task === 'floorplan' ? 'Nano · layout' : 'Nano · structure' });
    return { calls, subSteps };
  }
  // One Gemini "tile N" cursor per tile (frames the tile first)...
  for (let i = 0; i < tileCount; i++) subSteps.push({ kind: 'gemini', label: `Gemini · tile ${i + 1}`, tileIndex: i });
  // ...then one Nano labelling cursor per tile (fills it in after).
  for (let i = 0; i < tileCount; i++) subSteps.push({ kind: 'nano', label: nanoRoles[i % nanoRoles.length], tileIndex: i });
  subSteps.push({ kind: 'gemini', label: geminiRoles[0] });
  subSteps.push({ kind: 'nano', label: nanoRoles[0] });
  return { calls, subSteps };
}

/** One real call's worth of cursors: the call itself plus a fixed set of
 *  honestly-labelled sub-steps, landing in the ~10-20 cursor range the demo
 *  calls for from a single real model call. */
export function buildSwarmPlanForCall(kind: SwarmKind, subStepCount = DEFAULT_SUB_STEPS): SwarmPlanInput {
  const name = kind === 'gemini' ? 'Gemini' : 'Nano';
  const realLabel = kind === 'gemini' ? 'Gemini · planner' : 'Nano · labels';
  const subSteps = Array.from({ length: subStepCount }, (_, i) => ({ kind, label: `${name} · tile ${i + 2}` }));
  return { calls: [{ kind, label: realLabel }], subSteps };
}

/** The honesty line the full-screen review / model panels show next to the
 *  swarm, so the visual never reads as more model calls than really ran. */
export function honestyNote(agents: SwarmAgentSpec[]): string {
  const real = agents.filter((a) => a.real).length;
  return `${agents.length} agent${agents.length === 1 ? '' : 's'} show the real steps of about ${real} model call${real === 1 ? '' : 's'}.`;
}

function formatBytesShort(bytes: number): string {
  if (bytes <= 0) return '0 B';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

export function swarmPillText(s: { agents: number; gemini: number; nano: number; bytes: number; simBytes?: number }): string {
  const counts = [s.gemini ? `Gemini ${s.gemini}` : '', s.nano ? `Nano ${s.nano}` : ''].filter(Boolean).join(' · ');
  const sim = s.simBytes ?? 0;
  // A SIM turn sent nothing: what it would send is labelled, never "to cloud".
  const bytes = sim > 0 && s.bytes <= 0 ? `SIM · would send ${formatBytesShort(sim)}`
    : `${formatBytesShort(s.bytes)} to cloud${sim > 0 ? ` · SIM · would send ${formatBytesShort(sim)}` : ''}`;
  return `${s.agents} agent${s.agents === 1 ? '' : 's'}${counts ? ` · ${counts}` : ''} · ${bytes}`;
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
  /** At most this many visible cursors per engine (default: one per agent).
   *  The canvas passes 1: one Nano and one Gemini cursor, never a spray. The
   *  other agents still count in the pill and still light their tiles. */
  maxPerKind?: number;
  /** Where a visible cursor parks, as a fraction of the container: the tile
   *  it fills (`tileIndex`) or, with no tile, the board itself. null hides
   *  the cursor, so it never floats outside a board. Read every frame. */
  anchor?: (tileIndex: number | undefined) => { x: number; y: number } | null;
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
  /** The agents that get a cursor element (maxPerKind per engine). */
  let shown = new Set<string>();
  /** A shown cursor parks on the first tile its engine fills. */
  const parkTile = new Map<string, number | undefined>();
  const els = new Map<string, HTMLElement>();
  let rafId: number | null = null;
  let startedAt = 0;
  let seed = 1;
  let bytes = 0;
  let simBytes = 0;
  let reached = new Set<string>();

  function renderPill(): void {
    const gemini = agents.filter((a) => a.kind === 'gemini').length;
    const nano = agents.filter((a) => a.kind === 'nano').length;
    pill.textContent = swarmPillText({ agents: agents.length, gemini, nano, bytes, simBytes });
    pill.title = honestyNote(agents);
  }

  function applyPose(agent: SwarmAgentSpec, pose: SwarmPose, t: number): void {
    const el = els.get(agent.id);
    if (el) {
      let x = pose.x;
      let y = pose.y;
      if (opts.anchor) {
        // Fly from the board to the parked tile (both inside the board).
        const to = opts.anchor(parkTile.get(agent.id));
        const from = opts.anchor(undefined) ?? to;
        el.hidden = !to;
        if (to && from) {
          const p = Math.max(0, Math.min(1, t / FLIGHT_MS));
          const e = 1 - Math.pow(1 - p, 3);
          x = from.x + (to.x - from.x) * e;
          y = from.y + (to.y - from.y) * e;
        }
      }
      el.style.left = `${(x * 100).toFixed(2)}%`;
      el.style.top = `${(y * 100).toFixed(2)}%`;
      el.classList.toggle('is-editing', pose.phase === 'editing');
    }
    if (pose.phase === 'editing' && agent.tileIndex != null && !reached.has(agent.id)) {
      reached.add(agent.id);
      opts.onReachTarget?.(agent.tileIndex, agent.kind);
    }
  }

  function frame(t: number): void {
    const elapsed = t - startedAt;
    agents.forEach((a, i) => applyPose(a, poseAt(a, i, elapsed, { seed, durationMs: FLIGHT_MS, total: agents.length }), elapsed));
    rafId = elapsed < FLIGHT_MS && raf ? raf(frame) : null;
  }

  function clear(): void {
    els.forEach((el) => el.remove());
    els.clear();
    agents = [];
    shown = new Set();
    parkTile.clear();
    reached = new Set();
  }

  return {
    start(input, s = 1) {
      if (rafId != null && caf) caf(rafId);
      clear();
      seed = s;
      agents = buildSwarmAgents(input);
      const cap = opts.maxPerKind ?? Infinity;
      const perKind: Record<SwarmKind, number> = { gemini: 0, nano: 0 };
      for (const a of agents) {
        if (perKind[a.kind] >= cap) continue;
        perKind[a.kind]++;
        shown.add(a.id);
        parkTile.set(a.id, a.tileIndex ?? agents.find((b) => b.kind === a.kind && b.tileIndex != null)?.tileIndex);
      }
      agents.forEach((a, i) => {
        if (!shown.has(a.id)) {
          if (opts.reducedMotion) applyPose(a, poseAt(a, i, FLIGHT_MS, { seed, total: agents.length }), FLIGHT_MS);
          return;
        }
        const el = doc.createElement('div');
        el.className = `mc-swarm-cursor is-${a.kind}`;
        el.setAttribute('data-agent-id', a.id);
        el.style.setProperty('--mc-swarm-color', a.color);
        el.innerHTML = `<span class="mc-swarm-arrow"></span><span class="mc-swarm-label">${a.label}</span>`;
        container.appendChild(el);
        els.set(a.id, el);
        const initial = opts.reducedMotion
          ? poseAt(a, i, FLIGHT_MS, { seed, total: agents.length })
          : poseAt(a, i, 0, { seed, total: agents.length });
        applyPose(a, initial, opts.reducedMotion ? FLIGHT_MS : 0);
      });
      container.hidden = false;
      pill.hidden = false;
      renderPill();
      if (!opts.reducedMotion && raf) { startedAt = now(); rafId = raf(frame); }
    },
    reportBytes(b, sim = 0) { bytes = b; simBytes = sim; renderPill(); },
    settle() {
      if (rafId != null && caf) caf(rafId);
      rafId = null;
      clear();
      container.hidden = true;
      pill.hidden = true;
    },
    destroy() {
      if (rafId != null && caf) caf(rafId);
      rafId = null;
      clear();
    },
  };
}
