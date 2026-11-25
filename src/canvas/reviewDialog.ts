import { SCREEN_MARGIN_PX } from './handEdge';
import { mountDraggablePanel } from './dragPanel';
import { NO_VISIBLE_CHANGE, type PlanChange } from './planDiff';

// Floating review window: whenever a Proposal needs a human decision it opens
// here (~560px, top-right inside the 24px safe zone, left of the hand
// cluster) so the board stays visible behind it. It reads like a PLAN:
//   header  — title + which engine made it (+ SIM when scripted)
//   asked   — "You asked: …"
//   THE PLAN — + / ~ / − lines of what will change (scrolls on its own)
//   footer  — why that engine, and what left this device (real ledger bytes)
//   actions — Approve / Reject / Ask for something else (always visible)
// Mouse/touch-drag the title bar to move it, or hold a fist on it (handPointer
// forwards a held fist on any [data-mc-drag-handle]/[data-mc-resize-handle] as
// pointer events); the bottom-right corner resizes the same way, or with the
// arrow keys when focused — the size is remembered. Esc (focus anywhere) / ✕ close
// WITHOUT deciding — the proposal stays waiting so voice/pinch keep·drop
// still work. Approve/Reject proxy-click the same .mc-proposal-keep /
// .mc-proposal-drop buttons on the (hidden) card.

export type ReviewAction = 'approve' | 'reject' | 'ask-else';

/** Pure mapping used by tests and by the dialog itself: what each button does
 *  to the underlying proposal. 'ask-else' never keeps or drops. */
export function reviewActionFor(action: ReviewAction): 'keep' | 'drop' | null {
  if (action === 'approve') return 'keep';
  if (action === 'reject') return 'drop';
  return null;
}

/** Default width of the floating review window (px). */
export const REVIEW_WINDOW_WIDTH = 560;
/** Smallest a corner-drag may make the window. */
export const REVIEW_MIN_SIZE = { width: 420, height: 320 } as const;
/** Largest, as a fraction of the viewport. */
export const REVIEW_MAX_FRACTION = { width: 0.8, height: 0.85 } as const;
const SIZE_KEY = 'mc.reviewSize';

export interface ReviewSize { width: number; height: number }

/** Clamp a corner-drag to [420×320, 80vw×85vh]. On a viewport too small for
 *  the minimum, the viewport cap wins so the window never runs off screen. */
export function clampReviewSize(size: ReviewSize, vp: { width: number; height: number }): ReviewSize {
  const maxW = Math.max(160, Math.floor(vp.width * REVIEW_MAX_FRACTION.width));
  const maxH = Math.max(160, Math.floor(vp.height * REVIEW_MAX_FRACTION.height));
  return {
    width: Math.round(Math.min(Math.max(size.width, REVIEW_MIN_SIZE.width), maxW)),
    height: Math.round(Math.min(Math.max(size.height, REVIEW_MIN_SIZE.height), maxH)),
  };
}

type SizeStorage = Pick<Storage, 'getItem' | 'setItem'>;
export function loadReviewSize(storage: SizeStorage | null | undefined): ReviewSize | null {
  try {
    const raw = storage?.getItem(SIZE_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ReviewSize>;
    if (typeof v.width === 'number' && typeof v.height === 'number' && v.width > 0 && v.height > 0) return { width: v.width, height: v.height };
  } catch { /* corrupt or unavailable — use the default size */ }
  return null;
}
export function saveReviewSize(storage: SizeStorage | null | undefined, size: ReviewSize): void {
  try { storage?.setItem(SIZE_KEY, JSON.stringify(size)); } catch { /* storage unavailable — size just won't persist */ }
}

/** Starting top-right origin, inside the screen margin and clear of the
 *  tools bar and the always-open AI drawer. */
export function reviewWindowStart(
  vp: { width: number; height: number },
  opts: { barH?: number; aiW?: number; aiRight?: number } = {},
): { top: number; right: number } {
  const margin = SCREEN_MARGIN_PX;
  const barH = opts.barH ?? 0;
  const aiW = opts.aiW ?? 0;
  const aiRight = opts.aiRight ?? 16;
  const top = Math.max(margin, barH + margin);
  const width = Math.min(REVIEW_WINDOW_WIDTH, Math.max(160, vp.width - margin * 2));
  const right = Math.min(
    margin + (aiW > 0 ? aiW + aiRight : 0),
    Math.max(margin, vp.width - width - margin),
  );
  return { top, right };
}

/** The honest receipt under the plan: who made it, why there, what left. */
export interface ReviewFacts {
  /** 'nano' | 'gemini' | 'rules' | 'apple' … — where it actually ran. */
  engine: string;
  /** Overrides the chip text (e.g. the teach panel's own engine label). */
  engineLabel?: string;
  sim?: boolean;
  youAsked?: string;
  /** Why that engine (the route line). */
  why?: string;
  /** What left this device, in words (null/'' = nothing). */
  sentWhat?: string | null;
  /** Bytes the ledger recorded for this turn; undefined = not measured. */
  bytes?: number;
  /** A scripted (SIM) turn: what a real run would have sent (nothing left). */
  simBytes?: number;
  /** No AI call made this change (no ledger token): say so, claim no bytes. */
  noAiCall?: boolean;
  /** Two engines made this one change (draft + improvement, or a draft
   *  shown because the improvement failed): replaces the "Why …" line. */
  chain?: string;
}

function stepBytes(f: Pick<ReviewFacts, 'bytes' | 'simBytes'>): string {
  if (f.bytes && f.bytes > 0) return formatReviewBytes(f.bytes);
  if (f.simBytes && f.simBytes > 0) return `SIM would send ${formatReviewBytes(f.simBytes)}`;
  return '0 B';
}
function stepWhere(f: Pick<ReviewFacts, 'engine'>): string {
  return f.engine.toLowerCase() === 'gemini' ? 'in the cloud' : 'on this device';
}
const addBytes = (a?: number, b?: number): number | undefined => (a == null && b == null ? undefined : (a ?? 0) + (b ?? 0));

/** One review for a two-engine change. `improved`: `draft` was improved by
 *  `main` (both steps' bytes count). `fallback`: `main` is the draft shown
 *  because the `attempt` to improve it failed — whatever that attempt
 *  already sent still left this device, so it is counted too. */
export function combineFacts(main: ReviewFacts, other: ReviewFacts, kind: 'improved' | 'fallback'): ReviewFacts {
  const bytes = addBytes(main.bytes, other.bytes);
  const simBytes = (main.simBytes ?? 0) + (other.simBytes ?? 0);
  const sentWhat = [main.sentWhat, other.sentWhat].filter((x) => x && x.trim()).join('; ') || null;
  const chain = kind === 'improved'
    ? `Drafted by ${engineName(other.engine)} ${stepWhere(other)} · ${stepBytes(other)}; improved by ${engineName(main.engine)} · ${stepBytes(main)}`
    : `${engineName(other.engine)} didn’t answer — this is ${engineName(main.engine)}’s draft (${engineName(other.engine)} attempt · ${stepBytes(other)})`;
  return { ...main, sim: !!(main.sim || other.sim), bytes, sentWhat, chain, ...(simBytes > 0 ? { simBytes } : { simBytes: undefined }) };
}

/** What a turn told the ledger (aiTurn's SentInfo shape, kept structural). */
export interface ReviewTurn { engine: string; sent: string | null; routeLine: string; sim: boolean }

/** Per-turn ledger receipts. The turn that sends records its bytes against
 *  its own token (its SentInfo object) and later hands that SAME token to its
 *  review, so a footer can only show that turn's engine, route and bytes —
 *  never whichever turn happened to run last. No token = no AI call. */
export function createReviewReceipts() {
  const bytes = new WeakMap<ReviewTurn, number>();
  const simBytes = new WeakMap<ReviewTurn, number>();
  return {
    /** Add one ledger line's real bytes (and SIM would-send bytes) to this turn. */
    record(turn: ReviewTurn, n: number, sim = 0): void {
      bytes.set(turn, (bytes.get(turn) ?? 0) + n);
      if (sim > 0) simBytes.set(turn, (simBytes.get(turn) ?? 0) + sim);
    },
    facts(turn: ReviewTurn | null, o: { youAsked?: string; sim?: boolean } = {}): ReviewFacts {
      if (!turn) return { engine: 'rules', engineLabel: 'On this device', sim: !!o.sim, youAsked: o.youAsked, noAiCall: true };
      const sim = simBytes.get(turn);
      return { engine: turn.engine, sim: turn.sim, youAsked: o.youAsked, why: turn.routeLine, sentWhat: turn.sent, bytes: bytes.get(turn), ...(sim ? { simBytes: sim } : {}) };
    },
  };
}

export interface ReviewDialogModel {
  title: string;
  /** The rendered Proposal card (keep/drop buttons already wired). */
  card: HTMLElement;
  /** Extra context: what each model did, prompts sent, stayed-local strip. */
  extra?: HTMLElement | null;
  /** THE PLAN: what will change on the board (see planDiff.ts). */
  changes?: PlanChange[] | null;
  facts?: ReviewFacts | null;
}

export interface ReviewDialog {
  open(model: ReviewDialogModel): void;
  close(): void;
  isOpen(): boolean;
  currentCard(): HTMLElement | null;
  destroy(): void;
}

const ENGINE_NAMES: Record<string, string> = { nano: 'Nano', gemini: 'Gemini', rules: 'Rules', apple: 'Apple' };
export function engineName(engine: string): string {
  return ENGINE_NAMES[engine.toLowerCase()] ?? (engine ? engine[0].toUpperCase() + engine.slice(1) : 'AI');
}
/** "Nano · on this device" / "Gemini · cloud". */
export function engineChipText(facts: Pick<ReviewFacts, 'engine' | 'engineLabel'>): string {
  if (facts.engineLabel) return facts.engineLabel;
  const e = facts.engine.toLowerCase();
  return e === 'gemini' ? 'Gemini · cloud' : `${engineName(e)} · on this device`;
}
export function formatReviewBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
/** Route lines often start with the engine chip's own words ("SIM · Nano · on
 *  device — …"); the chip already says that, so keep only the reason. */
function reasonOnly(why: string): string {
  return why.replace(/^SIM · /, '').replace(/^(Nano|Gemini|Apple|Rules|Quick|Deep)\b[^—]*—\s*/i, '').trim();
}
const DEFAULT_WHY: Record<string, string> = {
  nano: 'a quick draft, made right here on this device',
  rules: 'a fixed rule on this device, no model needed',
  apple: 'made right here on this device',
};
/** The footer's two honest lines. `leftWhat` + `leftBytes` are `left` split so
 *  the byte count can never be cut off by an ellipsis. */
export function honestyLines(facts: ReviewFacts): { why: string | null; left: string; leftWhat: string; leftBytes: string } {
  if (facts.noAiCall) return { why: null, left: 'No AI call for this change.', leftWhat: 'No AI call for this change.', leftBytes: '' };
  const engine = facts.engine.toLowerCase();
  let reason = facts.why ? reasonOnly(facts.why) : '';
  // "nothing left this device" is the next line's job, not a reason.
  if (/^nothing (left|sent)\b/i.test(reason)) reason = '';
  if (!reason) reason = DEFAULT_WHY[engine] ?? '';
  const why = facts.chain ?? (reason ? `Why ${engineName(engine)}: ${reason}` : null);
  // SIM: nothing left; say what a real run would send, never as real bytes.
  if (facts.simBytes && facts.simBytes > 0 && !facts.bytes) {
    const leftWhat = `SIM · nothing left this device; a real run would send ${(facts.sentWhat || 'your request').replace(/\.\s*$/, '')}`;
    const leftBytes = ` · would send ${formatReviewBytes(facts.simBytes)}`;
    return { why, left: leftWhat + leftBytes, leftWhat, leftBytes };
  }
  const nothing = facts.bytes === 0 || (!facts.sentWhat && facts.bytes == null);
  if (nothing) return { why, left: 'Nothing left this device.', leftWhat: 'Nothing left this device.', leftBytes: '' };
  const leftWhat = `What left this device: ${(facts.sentWhat || 'your request').replace(/\.\s*$/, '')}`;
  const leftBytes = facts.bytes != null ? ` · ${formatReviewBytes(facts.bytes)}` : '';
  return { why, left: leftWhat + leftBytes, leftWhat, leftBytes };
}

const OP_WORD: Record<PlanChange['op'], string> = { add: 'Add', change: 'Change', remove: 'Remove' };
/** The word on a plan line's badge: "Rename" for a name change, else Add / Change / Remove. */
export function opWord(c: Pick<PlanChange, 'op' | 'detail'>): string {
  if (c.op === 'change' && /^renamed\b|→/.test(c.detail ?? '')) return 'Rename';
  return OP_WORD[c.op];
}

function btn(doc: Document, cls: string, label: string, onClick: () => void, i18n?: string): HTMLButtonElement {
  const b = doc.createElement('button');
  if (i18n) b.setAttribute('data-i18n', i18n);
  b.type = 'button';
  b.className = `mc-btn ${cls}`;
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function mountReviewDialog(
  root: HTMLElement,
  handlers: { onAskElse?: () => void } = {},
  doc: Document = document,
  storage: SizeStorage | null = (() => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; } })(),
): ReviewDialog {
  const dialog = doc.createElement('div');
  dialog.className = 'mc-review-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'false');
  dialog.setAttribute('aria-labelledby', 'mc-review-title');
  // Opening focuses the window itself, not Approve: no focus ring sits on
  // the primary button before anyone chose it; Tab reaches it next.
  dialog.tabIndex = -1;
  dialog.hidden = true;

  const head = el(doc, 'div', 'mc-review-head');
  const drag = el(doc, 'div', 'mc-review-drag');
  drag.setAttribute('data-mc-drag-handle', '');
  drag.setAttribute('role', 'button');
  drag.setAttribute('tabindex', '0');
  drag.setAttribute('aria-label', 'Move review window');
  const titleEl = el(doc, 'h2', 'mc-review-title');
  titleEl.id = 'mc-review-title';
  const chipRow = el(doc, 'div', 'mc-review-chips');
  const engineChip = el(doc, 'span', 'mc-review-engine');
  const simChip = el(doc, 'span', 'mc-review-sim', 'SIM');
  simChip.setAttribute('title', 'Simulated: a prepared reply, no real model call');
  chipRow.append(engineChip, simChip);
  const titleWrap = el(doc, 'div', 'mc-review-titles');
  titleWrap.append(titleEl, chipRow);

  const body = el(doc, 'div', 'mc-review-body');
  const askedEl = el(doc, 'p', 'mc-review-asked');
  const planSec = el(doc, 'section', 'mc-review-plan');
  planSec.setAttribute('aria-label', 'The plan');
  const planHead = el(doc, 'h3', 'mc-review-plan-head', 'The plan');
  const planList = el(doc, 'ol', 'mc-review-plan-list');
  const cardHost = el(doc, 'div', 'mc-review-card-host');
  const extraEl = el(doc, 'div', 'mc-review-extra');
  const moreEl = el(doc, 'details', 'mc-review-more');
  const moreSum = el(doc, 'summary', 'mc-review-more-sum', 'Show the work');
  moreEl.append(moreSum, extraEl);
  planSec.append(planHead, planList, cardHost, moreEl);
  const honesty = el(doc, 'footer', 'mc-review-honesty');
  const whyEl = el(doc, 'p', 'mc-review-why');
  const leftEl = el(doc, 'p', 'mc-review-left');
  honesty.append(whyEl, leftEl);
  const actions = el(doc, 'div', 'mc-review-actions');
  const resize = el(doc, 'span', 'mc-review-resize');
  resize.setAttribute('data-mc-resize-handle', '');
  resize.setAttribute('role', 'button');
  resize.setAttribute('tabindex', '0');
  resize.setAttribute('aria-label', 'Resize review window (arrow keys)');
  resize.setAttribute('title', 'Drag to resize — or focus and use the arrow keys');

  let open = false;
  let card: HTMLElement | null = null;
  let lastFocused: HTMLElement | null = null;

  function clickCard(cls: string): void {
    card?.querySelector<HTMLButtonElement>(cls)?.click();
  }
  function run(action: ReviewAction): void {
    const mapped = reviewActionFor(action);
    if (mapped === 'keep') clickCard('.mc-proposal-keep');
    else if (mapped === 'drop') clickCard('.mc-proposal-drop');
    else handlers.onAskElse?.();
    close();
  }
  const approveBtn = btn(doc, 'mc-review-approve', 'Approve', () => run('approve'), 'approve');
  const rejectBtn = btn(doc, 'mc-review-reject', 'Reject', () => run('reject'), 'reject');
  const askElseBtn = btn(doc, 'mc-review-ask-else', 'Something else', () => run('ask-else'), 'askElse');
  actions.append(approveBtn, rejectBtn, askElseBtn);
  // A visible, pinch-sized ✕ that maps to Escape semantics (A5-005): closes
  // WITHOUT deciding, so the proposal stays waiting and voice/pinch keep·drop
  // still resume it. It sits in the header — never inside .mc-review-actions —
  // so it can never cover Approve/Reject/Ask-else.
  const closeBtn = btn(doc, 'mc-review-close', '✕', () => close());
  closeBtn.setAttribute('aria-label', 'Close without deciding');
  closeBtn.setAttribute('title', 'Close — decide later with voice or a pinch');
  drag.append(titleWrap);
  head.append(drag, closeBtn);
  body.append(askedEl, planSec, honesty, actions);
  dialog.append(head, body, resize);
  root.append(dialog);

  const live = typeof (dialog as HTMLElement).getBoundingClientRect === 'function';
  const dragCtl = live
    ? mountDraggablePanel(dialog, drag, { id: 'review', alreadyFixed: true }, () => {
        const spacer = doc.createElement('div');
        spacer.hidden = true;
        return spacer;
      })
    : null;

  // ---- corner resize (mouse, touch, or the hand's pinch-drag: handPointer
  // dispatches synthetic pointer events to any [data-mc-resize-handle]) ----
  const win = (): { width: number; height: number } =>
    typeof window !== 'undefined' ? { width: window.innerWidth, height: window.innerHeight } : { width: 1280, height: 800 };
  const isPhone = (): boolean => win().width <= 600;
  let resizeStart: { x: number; y: number; width: number; height: number; left: number; maxRight: number } | null = null;
  function applySize(s: ReviewSize): void {
    dialog.style.width = `${s.width}px`;
    dialog.style.height = `${s.height}px`;
  }
  function onResizeDown(e: PointerEvent): void {
    if (!live || isPhone()) return;
    e.preventDefault?.();
    const r = dialog.getBoundingClientRect();
    // Pin the top-left so the corner follows the pointer (the default spot is
    // anchored by `right`, which would make the window grow leftwards).
    if (!dialog.classList.contains('is-floating')) {
      dialog.classList.add('is-floating');
      dialog.style.right = 'auto';
      dialog.style.left = `${r.left}px`;
      dialog.style.top = `${r.top}px`;
    }
    // A window that starts clear of the hand cluster stays clear of it: once
    // the right edge reaches the cluster, growing wider slides it left.
    const cluster = doc.querySelector?.('.mc-hand-cluster')?.getBoundingClientRect?.();
    const maxRight = cluster && cluster.width > 0 && r.right <= cluster.left ? cluster.left - SCREEN_MARGIN_PX : Infinity;
    resizeStart = { x: e.clientX, y: e.clientY, width: r.width, height: r.height, left: r.left, maxRight };
    try { if (e.pointerId != null) resize.setPointerCapture?.(e.pointerId); } catch { /* synthetic (hand) pointer: no capture needed */ }
  }
  function onResizeMove(e: PointerEvent): void {
    if (!resizeStart) return;
    const want = clampReviewSize({ width: resizeStart.width + (e.clientX - resizeStart.x), height: resizeStart.height + (e.clientY - resizeStart.y) }, win());
    const room = resizeStart.maxRight - SCREEN_MARGIN_PX; // widest it can be left of the cluster
    const size = { ...want, width: Math.min(want.width, Math.max(REVIEW_MIN_SIZE.width, room)) };
    applySize(size);
    dialog.style.left = `${Math.max(SCREEN_MARGIN_PX, Math.min(resizeStart.left, resizeStart.maxRight - size.width))}px`;
  }
  function onResizeUp(): void {
    if (!resizeStart) return;
    resizeStart = null;
    const r = dialog.getBoundingClientRect();
    saveReviewSize(storage, { width: r.width, height: r.height });
  }
  resize.addEventListener('pointerdown', onResizeDown as EventListener);
  resize.addEventListener('pointermove', onResizeMove as EventListener);
  resize.addEventListener('pointerup', onResizeUp);
  resize.addEventListener('pointercancel', onResizeUp);

  /** Keyboard resize from the focused corner: arrows grow/shrink by 16px. */
  const KEY_STEP = 16;
  function onResizeKey(e: KeyboardEvent): void {
    const d = e.key === 'ArrowRight' ? [KEY_STEP, 0] : e.key === 'ArrowLeft' ? [-KEY_STEP, 0]
      : e.key === 'ArrowDown' ? [0, KEY_STEP] : e.key === 'ArrowUp' ? [0, -KEY_STEP] : null;
    if (!d || !live) return;
    e.preventDefault(); e.stopPropagation();
    const r = dialog.getBoundingClientRect();
    const next = clampReviewSize({ width: r.width + d[0], height: r.height + d[1] }, win());
    applySize(next);
    saveReviewSize(storage, next);
  }
  resize.addEventListener('keydown', onResizeKey as EventListener);

  /** Everything Tab can reach inside the window, in visual order. */
  function tabbables(): HTMLElement[] {
    const list: HTMLElement[] = [drag, closeBtn];
    if (!moreEl.hidden) list.push(moreSum);
    list.push(approveBtn, rejectBtn, askElseBtn);
    if (!isPhone()) list.push(resize);
    return list.filter((x) => !x.hidden);
  }
  function onKeydown(e: KeyboardEvent): void {
    if (!open) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key === 'Tab') {
      const items = tabbables();
      if (!items.length) return;
      const first = items[0]; const last = items[items.length - 1];
      if (e.shiftKey && doc.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && doc.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  dialog.addEventListener('keydown', onKeydown);
  // Escape closes it wherever focus is (e.g. after a click on the board);
  // keys aimed inside the dialog are already handled above.
  function onDocKeydown(e: KeyboardEvent): void {
    if (!open || e.key !== 'Escape') return;
    const t = e.target as Node | null;
    if (t && typeof dialog.contains === 'function' && dialog.contains(t)) return;
    e.preventDefault(); e.stopPropagation();
    close();
  }
  doc.addEventListener?.('keydown', onDocKeydown, true);

  function close(): void {
    if (!open) return;
    dialog.hidden = true;
    open = false;
    card = null;
    cardHost.innerHTML = '';
    lastFocused?.focus?.();
  }

  function renderPlan(changes: PlanChange[]): void {
    planList.innerHTML = '';
    for (const c of changes) {
      const none = c.label === NO_VISIBLE_CHANGE;
      const li = el(doc, 'li', `mc-review-change is-${none ? 'none' : c.op}`);
      const badge = el(doc, 'span', 'mc-review-op', none ? 'Same' : opWord(c));
      if (none) badge.setAttribute('aria-label', 'No change');
      const text = el(doc, 'span', 'mc-review-change-text');
      text.append(el(doc, 'span', 'mc-review-change-label', c.label));
      if (c.detail) text.append(el(doc, 'span', 'mc-review-change-detail', c.detail));
      li.append(badge, text);
      planList.append(li);
    }
  }

  return {
    open(model) {
      card = model.card;
      titleEl.textContent = model.title;
      const facts = model.facts ?? null;
      const changes = model.changes && model.changes.length ? model.changes : null;

      engineChip.hidden = !facts;
      simChip.hidden = !facts?.sim;
      if (facts) {
        engineChip.textContent = engineChipText(facts);
        engineChip.dataset.engine = facts.engine.toLowerCase();
      }
      const asked = facts?.youAsked?.trim();
      askedEl.hidden = !asked;
      askedEl.textContent = asked ? `You asked: “${asked}”` : '';

      // The plan list is the centre when we know the change; otherwise the
      // proposal card itself (old behaviour) stands in for it.
      planList.hidden = !changes;
      if (changes) renderPlan(changes); else planList.innerHTML = '';
      cardHost.innerHTML = '';
      cardHost.append(model.card);
      cardHost.classList.toggle('is-proxy-only', !!changes);
      planHead.textContent = 'The plan';

      honesty.hidden = !facts;
      if (facts) {
        const lines = honestyLines(facts);
        whyEl.hidden = !lines.why;
        whyEl.textContent = lines.why ?? '';
        whyEl.setAttribute('title', lines.why ?? '');
        leftEl.innerHTML = '';
        leftEl.append(el(doc, 'span', 'mc-review-left-what', lines.leftWhat));
        if (lines.leftBytes) leftEl.append(el(doc, 'span', 'mc-review-left-bytes', lines.leftBytes));
        leftEl.setAttribute('title', lines.left);
      }

      extraEl.innerHTML = '';
      if (model.extra) extraEl.append(model.extra);
      moreEl.hidden = !model.extra;
      moreEl.open = false;

      dragCtl?.resetPosition();
      if (live) {
        // resetPosition leaves the inline right/bottom a drag set; clear them
        // so the CSS default spot (left of the hand cluster) applies again.
        dialog.style.right = '';
        dialog.style.bottom = '';
        const saved = isPhone() ? null : loadReviewSize(storage);
        if (saved) applySize(clampReviewSize(saved, win()));
        else { dialog.style.width = ''; dialog.style.height = ''; }
      }
      dialog.hidden = false;
      open = true;
      planSec.scrollTop = 0;
      lastFocused = (doc.activeElement as HTMLElement) ?? null;
      (typeof dialog.focus === 'function' ? dialog : approveBtn).focus();
    },
    close,
    isOpen() { return open; },
    currentCard() { return card; },
    destroy() {
      dragCtl?.destroy();
      resize.removeEventListener('pointerdown', onResizeDown as EventListener);
      resize.removeEventListener('pointermove', onResizeMove as EventListener);
      resize.removeEventListener('pointerup', onResizeUp);
      resize.removeEventListener('pointercancel', onResizeUp);
      resize.removeEventListener('keydown', onResizeKey as EventListener);
      dialog.removeEventListener('keydown', onKeydown);
      doc.removeEventListener?.('keydown', onDocKeydown, true);
      dialog.remove();
    },
  };
}
