// The final honesty pass: try-to-break never sends her words to the cloud, a
// SIM turn books no real bytes (and the monitor never calls it Live), a
// fallback draft is not a second send, a Nano turn shows Nano cursors only,
// an open-ended cloud turn is redacted + ledgered, and a pending point-choice
// books its crop when it left.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { scriptedEngine, type SurfaceEngine } from '../../src/canvas/aiTurn';
import { createAiFeed, isAiFeedMsg, type FeedChannel } from '../../src/canvas/aiFeed';
import { createEngines } from '../../src/canvas/engines';
import { createCanvasLedger, ledgerPanelLines } from '../../src/canvas/ledger';
import { formatFooterBytes } from '../../src/canvas/modelPanels';
import { openEndedAsk } from '../../src/canvas/openEndedAsk';
import { createReviewReceipts, honestyLines } from '../../src/canvas/reviewDialog';
import { buildMixedSwarmPlan, buildSwarmAgents, swarmPillText } from '../../src/canvas/swarmAgents';
import { BREAK_RULES_ROUTE, breakEngine, detectAttempt, runBreakTurn, scriptedReply } from '../../src/canvas/tryToBreak';
import type { DeviceRef } from '../../src/canvas/deviceCommands';
import { createLedger } from '../../src/monitor/monitorMain';
import { pointConnectFromIdentity, pointFailureReceipt } from '../../src/canvas/connectTurns';

const canvasSrc = readFileSync('src/canvas/canvasApp.ts', 'utf8');
const devices: DeviceRef[] = [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp', on: true, brightness: 60 }];
const fakePanel = () => {
  const lines: Array<[string, string]> = [];
  return { lines, log: (v: string, d: string) => { lines.push([v, d]); }, fail: (d: string) => { lines.push(['fail', d]); } };
};

describe('A1 try-to-break: no cloud call behind a "Nano" label', () => {
  const attempt = () => detectAttempt('set the desk lamp to 500%', devices)!;

  it('a "Nano" engine that is really Gemini in the cloud is never called; Rules decide', async () => {
    const cloud = vi.fn(async () => '{"deviceId":"wiz-desk","brightness":500}');
    const nano = createEngines({ cloud: (p, on) => cloud(p, on) }).nano!(scriptedReply(attempt()));
    expect(nano.id).toBe('gemini');
    const engine = breakEngine(nano, false);
    expect(engine).toBeNull();
    const panel = fakePanel();
    const r = await runBreakTurn('set the desk lamp to 500%', attempt(), { engine, devices, panel, say: () => {} });
    expect(r.refused).toBe(true);
    expect(cloud).not.toHaveBeenCalled();
    expect(panel.lines[0]).toEqual(['note', BREAK_RULES_ROUTE]);
    expect(BREAK_RULES_ROUTE).toMatch(/^Rules · on this device/);
    expect(BREAK_RULES_ROUTE).not.toMatch(/Nano|Gemini/);
  });

  it('a real on-device Nano is asked; ?sim=1 keeps the SIM script; a scripted stand-in is not a model', () => {
    const realNano = createEngines({ languageModel: {}, nanoStream: async () => '{}' }).nano!('{}');
    expect(realNano.id).toBe('nano');
    expect(breakEngine(realNano, false)).toBe(realNano);
    const sim = createEngines({ sim: true }).nano!('{}');
    expect(breakEngine(sim, true)).toBe(sim);
    expect(breakEngine(createEngines({}).nano!('{}'), false)).toBeNull();
  });

  it('canvasApp routes through breakEngine and no longer claims "Checked on this device" for any engine', () => {
    const body = canvasSrc.slice(canvasSrc.indexOf('async function breakTurn('), canvasSrc.indexOf('// ---- commands ----'));
    expect(body).toContain("breakEngine(engineFor('nano'");
    expect(body).not.toContain('Checked on this device. Nothing sent.');
  });
});

describe('A2 SIM bytes are never real bytes', () => {
  it('ledger: 0 real bytes, would-send kept apart', () => {
    const l = createCanvasLedger();
    const e = l.record({ engine: 'gemini', sentText: 'x'.repeat(300), sim: true });
    expect(e).toMatchObject({ bytes: 0, simBytes: 300, sim: true });
    expect(l.totals()).toMatchObject({ aiBytes: 0, simBytes: 300 });
    const line = ledgerPanelLines(l).ai;
    expect(line).toContain('0 bytes left this device');
    expect(line).toContain('SIM · would send 300 B');
    expect(line).not.toMatch(/sent to Gemini/);
    expect(l.record({ engine: 'nano', sentText: 'abc', sim: true }).simBytes).toBe(0);
  });

  it('footer / engine bar text', () => {
    expect(formatFooterBytes(0, 2048)).toBe('SIM · would send 2.0 KB');
    expect(formatFooterBytes(500, 100)).toBe('500 B sent to cloud · SIM · would send 100 B');
    expect(formatFooterBytes(500)).toBe('500 B sent to cloud');
  });

  it('swarm pill', () => {
    expect(swarmPillText({ gemini: 1, nano: 0, bytes: 0, simBytes: 2048 })).toBe('Gemini · 1 call · SIM · would send 2.0 KB');
  });

  it('review footer: SIM says "would send", never "What left this device"', () => {
    const receipts = createReviewReceipts();
    const turn = { engine: 'gemini', sent: 'your words', routeLine: 'SIM · Gemini · cloud — x', sim: true };
    receipts.record(turn, 0, 812);
    const facts = receipts.facts(turn);
    expect(facts).toMatchObject({ bytes: 0, simBytes: 812, sim: true });
    const lines = honestyLines(facts);
    expect(lines.left).toMatch(/^SIM · nothing left this device/);
    expect(lines.leftBytes).toBe(' · would send 812 B');
    expect(lines.left).not.toMatch(/What left this device/);
  });

  it('feed: a ?sim=1 canvas stamps every message sim:true and carries simTotal', () => {
    const sent: unknown[] = [];
    const ch: FeedChannel = { postMessage: (m) => sent.push(m), addEventListener() {} };
    const feed = createAiFeed({ channel: ch, sim: true });
    feed.publish({ kind: 'bytes', total: 0, simTotal: 400 });
    feed.publish({ kind: 'log', engine: 'nano', verb: 'received', text: 'hi' });
    expect(sent).toHaveLength(2);
    expect(sent.every((m) => (m as { sim?: boolean }).sim === true)).toBe(true);
    expect(isAiFeedMsg(sent[0])).toBe(true);
    // Backward compatible: no flag on a real canvas, and old messages still parse.
    const real: unknown[] = [];
    createAiFeed({ channel: { postMessage: (m) => real.push(m), addEventListener() {} } }).publish({ kind: 'bytes', total: 5 });
    expect((real[0] as { sim?: boolean }).sim).toBeUndefined();
    expect(isAiFeedMsg({ v: 1, sid: 's', t: 1, kind: 'bytes', total: 1 })).toBe(true);
    expect(isAiFeedMsg({ v: 1, sid: 's', t: 1, kind: 'bytes', total: 1, sim: 'yes' })).toBe(false);
  });

  it('monitor ledger: a SIM turn crosses as a SIM packet, never as real bytes', () => {
    const l = createLedger();
    l.log('laptop', 'nano', 'received', 'build it', 1000);
    expect(l.bytes('laptop', 0, 1001, 900)).toEqual([]);
    const fx = l.log('laptop', 'gemini', 'received', 'prompt', 1002);
    expect(fx).toMatchObject([{ kind: 'packet', dir: 'out', bytes: 900, sim: true }]);
    expect(l.sentTotal()).toBe(0);
    expect(l.simTotal()).toBe(900);
  });

  it('canvasApp books via the ledger with the turn\'s sim flag', () => {
    expect(canvasSrc).toMatch(/ledger\.record\(\{ engine: s\.engine, extraBytes: [^}]*sim: s\.sim \}\)/);
    expect(canvasSrc).toContain('createCanvasAiFeed(phoneShell, { sim: !!opts.sim })');
    // the engine bar gets the SIM would-send total too, not just real bytes
    expect(canvasSrc).toContain('setCloudBytes: (b, sim) => engineBar.setCloudBytes(b, sim)');
  });
});

describe('A3 a fallback draft is not a second send', () => {
  it('canvasApp never re-books on fallback (aiFellBack only relabels)', () => {
    const fb = canvasSrc.slice(canvasSrc.indexOf('function aiFellBack('), canvasSrc.indexOf('function aiFellBack(') + 400);
    expect(fb).not.toMatch(/recordSent|ledger\.record|logTurnReceipt|swarm\.start/);
    expect(canvasSrc).toContain('onFallback: aiFellBack');
    // the connect path's fallback, too: its SIM relabel books nothing. The one
    // other send there is the handoff to the REAL Gemini engine after an
    // on-device failure — a genuine second send, so it is booked.
    const connect = canvasSrc.slice(canvasSrc.indexOf('async function connectTurn('), canvasSrc.indexOf('// ---- point-to-connect'));
    expect(connect).toContain('onFallback: aiFellBack,');
    // three opens: the replayed identity, the turn itself, and the handoff —
    // and the two model turns only book when a call really leaves (defer).
    expect(connect.match(/aiSent\(/g)).toHaveLength(3);
    expect(connect.match(/defer: true/g)).toHaveLength(2);
  });
});

describe('A4 swarm cursors follow the engine that really ran', () => {
  it('a Nano call shows no Gemini cursor', () => {
    for (const task of ['dashboard', 'floorplan', 'kannada', 'generic'] as const) {
      const agents = buildSwarmAgents(buildMixedSwarmPlan('nano', task, { tileCount: 5 }));
      expect(agents.some((a) => a.kind === 'gemini')).toBe(false);
      expect(agents.filter((a) => a.real)).toHaveLength(1);
      expect(agents.length).toBe(1 + 5); // the call + one per tile, never a fixed mob
    }
    // ...and a Gemini call shows no Nano cursor either
    expect(buildSwarmAgents(buildMixedSwarmPlan('gemini', 'dashboard', { tileCount: 5 })).some((a) => a.kind === 'nano')).toBe(false);
    expect(swarmPillText({ gemini: 0, nano: 1, bytes: 0 })).toBe('Nano · 1 call · 0 B to cloud');
  });
});

describe('A5 no "not stored" overclaim', () => {
  it('point-to-connect receipts say what is true', () => {
    const r = pointFailureReceipt({ cropBytes: 1000, cloudSends: 1, cloudAnswered: true });
    expect(r.line).toContain('sent for this answer only; Mendcraft keeps no copy');
    expect(r.line).not.toMatch(/not stored/i);
    const out = pointConnectFromIdentity(
      { identity: { label: 'WiZ lamp', kind: 'lamp', brand: 'WiZ', confidence: 0.9 }, source: 'cloud', ms: 10 },
      { cropBytes: 1000, devices: [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' }] },
    );
    expect(out.ok && out.turn.sent.sent).toMatch(/Mendcraft keeps no copy/);
  });
});

describe('A6 open-ended: a cloud engine gets the redacted prompt, once', () => {
  it('prepare runs for each engine really tried, never for its scripted fallback', async () => {
    const seen: string[] = [];
    const streamed: string[] = [];
    const nanoIsCloud: SurfaceEngine = { id: 'gemini', sim: false, stream: async (p) => { streamed.push(p); throw new Error('down'); }, fallback: scriptedEngine('gemini', 'prepared', { delayMs: 0 }) };
    const gemini = scriptedEngine('gemini', 'never', { delayMs: 0 });
    const r = await openEndedAsk('hi Sharma', nanoIsCloud, gemini, undefined, (eng, prompt) => { seen.push(eng.id); return prompt.replace('Sharma', '[Client A]'); });
    expect(seen).toEqual(['gemini']);
    expect(streamed[0]).toContain('[Client A]');
    expect(streamed[0]).not.toContain('Sharma');
    expect(r).toMatchObject({ reply: 'prepared', sim: true });
  });
});

describe('A7 point-choice and teach book what left', () => {
  it('a pending point-choice books the crop when it was sent, and expires after 20 s', () => {
    const fin = canvasSrc.slice(canvasSrc.indexOf('async function finishPoint('), canvasSrc.indexOf('async function nameTurn('));
    expect(fin.indexOf('bookPointSends(r, o)')).toBeGreaterThan(-1);
    expect(fin.indexOf('bookPointSends(r, o)')).toBeLessThan(fin.indexOf('pointChoice = {'));
    expect(canvasSrc).toContain('const POINT_CHOICE_MS = 20_000;');
    expect(fin).toContain('prebookedBytes: o.prebooked');
    // booked once: the helper is idempotent per point
    const book = canvasSrc.slice(canvasSrc.indexOf('function bookPointSends('), canvasSrc.indexOf('function bookPointSends(') + 300);
    expect(book).toContain('if (o.prebooked != null) return;');
  });
  it('teach with a model books its prompt in the ledger', () => {
    expect(canvasSrc).toMatch(/onModelSent: \(engine, prompt\) => \{[\s\S]*?recordSent\(teachSent/);
  });
});
