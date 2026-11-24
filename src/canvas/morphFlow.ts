// MORPH FLOW: pinch-and-hold (or mouse/touch long-press) a tile ~1s, a small
// card names it, the mic opens, she speaks a change, Nano redacts on-device,
// Gemini returns ONE replacement tile that is spliced into the plan in place.
// This module owns the orchestration state machine (idle → hold → card →
// listening → working → done / cancel / undo), the amber hold ring, and the
// scoped-edit turn; the DOM card is morphCard.ts, the pure pieces are
// morphHold.ts / morphTarget.ts / morphEdit.ts, and the host (canvasApp)
// injects targets, engines, terminals/swarm and the apply/undo seams.
//
// Cancel before anything was asked logs nothing and never calls a model; a
// cancel mid-call discards the reply via a generation counter (nothing is
// ever applied from a cancelled turn).

import { createMorphHold, MORPH_FEEL, type MorphHold, type MorphPointerType, type MorphRelease } from './morphHold';
import type { MorphTargetRef } from './morphTarget';
import {
  applyMorphPatch, buildMorphPrompt, morphBoardLine, morphMeta, morphSummary,
  parseMorphTile, scriptedMorphJson,
} from '../ai/morphEdit';
import { protectText } from '../privacy/directory';
import type { SentInfo, SurfaceEngine } from './aiTurn';
import type { SurfacePlan } from './surfacePlan';
import type { DeviceIdSession } from '../privacy/deviceRedact';
import type { LogVerb } from './modelPanels';
import type { MorphCardUi } from './morphCard';

/** Mic auto-stop: one short phrase is expected, well under the global 15 s. */
export const MORPH_LISTEN_MS = 8000;
const PULSE_MS = 900;
const TICK_MS = 60;

export type MorphPhase = 'idle' | 'asking' | 'working' | 'done';

export interface MorphUiHooks {
  /** The aiSent-equivalent for a morph turn: Nano receipt + redact lines
   *  BEFORE a byte reaches the Gemini terminal, ledger, swarm pinned to the
   *  morphed tile. Implemented by the host so the privacy-order invariant
   *  stays in one place. */
  sent(s: SentInfo, o: { utterance: string; tileIndex: number; label: string }): void;
  log(engine: 'nano' | 'gemini', verb: LogVerb, detail: string): void;
  handoff(reason: string): void;
  /** Settle the swarm (the host may hold it on screen a minimum in sim). */
  settle(): Promise<void> | void;
  state(text: string): void;
}

export interface MorphFlowDeps {
  doc: Document;
  root: HTMLElement;
  card: MorphCardUi;
  /** Tile under (or near) the frozen hold point, or null → never arms. */
  resolveTarget(pt: { x: number; y: number }): MorphTargetRef | null;
  /** Nth stamped tile of the focused board (sim replay). */
  targetByIndex(index: number): MorphTargetRef | null;
  frameId(): string | null;
  plan(frameId: string): SurfacePlan | null;
  /** Edit mode on, a proposal waiting, review open, no focused board… */
  disabled(): boolean;
  /** Gemini engine with the scripted JSON this morph falls back to. */
  engine(json: string): SurfaceEngine;
  deviceIdSession?: DeviceIdSession;
  sim?: boolean;
  mic: { start(): void; stop(): void; supported(): boolean };
  /** Gate + swap the patched plan in + history push + render. `path` is the
   *  morphed tile's expandPlan path, so the host can self-check just that
   *  one tile after the splice. */
  apply(frameId: string, patched: SurfacePlan, summary: string, path?: number[]): boolean;
  /** When set, the patched tile is shown in the full-screen review and only
   *  applied after Approve — plan-first, same as a board build. */
  propose?(frameId: string, patched: SurfacePlan, summary: string, path?: number[]): Promise<boolean>;
  undo(): void;
  ui: MorphUiHooks;
  /** No mic (?sim=1, or a browser with no speech API): the card asks the
   *  user to type instead. true = reveal just the say box so it is
   *  reachable without opening the whole tools palette; false on every
   *  exit from the asking phase (runTurn starting, cancel, the listen cap
   *  firing with nothing typed). */
  typing?(on: boolean): void;
  /** True when the point is over UI that must survive an outside
   *  pointerdown while the card is open — the say box, its Go button, Talk
   *  — distinct from the card's own bounds, which are already excluded. */
  protectedPoint?(p: { x: number; y: number }): boolean;
  /** The hold just fired mid-pinch/press — the host suppresses the pending
   *  release so the control under the finger is not also clicked. */
  onFired?(target: MorphTargetRef): void;
  hold?: MorphHold;
  now?(): number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}

export interface MorphFlow {
  /** Pointer/pinch down over the canvas. True only when a hold armed. */
  beginHold(p: { x: number; y: number }, type: MorphPointerType): boolean;
  moveHold(p: { x: number; y: number }): void;
  /** 'tap' = released before the fire: the normal tap path runs unchanged. */
  endHold(): MorphRelease;
  cancelHold(): void;
  /** Tracking dropout (pointercancel): keep the armed hold alive for the grace
   *  window so a quick re-entry resumes it rather than restarting (A4-029). */
  pauseHold(): void;
  /** True while a pinch/press the classifier armed on is still down — the
   *  host uses this to suppress `pinch-hold-still` for that pinch. */
  holdActive(): boolean;
  isOpen(): boolean;
  phase(): MorphPhase;
  /** Morph-first speech routing: true = consumed (only while the card has a
   *  say in it). "cancel"/"undo" are meta-commands handled locally. */
  handleSpeech(text: string): boolean;
  /** Any pointer/pinch down: a quick press outside the open card cancels. */
  pointerDownAt(p: { x: number; y: number }): void;
  /** ?sim=1 replay: same classifier, injected clock, no camera or mic. */
  simulateHold(index: number): boolean;
  /** Swarm cursor landed on the tile: pulse the amber outline. */
  pulseTarget(): void;
  /** Card timers ran out (done/empty/error states auto-dismissed). */
  onCardAutoClosed(): void;
  /** Open the morph card on a already-resolved tile (phone tap-to-select + mic). */
  ask(target: MorphTargetRef, opts?: { startMic?: boolean }): boolean;
  cancel(): void;
  destroy(): void;
}

export function createMorphFlow(deps: MorphFlowDeps): MorphFlow {
  const hold = deps.hold ?? createMorphHold(MORPH_FEEL);
  const now = deps.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const setT = deps.setTimer ?? setTimeout;
  const clearT = deps.clearTimer ?? clearTimeout;

  let phase: MorphPhase = 'idle';
  let target: MorphTargetRef | null = null;
  let frameId: string | null = null;
  let lastP = { x: 0, y: 0 };
  let gen = 0; // cancel() bumps it; an in-flight turn checks after every await
  let ticker: ReturnType<typeof setTimeout> | null = null;
  let listenTimer: ReturnType<typeof setTimeout> | null = null;
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;

  // Amber hold ring at the frozen point: progress is SHOWN, not hidden in a
  // timer (the visionOS idea) — releasing before the fill completes aborts.
  const ring = deps.doc.createElement('div');
  ring.className = 'mc-morph-ring';
  ring.setAttribute('aria-hidden', 'true');
  ring.hidden = true;
  deps.root.append(ring);

  const hostEl = (): HTMLElement | null => (target ? (target.host as unknown as HTMLElement) : null);

  function showRing(p: { x: number; y: number }): void {
    ring.hidden = false;
    ring.style.left = `${p.x - 22}px`;
    ring.style.top = `${p.y - 22}px`;
    paintRing(0);
  }
  function paintRing(progress: number): void {
    const deg = Math.round(progress * 360);
    ring.style.background = `conic-gradient(#C98B3C ${deg}deg, rgba(201, 139, 60, 0.18) ${deg}deg)`;
  }
  function hideRing(): void { ring.hidden = true; }

  function stopTicker(): void {
    if (ticker !== null) { clearT(ticker); ticker = null; }
  }
  function startTicker(): void {
    stopTicker();
    const tick = (): void => {
      if (!hold.armed || hold.fired) { stopTicker(); return; }
      const t = now();
      paintRing(hold.progress(t));
      handleHoldEvent(hold.update(lastP, t));
      if (hold.armed && !hold.fired) ticker = setT(tick, TICK_MS);
    };
    ticker = setT(tick, TICK_MS);
  }

  function clearListenTimer(): void {
    if (listenTimer !== null) { clearT(listenTimer); listenTimer = null; }
  }

  function clearOutline(): void {
    hostEl()?.classList.remove('mc-morph-target', 'is-morph-pulse');
    if (pulseTimer !== null) { clearT(pulseTimer); pulseTimer = null; }
  }

  function dropHold(): void {
    stopTicker();
    hideRing();
    if (phase === 'idle') target = null;
  }

  function onEsc(e: Event): void {
    if ((e as KeyboardEvent).key !== 'Escape') return;
    if (!deps.card.isOpen()) return;
    e.stopPropagation();
    cancel();
  }
  deps.doc.addEventListener?.('keydown', onEsc, true);

  function fire(opts?: { startMic?: boolean }): void {
    stopTicker();
    hideRing();
    const t = target!;
    phase = 'asking';
    (t.host as unknown as HTMLElement).classList?.add('mc-morph-target');
    deps.onFired?.(t);
    const startMic = opts?.startMic !== false;
    const listening = startMic && deps.mic.supported();
    deps.card.open({ label: t.label, rect: t.rect, listening });
    if (listening) deps.mic.start();
    else if (startMic) deps.typing?.(true);
    clearListenTimer();
    if (!startMic) return;
    // Nothing spoken by the cap: close the mic, say so, make no model call.
    listenTimer = setT(() => {
      if (phase !== 'asking') return;
      deps.mic.stop();
      deps.typing?.(false);
      clearOutline();
      phase = 'idle';
      deps.card.showEmpty();
    }, MORPH_LISTEN_MS);
  }

  function ask(resolved: MorphTargetRef, opts?: { startMic?: boolean }): boolean {
    if (phase !== 'idle' || hold.armed || deps.disabled()) return false;
    const fid = deps.frameId();
    if (!fid) return false;
    target = resolved;
    frameId = fid;
    fire({ startMic: opts?.startMic !== false });
    return true;
  }

  function handleHoldEvent(ev: 'none' | 'fired' | 'cancelled'): void {
    if (ev === 'fired') fire();
    else if (ev === 'cancelled') dropHold(); // slop crossed: fall through to whatever it was
  }

  function beginHold(p: { x: number; y: number }, type: MorphPointerType): boolean {
    // Hand re-entered after a brief tracking dropout: resume the same hold
    // (the grace window is still open) instead of starting a fresh ~900ms one.
    if (hold.paused) {
      if (hold.arm(p, type, now())) { lastP = { x: p.x, y: p.y }; if (ticker === null) startTicker(); return true; }
      return false;
    }
    if (phase !== 'idle' || hold.armed || deps.disabled()) return false;
    const resolved = deps.resolveTarget(p);
    if (!resolved) return false;
    const fid = deps.frameId();
    if (!fid) return false;
    if (!hold.arm(p, type, now())) return false;
    target = resolved;
    frameId = fid;
    lastP = { x: p.x, y: p.y };
    showRing(p);
    startTicker();
    return true;
  }

  function moveHold(p: { x: number; y: number }): void {
    if (!hold.armed || hold.fired) return;
    lastP = { x: p.x, y: p.y };
    handleHoldEvent(hold.update(lastP, now()));
  }

  function endHold(): MorphRelease {
    const r = hold.release(now());
    if (r === 'tap') dropHold(); // the existing tap path runs unchanged
    else if (r === 'after-fire') { stopTicker(); hideRing(); }
    return r;
  }

  function cancelHold(): void {
    hold.cancel();
    dropHold();
  }

  function pauseHold(): void {
    hold.pause(now());
    // The ticker keeps running (hold stays armed) and will emit 'cancelled'
    // once the grace window lapses, tearing down through handleHoldEvent.
  }

  function cancel(): void {
    gen++;
    const wasWorking = phase === 'working';
    clearListenTimer();
    deps.mic.stop();
    deps.typing?.(false);
    deps.card.close();
    clearOutline();
    hold.cancel();
    dropHold();
    phase = 'idle';
    target = null;
    if (wasWorking) {
      // The model was already called; be honest that its reply is discarded.
      deps.ui.log('gemini', 'note', 'cancelled — the reply will not be applied');
      void deps.ui.settle();
    }
  }

  function finishAfterCard(): void {
    clearOutline();
    deps.typing?.(false);
    phase = 'idle';
    target = null;
  }

  async function settleFail(why: string): Promise<void> {
    await deps.ui.settle();
    deps.ui.log('gemini', 'note', why);
    deps.ui.state("Couldn't make that change.");
    clearOutline();
    phase = 'idle';
    deps.card.showError("Couldn't make that change.");
  }

  async function runTurn(utterance: string): Promise<void> {
    const t = target!;
    const fid = frameId!;
    const plan = deps.plan(fid);
    if (!plan) { deps.card.showError("That board changed — pinch-hold again."); phase = 'idle'; clearOutline(); return; }
    const g = ++gen;
    phase = 'working';
    clearListenTimer();
    deps.mic.stop();
    deps.typing?.(false);
    deps.card.showWorking(`Changing ${t.label}…`);
    // Nano's on-device leg: the raw words become tokens BEFORE the prompt
    // exists; the cloud only ever sees the redacted utterance + this one tile.
    const redacted = protectText(utterance).text;
    const prompt = buildMorphPrompt(t.spec, redacted, morphBoardLine(plan), { deviceIdSession: deps.deviceIdSession });
    const engine = deps.engine(scriptedMorphJson(t.spec, utterance));
    const base = 'Gemini · cloud — sent your redacted words and this one tile, nothing else';
    const sent: SentInfo = {
      engine: 'gemini',
      prompt,
      sent: 'your words (names redacted) and one tile. No other tiles, no device addresses.',
      routeLine: engine.routeLine ?? (engine.sim ? `SIM · ${base}` : base),
      sim: engine.sim,
    };
    deps.ui.sent(sent, { utterance, tileIndex: t.path[0] ?? 0, label: t.label });
    deps.ui.handoff(`edit one tile: ${t.label}`);
    deps.ui.log('gemini', 'plan', `revise ${t.label}; everything else stays put`);
    let full = '';
    try {
      full = await engine.stream(prompt, () => {});
    } catch {
      if (g !== gen) return;
      if (!engine.fallback) { await settleFail('the model didn’t answer'); return; }
      deps.ui.log('gemini', 'note', 'SIM · the model didn’t answer, so a prepared edit is waiting');
      try { full = await engine.fallback.stream(prompt, () => {}); }
      catch { if (g === gen) await settleFail('the model didn’t answer'); return; }
    }
    if (g !== gen) return;
    const parsed = parseMorphTile(full, t.spec, deps.deviceIdSession);
    if (!parsed.ok) { await settleFail(`refused the tile: ${parsed.error}`); return; }
    const patched = applyMorphPatch(plan, t.path, parsed.value);
    if (!patched) { await settleFail('the tile is no longer where it was'); return; }
    await deps.ui.settle();
    if (g !== gen) return;
    const summary = morphSummary(t.label, utterance);
    deps.ui.log('gemini', 'plan', summary);
    const accepted = deps.propose
      ? await deps.propose(fid, patched, summary, t.path)
      : deps.apply(fid, patched, summary, t.path);
    if (g !== gen) return;
    if (!accepted) {
      deps.card.showError('Dropped. Nothing changed.');
      clearOutline();
      phase = 'idle';
      deps.ui.state('Dropped. Nothing changed.');
      return;
    }
    deps.ui.log('gemini', 'build', `patched ${t.label}`);
    deps.ui.log('gemini', 'done', 'one tile changed');
    deps.ui.state(`Changed ${t.label}. Undo is on the card.`);
    phase = 'done';
    deps.card.showDone();
  }

  function handleSpeech(text: string): boolean {
    if (phase === 'asking') {
      const meta = morphMeta(text);
      if (meta === 'cancel') { cancel(); deps.ui.state('Cancelled. Nothing changed.'); return true; }
      if (meta === 'undo') { cancel(); deps.undo(); return true; }
      void runTurn(text);
      return true;
    }
    if (phase === 'working') {
      if (morphMeta(text) === 'cancel') { cancel(); deps.ui.state('Cancelled. Nothing changed.'); return true; }
      deps.ui.state(`Still changing ${target?.label ?? 'the tile'}…`);
      return true;
    }
    if (phase === 'done') {
      if (morphMeta(text) === 'undo') {
        deps.undo();
        deps.card.close();
        finishAfterCard();
        return true;
      }
      deps.card.close();
      finishAfterCard();
      return false; // the board command runs normally
    }
    return false;
  }

  function pointerDownAt(p: { x: number; y: number }): void {
    if (!deps.card.isOpen() || phase === 'idle') return;
    const r = deps.card.el.getBoundingClientRect?.();
    if (r && p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height) return;
    if (deps.protectedPoint?.(p)) return;
    cancel();
  }

  function simulateHold(index: number): boolean {
    if (phase !== 'idle' || hold.armed || deps.disabled()) return false;
    const resolved = deps.targetByIndex(index);
    const fid = deps.frameId();
    if (!resolved || !fid) return false;
    const c = { x: resolved.rect.left + resolved.rect.width / 2, y: resolved.rect.top + resolved.rect.height / 2 };
    const t0 = now();
    if (!hold.arm(c, 'mouse', t0)) return false;
    target = resolved;
    frameId = fid;
    lastP = c;
    // The same classifier decides, on an injected clock: arm, hold exactly
    // holdMs with no movement, release after the fire — deterministic.
    const ev = hold.update(c, t0 + MORPH_FEEL.holdMs);
    hold.release(t0 + MORPH_FEEL.holdMs + 1);
    if (ev !== 'fired') { dropHold(); return false; }
    fire();
    return true;
  }

  function pulseTarget(): void {
    const el = hostEl();
    if (!el || phase === 'idle') return;
    el.classList.add('is-morph-pulse');
    if (pulseTimer !== null) clearT(pulseTimer);
    pulseTimer = setT(() => { el.classList.remove('is-morph-pulse'); pulseTimer = null; }, PULSE_MS);
  }

  return {
    beginHold,
    moveHold,
    endHold,
    cancelHold,
    pauseHold,
    holdActive: () => hold.armed,
    isOpen: () => deps.card.isOpen(),
    phase: () => phase,
    handleSpeech,
    pointerDownAt,
    simulateHold,
    pulseTarget,
    onCardAutoClosed: finishAfterCard,
    ask,
    cancel,
    destroy() {
      gen++;
      stopTicker();
      clearListenTimer();
      clearOutline();
      deps.doc.removeEventListener?.('keydown', onEsc, true);
      ring.remove();
    },
  };
}

/** DOM pointer adapter: mouse + touch long-press on the board feed the SAME
 *  classifier the hand path uses. No preventDefault on the way down — taps,
 *  clicks and drags are untouched; only a hold that actually FIRED swallows
 *  the one click the released press would otherwise deliver to the tile. */
export function attachMorphPointers(el: HTMLElement, flow: MorphFlow, doc: Document = el.ownerDocument): () => void {
  let activePointer: number | null = null;
  let suppressClickUntil = 0;

  const onDown = (e: PointerEvent): void => {
    flow.pointerDownAt({ x: e.clientX, y: e.clientY });
    if (e.pointerType !== 'mouse' && e.pointerType !== 'touch') return; // 'pen' is handPointer's synthetic drag stream
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const armed = flow.beginHold({ x: e.clientX, y: e.clientY }, e.pointerType === 'touch' ? 'touch' : 'mouse');
    if (armed) activePointer = e.pointerId;
  };
  const onMove = (e: PointerEvent): void => {
    if (e.pointerId === activePointer) flow.moveHold({ x: e.clientX, y: e.clientY });
  };
  const onUp = (e: PointerEvent): void => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    if (flow.endHold() === 'after-fire') suppressClickUntil = Date.now() + 800;
  };
  const onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    flow.pauseHold(); // keep the hold alive through a brief tracking dropout (grace window)
  };
  const onClick = (e: MouseEvent): void => {
    if (Date.now() < suppressClickUntil) {
      suppressClickUntil = 0;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onContextMenu = (e: Event): void => {
    if (flow.holdActive() || flow.isOpen()) e.preventDefault(); // touch long-press menu never over a morph
  };

  el.addEventListener('pointerdown', onDown);
  doc.addEventListener('pointermove', onMove);
  doc.addEventListener('pointerup', onUp);
  doc.addEventListener('pointercancel', onPointerCancel);
  doc.addEventListener('click', onClick, true);
  el.addEventListener('contextmenu', onContextMenu);
  return () => {
    el.removeEventListener('pointerdown', onDown);
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
    doc.removeEventListener('pointercancel', onPointerCancel);
    doc.removeEventListener('click', onClick, true);
    el.removeEventListener('contextmenu', onContextMenu);
  };
}
