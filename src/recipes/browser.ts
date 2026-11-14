// Browser recipe steps + a pure interpreter. A 'browser' recipe is a short,
// JSON-only script the in-canvas panel replays inside a same-origin iframe (or,
// when the page can't be scripted, opens in a tab). There is NO eval and NO free
// code anywhere: the interpreter admits only a fixed allowlist of step kinds,
// every open URL is checked against a host allowlist, and any step that submits
// a form or clicks a send/pay/delete-style button is gated behind an explicit
// confirm (pinch or click) before it runs.

import type { RecipeStep } from './model';

export const BROWSER_STEP_KINDS = ['open', 'find', 'type', 'click', 'scroll', 'wait_for'] as const;
export type BrowserStepKind = (typeof BROWSER_STEP_KINDS)[number];

export const FIND_BY = ['label', 'placeholder', 'role'] as const;
export type FindBy = (typeof FIND_BY)[number];

export const CLICK_BY = ['link', 'button'] as const;
export type ClickBy = (typeof CLICK_BY)[number];

export const SCROLL_DIRS = ['up', 'down'] as const;
export type ScrollDir = (typeof SCROLL_DIRS)[number];

export type BrowserStep =
  | { op: 'open'; url: string }
  | { op: 'find'; by: FindBy; value: string }
  | { op: 'type'; text?: string; slot?: string }
  | { op: 'click'; by: ClickBy; text: string }
  | { op: 'scroll'; dir: ScrollDir; amount: number }
  | { op: 'wait_for'; text: string };

const MAX_STR = 500;
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** A short, trimmed, in-bounds string, else undefined. */
function str(v: unknown, max = MAX_STR): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  return t && t.length <= max ? t : undefined;
}

/**
 * Words that mean "this action leaves the device / spends money / destroys
 * data". A click whose label contains one of these ALWAYS stops for confirm,
 * on top of the runtime "is this a form submit?" check. Word-boundary match so
 * "post" matches "Post reply" but not "postcode".
 */
export const CONFIRM_WORDS = [
  'send', 'submit', 'pay', 'buy', 'order', 'checkout',
  'delete', 'remove', 'post', 'confirm', 'place order', 'transfer',
] as const;

const CONFIRM_RE = new RegExp(`\\b(${CONFIRM_WORDS.map((w) => w.replace(/ /g, '\\s+')).join('|')})\\b`, 'i');

/** Does this button/link label read like it sends, pays, or destroys? */
export function labelNeedsConfirm(label: string): boolean {
  return CONFIRM_RE.test(label);
}

/** Runtime facts the panel can supply once it has resolved a step on the page. */
export interface StepContext {
  /** The matched element submits a form (type=submit / inside a <form>). */
  submitsForm?: boolean;
}

/**
 * Must this step stop for an explicit confirm before it runs? Only click steps
 * can — by their label (send/pay/delete…) or because they submit a form.
 */
export function stepNeedsConfirm(step: BrowserStep, ctx: StepContext = {}): boolean {
  if (step.op !== 'click') return false;
  return labelNeedsConfirm(step.text) || ctx.submitsForm === true;
}

/** Strictly interpret one raw op into a typed BrowserStep, or return an error. */
export function interpretBrowserStep(raw: unknown): BrowserStep | string {
  if (!isObj(raw)) return 'step must be an object';
  const op = raw.op;
  if (typeof op !== 'string' || !(BROWSER_STEP_KINDS as readonly string[]).includes(op)) {
    return `unknown browser step "${String(op)}"`;
  }
  switch (op as BrowserStepKind) {
    case 'open': {
      const url = str(raw.url);
      if (!url) return 'open needs a url';
      return { op: 'open', url };
    }
    case 'find': {
      const by = raw.by;
      if (typeof by !== 'string' || !(FIND_BY as readonly string[]).includes(by)) {
        return 'find needs by: label | placeholder | role';
      }
      const value = str(raw.value);
      if (!value) return 'find needs a value';
      return { op: 'find', by: by as FindBy, value };
    }
    case 'type': {
      const text = str(raw.text);
      const slot = str(raw.slot, 24);
      if (text === undefined && slot === undefined) return 'type needs text or a slot name';
      const out: BrowserStep = { op: 'type' };
      if (text !== undefined) out.text = text;
      if (slot !== undefined) out.slot = slot;
      return out;
    }
    case 'click': {
      const by = raw.by;
      if (typeof by !== 'string' || !(CLICK_BY as readonly string[]).includes(by)) {
        return 'click needs by: link | button';
      }
      const text = str(raw.text);
      if (!text) return 'click needs the visible text';
      return { op: 'click', by: by as ClickBy, text };
    }
    case 'scroll': {
      const dir = raw.dir === 'up' ? 'up' : 'down';
      const n = typeof raw.amount === 'number' && Number.isFinite(raw.amount) ? Math.round(raw.amount) : 400;
      return { op: 'scroll', dir, amount: Math.min(5000, Math.max(50, Math.abs(n))) };
    }
    case 'wait_for': {
      const text = str(raw.text);
      if (!text) return 'wait_for needs the text to wait for';
      return { op: 'wait_for', text };
    }
  }
}

// ---- URL / origin allowlist (the "hard allowlist") -------------------------

/** http(s) only, and the host (or a subdomain of it) is on the allowlist. */
export function isAllowedUrl(url: string, allowedHosts: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const host = u.hostname.toLowerCase();
  return allowedHosts.some((h) => {
    const base = h.toLowerCase().replace(/^\*\./, '');
    return host === base || host.endsWith(`.${base}`);
  });
}

/** Can the panel script this page in-place, or must it open a new tab? */
export function isSameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url, origin).origin === origin;
  } catch {
    return false;
  }
}

// ---- planning --------------------------------------------------------------

export interface PlannedStep {
  index: number;
  step: BrowserStep;
  /** Known-at-build confirm (label-based). A form-submit confirm is decided at
   *  runtime once the element is resolved; see stepNeedsConfirm. */
  needsConfirm: boolean;
  /** One human line for the highlight / card. */
  label: string;
}

export interface BrowserPlanOptions {
  allowedHosts?: readonly string[];
  slots?: Record<string, string>;
}

export type BrowserPlan =
  | { ok: true; steps: PlannedStep[]; confirmCount: number; opensExternal: boolean }
  | { ok: false; error: string };

/** One human line describing a step (for the highlight banner + iPad card). */
export function describeBrowserStep(step: BrowserStep): string {
  switch (step.op) {
    case 'open':
      return `Open ${step.url}`;
    case 'find':
      return `Find the ${step.by} “${step.value}”`;
    case 'type':
      return step.slot ? `Type the ${step.slot}` : `Type “${step.text}”`;
    case 'click':
      return `Click the ${step.by} “${step.text}”`;
    case 'scroll':
      return `Scroll ${step.dir}`;
    case 'wait_for':
      return `Wait for “${step.text}”`;
  }
}

/**
 * Validate + resolve a browser recipe into a replay plan. Every open URL must
 * pass the host allowlist; `slot` references must resolve against opts.slots.
 * The result marks which steps stop for confirm and whether any step opens an
 * external (non-allowlisted-origin but still allowed) page in a tab.
 */
export function buildBrowserPlan(steps: readonly RecipeStep[], opts: BrowserPlanOptions = {}): BrowserPlan {
  const allowedHosts = opts.allowedHosts ?? [];
  const slots = opts.slots ?? {};
  if (steps.length === 0) return { ok: false, error: 'recipe has no steps' };
  const planned: PlannedStep[] = [];
  let confirmCount = 0;
  const opensExternal = false;

  for (let i = 0; i < steps.length; i++) {
    const got = interpretBrowserStep(steps[i].op);
    if (typeof got === 'string') return { ok: false, error: `step ${i + 1}: ${got}` };
    let step = got;
    if (step.op === 'open') {
      if (!isAllowedUrl(step.url, allowedHosts)) {
        return { ok: false, error: `step ${i + 1}: url is not on the allowlist (${step.url})` };
      }
    }
    if (step.op === 'type' && step.slot !== undefined) {
      const value = slots[step.slot];
      if (value === undefined) return { ok: false, error: `step ${i + 1}: no value for slot “${step.slot}”` };
      step = { op: 'type', text: value };
    }
    const needsConfirm = stepNeedsConfirm(step);
    if (needsConfirm) confirmCount++;
    planned.push({ index: i, step, needsConfirm, label: describeBrowserStep(step) });
  }
  return { ok: true, steps: planned, confirmCount, opensExternal };
}
