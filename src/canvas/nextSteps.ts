// Next-step suggestions: 2–3 chips on the focused board that move her along
// the journey (journey.ts). The candidates are fixed rules, each with a `say`
// that run() routes to a real command (checked against routeLine.ts, the
// same table run() switches on). Gemini Nano on this device may pick and
// reorder from that list by id — it can never invent a step, and a bad, slow
// or missing reply leaves the rules up. Never cloud.
import { journeyStepOf, type JourneyBoard, type JourneyCtx, type JourneyStep } from './journey';

export interface NextStep { id: string; label: string; say: string }

export interface NextStepCtx extends JourneyCtx {
  /** Step ids already run on this board (not offered again). */
  done?: readonly string[];
  /** Another board is a saved (pinned) room — after save, the plan comes next. */
  savedRoom?: boolean;
  /** ?sim=1: rules only, and labelled so. */
  sim?: boolean;
  /** Label of a connected lamp, so "Try to break it" names one that exists. */
  lampLabel?: string;
  /** The pair-first flow asked "What do you want to connect next?". */
  asking?: boolean;
}

export interface NextStepsResult { steps: NextStep[]; source: 'nano' | 'rules'; sim?: boolean }

export const MAX_NEXT_STEPS = 3;
export const NANO_PICK_TIMEOUT_MS = 2500;

const CATALOG: Record<string, Omit<NextStep, 'id'>> = {
  'connect-devices': { label: 'Connect devices', say: 'connect devices' },
  // Consumed by the live pair-first flow (pairedRow.ts) while phones pair.
  'build-dashboard': { label: 'Build the dashboard', say: 'build the dashboard' },
  // After pairing ("What do you want to connect next?"): point / name / build.
  'point-device': { label: 'Point at a device', say: 'connect to what I’m pointing at' },
  'name-device': { label: 'Name a device', say: 'connect a device' },
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
  // A real safety-net beat: the request breaks a limit, validation refuses it.
  'try-to-break': { label: 'Try to break it', say: 'set the desk lamp to 500% brightness' },
};

// Not here yet because run() has no route for them in this build:
// "send to my phone" (board-to-phone) and "go offline" (the bar toggle only).
const RULES: Record<JourneyStep, string[]> = {
  empty: ['connect-devices', 'floorplan', 'connect-device'],
  devices: ['connect-room', 'connect-device', 'floorplan'],
  dashboard: ['connect-speaker', 'save', 'floorplan'],
  music: ['play-music', 'save', 'floorplan'],
  saved: ['floorplan', 'try-to-break', 'kannada'],
  floorplan: ['check', '3d', 'dxf'],
  checked: ['kannada', '3d', 'dxf'],
  language: ['3d', 'dxf', 'everything'],
  offline: ['everything', 'undo', 'new-board'],
  shared: ['everything', 'new-board'],
};
const FILLERS = ['everything', 'new-board'];

/** Steps whose effect the board shape can't show; once run on a board (by
 *  chip or by voice, and only when it worked) they are not offered there again. */
export const ONE_SHOT: ReadonlySet<string> = new Set(['check', '3d', 'dxf', 'play-music', 'try-to-break']);

const step = (id: string, ctx?: NextStepCtx): NextStep => {
  const s: NextStep = { id, ...CATALOG[id] };
  if (id === 'try-to-break') s.say = `set the ${ctx?.lampLabel?.toLowerCase() || 'lamp'} to 500% brightness`;
  return s;
};

/** The deterministic 2–3 steps for this journey step. */
export function ruleSuggestions(at: JourneyStep, ctx: NextStepCtx): NextStep[] {
  let ids = RULES[at];
  if (at === 'empty' && ctx.savedRoom) ids = ['floorplan', 'connect-device', 'everything'];
  if (at === 'devices' && ctx.pairing) ids = ctx.asking ? ['point-device', 'name-device', 'build-dashboard'] : ['build-dashboard', 'connect-device'];
  const skip = new Set(ctx.done ?? []);
  if (ctx.lang && ctx.lang !== 'en') skip.add('kannada');
  const out = ids.filter((id) => !skip.has(id));
  for (const f of FILLERS) if (out.length < 2 && !out.includes(f)) out.push(f);
  return out.slice(0, MAX_NEXT_STEPS).map((id) => step(id, ctx));
}

/** A CAD extra's reply line that means it actually ran (not "Nothing to …"). */
export function planExtraRan(said: string): boolean {
  return !/^(Nothing to|3D is not available)/.test(said);
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

// ---- chips on the focused board -------------------------------------------

// One SIM marker per screen (the engine bar's would-send line): rule
// suggestions are labelled "Suggested" with or without SIM — they never
// claim a model picked them.
export const SOURCE_TAG = { nano: 'Nano · on device', rules: 'Suggested', sim: 'Suggested' } as const;

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

export interface NextChips {
  refresh(): void;
  steps(): NextStep[];
  /** A one-shot step ran (chip or voice) and worked on this board. */
  markDone(frameId: string, stepId: string): void;
  /** Remove the chip rows and ignore any Nano pick still in flight. */
  destroy(): void;
}

const CACHE_MAX = 32;

/** The slim chip row at the foot of the focused board. refresh() is cheap to
 *  call after every sync: it only redraws when the step or context changed.
 *  The rule chips show at once; Nano's order replaces them only if it answers
 *  in time. One Nano pick at a time — while one is out, the rules stay up. */
export function createNextStepChips(host: NextChipsHost): NextChips {
  const done = new Map<string, Set<string>>();
  const cache = new Map<string, NextStep[]>(); // signature → Nano's pick
  let lastSig = '';
  let seq = 0;
  let nanoBusy = false;
  let shown: NextStep[] = [];
  const clear = (except?: HTMLElement) => host.root.querySelectorAll<HTMLElement>('.mc-next').forEach((el) => { if (el.parentElement !== except) el.remove(); });

  function render(el: HTMLElement, r: NextStepsResult): void {
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
        host.run(s.say); // run() marks one-shot steps done when they work
        api.refresh(); // plan extras and music don't re-sync the board
      });
      row.append(b);
    }
    el.append(row);
    shown = r.steps;
  }

  /** Wrap host.nano so a pick still running after its timeout blocks the next one. */
  const nanoOnce = host.nano
    ? (prompt: string): Promise<string> => {
      nanoBusy = true;
      const call = host.nano!(prompt);
      call.then(() => { nanoBusy = false; }, () => { nanoBusy = false; });
      return call;
    }
    : undefined;

  const api: NextChips = {
    steps: () => shown,
    destroy() { seq++; lastSig = ''; shown = []; clear(); },
    markDone(frameId, stepId) {
      if (!ONE_SHOT.has(stepId)) return;
      const set = done.get(frameId) ?? new Set<string>();
      set.add(stepId); done.set(frameId, set);
      api.refresh(); // a voice run of a plan extra or music doesn't re-sync the board
    },
    refresh() {
      const f = host.focused();
      if (!f) { clear(); lastSig = ''; shown = []; seq++; return; }
      clear(f.el);
      const d = done.get(f.id) ?? new Set<string>();
      const ctx: NextStepCtx = { ...host.ctx(), done: [...d], checked: d.has('check') };
      const at = journeyStepOf(f.board, ctx);
      const sig = JSON.stringify([at, ctx.done, ctx.lang, ctx.online, !!ctx.savedRoom, !!ctx.pairing, !!ctx.sim, ctx.lampLabel]);
      if (sig === lastSig && f.el.querySelector(':scope > .mc-next')) return;
      lastSig = sig;
      const mine = ++seq;
      const cached = cache.get(sig);
      if (cached) { render(f.el, { steps: cached, source: 'nano' }); return; }
      const rules = ruleSuggestions(at, ctx);
      render(f.el, { steps: rules, source: 'rules', sim: ctx.sim || undefined });
      if (ctx.sim || !nanoOnce || nanoBusy) return;
      void suggestNextSteps(at, ctx, nanoOnce).then((r) => {
        if (r.source !== 'nano') return; // rules are already up
        cache.set(sig, r.steps);
        if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
        if (mine !== seq || !f.el.isConnected) return; // she moved on: keep it for next time
        render(f.el, r);
        host.onNano?.(`next steps (${at}): ${r.steps.map((s) => s.label).join(' · ')}`);
      });
    },
  };
  return api;
}
