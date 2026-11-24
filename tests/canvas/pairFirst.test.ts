import { describe, expect, it, vi } from 'vitest';
import {
  NEXT_PROMPT, createPairFirst, isBuildDashboard, pairedRowHtml, parseConnectDevices,
} from '../../src/canvas/pairedRow';

function setup(o: { sim?: boolean; pairingOk?: boolean } = {}) {
  const said: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const build = vi.fn();
  const pf = createPairFirst({
    say: (t) => said.push(t),
    openPairing: async () => o.pairingOk ?? true,
    buildDashboard: build,
    sim: () => !!o.sim,
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
    expect(pf.pendingDashboard()).toBe(true);
    expect(build).not.toHaveBeenCalled();
    expect(pf.handleSpeech('next')).toBe(true); // no phone yet: refused, still pairing
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
