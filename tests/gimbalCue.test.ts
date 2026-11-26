// Gimbal body language: nod 'yes' on Approve, shake 'no' on a refusal,
// 'wakeup' on pairing. Relayed laptop → iPhone as an allow-listed word (no
// user content), at most one per 2 s, and only ever claimed after the native
// DockKit call reported success.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  createCueLimiter,
  GIMBAL_CUE_MIN_GAP_MS,
  GIMBAL_CUE_RECEIVE_GAP_MS,
  GIMBAL_CUES,
  isGimbalCue,
  validateCommand,
  validateMessage,
  type RandomBytes,
} from '../src/relay/protocol';
import { createFakeTransport } from '../src/relay/transport';
import { createGuestSession, createHostSession } from '../src/relay/session';
import {
  createGimbalCanvasController,
  CUE_OLD_BUILD_WHY,
  CUE_RATE_WHY,
  CUE_STATUS,
  NO_GIMBAL_WHY,
} from '../src/canvas/gimbalCanvas';
import type { GimbalPlugin } from '../src/devices/native';

const seqRandom = (start = 0): RandomBytes => (n) => Uint8Array.from({ length: n }, (_, i) => start + i);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('relay allow-list for gimbalCue', () => {
  it('accepts exactly yes / no / wakeup', () => {
    expect(GIMBAL_CUES).toEqual(['yes', 'no', 'wakeup']);
    for (const k of GIMBAL_CUES) expect(validateCommand({ kind: 'gimbalCue', text: k })).toEqual({ kind: 'gimbalCue', text: k });
  });
  it('refuses anything else — no user content rides the cue', () => {
    for (const text of [undefined, '', 'YES', 'kapow', 'yes please', 'turn the oven on', '{"kind":"yes"}', 'yes'.repeat(100)]) {
      expect(validateCommand({ kind: 'gimbalCue', text })).toBeNull();
    }
    expect(isGimbalCue('kapow')).toBe(false);
  });
  it('drops extra fields (dx/dy) from a cue', () => {
    expect(validateCommand({ kind: 'gimbalCue', text: 'no', dx: 1 })).toEqual({ kind: 'gimbalCue', text: 'no' });
  });
  it('a whole wire message with a bad cue is rejected', () => {
    expect(validateMessage({ v: 1, from: 'host', type: 'cmd', cmd: { kind: 'gimbalCue', text: 'hello there' } })).toBeNull();
    expect(validateMessage({ v: 1, from: 'host', type: 'cmd', cmd: { kind: 'gimbalCue', text: 'wakeup' } })).not.toBeNull();
  });
});

describe('cue rate limit (≤ 1 per 2 s)', () => {
  it('createCueLimiter allows one per gap', () => {
    let t = 0;
    const lim = createCueLimiter(GIMBAL_CUE_MIN_GAP_MS, () => t);
    expect(lim.allow()).toBe(true);
    t = 1999; expect(lim.allow()).toBe(false);
    t = 2000; expect(lim.allow()).toBe(true);
    t = 2500; expect(lim.allow()).toBe(false);
  });

  it("lets a 'no' straight after a 'yes' through, once", () => {
    let t = 0;
    const lim = createCueLimiter(GIMBAL_CUE_MIN_GAP_MS, () => t);
    expect(lim.allow('yes')).toBe(true);
    t = 100; expect(lim.allow('yes')).toBe(false);
    t = 200; expect(lim.allow('no')).toBe(true);
    t = 300; expect(lim.allow('no')).toBe(false);
    t = 400; expect(lim.allow('wakeup')).toBe(false);
    // 'no' after a non-yes cue is still limited.
    t = 5000; expect(lim.allow('wakeup')).toBe(true);
    t = 5100; expect(lim.allow('no')).toBe(false);
  });

  it('ready() does not stamp; mark() does', () => {
    let t = 0;
    const lim = createCueLimiter(GIMBAL_CUE_MIN_GAP_MS, () => t);
    expect(lim.ready('yes')).toBe(true);
    expect(lim.ready('yes')).toBe(true);
    lim.mark('yes');
    t = 10; expect(lim.ready('wakeup')).toBe(false);
  });

  it('receiver gap is 1.5 s (jitter-tolerant), sender 2 s', () => {
    expect(GIMBAL_CUE_MIN_GAP_MS).toBe(2000);
    expect(GIMBAL_CUE_RECEIVE_GAP_MS).toBe(1500);
  });

  it('sender stamps the gap only after a successful publish', async () => {
    const tr = createFakeTransport();
    let now = 0;
    const host = await createHostSession(tr, seqRandom(), { now: () => now });
    const guest = await createGuestSession(tr, host.token, { now: () => now });
    const got: string[] = [];
    guest.onGimbalCue((k) => got.push(k));
    await flush();
    const real = tr.publish.bind(tr);
    const spy = vi.spyOn(tr, 'publish').mockRejectedValueOnce(new Error('offline'));
    await expect(host.sendGimbalCue('yes')).rejects.toThrow('offline');
    spy.mockImplementation(real);
    now = 100;
    expect(await host.sendGimbalCue('yes')).toBe(true); // not blocked by the failed one
    await flush();
    expect(got).toEqual(['yes']);
    spy.mockRestore();
    await guest.close();
    await host.close();
  });

  it('receiver: a cue 1.6 s after the last is accepted (jitter); a yes then no arrives as both', async () => {
    const tr = createFakeTransport();
    let now = 0;
    const host = await createHostSession(tr, seqRandom());
    const guest = await createGuestSession(tr, host.token, { now: () => now });
    const got: string[] = [];
    guest.onGimbalCue((k) => got.push(k));
    await flush();
    const send = (text: string) => tr.publish(host.token, { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'gimbalCue', text } });
    await send('wakeup'); await flush();
    now = 1600; await send('yes'); await flush();
    now = 1700; await send('no'); await flush();
    now = 1800; await send('yes'); await flush();
    expect(got).toEqual(['wakeup', 'yes', 'no']);
    await guest.close();
    await host.close();
  });

  it('host → guest: relayed, rate-limited on send, honoured only from the host', async () => {
    const tr = createFakeTransport();
    let now = 10_000;
    const host = await createHostSession(tr, seqRandom(), { now: () => now });
    // Not paired yet: nothing is sent.
    expect(await host.sendGimbalCue('wakeup')).toBe(false);
    const guest = await createGuestSession(tr, host.token, { now: () => now });
    const got: string[] = [];
    guest.onGimbalCue((k) => got.push(k));
    await flush();
    expect(host.state()).toBe('paired');

    expect(await host.sendGimbalCue('wakeup')).toBe(true);
    now += 500;
    expect(await host.sendGimbalCue('yes')).toBe(false); // within 2 s: dropped
    now += 1600;
    expect(await host.sendGimbalCue('no')).toBe(true);
    await flush();
    expect(got).toEqual(['wakeup', 'no']);

    // The host ignores a phone's cue (host → phone only); a second phone's cue
    // never reaches the guest callback either (from: 'phone').
    const hostCmds: unknown[] = [];
    host.onCommand((c) => hostCmds.push(c));
    now += 5000;
    await guest.sendCommand({ kind: 'gimbalCue', text: 'yes' });
    await flush();
    expect(got).toEqual(['wakeup', 'no']);
    await guest.close();
    await host.close();
  });

  it('the guest enforces the same gap even if a sender floods', async () => {
    const tr = createFakeTransport();
    let now = 0;
    const host = await createHostSession(tr, seqRandom());
    const guest = await createGuestSession(tr, host.token, { now: () => now });
    const got: string[] = [];
    guest.onGimbalCue((k) => got.push(k));
    await flush();
    for (let i = 0; i < 5; i++) await tr.publish(host.token, { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'gimbalCue', text: 'yes' } });
    await flush();
    expect(got).toEqual(['yes']);
    now = 2000;
    await tr.publish(host.token, { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'gimbalCue', text: 'no' } });
    await flush();
    expect(got).toEqual(['yes', 'no']);
    await guest.close();
    await host.close();
  });
});

function plugin(over: Partial<GimbalPlugin> & { docked?: boolean } = {}): GimbalPlugin & { cue: ReturnType<typeof vi.fn> } {
  const docked = over.docked ?? true;
  return {
    isAvailable: vi.fn(async () => ({ available: docked, reason: docked ? '' : 'No DockKit stand docked' })),
    aim: vi.fn(async () => ({ ok: true })),
    release: vi.fn(async () => {}),
    setSystemTrackingEnabled: vi.fn(async ({ enabled }) => ({ ok: true, enabled })),
    cue: vi.fn(async () => ({ ok: true })),
    ...over,
  } as GimbalPlugin & { cue: ReturnType<typeof vi.fn> };
}

describe('gimbalCanvas.gimbalCue', () => {
  it('nods and only then claims it', async () => {
    const p = plugin();
    const c = createGimbalCanvasController({ plugin: p, now: () => 0 });
    expect(await c.gimbalCue('yes')).toEqual({ ok: true, status: CUE_STATUS.yes });
    expect(CUE_STATUS.yes).toBe('Gimbal nodded');
    expect(p.cue).toHaveBeenCalledWith({ kind: 'yes' });
  });

  it('is a no-op when undocked: the native cue is never called, no status', async () => {
    const p = plugin({ docked: false });
    const c = createGimbalCanvasController({ plugin: p, now: () => 0 });
    const r = await c.gimbalCue('no');
    expect(r.ok).toBe(false);
    expect(r.status).toBeUndefined();
    expect(p.cue).not.toHaveBeenCalled();
  });

  it('never claims a move the native call did not confirm', async () => {
    const failing = plugin({ cue: vi.fn(async () => ({ ok: false, reason: 'The gimbal didn’t answer in 3 s' })) });
    const r = await createGimbalCanvasController({ plugin: failing, now: () => 0 }).gimbalCue('wakeup');
    expect(r).toEqual({ ok: false, why: 'The gimbal didn’t answer in 3 s' });

    const throwing = plugin({ cue: vi.fn(async () => { throw new Error('bridge gone'); }) });
    const r2 = await createGimbalCanvasController({ plugin: throwing, now: () => 0 }).gimbalCue('yes');
    expect(r2).toEqual({ ok: false, why: 'bridge gone' });

    const odd = plugin({ cue: vi.fn(async () => ({}) as { ok: boolean }) });
    expect((await createGimbalCanvasController({ plugin: odd, now: () => 0 }).gimbalCue('yes')).ok).toBe(false);
  });

  it('web / old app build: honest no-op', async () => {
    expect(await createGimbalCanvasController({ plugin: null }).gimbalCue('yes')).toEqual({ ok: false, why: NO_GIMBAL_WHY });
    const old = plugin();
    delete (old as Partial<GimbalPlugin>).cue;
    expect(await createGimbalCanvasController({ plugin: old }).gimbalCue('yes')).toEqual({ ok: false, why: CUE_OLD_BUILD_WHY });
  });

  it('local cues are rate-limited too (≤ 1 per 2 s)', async () => {
    let t = 0;
    const p = plugin();
    const c = createGimbalCanvasController({ plugin: p, now: () => t });
    expect((await c.gimbalCue('yes')).ok).toBe(true);
    t = 1000;
    expect(await c.gimbalCue('wakeup')).toEqual({ ok: false, why: CUE_RATE_WHY });
    t = 2100;
    expect((await c.gimbalCue('wakeup')).ok).toBe(true);
    expect(p.cue).toHaveBeenCalledTimes(2);
  });

  it('a refusal right after an Approve still shakes (no bypasses the gap after yes)', async () => {
    let t = 0;
    const p = plugin();
    const c = createGimbalCanvasController({ plugin: p, now: () => t });
    expect((await c.gimbalCue('yes')).ok).toBe(true);
    t = 300;
    expect((await c.gimbalCue('no')).ok).toBe(true);
    t = 600;
    expect((await c.gimbalCue('no')).ok).toBe(false); // the bypass is one-shot
    expect(p.cue).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown kind without touching native', async () => {
    const p = plugin();
    const r = await createGimbalCanvasController({ plugin: p }).gimbalCue('kapow' as never);
    expect(r.ok).toBe(false);
    expect(p.cue).not.toHaveBeenCalled();
  });
});

describe('wiring (source checks)', () => {
  const app = readFileSync(new URL('../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
  const swift = readFileSync(new URL('../ios-src/MendcraftGimbalPlugin.swift', import.meta.url), 'utf8');

  it('Approve nods only after the build applied; refusals shake; pairing wakes', () => {
    expect(app).toMatch(/onKeep: \(\) => \{ prop\.accept\(\); finish\(true\); if \(built\) bodyLanguage\('yes'\);/);
    expect(app).toMatch(/if \(r\.refused\) bodyLanguage\('no'\)/);
    expect(app).toMatch(/Blocked a plan that did not pass the check\.', \{ speak: true \}\); bodyLanguage\('no'\)/);
    // …on the phone's first LIVE announce of this laptop session (never on a
    // hello replayed from the room's history).
    expect(app).toMatch(/if \(live === 'first'\) \{[\s\S]{0,400}bodyLanguage\('wakeup'\);/);
    expect(app).not.toMatch(/wakeOnSession/);
  });

  it('the laptop relays; the iPhone cues locally and never re-relays', () => {
    expect(app).toMatch(/if \(getGimbalPlugin\(\)\) \{\s*void inputs\.gimbal\.gimbalCue\(kind\)/);
    expect(app).toMatch(/hostSession\?\.sendGimbalCue\(kind\)/);
    expect(app).toMatch(/cmd\.kind === 'gimbalCue'\) return; \/\/ host → phone only/);
    expect(main).toMatch(/if \(phonePlatform === 'ios'\) s\?\.onGimbalCue\?\.\(\(kind\) => h\.gimbalCue\(kind\)\)/);
  });

  it('native uses DockKit animate(motion:) with .yes / .no / .wakeup and a 3 s timeout', () => {
    expect(swift).toMatch(/CAPPluginMethod\(name: "cue"/);
    expect(swift).toMatch(/acc\.animate\(motion: motion\)/);
    for (const m of ['.yes', '.no', '.wakeup']) expect(swift).toContain(`motion = ${m}`);
    expect(swift).toMatch(/withTimeout\(ms: 3000\)/);
  });

  it('native: a timeout cancels the animation Progress; overlapping moves restore the pre-pause state', () => {
    expect(swift).toMatch(/if outcome == nil \{ box\.cancel\(\) \}/);
    expect(swift).toMatch(/withTaskCancellationHandler/);
    expect(swift).toMatch(/if movesInFlight == 0 \{ pausedFrom = DockAccessoryManager\.shared\.isSystemTrackingEnabled \}/);
    expect(swift).toMatch(/let restoreOn = wanted \?\? pausedFrom \?\? false/);
    // No move re-reads the live system value to decide its restore.
    expect(swift).not.toMatch(/restoreOn = wanted \?\? DockAccessoryManager/);
  });
});
