// HAND EDIT on a floor-plan board, the DOM side (design:
// docs/plan/2026-11-26-plan-hands-design.md). plan/handEdit.ts holds the
// logic; this file gives it a face on each plan board while Hands is on:
//
//  - the mode banner ("Drawing walls with your hand — …") with the live size;
//  - the hand action bar for the selected element: size steppers (also
//    `data-level` controls), Rotate / Flip swing, Remove, Done — all real
//    buttons, so the palm highlight, thumbs-up and the fixed gestures
//    (R thumbs-down = Remove, L peace = Rotate) press them like a mouse;
//  - element handles: one invisible proxy button per wall / room / door /
//    furniture while the Select tool is active, so the palm highlight snaps
//    to plan elements exactly as it snaps to buttons;
//  - the `handEdit` half of the board's HandSurface, which the hand pointer
//    calls for fist strokes and fist taps;
//  - the edit journal: every plan edit (hand or mouse) is announced as an
//    `mc-plan-edit` event so the canvas history / Undo can take it back.

import type { ModeController, ViewportHandle } from '../core/controller';
import { createPlanHandEdit, type HandSelection, type HandTarget, type PlanHandEdit } from '../plan/handEdit';
import { createPlanJournal, type PlanJournal } from '../plan/editJournal';
import { mmToMetresLabel } from '../plan/doc';
import { HAND_HOT, type HandSurfaceEdit } from './handPointer';

/** Fired (bubbling, composed) on the plan board for each finished edit. */
export const PLAN_EDIT_EVENT = 'mc-plan-edit';
export interface PlanEditDetail { steps: number; summary: string; epoch: number }

/** The plan's own chrome inside the drawing host: a fist there is not a stroke. */
const CHROME = '.mc-palette, .mc-flyout, .mc-props, .mc-trash, .mc-fsctl, .mc-plan-hand-bar, .mc-plan-hand-banner, button, input, select, textarea';
const HOT_MIN = 32;
const HOT_MAX = 60;

export interface PlanHandSurface extends HandSurfaceEdit {
  readonly hand: PlanHandEdit;
  readonly journal: PlanJournal;
  /** Peace-and-move resize (planPeace.PeaceTarget). */
  resizable(): boolean;
  resizeBegin(): boolean;
  resizeTravel(dxPx: number, dyPx: number): void;
  resizeEnd(): void;
  resizeCancel(): void;
  /** Hand edit switch for this board (default on). */
  enabled(): boolean;
  setEnabled(on: boolean): void;
  /** Hands is on and this board would take a fist (ignoring the point). */
  active(): boolean;
  /** Re-draw the banner, bar and element handles if anything changed. */
  refresh(force?: boolean): void;
  /** Canvas Undo for one journal entry. Returns engine steps undone. */
  undo(steps: number, epoch: number): number;
  dispose(): void;
}

const mounted = new Set<PlanHandSurface>();
/** Refresh every mounted plan board's hand UI (the canvas calls this from
 *  its hand-frame loop and when Hands turns on or off). */
export function refreshPlanHands(force = false): void {
  for (const s of mounted) s.refresh(force);
}

let epochSeq = 0;

export function mountPlanHandSurface(o: {
  /** The drawing host (`.mc-plan-board`, the HandSurface element). */
  host: HTMLElement;
  /** The board element events are dispatched on (`<mc-plan-board>`). */
  board: HTMLElement;
  controller: ModeController;
  view: ViewportHandle;
}): PlanHandSurface | null {
  const { host, board, controller, view } = o;
  const hh = view.handHost?.();
  if (!hh) return null;
  const doc = host.ownerDocument;
  const epoch = ++epochSeq;
  let on = true;

  // ---- journal: counts engine steps; one event per finished edit.
  const journal = createPlanJournal(controller as never, (e) => {
    board.dispatchEvent(new CustomEvent<PlanEditDetail>(PLAN_EDIT_EVENT, { bubbles: true, composed: true, detail: { ...e, epoch } }));
  });
  // Mouse / keyboard / panel edits: close the open edit once input settles.
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let mouseDown = false;
  const flushSoon = (): void => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      if (mouseDown || hand.busy()) { if (journal.dirty()) flushSoon(); return; }
      journal.flush();
      refresh();
    }, 350);
  };
  const applyInner = controller.applyOp.bind(controller);
  let refreshQueued = false;
  controller.applyOp = (raw: unknown) => {
    const r = applyInner(raw);
    if (r.ok && journal.dirty()) flushSoon();
    // Selection / geometry changed (mouse included): the bar and handles follow.
    if (r.ok && !refreshQueued) { refreshQueued = true; queueMicrotask(() => { refreshQueued = false; refresh(); }); }
    return r;
  };
  const onDown = (): void => { mouseDown = true; };
  const onUp = (): void => { mouseDown = false; if (journal.dirty()) flushSoon(); };
  host.addEventListener('mousedown', onDown);
  doc.defaultView?.addEventListener('mouseup', onUp);
  // A palette click changes the tool without an op: the banner follows.
  const onClick = (): void => { queueMicrotask(() => refresh()); };
  host.addEventListener('click', onClick);

  const hand = createPlanHandEdit({
    ctx: hh.ctx,
    tools: hh.tools,
    dropRedo: (n) => controller.dropRedo?.(n),
    setLive: (v) => view.setLiveGesture?.(v),
    panByPx: (dx, dy) => view.panByPx?.(dx, dy),
    aim: (x, y, r) => view.aim?.(x, y, r)?.id ?? null,
    onEdit: (summary) => journal.note(summary),
    onChange: () => refresh(),
  });

  // ---- DOM
  const banner = doc.createElement('div');
  banner.className = 'mc-plan-hand-banner';
  banner.setAttribute('role', 'status');
  banner.setAttribute('aria-live', 'polite');
  banner.hidden = true;
  const bannerText = doc.createElement('span');
  bannerText.className = 'mc-plan-hand-text';
  const bannerReadout = doc.createElement('strong');
  bannerReadout.className = 'mc-plan-hand-readout';
  banner.append(bannerText, bannerReadout);

  const bar = doc.createElement('div');
  bar.className = 'mc-plan-hand-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selected element');
  bar.hidden = true;

  const hot = doc.createElement('div');
  hot.className = 'mc-plan-hot-layer';
  host.append(hot, banner, bar);

  const button = (cls: string, text: string, label: string, act: () => void): HTMLButtonElement => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = `mc-plan-hand-btn ${cls}`;
    b.textContent = text;
    b.setAttribute('aria-label', label);
    b.addEventListener('click', (e) => { e.stopPropagation(); act(); refresh(true); });
    return b;
  };

  let barKey = '';
  function buildBar(sel: HandSelection): void {
    const key = JSON.stringify([sel.id, sel.axes.map((a) => a.key + a.name), sel.rotate, sel.label.replace(/[\d.]+ m/g, '')]);
    if (key === barKey && bar.childElementCount) {
      sel.axes.forEach((ax, i) => {
        const g = bar.querySelectorAll<HTMLElement>('.mc-plan-size')[i];
        if (!g) return;
        g.setAttribute('aria-label', `${ax.name} ${mmToMetresLabel(ax.value)}`);
        g.querySelector('.mc-plan-size-value')!.textContent = `${ax.name} ${mmToMetresLabel(ax.value)}`;
      });
      return;
    }
    barKey = key;
    bar.innerHTML = '';
    for (const ax of sel.axes) {
      const g = doc.createElement('div');
      g.className = 'mc-plan-size';
      // The shared level-control contract (peace-and-move over it steps it).
      g.setAttribute('data-level', ax.name.toLowerCase());
      g.setAttribute('data-level-step', '100');
      g.setAttribute('role', 'group');
      // levelReadout() shows this label next to the hand ("Length 3.10 m").
      g.setAttribute('aria-label', `${ax.name} ${mmToMetresLabel(ax.value)}`);
      const dec = button('mc-plan-size-dec', '− 10 cm', `${ax.name} 10 centimetres shorter`, () => hand.step(ax.key, -1));
      dec.setAttribute('data-level-dec', '');
      const val = doc.createElement('span');
      val.className = 'mc-plan-size-value';
      val.textContent = `${ax.name} ${mmToMetresLabel(ax.value)}`;
      const inc = button('mc-plan-size-inc', '+ 10 cm', `${ax.name} 10 centimetres longer`, () => hand.step(ax.key, 1));
      inc.setAttribute('data-level-inc', '');
      g.append(dec, val, inc);
      bar.append(g);
    }
    if (sel.rotate) bar.append(button('mc-plan-rotate', sel.rotate, `${sel.rotate} ${sel.label}`, () => hand.rotate()));
    bar.append(
      button('mc-plan-remove', 'Remove', `Remove ${sel.label}`, () => hand.remove()),
      button('mc-plan-deselect', 'Done', 'Done with this element', () => hand.select(null)),
    );
  }

  const hotEls = new Map<string, HTMLButtonElement>();
  function paintHot(targets: HandTarget[]): void {
    const r = host.getBoundingClientRect();
    const inside = targets.filter((t) => t.x > r.left + 8 && t.x < r.right - 8 && t.y > r.top + 8 && t.y < r.bottom - 8);
    const keep = new Set(inside.map((t) => t.id));
    for (const [id, el] of hotEls) if (!keep.has(id)) { el.remove(); hotEls.delete(id); }
    for (const t of inside) {
      let near = Infinity;
      for (const u of inside) if (u !== t) near = Math.min(near, Math.hypot(u.x - t.x, u.y - t.y));
      const size = Math.max(HOT_MIN, Math.min(HOT_MAX, near * 0.9));
      let el = hotEls.get(t.id);
      if (!el) {
        el = doc.createElement('button');
        el.type = 'button';
        el.className = 'mc-plan-hot';
        el.setAttribute(HAND_HOT, '');
        el.tabIndex = -1;
        el.dataset.planId = t.id;
        el.addEventListener('click', (e) => { e.stopPropagation(); hand.select(el!.dataset.planId ?? null); refresh(true); });
        hot.append(el);
        hotEls.set(t.id, el);
      }
      el.dataset.kind = t.kind;
      if (el.getAttribute('aria-label') !== t.label) el.setAttribute('aria-label', t.label);
      el.style.left = `${Math.round(t.x - r.left - size / 2)}px`;
      el.style.top = `${Math.round(t.y - r.top - size / 2)}px`;
      el.style.width = el.style.height = `${Math.round(size)}px`;
    }
  }

  const handsOn = (): boolean => !!host.closest('.mc-gestures-on');
  const layoutEditing = (): boolean => !!host.closest('.mc-edit-canvas.mc-editing');
  const usable = (): boolean => on && handsOn() && !layoutEditing() && host.isConnected;
  const active = (): boolean => usable() && !view.is3D?.();
  /** The 3D view is showing: a held fist turns the model (nothing to edit). */
  const in3d = (): boolean => usable() && !!view.is3D?.();
  let orbit: { x: number; y: number } | null = null;

  let sig = '';
  function refresh(force = false): void {
    const act = active();
    const mode = act ? hand.mode() : null;
    const sel = act && mode!.tool === 'select' && !hand.busy() ? hand.selection() : null;
    const targets = act && !hand.busy() ? hand.targets() : [];
    const r = host.getBoundingClientRect();
    const turning = !act && in3d();
    const next = JSON.stringify([act, turning, !!orbit, mode, sel, targets.map((t) => [t.id, Math.round(t.x - r.left), Math.round(t.y - r.top), t.label])]);
    if (!force && next === sig) return;
    sig = next;
    host.classList.toggle('mc-plan-hand-on', act || turning);
    host.dataset.handTool = mode?.tool ?? '';
    banner.hidden = !mode && !turning;
    if (turning) {
      bannerText.textContent = orbit ? 'Turning the 3D view — open your hand to stop' : '3D view — hold a fist and move to turn the model';
      bannerReadout.hidden = true;
      banner.classList.toggle('is-live', !!orbit);
      banner.dataset.kind = '3d';
    }
    if (mode) {
      bannerText.textContent = mode.text;
      bannerReadout.textContent = mode.readout ?? '';
      bannerReadout.hidden = !mode.readout;
      banner.classList.toggle('is-live', mode.live);
      banner.dataset.kind = mode.kind;
    }
    bar.hidden = !sel;
    if (sel) buildBar(sel);
    else if (bar.childElementCount) { bar.innerHTML = ''; barKey = ''; }
    paintHot(targets);
  }

  /** On the drawing floor itself (not the palette, panel, bar or a button). */
  function onFloor(x: number, y: number): boolean {
    const el = doc.elementFromPoint(x, y);
    return !!el && host.contains(el) && !el.closest(CHROME);
  }

  const api: PlanHandSurface = {
    hand,
    journal,
    armed: (x, y) => (active() || in3d()) && onFloor(x, y),
    drawing: () => active() && hand.mode().kind !== 'select',
    tap(x, y) { if (in3d()) return; host.focus({ preventScroll: true }); hand.tap(x, y); refresh(); },
    fistStart(x, y) {
      if (in3d()) { orbit = { x, y }; refresh(); return true; }
      host.focus({ preventScroll: true });
      const ok = hand.fistStart(x, y);
      refresh();
      return ok;
    },
    fistMove(x, y) {
      if (orbit) { view.orbit3D?.(x - orbit.x, y - orbit.y); orbit = { x, y }; return; }
      hand.fistMove(x, y);
    },
    fistEnd() { if (orbit) orbit = null; else hand.fistEnd(); refresh(); },
    fistCancel() { if (orbit) orbit = null; else hand.fistCancel(); refresh(); },
    resizable: () => active() && !!hand.selection()?.axes.length,
    resizeBegin: () => hand.resizeBegin(),
    resizeTravel: (dx, dy) => hand.resizeTravel(dx, dy),
    resizeEnd() { hand.resizeEnd(); refresh(); },
    resizeCancel() { hand.resizeCancel(); refresh(); },
    enabled: () => on,
    setEnabled(v) { on = v; if (!v && hand.busy()) { hand.fistCancel(); hand.resizeCancel(); } refresh(true); },
    active,
    refresh,
    undo(steps, e) {
      if (e !== epoch) return 0;
      if (hand.busy()) { hand.fistCancel(); hand.resizeCancel(); }
      const n = journal.undo(steps);
      view.render();
      refresh(true);
      return n;
    },
    dispose() {
      mounted.delete(api);
      if (flushTimer) clearTimeout(flushTimer);
      host.removeEventListener('mousedown', onDown);
      host.removeEventListener('click', onClick);
      doc.defaultView?.removeEventListener('mouseup', onUp);
      journal.dispose();
      banner.remove(); bar.remove(); hot.remove();
    },
  };
  mounted.add(api);
  refresh(true);
  return api;
}
