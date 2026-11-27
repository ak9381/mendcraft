import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  DISCONNECT_ARM_MS, NEXT_PROMPT, createPairFirst, isBuildDashboard, pairedRowHtml, parseConnectDevices,
} from '../../src/canvas/pairedRow';

function setup(o: { sim?: boolean; pairingOk?: boolean; busy?: { v: boolean } } = {}) {
  const said: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const build = vi.fn();
  const pf = createPairFirst({
    say: (t) => said.push(t),
    openPairing: async () => o.pairingOk ?? true,
    buildDashboard: build,
    sim: () => !!o.sim,
    busy: () => !!o.busy?.v,
    clear: () => undefined,
    schedule: (fn, ms) => { timers.push({ fn, ms }); },
  });
  return { pf, said, build, timers };
}

describe('parsing', () => {
  it('spots connect-devices, with and without a dashboard', () => {
    expect(parseConnectDevices('connect devices and make a dashboard')).toEqual({ dashboard: true });
    expect(parseConnectDevices('connect my devices')).toEqual({ dashboard: false });
    expect(parseConnectDevices('connect everything in this room')).toBeNull();
    expect(isBuildDashboard('ok build the dashboard')).toBe(true);
    expect(isBuildDashboard('make a dashboard')).toBe(true);
  });
});

describe('pair first', () => {
  it('sets pending and does not build before pairing completes', async () => {
    const { pf, build } = setup();
    await pf.begin({ dashboard: true });
    expect(pf.phase()).toBe('pairing');
    expect(build).not.toHaveBeenCalled();
    expect(pf.handleSpeech('next')).toBe(false); // no phone yet: not swallowed
    expect(pf.phase()).toBe('pairing');
  });

  it('renders a check per joined phone, SIM labelled', async () => {
    const { pf } = setup();
    await pf.begin({ dashboard: false });
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    pf.addPhone({ id: 'sim-1', label: 'Nothing phone', sim: true });
    const html = pairedRowHtml(pf.phones(), pf.phase());
    expect(html.match(/mc-paired-check/g)).toHaveLength(2);
    expect(html).toContain('SIM');
    expect(html).toContain('mc-paired-continue');
  });

  it('a named phone replaces the generic paired placeholder', async () => {
    const { pf } = setup();
    await pf.begin({ dashboard: false });
    pf.addGeneric();
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    expect(pf.phones().map((p) => p.id)).toEqual(['ios']);
  });

  it('Continue asks what is next; only "build the dashboard" runs connectRoom, once', async () => {
    const { pf, said, build } = setup();
    await pf.begin({ dashboard: true });
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    pf.handleSpeech('next');
    expect(said.at(-1)).toBe(NEXT_PROMPT);
    expect(pf.phase()).toBe('asking');
    expect(build).not.toHaveBeenCalled();
    expect(pf.handleSpeech('build the dashboard')).toBe(true);
    expect(pf.handleSpeech('build the dashboard')).toBe(false); // flow is over
    expect(build).toHaveBeenCalledTimes(1);
  });

  it('with no pairing possible it says so and builds immediately', async () => {
    const { pf, said, build } = setup({ pairingOk: false });
    await pf.begin({ dashboard: true });
    expect(build).toHaveBeenCalledTimes(1);
    expect(said.join(' ')).toMatch(/not reachable/);
  });

  it('under sim two scripted phones join, labelled SIM, then it asks what is next', async () => {
    const { pf, said, timers, build } = setup({ sim: true });
    await pf.begin({ dashboard: true });
    expect(said[0]).toMatch(/^SIM/);
    timers.forEach((t) => t.fn());
    expect(pf.phones().map((p) => p.sim)).toEqual([true, true]);
    expect(said.at(-1)).toBe(NEXT_PROMPT);
    expect(build).not.toHaveBeenCalled();
  });

  it('cancel drops scripted joins', async () => {
    const { pf, timers } = setup({ sim: true });
    await pf.begin({ dashboard: false });
    pf.cancel();
    timers.forEach((t) => t.fn());
    expect(pf.phones()).toEqual([]);
  });
});

describe('flow lifecycle', () => {
  it('cancels when the last real phone drops (no stuck pairing)', async () => {
    const { pf } = setup();
    await pf.begin();
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    pf.clearReal();
    expect(pf.phase()).toBe('idle');
    expect(pf.phones()).toEqual([]);
  });

  it('asking expires on an unrelated command, which falls through', async () => {
    const { pf } = setup();
    await pf.begin();
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    pf.continueNext();
    expect(pf.handleSpeech('connect the speaker')).toBe(false);
    expect(pf.phase()).toBe('asking'); // connecting something is in-flow
    expect(pf.handleSpeech('zoom in')).toBe(false);
    expect(pf.phase()).toBe('live'); // flow over, phones kept
    expect(pf.handleSpeech('build the dashboard')).toBe(false); // no longer intercepted
  });

  it('abandon (new board / undo) keeps phones, cancel drops them', async () => {
    const { pf } = setup();
    await pf.begin();
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    pf.abandon();
    expect(pf.phase()).toBe('live');
    expect(pf.phones()).toHaveLength(1);
    expect(pairedRowHtml(pf.phones(), pf.phase()).replace(/<[^>]+>/g, '')).toContain('1 phone connected');
    pf.cancel();
    expect(pf.phase()).toBe('idle');
  });

  it('build after pairing leaves the phones live; a busy review keeps it asking', async () => {
    const busy = { v: true };
    const { pf, build, said } = setup({ busy });
    await pf.begin();
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    expect(pf.continueNext()).toBe(true);
    expect(pf.phase()).toBe('pairing'); // Continue respects the busy review
    busy.v = false;
    pf.continueNext();
    busy.v = true;
    pf.handleSpeech('build the dashboard');
    expect(build).not.toHaveBeenCalled();
    expect(pf.phase()).toBe('asking');
    expect(said.at(-1)).toMatch(/Finish the waiting proposal/);
    busy.v = false;
    pf.handleSpeech('build the dashboard');
    expect(build).toHaveBeenCalledTimes(1);
    expect(pf.phase()).toBe('live');
  });

  it('cancel clears scripted sim timers', async () => {
    const cleared: unknown[] = [];
    const pf = createPairFirst({
      say: () => undefined, openPairing: async () => true, buildDashboard: () => undefined,
      sim: () => true, schedule: (_f, ms) => ms, clear: (h) => cleared.push(h),
    });
    await pf.begin();
    pf.cancel();
    expect(cleared).toEqual([1200, 2600, 4000]);
  });
});

describe('live phones survive reopening', () => {
  it('a phone joining while live keeps it live and counts it', async () => {
    const { pf } = setup();
    await pf.begin();
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    pf.abandon();
    pf.addPhone({ id: 'android', label: 'Nothing phone' });
    expect(pf.phase()).toBe('live');
    expect(pairedRowHtml(pf.phones(), pf.phase()).replace(/<[^>]+>/g, '')).toContain('2 phones connected');
  });

  it('losing every real phone while live resets the flow', async () => {
    const { pf } = setup();
    await pf.begin();
    pf.addPhone({ id: 'ios', label: 'iPhone' });
    pf.abandon();
    pf.clearReal();
    expect(pf.phase()).toBe('idle');
  });
});

describe('Disconnect after Continue (double press / tremor)', () => {
  it('leads the connected row, away from where Continue sat at the end', () => {
    const live = pairedRowHtml([{ id: 'a', label: 'iPhone', sim: true }, { id: 'b', label: 'Nothing phone', sim: true }], 'live');
    const pairing = pairedRowHtml([{ id: 'a', label: 'iPhone', sim: true }], 'pairing');
    expect(pairing.trim().endsWith('Continue</button>')).toBe(true);
    expect(live.startsWith('<button type="button" class="mc-btn mc-paired-disconnect">')).toBe(true);
  });

  it('ignores presses for a second after it appears', () => {
    expect(DISCONNECT_ARM_MS).toBeGreaterThanOrEqual(1000);
    const app = readFileSync(join(__dirname, '../../src/canvas/canvasApp.ts'), 'utf8');
    expect(app).toMatch(/const disconnectArm = createClickCooldown\(DISCONNECT_ARM_MS\)/);
    expect(app).toMatch(/if \(disconnectBtn && !hadDisconnect\) disconnectArm\.arm\(/);
    expect(app).toMatch(/if \(!disconnectArm\.ready\(performance\.now\(\)\)\) return;\s*disconnectPhones\(\{ forget: true \}\)/);
  });
});
