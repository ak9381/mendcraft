// Swarm-style build cursors: ~10-20 small, labelled, colour-coded cursors
// that fly around the canvas while a build turn runs. Every visible cursor
// stands for a real sub-step of the model work already happening elsewhere
// (aiTurn.ts's onSent/onGhost) — never decoration invented on top of it.
// Real model calls stay capped at REAL_CALL_CAP (matching raceHedged's
// primary+backup path in src/ai/hedge.ts); the rest of the cursors are
// sub-steps of one of those real calls, flagged `real: false`.
export type SwarmKind = 'gemini' | 'nano';

export interface SwarmAgentSpec {
  id: string;
  kind: SwarmKind;
  label: string;
  color: string;
  /** True for the handful of cursors standing in for an actual network
   *  call; false for a sub-step cursor of one of those calls. */
  real: boolean;
}

export const REAL_CALL_CAP = 3;
const GEMINI_COLORS = ['#6e8bff', '#b388ff']; // blue, purple
const NANO_COLOR = '#53d17a'; // green
const DEFAULT_SUB_STEPS = 14;
const FLIGHT_MS = 1400;

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
  subSteps: { kind: SwarmKind; label: string }[];
}

export function buildSwarmAgents(input: SwarmPlanInput): SwarmAgentSpec[] {
  const calls = input.calls.slice(0, REAL_CALL_CAP);
  const seen: Record<SwarmKind, number> = { gemini: 0, nano: 0 };
  const next = (kind: SwarmKind): string => assignSwarmColor(kind, seen[kind]++);
  const agents: SwarmAgentSpec[] = calls.map((c, i) => ({
    id: `real-${i}`, kind: c.kind, label: c.label, color: next(c.kind), real: true,
  }));
  input.subSteps.forEach((s, i) => {
    agents.push({ id: `sub-${i}`, kind: s.kind, label: s.label, color: next(s.kind), real: false });
  });
  return agents;
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

export function swarmPillText(s: { agents: number; gemini: number; nano: number; bytes: number }): string {
  return `${s.agents} agent${s.agents === 1 ? '' : 's'} · Gemini ${s.gemini} · Nano ${s.nano} · ${formatBytesShort(s.bytes)} to cloud`;
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

/** Deterministic position for one agent at elapsed time `tMs`: starts near
 *  a random edge, eases into a "tile" spot, then holds. Same seed + index +
 *  t always gives the same pose. */
export function poseAt(agent: SwarmAgentSpec, index: number, tMs: number, opts: { seed?: number; durationMs?: number } = {}): SwarmPose {
  const durationMs = opts.durationMs ?? FLIGHT_MS;
  const rand = mulberry32((opts.seed ?? 1) + index * 7919);
  const sx = rand(); const sy = rand();
  const ex = 0.18 + rand() * 0.64; const ey = 0.22 + rand() * 0.56;
  const p = Math.max(0, Math.min(1, tMs / durationMs));
  const eased = 1 - Math.pow(1 - p, 3);
  return { id: agent.id, x: sx + (ex - sx) * eased, y: sy + (ey - sy) * eased, phase: p >= 1 ? 'editing' : 'flying' };
}

export interface SwarmLayer {
  start(input: SwarmPlanInput, seed?: number): void;
  reportBytes(bytes: number): void;
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
  let rafId: number | null = null;
  let startedAt = 0;
  let seed = 1;
  let bytes = 0;

  function renderPill(): void {
    const gemini = agents.filter((a) => a.kind === 'gemini').length;
    const nano = agents.filter((a) => a.kind === 'nano').length;
    pill.textContent = swarmPillText({ agents: agents.length, gemini, nano, bytes });
    pill.title = honestyNote(agents);
  }

  function applyPose(agent: SwarmAgentSpec, pose: SwarmPose): void {
    const el = els.get(agent.id);
    if (!el) return;
    el.style.left = `${(pose.x * 100).toFixed(2)}%`;
    el.style.top = `${(pose.y * 100).toFixed(2)}%`;
    el.classList.toggle('is-editing', pose.phase === 'editing');
  }

  function frame(t: number): void {
    const elapsed = t - startedAt;
    agents.forEach((a, i) => applyPose(a, poseAt(a, i, elapsed, { seed, durationMs: FLIGHT_MS })));
    rafId = elapsed < FLIGHT_MS && raf ? raf(frame) : null;
  }

  function clear(): void {
    els.forEach((el) => el.remove());
    els.clear();
    agents = [];
  }

  return {
    start(input, s = 1) {
      if (rafId != null && caf) caf(rafId);
      clear();
      seed = s;
      agents = buildSwarmAgents(input);
      agents.forEach((a, i) => {
        const el = doc.createElement('div');
        el.className = `mc-swarm-cursor is-${a.kind}`;
        el.style.setProperty('--mc-swarm-color', a.color);
        el.innerHTML = `<span class="mc-swarm-arrow"></span><span class="mc-swarm-label">${a.label}</span>`;
        container.appendChild(el);
        els.set(a.id, el);
        const initial = opts.reducedMotion ? poseAt(a, i, FLIGHT_MS, { seed }) : poseAt(a, i, 0, { seed });
        applyPose(a, initial);
      });
      container.hidden = false;
      pill.hidden = false;
      renderPill();
      if (!opts.reducedMotion && raf) { startedAt = now(); rafId = raf(frame); }
    },
    reportBytes(b) { bytes = b; renderPill(); },
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
