import { describe, expect, it, vi } from 'vitest';
import { runAddDevice, MAX_WRITE_ATTEMPTS, type FlowDeps, type StepEvent, type WritingEvent, type WriteResult } from '../src/devices/addDeviceFlow';
import { builtinWizConnector, checkConnectorDraft, planRequest, runAction, ACTION_VERBS, type Connector } from '../src/devices/connector';
import { ackOf, expectedState, stateOf } from '../src/devices/ack';
import { clampPayload, clampUrl, createRateLimiter, safeTransports, TooFastError } from '../src/devices/safety';
import { buildConnectorPrompt } from '../src/devices/identify';
import { plainWords } from '../src/ui/addDevicePanel';

const id = { kind: 'smart-bulb', brand: 'WiZ', model: '', label: 'Lamp', confidence: 0.9 };
const ok = (c = builtinWizConnector()): WriteResult => ({ ok: true, connector: c, source: 'cloud', text: JSON.stringify({ protocol: c.protocol }) });

function deps(over: Partial<FlowDeps> & { reply?: (payload: unknown) => unknown } = {}) {
  const events: StepEvent[] = [];
  const writing: WritingEvent[] = [];
  const sent: string[] = [];
  const reply = over.reply ?? (() => ({ result: { success: true } }));
  const d: FlowDeps = {
    sim: false, mode: 'voice', identityFromWords: () => id,
    capture: async () => null, identify: async () => null,
    cachedConnector: () => null,
    writeConnector: async () => ok(),
    saveConnector: vi.fn(),
    discover: async () => ({ found: [{ host: '192.168.1.42' }], source: 'native', note: '' }),
    confirm: async () => true,
    run: async (c: Connector, a: string, h: string) => { sent.push(a); return runAction(c, a, {}, h, { udp: async (_h, _p, payload) => reply(payload) }); },
    check: async () => ({ verdict: 'done', reason: '', source: 'on-device' }),
    saveDevice: vi.fn(), wait: async () => {}, onStep: (e) => events.push(e), onWriting: (e) => writing.push(e),
    ...over,
  };
  return { d, events, writing, sent };
}

describe('write → test on device → fix → finish', () => {
  it('a connector is saved only after the device answers, stamped testedAt', async () => {
    const { d, writing } = deps();
    const out = await runAddDevice(d);
    expect(out.ok).toBe(true);
    expect(d.saveConnector).toHaveBeenCalledOnce();
    expect((d.saveConnector as ReturnType<typeof vi.fn>).mock.calls[0][0].testedAt).toBeTypeOf('number');
    expect(writing.at(-1)?.state).toBe('passed');
  });

  it('an invalid draft goes back to Gemini with the exact errors, nothing sent', async () => {
    const write = vi.fn()
      .mockResolvedValueOnce({ ok: false, errors: ['Action "dim": unknown param "dim".'], text: '{"bad":1}', source: 'cloud' })
      .mockResolvedValueOnce(ok());
    const { d, sent, writing } = deps({ writeConnector: write });
    const out = await runAddDevice(d);
    expect(out.ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][1]).toEqual({ attempt: 1, errors: ['Action "dim": unknown param "dim".'], previous: '{"bad":1}' });
    expect(writing.some((w) => w.state === 'invalid')).toBe(true);
    expect(sent[0]).toBe('power-off'); // first device contact is after the valid draft
  });

  it('a device failure is fed back; the next draft is retested', async () => {
    let calls = 0;
    const { d } = deps({ reply: () => (++calls <= 1 ? null : { result: { success: true } }) });
    const write = vi.fn().mockResolvedValue(ok());
    d.writeConnector = write;
    const out = await runAddDevice(d);
    expect(out.ok).toBe(true);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][1].errors[0]).toMatch(/On the real device: .*No reply/);
  });

  it('stops after the max attempts with a clear error and saves nothing', async () => {
    const { d, events, writing } = deps({ reply: () => ({ error: { message: 'method not found' } }) });
    const write = vi.fn().mockResolvedValue(ok());
    d.writeConnector = write;
    const out = await runAddDevice(d);
    expect(out.ok).toBe(false);
    expect(write).toHaveBeenCalledTimes(MAX_WRITE_ATTEMPTS);
    expect(!out.ok && out.reason).toMatch(/method not found.*tried 3 versions; nothing was saved/i);
    expect(d.saveConnector).not.toHaveBeenCalled();
    expect(events.at(-1)?.state).toBe('fail');
    expect(writing.filter((w) => w.state === 'failed')).toHaveLength(3);
  });

  it('a status read that disagrees fails the test', async () => {
    const { d } = deps({ reply: (p) => ((p as { method: string }).method === 'getPilot' ? { result: { state: false } } : { result: { success: true } }) });
    d.writeConnector = vi.fn().mockResolvedValue(ok());
    const out = await runAddDevice(d);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.reason).toMatch(/says the device is off/);
  });

  it('an unreachable writer fails visibly; never a template', async () => {
    const { d } = deps({ writeConnector: async () => ({ ok: false, unreachable: true, errors: ['offline'] }) });
    const out = await runAddDevice(d);
    expect(out.ok).toBe(false);
    expect(!out.ok && out.at).toBe('connector');
    expect(!out.ok && out.reason).toMatch(/could not be reached/);
    expect(d.saveConnector).not.toHaveBeenCalled();
  });

  it('the fix prompt carries the errors and the previous draft', () => {
    const p = buildConnectorPrompt(id, { attempt: 1, errors: ['No reply from the device'], previous: '{"x":1}' });
    expect(p).toContain('No reply from the device');
    expect(p).toContain('{"x":1}');
    expect(p).toContain(ACTION_VERBS.join(', '));
  });

  it('plain words come out of half-written JSON', () => {
    expect(plainWords('{"protocol":"WiZ UDP","actions":[{"id":"a","verb":"on","label":"Turn on"},{"id":"b","label":"Dim","verb":"set"')).toEqual(['Talks to it with WiZ UDP.', 'Turn on (on)', 'Dim (set)']);
  });
});

describe('fixed action schema', () => {
  const base = () => ({
    deviceKind: 'plug', brand: 'Shelly', protocol: 'http', discovery: { method: 'mdns' },
    actions: [
      { id: 'on', verb: 'on', label: 'On', params: [], request: { transport: 'http', port: 80, method: 'GET', path: '/relay/0?turn=on' } },
      { id: 'off', verb: 'off', label: 'Off', params: [], request: { transport: 'http', port: 80, method: 'GET', path: '/relay/0?turn=off' } },
    ],
    test: { action: 'on', prepare: 'off' },
  });
  it('accepts on/off/set/toggle/status', () => {
    expect(checkConnectorDraft(base()).ok).toBe(true);
  });
  it('rejects unknown verbs and params with plain errors', () => {
    const r1 = checkConnectorDraft({ ...base(), actions: [{ ...base().actions[0], verb: 'explode' }, base().actions[1]] });
    expect(!r1.ok && r1.errors[0]).toMatch(/verb must be one of on, off, set, toggle, status/);
    const r2 = checkConnectorDraft({ ...base(), actions: [...base().actions, { id: 'x', verb: 'set', label: 'X', params: [{ name: 'voltage', type: 'number' }], request: { transport: 'http', port: 80, method: 'GET', path: '/x?v={{voltage}}' } }] });
    expect(!r2.ok && r2.errors.join(' ')).toMatch(/unknown param "voltage"/);
    const r3 = checkConnectorDraft({ ...base(), actions: [{ ...base().actions[0], params: [{ name: 'brightness', type: 'number' }] }, base().actions[1]] });
    expect(!r3.ok && r3.errors.join(' ')).toMatch(/only "set" actions take params/);
    const r4 = checkConnectorDraft({ ...base(), test: { action: 'nope' } });
    expect(!r4.ok && r4.errors.join(' ')).toMatch(/test.action/);
  });
  it('narrows a param range to the vocabulary and rejects unknown args at run time', () => {
    const r = checkConnectorDraft({ ...base(), actions: [...base().actions, { id: 'dim', verb: 'set', label: 'Dim', params: [{ name: 'brightness', type: 'number', min: -50, max: 9000 }], request: { transport: 'http', port: 80, method: 'GET', path: '/light/0?brightness={{brightness}}' } }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dim = r.connector.actions.find((a) => a.id === 'dim')!;
    expect(dim.params[0]).toMatchObject({ min: 1, max: 100 });
    expect(planRequest(r.connector, 'dim', { brightness: 500 }, '192.168.1.9')).toMatchObject({ ok: true, request: { url: 'http://192.168.1.9/light/0?brightness=100' } });
    expect(planRequest(r.connector, 'dim', { voltage: 5 }, '192.168.1.9').ok).toBe(false);
  });
  it('old cached connectors without verbs still load (verb inferred)', () => {
    const c = builtinWizConnector();
    expect(c.actions.map((a) => a.verb)).toEqual(['on', 'off', 'set', 'set', 'status']);
  });
});

describe('device acknowledgements', () => {
  it('needs a real reply over UDP; errors fail', () => {
    expect(ackOf({ result: { success: true } }, 'udp').ok).toBe(true);
    expect(ackOf(null, 'udp').ok).toBe(false);
    expect(ackOf({ error: { code: -32601, message: 'Method not found' } }, 'udp')).toEqual({ ok: false, error: 'The device answered with an error: Method not found.' });
    expect(ackOf({ result: { success: false } }, 'udp').ok).toBe(false);
    expect(ackOf(null, 'http').ok).toBe(true);
  });
  it('reads on/off state from common replies', () => {
    expect(stateOf({ result: { state: true } })).toBe(true);
    expect(stateOf({ ison: false })).toBe(false);
    expect(stateOf({ POWER: 'ON' })).toBe(true);
    expect(stateOf({ result: { success: true } })).toBeNull();
    expect(expectedState('off')).toBe(false);
    expect(expectedState('toggle')).toBeNull();
  });
});

describe('send-layer safety', () => {
  it('clamps brightness, volume and colour in payloads and URLs', () => {
    const notes: { field: string; from: number; to: number }[] = [];
    expect(clampPayload({ method: 'setPilot', params: { dimming: 400, r: 300, temp: 99999, state: true } }, notes))
      .toEqual({ method: 'setPilot', params: { dimming: 100, r: 255, temp: 6500, state: true } });
    expect(notes.map((n) => n.field)).toEqual(['dimming', 'r', 'temp']);
    expect(clampPayload({ volume: '250' })).toEqual({ volume: '100' });
    expect(clampUrl('http://10.0.0.2/light/0?brightness=900&turn=on')).toBe('http://10.0.0.2/light/0?brightness=100&turn=on');
  });
  it('rate-limits each device separately', () => {
    let t = 0;
    const lim = createRateLimiter({ max: 3, windowMs: 1000, minGapMs: 100 }, () => t);
    expect(lim.take('a').ok).toBe(true);
    expect(lim.take('a').ok).toBe(false); // too soon
    expect(lim.take('b').ok).toBe(true);
    t = 150; expect(lim.take('a').ok).toBe(true);
    t = 300; expect(lim.take('a').ok).toBe(true);
    t = 450; expect(lim.take('a').ok).toBe(false); // 3 in the window
    t = 1200; expect(lim.take('a').ok).toBe(true);
  });
  it('wrapped transports clamp before sending and refuse when too fast', async () => {
    const seen: unknown[] = [];
    let t = 0;
    const tr = safeTransports({ udp: async (_h, _p, payload) => { seen.push(payload); return { result: { success: true } }; } },
      createRateLimiter({ max: 5, windowMs: 1000, minGapMs: 100 }, () => t));
    await tr.udp!('192.168.1.2', 38899, { params: { dimming: 1000 } });
    expect(seen[0]).toEqual({ params: { dimming: 100 } });
    await expect(tr.udp!('192.168.1.2', 38899, { params: {} })).rejects.toBeInstanceOf(TooFastError);
  });
});
