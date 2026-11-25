// Phone hand control (phoneHands.ts): the Hands pill (persisted, off on
// first run), camera only on toggle, frames → the pointer (mirrored to camera
// space) only while on, the facing gate from the same frames, the look-to-edit
// lock, the camera indicator, a denied camera turning it back off — and that
// touch is never intercepted and hand actions never reach the AI feed.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { mountPhoneHands, PHONE_HANDS_FACE_LINE, PHONE_HANDS_LOST_LINE, PHONE_HANDS_ON_LINE } from '../../src/canvas/phoneHands';
import { CameraLostError, createPhoneCamera, PHONE_HANDS_KEY, phoneHandsAllowed, phoneSensingAllowed } from '../../src/canvas/phoneCamera';
import { createPhoneSensor, PHONE_SENSOR_KEY, SENSOR_ON_LINE } from '../../src/canvas/phoneSensor';
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

function setup(opts: { storage?: ReturnType<typeof memStorage>; gumFails?: Error; locked?: () => boolean; startGate?: Promise<void>; gestures?: { frame: ReturnType<typeof vi.fn>; setActive: ReturnType<typeof vi.fn>; lost: ReturnType<typeof vi.fn> }; gesturesBlocked?: () => boolean } = {}) {
  const getUserMedia = vi.fn(async () => { if (opts.gumFails) throw opts.gumFails; return fakeStream(); });
  let feed: ((f: PresenceFrame) => void) | null = null;
  let lost: (() => void) | null = null;
  const createTracker = vi.fn((_e: () => void, onFrame: (f: PresenceFrame) => void, o: { onCameraLost: () => void }) => {
    feed = onFrame;
    lost = o.onCameraLost;
    return { start: vi.fn(async () => { await opts.startGate; }), stop: vi.fn() };
  });
  const timers: (() => void)[] = [];
  const camera = createPhoneCamera({
    getUserMedia, createTracker, doc: null, win: null, now: () => 0,
    setTimeout: (fn) => { timers.push(fn); return timers.length; }, clearTimeout: () => undefined,
  });
  let gated = false;
  const pointer = { update: vi.fn(), lost: vi.fn(), setFacing: vi.fn(), cursors: vi.fn(() => []), handsLocked: vi.fn(() => gated) };
  const say = vi.fn();
  const storage = opts.storage ?? memStorage();
  const root = fakeRoot();
  const aspects: number[] = [];
  const hands = mountPhoneHands(root as unknown as HTMLElement, {
    camera, pointer, reach: () => phoneReach(null), storage, say, overlay: false,
    locked: opts.locked, onAspect: (a) => aspects.push(a), now: () => 1000,
    gestures: opts.gestures as never, gesturesBlocked: opts.gesturesBlocked,
  });
  return {
    hands, camera, pointer, say, storage, root, getUserMedia, createTracker, aspects, timers,
    feed: (f: PresenceFrame) => feed?.(f),
    lose: () => lost?.(),
    gate: (on: boolean) => { gated = on; },
  };
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

describe('phone Hands status on the pill and indicator', () => {
  it('the pill says "face the phone" while the facing gate locks the hands', async () => {
    const s = setup();
    await s.hands.setOn(true);
    s.feed(frame({ handGate: true }));
    expect(s.hands.pill.textContent).toBe('Hands ✓');
    s.gate(true);
    s.feed(frame({ handGate: false }));
    expect(s.hands.pill.textContent).toBe(PHONE_HANDS_FACE_LINE);
    s.gate(false);
    s.feed(frame({ handGate: true }));
    expect(s.hands.pill.textContent).toBe('Hands ✓');
  });

  it('the indicator says "Loading hand model…" while starting, then "Camera"', async () => {
    let release: () => void = () => undefined;
    const s = setup({ startGate: new Promise<void>((r) => { release = r; }) });
    const p = s.hands.setOn(true);
    await flush(); await flush();
    expect(s.hands.indicator.hidden).toBe(false);
    expect(s.hands.indicator.innerHTML).toContain('Loading hand model…');
    release();
    await p;
    expect(s.hands.indicator.innerHTML).toContain('Camera');
    expect(s.hands.indicator.innerHTML).not.toContain('Loading');
  });

  it('a camera taken for good (retries spent) turns Hands off with a plain message', async () => {
    const s = setup();
    await s.hands.setOn(true);
    for (let i = 0; i < 3; i++) {
      s.lose();
      expect(s.hands.isOn()).toBe(true); // retrying
      for (const fn of s.timers.splice(0)) fn();
      await flush(); await flush();
    }
    s.lose();
    await flush();
    expect(s.camera.lastError()).toBeInstanceOf(CameraLostError);
    expect(s.hands.isOn()).toBe(false);
    expect(s.hands.pill.getAttribute('aria-pressed')).toBe('false');
    expect(s.say).toHaveBeenLastCalledWith(PHONE_HANDS_LOST_LINE);
  });
});

describe('platform split: control on both (pill, facing-gated), sensing on the iPhone', () => {
  it('phoneHandsAllowed (control hub): Android and iPhone shells; desktop no. phoneSensingAllowed: iPhone only', () => {
    expect(phoneHandsAllowed(true, 'android')).toBe(true);
    expect(phoneHandsAllowed(true, 'ios')).toBe(true);
    expect(phoneHandsAllowed(false, 'android')).toBe(false);
    expect(phoneHandsAllowed(true, null)).toBe(false);
    expect(phoneSensingAllowed(true, 'ios')).toBe(true);
    expect(phoneSensingAllowed(true, 'android')).toBe(false);
    expect(phoneSensingAllowed(false, 'ios')).toBe(false);
  });

  it('canvasMain creates ONE camera hub; mountCanvas mounts the pill only with a hub, and sensing only when asked', () => {
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/const phoneCamera = phoneHandsAllowed\(phoneShell, phonePlatform\)\s*\?\s*createPhoneCamera\(/);
    expect(main).toMatch(/const phonePlatform = capacitor\?\.getPlatform\?\.\(\) === 'ios' \? 'ios' as const : 'android' as const;/);
    expect(main).toMatch(/phoneSensing: phoneSensingAllowed\(phoneShell, phonePlatform\)/);
    expect(main.match(/createPhoneCamera\(/g)).toHaveLength(1);
    const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    expect(app).toMatch(/const phoneHands = phoneShell && opts\.phoneCamera && handPointer/);
    expect(app.match(/mountPhoneHands\(/g)).toHaveLength(1);
    expect(app).toMatch(/phoneShell && opts\.phoneSensing && opts\.phoneCamera/);
  });

  function iphone(opts: { storage?: ReturnType<typeof memStorage> } = {}) {
    const s = setup(opts);
    const sensed: { hands: { x: number; y: number }[][]; now: number }[] = [];
    const sensor = createPhoneSensor({ camera: s.camera, onHands: (hands, now) => sensed.push({ hands, now }), storage: s.storage, pill: false, now: () => 5 });
    return { ...s, sensor, sensed };
  }

  it('iPhone control is OFF by default: fist frames never reach the pointer (no click possible)', async () => {
    const s = iphone();
    await s.sensor.request('docked', true);
    expect(s.camera.status()).toBe('live');
    s.feed(frame());
    s.feed(frame({ hands: 2 }));
    expect(s.hands.isOn()).toBe(false);
    expect(s.pointer.update).not.toHaveBeenCalled();
    // …while sensing still gets every hand frame.
    expect(s.sensed.length).toBe(2);
  });

  it('pill on + facing → the pointer gets the frames (clicks work through it)', async () => {
    const s = iphone();
    await s.hands.setOn(true);
    s.feed(frame({ handGate: true }));
    expect(s.pointer.update).toHaveBeenCalledTimes(1);
    expect(s.pointer.handsLocked()).toBe(false);
  });

  it('pill on + NOT facing → control locked, but sensing still feeds point/follow (pointing works with facing=false)', async () => {
    const s = iphone();
    await s.hands.setOn(true);
    await s.sensor.request('point', true);
    s.gate(true);
    s.feed(frame({ handGate: false }));
    expect(s.pointer.handsLocked()).toBe(true);
    expect(s.hands.pill.textContent).toBe(PHONE_HANDS_FACE_LINE);
    expect(s.sensed.length).toBe(1);
  });

  it('sensing hands are un-mirrored to camera space (presence hands are selfie-mirrored)', async () => {
    const s = iphone();
    await s.sensor.request('follow', true);
    s.feed(frame()); // every landmark at selfie x = 0.3
    expect(s.sensed[0]!.hands[0]![0]!.x).toBeCloseTo(0.7, 6);
  });

  it('one camera, one getUserMedia for sensing + Hands; sensing off → camera off; hidden → camera stops', async () => {
    const s = iphone();
    await s.sensor.request('point', true);
    await s.hands.setOn(true);
    expect(s.getUserMedia).toHaveBeenCalledTimes(1);
    expect(s.sensor.running()).toBe(true);
    await s.hands.setOn(false);
    expect(s.camera.status()).toBe('live'); // sensing still wants it
    await s.sensor.request('point', false);
    expect(s.camera.status()).toBe('off');
    expect(s.sensor.running()).toBe(false);
  });

  it('the Track reason is persisted (mc.phoneSensor) and off by default', async () => {
    const storage = memStorage();
    const s = iphone({ storage });
    await flush();
    expect(s.sensor.reasons()).toEqual([]);
    expect(s.getUserMedia).not.toHaveBeenCalled();
    await s.sensor.request('pill', true);
    expect(storage.m.get(PHONE_SENSOR_KEY)).toBe('1');
    expect(s.sensor.statusLine()).toBe(SENSOR_ON_LINE);
  });

  it('stops on hide like every other use (camera lifecycle unchanged)', async () => {
    let vis: 'visible' | 'hidden' = 'visible';
    const fns: (() => void)[] = [];
    const doc = { get visibilityState() { return vis; }, addEventListener: (_: string, fn: () => void) => { fns.push(fn); }, removeEventListener: () => undefined };
    const track = { readyState: 'live', stop: vi.fn() };
    const camera = createPhoneCamera({
      getUserMedia: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }) as unknown as MediaStream,
      createTracker: () => ({ start: async () => undefined, stop: vi.fn() }),
      doc: doc as never, win: null, now: () => 0,
    });
    const sensor = createPhoneSensor({ camera, onHands: () => undefined, pill: false, storage: memStorage() });
    await sensor.request('docked', true);
    expect(camera.status()).toBe('live');
    vis = 'hidden';
    fns.forEach((f) => f());
    await flush();
    expect(track.stop).toHaveBeenCalled();
    expect(camera.status()).toBe('off');
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

describe('phone button gestures (behind the Hands pill)', () => {
  const stub = () => ({ frame: vi.fn(), setActive: vi.fn(), lost: vi.fn() });

  it('the pill turns the gesture layer on and off', async () => {
    const g = stub();
    const s = setup({ gestures: g });
    await flush();
    expect(g.setActive).not.toHaveBeenCalled();
    await s.hands.setOn(true);
    expect(g.setActive).toHaveBeenLastCalledWith(true);
    await s.hands.setOn(false);
    expect(g.setActive).toHaveBeenLastCalledWith(false);
  });

  it('frames reach the gestures (selfie space, labelled) with the facing gate and face x', async () => {
    const g = stub();
    const s = setup({ gestures: g });
    await s.hands.setOn(true);
    s.feed(frame({ handGate: true }));
    expect(g.frame).toHaveBeenCalledTimes(1);
    const [hands, , ctx] = g.frame.mock.calls[0];
    expect(hands).toHaveLength(1);
    expect(hands[0][0]).toEqual({ x: 0.3, y: 0.5 }); // NOT mirrored to camera space
    expect((hands[0] as { label?: string }).label).toBe('Right');
    expect(ctx).toMatchObject({ facing: true, faceX: 0.5, blocked: false });
  });

  it('blocked while the hands are gated (not facing) or the app says so', async () => {
    const g = stub();
    let busy = false;
    const s = setup({ gestures: g, gesturesBlocked: () => busy });
    await s.hands.setOn(true);
    s.gate(true);
    s.feed(frame());
    expect(g.frame.mock.calls.at(-1)![2].blocked).toBe(true);
    s.gate(false); busy = true;
    s.feed(frame());
    expect(g.frame.mock.calls.at(-1)![2].blocked).toBe(true);
  });

  it('the look-to-edit lock stops gestures (and cancels a hold)', async () => {
    const g = stub();
    let locked = false;
    const s = setup({ gestures: g, locked: () => locked });
    await s.hands.setOn(true);
    locked = true;
    s.feed(frame());
    expect(g.frame).not.toHaveBeenCalled();
    expect(g.lost).toHaveBeenCalled();
  });

  it('off: no frames reach the gestures', async () => {
    const g = stub();
    const s = setup({ gestures: g });
    s.feed(frame());
    expect(g.frame).not.toHaveBeenCalled();
  });
});
