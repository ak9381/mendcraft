import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_KEY, applySendGlow, createArrivalGate, flagArrived, flashSent, sendGlowView,
  type ArrivalStore, type GlowFrame, type GlowPill,
} from '../../src/canvas/boardGlow';
import { createBoardEdgeTransferController, type EdgeGlow } from '../../src/canvas/edgeTransfer';
import { applyGuestSnapshot } from '../../src/canvas/phoneCanvasRuntime';
import { buildControlSnapshot, coerceSnapshot } from '../../src/relay/controlSnapshot';
import type { SurfacePlan } from '../../src/canvas/surfacePlan';

// Minimal fake frame (the suite runs in node, no jsdom).
function fakeFrame() {
  const classes = new Set<string>();
  const vars = new Map<string, string>();
  const pills: (GlowPill & { attrs: Record<string, string> })[] = [];
  const el: GlowFrame & { classes: Set<string>; vars: Map<string, string>; pills: typeof pills } = {
    classes, vars, pills,
    classList: {
      toggle: (c, on) => { const v = on ?? !classes.has(c); if (v) classes.add(c); else classes.delete(c); return v; },
      add: (c) => { classes.add(c); },
      remove: (c) => { classes.delete(c); },
    },
    appendChild: () => undefined,
    style: { setProperty: (k, v) => { vars.set(k, v); }, removeProperty: (k) => { vars.delete(k); return ''; } },
    querySelector: (sel) => {
      const m = /data-pill="(\w+)"/.exec(sel);
      return m ? pills.find((p) => p.dataset.pill === m[1]) ?? null : null;
    },
    ownerDocument: {
      createElement: () => {
        const p = { className: '', textContent: '', hidden: false, dataset: {} as Record<string, string | undefined>, attrs: {} as Record<string, string>, setAttribute(k: string, v: string) { p.attrs[k] = v; } };
        pills.push(p);
        return p;
      },
    },
  };
  return el;
}

describe('sendGlowView / applySendGlow (the dragged board lights up)', () => {
  it('off at 0 and without a target; on with the phone name past the threshold', () => {
    expect(sendGlowView(0, 'ios').on).toBe(false);
    expect(sendGlowView(0.04, 'ios').on).toBe(false);
    expect(sendGlowView(0.9, null).on).toBe(false);
    expect(sendGlowView(0.5, 'ios')).toEqual({ on: true, intensity: 0.5, label: 'Hold to send to iPhone' });
    expect(sendGlowView(3, 'android')).toEqual({ on: true, intensity: 1, label: 'Hold to send to Nothing phone' });
  });

  it('toggles the class, the intensity and the pill with the glow value', () => {
    const el = fakeFrame();
    applySendGlow(el, sendGlowView(0.3, 'ios'));
    expect(el.classes.has('mc-frame-sending')).toBe(true);
    expect(el.vars.get('--mc-send-glow')).toBe('0.300');
    expect(el.pills).toHaveLength(1);
    expect(el.pills[0].textContent).toBe('Hold to send to iPhone');
    applySendGlow(el, sendGlowView(1, 'ios'));
    expect(el.vars.get('--mc-send-glow')).toBe('1.000');
    expect(el.pills).toHaveLength(1); // the same pill, updated
    applySendGlow(el, sendGlowView(0, 'ios'));
    expect(el.classes.has('mc-frame-sending')).toBe(false);
    expect(el.vars.has('--mc-send-glow')).toBe(false);
    expect(el.pills[0].hidden).toBe(true);
  });

  it('a send flashes once and clears the sending glow', () => {
    const el = fakeFrame();
    applySendGlow(el, sendGlowView(1, 'android'));
    const later: (() => void)[] = [];
    flashSent(el, (fn) => later.push(fn));
    expect(el.classes.has('mc-frame-sending')).toBe(false);
    expect(el.classes.has('mc-frame-sent')).toBe(true);
    later.forEach((f) => f());
    expect(el.classes.has('mc-frame-sent')).toBe(false);
  });

  it('the arrived board says "Moved from laptop", then fades', () => {
    const el = fakeFrame();
    const later: (() => void)[] = [];
    flagArrived(el, (fn) => later.push(fn));
    expect(el.classes.has('mc-frame-arrived')).toBe(true);
    expect(el.pills[0].textContent).toBe('Moved from laptop');
    later.forEach((f) => f());
    expect(el.classes.has('mc-frame-arrived')).toBe(false);
    expect(el.pills[0].hidden).toBe(true);
  });
});

describe('board edge controller reports the frame + phone for the glow', () => {
  it('a move into the iPhone edge carries frameId and target; the clear does not', () => {
    const glows: EdgeGlow[] = [];
    const c = createBoardEdgeTransferController({
      getViewportWidth: () => 1000, getLayout: () => ({ left: 'ios', right: null }),
      getRect: () => ({ x: 0, y: 0, w: 10, h: 10 }), restoreRect: () => undefined,
      getBoard: () => null, onGlow: (g) => glows.push(g), onCommit: () => undefined,
      now: () => 0, every: () => 1, stopEvery: () => undefined,
    });
    c.handleBoardDrag({ frameId: 'f1', phase: 'start', clientX: 500, clientY: 0 });
    c.handleBoardDrag({ frameId: 'f1', phase: 'move', clientX: 10, clientY: 0 });
    expect(glows.at(-1)).toMatchObject({ side: 'left', frameId: 'f1', target: 'ios' });
    expect(sendGlowView(glows.at(-1)!.glow, glows.at(-1)!.target).on).toBe(true);
    c.handleBoardDrag({ frameId: 'f1', phase: 'end', clientX: NaN, clientY: NaN });
    expect(glows.at(-1)).toEqual({ side: null, glow: 0 });
  });
});

function memStore(): ArrivalStore & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); } };
}

const BOARD: SurfacePlan = { kind: 'room', title: 'Living room', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }] } as SurfacePlan;

describe('arrival gate (phone: "Moved from laptop" only for a real new send)', () => {
  const NOW = 1_800_000_000_000;
  it('a new send lights; the same send replayed or republished does not', () => {
    const g = createArrivalGate(memStore());
    const sent = { board: BOARD, boardFor: 'ios' as const, boardSend: { id: 'a1', at: NOW } };
    expect(g.isNew(sent, 'ios', NOW + 500)).toBe(true);
    expect(g.isNew(sent, 'ios', NOW + 900)).toBe(false); // replay on re-pair
    expect(g.isNew({ board: BOARD, boardFor: 'ios' }, 'ios', NOW + 1000)).toBe(false); // republish / keep-alive
    expect(g.isNew({ ...sent, boardSend: { id: 'a2', at: NOW + 2000 } }, 'ios', NOW + 2100)).toBe(true); // sent again
  });

  it('remembers across an app reload (persisted)', () => {
    const store = memStore();
    const sent = { board: BOARD, boardSend: { id: 'b1', at: NOW } };
    expect(createArrivalGate(store).isNew(sent, 'android', NOW)).toBe(true);
    expect(store.m.get(ARRIVAL_KEY)).toBe('b1');
    expect(createArrivalGate(store).isNew(sent, 'android', NOW + 5000)).toBe(false);
  });

  it('not for the other phone, not without a board, not a stale stamp', () => {
    const g = createArrivalGate(null);
    expect(g.isNew({ board: BOARD, boardFor: 'ios', boardSend: { id: 'c1', at: NOW } }, 'android', NOW)).toBe(false);
    expect(g.isNew({ boardSend: { id: 'c2', at: NOW } }, 'ios', NOW)).toBe(false);
    expect(g.isNew({ board: BOARD, boardSend: { id: 'c3', at: NOW - 60 * 60_000 } }, 'ios', NOW)).toBe(false);
  });

  it('end to end: the wire stamp survives coerce and applyGuestSnapshot passes arrived once', () => {
    const wire = JSON.parse(JSON.stringify(buildControlSnapshot({ rev: 7, board: BOARD, boardFor: 'ios', boardSend: { id: 'd1', at: NOW } })));
    expect(wire.boardSend).toEqual({ id: 'd1', at: NOW });
    const snap = coerceSnapshot(wire)!;
    expect(snap.boardSend).toEqual({ id: 'd1', at: NOW });
    const infos: unknown[] = [];
    const arrival = { gate: createArrivalGate(memStore()), now: () => NOW };
    applyGuestSnapshot(snap, (_p, _d, info) => infos.push(info ?? null), 'ios', arrival);
    applyGuestSnapshot({ ...snap, rev: 9 } as typeof snap, (_p, _d, info) => infos.push(info ?? null), 'ios', arrival);
    expect(infos).toEqual([{ arrived: true }, null]);
    // A republish carries no stamp; junk stamps are dropped.
    expect(buildControlSnapshot({ rev: 8, board: BOARD, boardFor: 'ios' }).boardSend).toBeUndefined();
    expect(buildControlSnapshot({ rev: 8, board: BOARD, boardSend: { id: '<script>', at: NOW } }).boardSend).toBeUndefined();
    expect(buildControlSnapshot({ rev: 8, boardSend: { id: 'x', at: NOW } }).boardSend).toBeUndefined();
  });
});
