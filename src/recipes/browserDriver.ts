// DOM driver that REPLAYS a validated browser plan (buildBrowserPlan → PlannedStep[])
// inside the in-canvas reference panel's same-origin iframe. The decision layer
// (interpret/allowlist/confirm-gate) lives in browser.ts and is already tested;
// this file is only the glue to the DOM, split so the matching + sequencing
// logic stays pure and unit-testable without a DOM.
//
// Safety rails kept intact: steps run ONLY inside a same-origin, scriptable
// frame; a cross-origin page is never scripted — it falls back to open-in-tab
// with the remaining steps shown. Any step where stepNeedsConfirm is true (a
// send/pay/delete label, or a real form submit) stops for an explicit big
// Confirm / Cancel before anything is clicked.

import { isSameOrigin, stepNeedsConfirm, describeBrowserStep, type BrowserStep, type FindBy, type ClickBy } from './browser';
import type { PlannedStep } from './browser';

// ── pure: a DOM-free description of an element we can match against ──────────

export interface ElementDescriptor {
  tag: string;            // lowercase tagName
  type?: string;          // lowercase input "type"
  text: string;           // collapsed visible text
  value?: string;         // input/textarea value
  placeholder?: string;
  ariaLabel?: string;
  role?: string;          // explicit role attribute (lowercase)
  labelText?: string;     // text of an associated <label>
  isSubmit?: boolean;     // would this element submit a form?
}

const norm = (s?: string): string => (s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

/** The element's effective ARIA role: explicit role attr, else the implicit one. */
export function effectiveRole(d: ElementDescriptor): string {
  if (d.role) return d.role;
  switch (d.tag) {
    case 'a': return 'link';
    case 'button': return 'button';
    case 'textarea': return 'textbox';
    case 'select': return 'combobox';
    case 'input': {
      const t = d.type || 'text';
      if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      return 'textbox';
    }
    default: return '';
  }
}

/** Does this element satisfy a `find` step (label | placeholder | role)? */
export function matchesFind(d: ElementDescriptor, by: FindBy, value: string): boolean {
  const v = norm(value);
  if (!v) return false;
  if (by === 'label') return norm(d.labelText).includes(v) || norm(d.ariaLabel).includes(v);
  if (by === 'placeholder') return norm(d.placeholder).includes(v);
  if (by === 'role') return effectiveRole(d) === v;
  return false;
}

/** Does this element satisfy a `click` step (link | button by visible text)? */
export function matchesClick(d: ElementDescriptor, by: ClickBy, text: string): boolean {
  const v = norm(text);
  if (!v) return false;
  const label = norm(d.text) || norm(d.ariaLabel) || norm(d.labelText) || norm(d.value);
  if (by === 'link') return d.tag === 'a' && label.includes(v);
  if (by === 'button') {
    const isBtn =
      d.tag === 'button' ||
      (d.tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(d.type || '')) ||
      effectiveRole(d) === 'button';
    return isBtn && label.includes(v);
  }
  return false;
}

// ── pure: teach-by-recording — turn an observed interaction into recipe steps ─

/** A click in a same-origin page → one `click` step, or null if not clickable. */
export function recordClickStep(d: ElementDescriptor): BrowserStep | null {
  const label = (d.text || d.ariaLabel || d.labelText || d.value || '').replace(/\s+/g, ' ').trim();
  if (!label) return null;
  if (d.tag === 'a') return { op: 'click', by: 'link', text: label.slice(0, 120) };
  const isBtn =
    d.tag === 'button' ||
    (d.tag === 'input' && ['button', 'submit', 'reset', 'image'].includes(d.type || '')) ||
    effectiveRole(d) === 'button';
  if (isBtn) return { op: 'click', by: 'button', text: label.slice(0, 120) };
  return null;
}

/** Typing into a field → a `find` (to locate it) then a `type` step. */
export function recordTypeSteps(d: ElementDescriptor, value: string): BrowserStep[] {
  const text = value.slice(0, 200);
  let find: BrowserStep | null = null;
  if (d.labelText || d.ariaLabel) {
    find = { op: 'find', by: 'label', value: (d.labelText || d.ariaLabel || '').slice(0, 120) };
  } else if (d.placeholder) {
    find = { op: 'find', by: 'placeholder', value: d.placeholder.slice(0, 120) };
  }
  if (!find) return []; // can't reliably relocate this field → skip (never guess)
  return [find, { op: 'type', text }];
}

/** Human lines for the remaining steps, for the cross-origin fallback card. */
export function remainingStepsSummary(steps: readonly PlannedStep[], fromIndex: number): string[] {
  return steps.slice(Math.max(0, fromIndex)).map((p) => p.label || describeBrowserStep(p.step));
}

// ── DOM extraction (needs a real element; not exercised by node tests) ───────

function cssEscapeId(id: string): string {
  const g = (globalThis as { CSS?: { escape?(s: string): string } }).CSS;
  return g?.escape ? g.escape(id) : id.replace(/["\\]/g, '\\$&');
}

function labelFor(el: Element): string {
  const id = el.getAttribute('id');
  const doc = el.ownerDocument;
  if (id && doc) {
    const lab = doc.querySelector(`label[for="${cssEscapeId(id)}"]`);
    if (lab) return (lab.textContent ?? '').trim();
  }
  const wrap = el.closest?.('label');
  if (wrap) return (wrap.textContent ?? '').trim();
  return '';
}

function isSubmitEl(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute('type') ?? '').toLowerCase();
  if (tag === 'button') return !!el.closest('form') && type !== 'button' && type !== 'reset';
  if (tag === 'input') return type === 'submit' || type === 'image';
  return false;
}

export function describeElement(el: Element): ElementDescriptor {
  const tag = el.tagName.toLowerCase();
  const type = el.getAttribute('type')?.toLowerCase() || undefined;
  return {
    tag,
    type,
    text: (el.textContent ?? '').replace(/\s+/g, ' ').trim(),
    value: (el as HTMLInputElement).value ?? undefined,
    placeholder: el.getAttribute('placeholder') || undefined,
    ariaLabel: el.getAttribute('aria-label') || undefined,
    role: el.getAttribute('role')?.toLowerCase() || undefined,
    labelText: labelFor(el),
    isSubmit: isSubmitEl(el),
  };
}

function candidates(doc: Document, step: BrowserStep): Element[] {
  const sel =
    step.op === 'click'
      ? 'a,button,input,[role="button"],[role="link"]'
      : 'input,textarea,select,[role],[aria-label],[placeholder]';
  return Array.from(doc.querySelectorAll(sel));
}

/** First element in the frame document that satisfies a find/click step. */
export function findInDoc(doc: Document, step: BrowserStep): Element | null {
  if (step.op !== 'find' && step.op !== 'click') return null;
  for (const el of candidates(doc, step)) {
    const d = describeElement(el);
    if (step.op === 'find' && matchesFind(d, step.by, step.value)) return el;
    if (step.op === 'click' && matchesClick(d, step.by, step.text)) return el;
  }
  return null;
}

/** The frame's document if it is same-origin & scriptable, else null. */
export function frameDoc(frame: HTMLIFrameElement): Document | null {
  try {
    return frame.contentDocument ?? null;
  } catch {
    return null; // cross-origin access throws → not scriptable
  }
}

function setFieldValue(el: Element, text: string): void {
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') {
    (el as HTMLInputElement).value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  } else if ((el as HTMLElement).isContentEditable) {
    (el as HTMLElement).textContent = text;
  }
}

async function waitForText(doc: Document, text: string, timeoutMs: number): Promise<boolean> {
  const needle = text.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((doc.body?.textContent ?? '').toLowerCase().includes(needle)) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return (doc.body?.textContent ?? '').toLowerCase().includes(needle);
}

// ── the host the driver renders into + drives ───────────────────────────────

export interface ReplayHost {
  frame: HTMLIFrameElement;
  /** Container the driver fills with the step list + confirm / fallback UI. */
  rail: HTMLElement;
  /** location.origin of the app (the only origin we will script). */
  appOrigin: string;
  /** Navigate the frame to a same-origin url; resolves on load or timeout. */
  navigate(url: string): Promise<void>;
  /** Cross-origin fallback: open the page in a new tab. */
  openExternal(url: string): void;
}

export type ReplayStatus = 'done' | 'cancelled' | 'fallback' | 'error';
export interface ReplayResult {
  status: ReplayStatus;
  detail: string;
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}

/** Render the step rail + confirm/fallback UI and return controls over it. */
function buildRail(rail: HTMLElement, steps: readonly PlannedStep[]) {
  rail.innerHTML = '';
  const list = document.createElement('ol');
  list.className = 'mc-ref-steps';
  const items = steps.map((p) => {
    const li = document.createElement('li');
    li.className = 'mc-ref-step';
    li.textContent = p.label;
    if (p.needsConfirm) {
      const badge = document.createElement('span');
      badge.className = 'mc-ref-step-confirm';
      badge.textContent = 'confirm';
      li.append(' ', badge);
    }
    list.appendChild(li);
    return li;
  });
  const banner = document.createElement('div');
  banner.className = 'mc-ref-banner';
  banner.setAttribute('role', 'status');
  banner.hidden = true;
  rail.append(list, banner);

  let marked: HTMLElement | null = null;
  const clearMark = () => {
    if (marked) { marked.style.outline = ''; marked.style.outlineOffset = ''; marked = null; }
  };

  return {
    highlight(i: number) {
      items.forEach((li, j) => {
        li.classList.toggle('active', j === i);
        li.classList.toggle('done', j < i);
      });
    },
    markTarget(el: Element) {
      clearMark();
      const h = el as HTMLElement;
      try { h.style.outline = '3px solid #ffb300'; h.style.outlineOffset = '2px'; h.scrollIntoView?.({ block: 'center' }); } catch { /* cross-doc */ }
      marked = h;
    },
    info(text: string) {
      banner.hidden = false;
      banner.className = 'mc-ref-banner';
      banner.textContent = text;
    },
    showFallback(reason: string, remaining: string[]) {
      clearMark();
      banner.hidden = false;
      banner.className = 'mc-ref-banner warn';
      banner.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = `${reason}. Opening it in a new tab — finish these steps yourself:`;
      const ul = document.createElement('ul');
      for (const line of remaining) {
        const li = document.createElement('li');
        li.textContent = line;
        ul.appendChild(li);
      }
      banner.append(p, ul);
    },
    done() {
      clearMark();
      items.forEach((li) => { li.classList.remove('active'); li.classList.add('done'); });
      this.info('All steps replayed.');
    },
    /** Big explicit Confirm / Cancel. Resolves true on confirm, false on cancel. */
    confirm(label: string): Promise<boolean> {
      clearMark();
      banner.hidden = false;
      banner.className = 'mc-ref-banner confirm';
      banner.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = `Ready to “${label}”. This sends/submits — confirm first.`;
      const row = document.createElement('div');
      row.className = 'mc-ref-confirm-row';
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'mc-ref-confirm-ok';
      ok.textContent = `Confirm: ${label}`;
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'mc-ref-confirm-no';
      no.textContent = 'Cancel';
      row.append(ok, no);
      banner.append(p, row);
      return new Promise<boolean>((resolve) => {
        const finish = (v: boolean) => { banner.className = 'mc-ref-banner'; resolve(v); };
        ok.addEventListener('click', () => finish(true), { once: true });
        no.addEventListener('click', () => finish(false), { once: true });
      });
    },
  };
}

/**
 * Replay a validated plan inside the panel. Pure matching/sequencing above;
 * this is the orchestration. Never scripts a cross-origin frame; stops for an
 * explicit confirm on any submit/send/pay/delete step.
 */
export async function runBrowserReplay(
  host: ReplayHost,
  steps: readonly PlannedStep[],
  opts: { timeoutMs?: number } = {},
): Promise<ReplayResult> {
  const ui = buildRail(host.rail, steps);
  const timeoutMs = opts.timeoutMs ?? 6000;
  let target: Element | null = null;

  const fallback = (fromIndex: number, reason: string): ReplayResult => {
    const remaining = remainingStepsSummary(steps, fromIndex);
    ui.showFallback(reason, remaining);
    const cur = steps[fromIndex]?.step;
    if (cur && cur.op === 'open') host.openExternal(cur.url);
    return { status: 'fallback', detail: `${reason}; ${remaining.length} step(s) left.` };
  };

  for (let i = 0; i < steps.length; i++) {
    const { step } = steps[i];
    ui.highlight(i);

    if (step.op === 'open') {
      if (!isSameOrigin(step.url, host.appOrigin)) {
        return fallback(i, `${hostOf(step.url)} can’t be automated here (cross-origin)`);
      }
      await host.navigate(step.url);
      target = null;
      continue;
    }

    const doc = frameDoc(host.frame);
    if (!doc) return fallback(i, 'This page can’t be scripted (cross-origin)');

    switch (step.op) {
      case 'find': {
        const el = findInDoc(doc, step);
        if (!el) return { status: 'error', detail: `Couldn’t find the ${step.by} “${step.value}”.` };
        target = el;
        ui.markTarget(el);
        break;
      }
      case 'type': {
        const field = target ?? doc.activeElement;
        if (!field) return { status: 'error', detail: 'Nothing to type into — a Find step must come first.' };
        setFieldValue(field, step.text ?? '');
        ui.markTarget(field);
        break;
      }
      case 'click': {
        const el = findInDoc(doc, step);
        if (!el) return { status: 'error', detail: `Couldn’t find the ${step.by} “${step.text}”.` };
        ui.markTarget(el);
        if (stepNeedsConfirm(step, { submitsForm: isSubmitEl(el) })) {
          const confirmed = await ui.confirm(step.text);
          if (!confirmed) return { status: 'cancelled', detail: `Stopped before “${step.text}”. Nothing was sent.` };
        }
        (el as HTMLElement).click();
        break;
      }
      case 'scroll': {
        const sc = doc.scrollingElement ?? doc.body;
        sc?.scrollBy?.(0, step.dir === 'up' ? -step.amount : step.amount);
        break;
      }
      case 'wait_for': {
        const found = await waitForText(doc, step.text, timeoutMs);
        if (!found) return { status: 'error', detail: `Timed out waiting for “${step.text}”.` };
        break;
      }
    }
  }

  ui.done();
  return { status: 'done', detail: `${steps.length} step(s) replayed.` };
}

// ── teach-by-recording: observe clicks/typing in a same-origin frame ─────────

export interface TeachRecorder {
  steps: BrowserStep[];
  stop(): void;
}

/**
 * Record clicks + typing in the (same-origin) frame into browser steps. Simple
 * version: a click → a click step; blurring a changed field → find+type steps.
 * Returns a live `steps` array and a stop() that detaches the listeners. Does
 * nothing (no listeners) if the frame is cross-origin.
 */
export function startTeaching(frame: HTMLIFrameElement, onChange?: (steps: BrowserStep[]) => void): TeachRecorder {
  const steps: BrowserStep[] = [];
  const doc = frameDoc(frame);
  const emit = () => onChange?.(steps.slice());

  if (!doc) return { steps, stop() { /* nothing attached */ } };

  const onClick = (e: Event) => {
    const el = (e.target as Element | null)?.closest?.('a,button,input[type="submit"],input[type="button"],[role="button"],[role="link"]');
    if (!el) return;
    const step = recordClickStep(describeElement(el));
    if (step) { steps.push(step); emit(); }
  };
  const onFieldChange = (e: Event) => {
    const el = e.target as HTMLInputElement | null;
    if (!el || (el.tagName.toLowerCase() !== 'input' && el.tagName.toLowerCase() !== 'textarea')) return;
    const value = el.value ?? '';
    if (!value.trim()) return;
    const recorded = recordTypeSteps(describeElement(el), value);
    if (recorded.length) { steps.push(...recorded); emit(); }
  };

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('change', onFieldChange, true);

  return {
    steps,
    stop() {
      try {
        doc.removeEventListener('click', onClick, true);
        doc.removeEventListener('change', onFieldChange, true);
      } catch { /* frame navigated away */ }
    },
  };
}
