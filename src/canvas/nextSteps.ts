// Next-step suggestions: at most three chips on the focused board. They are
// GENERATED: after each approved change Nano on this device (Gemini only
// when no Nano is here and she is online) writes them as data, which is
// checked by coerceNextSteps and kept as a `steps-<journeyStep>` artifact,
// labelled with the engine that wrote it. There is no fixed list of chips in
// the code, and no engine means no chips. A chip press only feeds its `say`
// into run(), exactly as if she had typed it, so a chip can never do more
// than her own words can.
import type { Coerced } from './surfacePlan';
import { JOURNEY_STEPS, type JourneyStep } from './journey';

export interface NextStep { id: string; label: string; say: string }

export const MAX_NEXT_STEPS = 3;
export const STEP_LABEL_MAX = 32;
export const STEP_SAY_MAX = 80;
const STEP_ID_RE = /^[a-z][a-z0-9-]{0,23}$/;

/** Prompt API responseConstraint for the steps reply. */
export const STEPS_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, label: { type: 'string' }, say: { type: 'string' } },
        required: ['id', 'label', 'say'],
      },
    },
  },
  required: ['steps'],
};

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const okText = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max && !/[<>]/.test(v);

/** Untrusted steps → at most MAX_NEXT_STEPS checked steps for one journey
 *  step. Nothing is trimmed silently: a step with a bad id, a label over 32
 *  characters, a `say` over 80, markup or a repeat is dropped and counted in
 *  `notes`, and so is every step past the third. None left is a refusal. */
export function coerceNextSteps(raw: unknown): Coerced<{ at: string; steps: NextStep[]; sig?: string }> {
  if (!isObj(raw)) return { ok: false, error: 'not an object' };
  if (raw.sig !== undefined && (typeof raw.sig !== 'string' || !SIG_RE.test(raw.sig))) return { ok: false, error: 'bad facts signature' };
  if (!(JOURNEY_STEPS as readonly unknown[]).includes(raw.at)) return { ok: false, error: 'unknown journey step' };
  if (!Array.isArray(raw.steps)) return { ok: false, error: 'steps must be a list' };
  const steps: NextStep[] = [];
  let bad = 0;
  let over = 0;
  for (const s of raw.steps) {
    if (!isObj(s) || typeof s.id !== 'string' || !STEP_ID_RE.test(s.id) || !okText(s.label, STEP_LABEL_MAX) || !okText(s.say, STEP_SAY_MAX)
      || steps.some((x) => x.id === s.id)) { bad++; continue; }
    if (steps.length >= MAX_NEXT_STEPS) { over++; continue; }
    steps.push({ id: s.id, label: s.label.trim(), say: s.say.trim() });
  }
  if (!steps.length) return { ok: false, error: 'no usable step' };
  const notes = [
    ...(bad ? [`Dropped ${bad} suggestion${bad === 1 ? '' : 's'} that failed the check.`] : []),
    ...(over ? [`Kept the first ${MAX_NEXT_STEPS} suggestions; dropped ${over} more.`] : []),
  ];
  const value = { at: raw.at as string, steps, ...(typeof raw.sig === 'string' ? { sig: raw.sig } : {}) };
  return notes.length ? { ok: true, value, notes } : { ok: true, value };
}

/** The steps prompt: the journey step and three counts. No board content,
 *  no device names, no words of hers. */
export function stepsPrompt(at: JourneyStep, facts: StepFacts): string {
  return [
    'You suggest what a person could do next on a smart home canvas she controls by voice.',
    'The canvas can: connect devices and phones, show her devices, build a dashboard for her lamps, speaker and gimbal, play music,'
      + ' save a board, draw a floor plan, check it for accessibility, show it in 3D, export DXF, add a language such as Kannada, show everything.',
    `She is at the "${at}" step. Devices here: ${facts.devices}. Boards: ${facts.boards}. Paired phones: ${facts.phones}.`,
    `Suggest at most ${MAX_NEXT_STEPS} next steps, most useful first. Each has an id (lowercase words joined by -), a label of at most ${STEP_LABEL_MAX} characters,`
      + ` and "say": the short sentence she would say to do it (at most ${STEP_SAY_MAX} characters).`,
    'Reply JSON only: {"steps":[{"id":string,"label":string,"say":string}]}',
  ].join('\n');
}

/** Which engine writes the steps: Nano on this device; Gemini only when no
 *  Nano is here and she is online; otherwise none (and no chips). */
export function stepsEngine<E extends { id: string }>(nano: E | undefined, gemini: E | undefined, online: boolean): E | undefined {
  const e = nano ?? gemini;
  // A cloud engine (Gemini, or a phone's "Nano" step that is Gemini) needs the network.
  return e?.id === 'gemini' && !online ? undefined : e;
}

export interface StepFacts { devices: number; boards: number; phones: number }
/** A coarse view of the facts the steps were written for (none / one / two /
 *  more of each): kept steps are asked for again when it changes, not on
 *  every small change. */
export function stepsFactsSig(f: StepFacts): string {
  const b = (n: number) => (n <= 0 ? 0 : n >= 3 ? 3 : Math.floor(n));
  return `d${b(f.devices)}-b${b(f.boards)}-p${b(f.phones)}`;
}
const SIG_RE = /^d[0-3]-b[0-3]-p[0-3]$/;
/** Kept steps still fit when they were written for the same coarse facts. */
export function stepsStillFit(kept: { data: Record<string, unknown> } | undefined, sig: string): boolean {
  return !!kept && kept.data.sig === sig;
}

/** A CAD extra's reply line that means it actually ran (not "Nothing to …"). */
export function planExtraRan(said: string): boolean {
  return !/^(Nothing to|3D is not available)/.test(said);
}

// ---- chips on the focused board -------------------------------------------

export interface ShownSteps { steps: NextStep[]; /** The engine that wrote them ("Nano · on device", "Replay · written example"). */ label: string }

export interface NextChipsHost {
  /** Where every board lives (old rows are cleared from here). */
  root: ParentNode;
  /** The focused board and the journey step it is at, or null in overview. */
  focused(): { id: string; el: HTMLElement; at: JourneyStep } | null;
  /** The generated steps kept for this journey step, or null (no chips). */
  stepsFor(at: JourneyStep): ShownSteps | null;
  run(say: string): void;
  /** The chip row was (re)drawn — the host may need to place it. */
  onRender?(): void;
}

export interface NextChips {
  refresh(): void;
  steps(): NextStep[];
  /** Remove the chip rows. */
  destroy(): void;
}

/** The slim chip row at the foot of the focused board. refresh() is cheap to
 *  call after every sync: it only redraws when the step or the steps changed. */
export function createNextStepChips(host: NextChipsHost): NextChips {
  let lastSig = '';
  let shown: NextStep[] = [];
  const clear = (except?: HTMLElement) => host.root.querySelectorAll<HTMLElement>('.mc-next').forEach((el) => { if (el.parentElement !== except) el.remove(); });

  function render(el: HTMLElement, r: ShownSteps): void {
    clear();
    const doc = el.ownerDocument;
    const row = doc.createElement('div');
    row.className = 'mc-next';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Next steps');
    const tag = doc.createElement('span');
    tag.className = 'mc-next-src';
    tag.textContent = r.label;
    row.append(tag);
    for (const s of r.steps) {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'mc-btn mc-next-chip';
      b.dataset.next = s.id;
      b.textContent = s.label;
      // Her words, nothing else: run() routes it as if she had said it.
      b.addEventListener('click', (e) => { e.stopPropagation(); host.run(s.say); });
      row.append(b);
    }
    el.append(row);
    shown = r.steps;
    host.onRender?.();
  }

  const api: NextChips = {
    steps: () => shown,
    destroy() { lastSig = ''; shown = []; clear(); },
    refresh() {
      const f = host.focused();
      const r = f ? host.stepsFor(f.at) : null;
      if (!f || !r || !r.steps.length) { clear(); lastSig = ''; shown = []; return; }
      clear(f.el);
      const sig = JSON.stringify([f.id, f.at, r.label, r.steps]);
      if (sig === lastSig && f.el.querySelector(':scope > .mc-next')) return;
      lastSig = sig;
      render(f.el, r);
    },
  };
  return api;
}
