// Next-step suggestions: 2–3 chips on the focused board that move her along
// the journey (journey.ts). The candidates are fixed rules, each with a `say`
// that run() already routes to a real command. Gemini Nano on this device may
// pick and reorder from that list by id — it can never invent a step, and a
// bad, slow or missing reply falls back to the rules. Never cloud.
import { parseCanvasCommand } from './canvasCommands';
import { connectAsk } from './connectTurns';
import { parseDeviceCommands, type DeviceRef } from './deviceCommands';
import { parseGimbalSpeech } from './gimbalCanvas';
import { parsePlanExtra } from './planExtras';
import { matchPaletteCommand } from './toolPalette';
import { journeyStepOf, type JourneyBoard, type JourneyCtx, type JourneyStep } from './journey';

export interface NextStep { id: string; label: string; say: string }

export interface NextStepCtx extends JourneyCtx {
  /** Step ids already run on this board (not offered again). */
  done?: readonly string[];
  /** Another board is a saved (pinned) room — after save, the plan comes next. */
  savedRoom?: boolean;
  /** ?sim=1: rules only, and labelled so. */
  sim?: boolean;
}

export interface NextStepsResult { steps: NextStep[]; source: 'nano' | 'rules'; sim?: boolean }

export const MAX_NEXT_STEPS = 3;
export const NANO_PICK_TIMEOUT_MS = 2500;

const CATALOG: Record<string, Omit<NextStep, 'id'>> = {
  'connect-room': { label: 'Connect this room', say: 'connect this room' },
  'connect-device': { label: 'Connect a device', say: 'connect a device' },
  'connect-speaker': { label: 'Connect the speaker', say: 'connect the speaker' },
  floorplan: { label: 'Draw the floor plan', say: 'draw the floor plan' },
  'play-music': { label: 'Play music', say: 'play music' },
  save: { label: 'Save', say: 'save' },
  kannada: { label: 'Add Kannada', say: 'add kannada' },
  check: { label: 'Check accessibility', say: 'check accessibility' },
  '3d': { label: 'Show 3D', say: 'show 3d' },
  dxf: { label: 'Export DXF', say: 'export dxf' },
  everything: { label: 'Show everything', say: 'show everything' },
  'new-board': { label: 'New board', say: 'new board' },
  undo: { label: 'Undo', say: 'undo' },
};

// Not here yet because run() has no route for them in this build:
// "send to my phone" (board-to-phone) and "go offline" (the bar toggle only).
const RULES: Record<JourneyStep, string[]> = {
  empty: ['connect-room', 'floorplan', 'connect-device'],
  devices: ['connect-room', 'connect-device', 'floorplan'],
  dashboard: ['connect-speaker', 'save', 'floorplan'],
  music: ['play-music', 'save', 'floorplan'],
  saved: ['floorplan', 'kannada', 'everything'],
  floorplan: ['check', '3d', 'dxf'],
  checked: ['kannada', '3d', 'dxf'],
  language: ['3d', 'dxf', 'everything'],
  offline: ['everything', 'undo', 'new-board'],
  shared: ['everything', 'new-board'],
};
const FILLERS = ['everything', 'new-board'];

const step = (id: string): NextStep => ({ id, ...CATALOG[id] });

/** The deterministic 2–3 steps for this journey step. */
export function ruleSuggestions(at: JourneyStep, ctx: NextStepCtx): NextStep[] {
  let ids = RULES[at];
  if (at === 'empty' && ctx.savedRoom) ids = ['floorplan', 'connect-device', 'everything'];
  const skip = new Set(ctx.done ?? []);
  if (ctx.lang && ctx.lang !== 'en') skip.add('kannada');
  const out = ids.filter((id) => !skip.has(id));
  for (const f of FILLERS) if (out.length < 2 && !out.includes(f)) out.push(f);
  return out.slice(0, MAX_NEXT_STEPS).map(step);
}

// ---- Nano pick (on device only) -------------------------------------------

export function nextStepsPrompt(at: JourneyStep, allowed: readonly NextStep[]): string {
  return 'You suggest what a person should do next on a smart home canvas. '
    + `She is at the "${at}" step of: connect devices, room dashboard, music, save, floor plan, accessibility check, Kannada, offline, share to phone.\n`
    + `Allowed ids (pick 2 or 3, most useful first; use only these):\n${allowed.map((s) => `- ${s.id}: ${s.label}`).join('\n')}\n`
    + 'Reply JSON only: {"ids":["id", "id"]}';
}

/** Strictly parse Nano's reply: known ids only, in Nano's order, no repeats,
 *  at most three. Fewer than two usable ids (or anything malformed) → null. */
export function parseNanoPick(raw: string, allowed: readonly NextStep[]): NextStep[] | null {
  const text = String(raw ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (!text.startsWith('{')) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return null; }
  const ids = (parsed as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids)) return null;
  const byId = new Map(allowed.map((s) => [s.id, s]));
  const out: NextStep[] = [];
  for (const id of ids) {
    const s = typeof id === 'string' ? byId.get(id) : undefined;
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= MAX_NEXT_STEPS) break;
  }
  return out.length >= Math.min(2, allowed.length) ? out : null;
}

function timeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('next-step pick timed out')), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Nano (on device) picks from the rule list; otherwise the rules, labelled so. */
export async function suggestNextSteps(
  at: JourneyStep,
  ctx: NextStepCtx,
  nano?: (prompt: string) => Promise<string>,
): Promise<NextStepsResult> {
  const rules = ruleSuggestions(at, ctx);
  if (ctx.sim) return { steps: rules, source: 'rules', sim: true };
  if (!nano || rules.length < 2) return { steps: rules, source: 'rules' };
  try {
    const picked = parseNanoPick(await timeout(nano(nextStepsPrompt(at, rules)), NANO_PICK_TIMEOUT_MS), rules);
    return picked ? { steps: picked, source: 'nano' } : { steps: rules, source: 'rules' };
  } catch {
    return { steps: rules, source: 'rules' };
  }
}

// ---- routing check ---------------------------------------------------------

/** The inline patterns run() (canvasApp.ts) uses for these routes, copied so
 *  routeOf() can mirror run()'s order; a test fails if run() drops one. */
export const NEXT_STEP_ROUTE_PATTERNS = {
  kannada: /\badd kannada\b/i,
  connectRoom: /\bconnect (everything|all|the room|this room|my room|devices?)\b/i,
  floorPlan: /\bfloor\s*plans?\b/i,
} as const;

/** Which route run() takes for a line, in run()'s own order. 'openEnded' is
 *  its catch-all model turn — a chip must never land there. */
export function routeOf(text: string, world: { hasPlanBoard: boolean; devices: readonly DeviceRef[] }): string {
  const palette = matchPaletteCommand(text);
  if (palette) return `palette:${palette}`;
  const gimbal = parseGimbalSpeech(text);
  if (gimbal) return `gimbal:${gimbal}`;
  if (NEXT_STEP_ROUTE_PATTERNS.kannada.test(text)) return 'kannada';
  const extra = world.hasPlanBoard ? parsePlanExtra(text) : null;
  if (extra) return `planExtra:${extra}`;
  const c = parseCanvasCommand(text);
  if (c) return `canvas:${c.type}`;
  if (parseDeviceCommands(text, world.devices)) return 'device';
  if (NEXT_STEP_ROUTE_PATTERNS.connectRoom.test(text)) return 'connectRoom';
  if (NEXT_STEP_ROUTE_PATTERNS.floorPlan.test(text)) return 'floorPlan';
  const ask = connectAsk(text);
  if (ask) return `connect:${ask}`;
  return 'openEnded';
}

// ---- chips on the focused board -------------------------------------------

export const SOURCE_TAG = { nano: 'Nano · on device', rules: 'Suggested', sim: 'Suggested · SIM' } as const;

export function sourceTag(r: Pick<NextStepsResult, 'source' | 'sim'>): string {
  return r.sim ? SOURCE_TAG.sim : SOURCE_TAG[r.source];
}

export interface NextChipsHost {
  /** Where every board lives (old rows are cleared from here). */
  root: ParentNode;
  /** The focused board, or null in overview. */
  focused(): { id: string; el: HTMLElement; board: JourneyBoard } | null;
  ctx(): Omit<NextStepCtx, 'done' | 'checked'>;
  nano?: (prompt: string) => Promise<string>;
  run(say: string): void;
  /** Nano picked the chips (on device): one line for its terminal / the AI feed. */
  onNano?(line: string): void;
}

export interface NextChips { refresh(): void; steps(): NextStep[] }

/** Chips whose effect the board shape can't show; once run on a board they are
 *  not offered there again. (A build, save or language change shows itself.) */
const ONE_SHOT: ReadonlySet<string> = new Set(['check', '3d', 'dxf', 'play-music']);

/** The slim chip row at the foot of the focused board. refresh() is cheap to
 *  call after every sync: it only re-asks when the step or context changed. */
export function createNextStepChips(host: NextChipsHost): NextChips {
  const done = new Map<string, Set<string>>();
  let lastSig = '';
  let seq = 0;
  let pending = false;
  let shown: NextStep[] = [];
  const clear = (except?: HTMLElement) => host.root.querySelectorAll<HTMLElement>('.mc-next').forEach((el) => { if (el.parentElement !== except) el.remove(); });

  function render(el: HTMLElement, frameId: string, r: NextStepsResult): void {
    clear();
    const doc = el.ownerDocument;
    const row = doc.createElement('div');
    row.className = 'mc-next';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Next steps');
    row.dataset.source = r.sim ? 'sim' : r.source;
    const tag = doc.createElement('span');
    tag.className = 'mc-next-src';
    tag.textContent = sourceTag(r);
    row.append(tag);
    for (const s of r.steps) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'mc-btn mc-next-chip';
      b.dataset.next = s.id;
      b.textContent = s.label;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        if (ONE_SHOT.has(s.id)) {
          const set = done.get(frameId) ?? new Set<string>();
          set.add(s.id); done.set(frameId, set);
        }
        host.run(s.say);
        api.refresh(); // plan extras and music don't re-sync the board
      });
      row.append(b);
    }
    el.append(row);
    shown = r.steps;
  }

  const api: NextChips = {
    steps: () => shown,
    refresh() {
      const f = host.focused();
      if (!f) { clear(); lastSig = ''; shown = []; seq++; pending = false; return; }
      clear(f.el);
      const d = done.get(f.id) ?? new Set<string>();
      const ctx: NextStepCtx = { ...host.ctx(), done: [...d], checked: d.has('check') };
      const at = journeyStepOf(f.board, ctx);
      const sig = JSON.stringify([f.id, at, ctx.done, ctx.lang, ctx.online, !!ctx.savedRoom, !!ctx.sim]);
      // Same state: the row is up, or its pick is still on the way.
      if (sig === lastSig && (pending || f.el.querySelector(':scope > .mc-next'))) return;
      lastSig = sig;
      const mine = ++seq;
      pending = true;
      void suggestNextSteps(at, ctx, host.nano).then((r) => {
        if (mine !== seq) return;
        pending = false;
        if (!f.el.isConnected) return;
        render(f.el, f.id, r);
        if (r.source === 'nano') host.onNano?.(`next steps (${at}): ${r.steps.map((s) => s.label).join(' · ')}`);
      });
    },
  };
  return api;
}
