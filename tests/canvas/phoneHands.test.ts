// Phone hand control (phoneHands.ts): the Hands pill (persisted, off on
// first run), camera only on toggle, frames → the pointer (mirrored to camera
// space) only while on, the facing gate from the same frames, the look-to-edit
// lock, the camera indicator, a denied camera turning it back off — and that
// touch is never intercepted and hand actions never reach the AI feed.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mountPhoneHands, PHONE_HANDS_ON_LINE } from '../../src/canvas/phoneHands';
import { createPhoneCamera, PHONE_HANDS_KEY } from '../../src/canvas/phoneCamera';
import { phoneReach } from '../../src/canvas/handFeel';
import type { PresenceFrame } from '../../src/input/presence';

type Listener = (e: { type: string; target: unknown }) => void;
class El {
  className = ''; title = ''; textContent = ''; innerHTML = ''; hidden = false; type = '';
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: El[] = [];
  parent: El | null = null;
  listeners = new Map<string, Listener[]>();
  classes = new Set<string>();
  ownerDocument: unknown;
  constructor(doc: unknown) { this.ownerDocument = doc; }
  classList = {
    toggle: (c: string, on?: boolean) => { const v = on ?? !this.classes.has(c); if (v) this.classes.add(c); else this.classes.delete(c); return v; },
    remove: (c: string) => { this.classes.delete(c); },
    contains: (c: string) => this.classes.has(c),
  };
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  append(...els: El[]) { for (const e of els) { e.parent = this; this.children.push(e); } }
  get lastElementChild() { return this.children.at(-1) ?? null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  addEventListener(type: string, fn: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]); }
  removeEventListener(type: string, fn: Listener) { this.listeners.set(type, (this.listeners.get(type) ?? []).filter((f) => f !== fn)); }
  click() { for (const fn of this.listeners.get('click') ?? []) fn({ type: 'click', target: this }); }
}
function fakeRoot() {
  const doc: { createElement: (t: string) => El } = { createElement: () => new El(doc) };
  return new El(doc);
}
function fakeStream() {
  const track = { readyState: 'live', stop: vi.fn(() => { track.readyState = 'ended'; }) };
  return { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
}
function memStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
}
const pt = (x: number, y: number) => ({ x, y });
const frame = (opts: { hands?: number; handGate?: boolean | null; face?: boolean } = {}): PresenceFrame => ({
  hands: Array.from({ length: opts.hands ?? 1 }, () => ({ points: Array.from({ length: 21 }, () => pt(0.3, 0.5)), label: 'Right' })) as unknown as PresenceFrame['hands'],
  rejectedHands: [],
  faces: opts.face === false ? [] : [{ box: { x: 0, y: 0, w: 1, h: 1, cx: 0.5, cy: 0.5 }, isOperator: true, facing: true, handGate: opts.handGate ?? null, dim: false }],
  facing: true, registered: false, paused: false, aspect: 640 / 480,
});

function setup(opts: { storage?: ReturnType<typeof memStorage>; gumFails?: Error; locked?: () => boolean } = {}) {
  const getUserMedia = vi.fn(async () => { if (opts.gumFails) throw opts.gumFails; return fakeStream(); });
  let feed: ((f: PresenceFrame) => void) | null = null;
  const createTracker = vi.fn((_e: () => void, onFrame: (f: PresenceFrame) => void) => {
    feed = onFrame;
    return { start: vi.fn(async () => undefined), stop: vi.fn() };
  });
  const camera = createPhoneCamera({ getUserMedia, createTracker, doc: null, now: () => 0 });
  const pointer = { update: vi.fn(), lost: vi.fn(), setFacing: vi.fn(), cursors: vi.fn(() => []) };
  const say = vi.fn();
  const storage = opts.storage ?? memStorage();
  const root = fakeRoot();
  const aspects: number[] = [];
  const hands = mountPhoneHands(root as unknown as HTMLElement, {
    camera, pointer, reach: () => phoneReach(null), storage, say, overlay: false,
    locked: opts.locked, onAspect: (a) => aspects.push(a), now: () => 1000,
  });
  return { hands, camera, pointer, say, storage, root, getUserMedia, createTracker, aspects, feed: (f: PresenceFrame) => feed?.(f) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('phone Hands pill', () => {
  it('is off on first run and opens no camera until tapped', async () => {
    const s = setup();
    await flush();
    expect(s.hands.isOn()).toBe(false);
    expect(s.hands.pill.getAttribute('aria-pressed')).toBe('false');
    expect(s.getUserMedia).not.toHaveBeenCalled();
    expect(s.hands.indicator.hidden).toBe(true);
    (s.hands.pill as unknown as El).click();
    await flush(); await flush();
    expect(s.getUserMedia).toHaveBeenCalledTimes(1);
    expect(s.hands.isOn()).toBe(true);
    expect(s.hands.pill.getAttribute('aria-pressed')).toBe('true');
    expect(s.storage.m.get(PHONE_HANDS_KEY)).toBe('1');
    expect(s.hands.indicator.hidden).toBe(false); // camera-on indicator
    expect(s.root.classes.has('is-phone-hands')).toBe(true);
    expect(s.say).toHaveBeenCalledWith(PHONE_HANDS_ON_LINE);
    await s.hands.setOn(false);
    expect(s.storage.m.has(PHONE_HANDS_KEY)).toBe(false);
    expect(s.hands.indicator.hidden).toBe(true);
    expect(s.camera.status()).toBe('off');
  });

  it('a second tap while the camera is still starting turns it straight back off', async () => {
    const s = setup();
    const first = s.hands.setOn(true);
    await s.hands.setOn(false);
    await first;
    expect(s.hands.isOn()).toBe(false);
    expect(s.hands.pill.getAttribute('aria-pressed')).toBe('false');
    expect(s.camera.status()).toBe('off');
    expect(s.storage.m.has(PHONE_HANDS_KEY)).toBe(false);
  });

  it('resumes when it was left on (persisted)', async () => {
    const s = setup({ storage: memStorage({ [PHONE_HANDS_KEY]: '1' }) });
    await flush(); await flush();
    expect(s.hands.isOn()).toBe(true);
    expect(s.getUserMedia).toHaveBeenCalledTimes(1);
  });

  it('a denied camera turns Hands back off and says why', async () => {
    const s = setup({ gumFails: Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' }) });
    await s.hands.setOn(true);
    await flush();
    expect(s.hands.isOn()).toBe(false);
    expect(s.storage.m.has(PHONE_HANDS_KEY)).toBe(false);
    expect(s.say).toHaveBeenCalled();
    expect(String(s.say.mock.calls.at(-1)?.[0])).toMatch(/camera|blocked|allow|permission/i);
  });
});

describe('phone hand frames', () => {
  it('feed the pointer un-mirrored (camera space) only while on, with the aspect', async () => {
    const s = setup();
    await s.hands.setOn(true);
    s.feed(frame());
    expect(s.pointer.update).toHaveBeenCalledTimes(1);
    const [hands] = s.pointer.update.mock.calls[0] as [{ x: number }[][]];
    expect(hands[0][0].x).toBeCloseTo(0.7); // selfie 0.3 → camera 0.7
    expect((hands[0] as unknown as { label?: string }).label).toBe('Right');
    expect(s.aspects).toEqual([640 / 480]);
    await s.hands.setOn(false);
    s.hands.frame(frame());
    expect(s.pointer.update).toHaveBeenCalledTimes(1);
    expect(s.pointer.lost).toHaveBeenCalled();
  });

  it('facing gate: the operator handGate from the same frame; no face = unknown (null)', async () => {
    const s = setup();
    await s.hands.setOn(true);
    s.feed(frame({ handGate: false }));
    expect(s.pointer.setFacing).toHaveBeenLastCalledWith(false, 1000);
    s.feed(frame({ handGate: true }));
    expect(s.pointer.setFacing).toHaveBeenLastCalledWith(true, 1000);
    s.feed(frame({ face: false }));
    expect(s.pointer.setFacing).toHaveBeenLastCalledWith(null, 1000);
    s.feed(frame({ handGate: null }));
    expect(s.pointer.setFacing).toHaveBeenLastCalledWith(null, 1000);
  });

  it('look-to-edit lock: hands do nothing while the board is locked', async () => {
    let locked = false;
    const s = setup({ locked: () => locked });
    await s.hands.setOn(true);
    s.feed(frame());
    locked = true;
    s.feed(frame());
    expect(s.pointer.update).toHaveBeenCalledTimes(1);
    expect(s.pointer.lost).toHaveBeenCalledTimes(1);
  });

  it('touch is never intercepted: no touch/pointer listeners anywhere, only the pill click', async () => {
    const s = setup();
    await s.hands.setOn(true);
    const all = [s.root, ...s.root.children];
    for (const el of all) {
      for (const type of el.listeners.keys()) expect(['click']).toContain(type);
    }
    expect(s.root.listeners.size).toBe(0);
    // A control tapped while hands are on still gets its own click.
    const tile = new El(s.root.ownerDocument);
    const onTap = vi.fn();
    tile.addEventListener('click', onTap);
    s.root.append(tile);
    s.feed(frame());
    tile.click();
    expect(onTap).toHaveBeenCalledTimes(1);
  });
});

describe('hand actions are not AI', () => {
  it('phoneHands has no AI feed; canvasApp sends hand clicks/grabs to the local activity log only', () => {
    const src = readFileSync(new URL('../../src/canvas/phoneHands.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/aiFeed|phoneAiFeed|AiFeed/);
    const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    const onHand = app.slice(app.indexOf('onHandEvent: (ev) => {'), app.indexOf('onBoardMove: (ev) => {'));
    expect(onHand).toMatch(/activityLog\.push/);
    expect(onHand).not.toMatch(/aiFeed|phoneAiFeed|panels\./);
  });

  it('the phone CSS keeps every hand layer pointer-events: none', () => {
    const css = readFileSync(new URL('../../src/canvas/canvas.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.mc-canvas \.hand-overlay \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.mc-hand-frame, \.mc-hand-cursor \{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.mc-phone-simple \.mc-cam-on:not\(\[hidden\]\) \{[^}]*pointer-events: none/);
  });
});
