import { describe, expect, it } from 'vitest';
import {
  AI_FEED_MAX,
  PRIMITIVES_MAX,
  buildControlSnapshot,
  coerceSnapshot,
  controlDemoSnapshots,
  playControlDemo,
  snapshotBytes,
  type ControlSnapshot,
  type ScenePrimitive,
} from '../src/relay/controlSnapshot';
import { validateMessage } from '../src/relay/protocol';
import { createFakeTransport } from '../src/relay/transport';
import {
  createControlSession,
  createGuestSession,
  createHostSession,
} from '../src/relay/session';
import type { CloudCall, LedgerCounts } from '../src/core/ledger';
import type { QueuedJob } from '../src/offline/queue';
import type { RandomBytes } from '../src/relay/protocol';

const seqRandom =
  (start = 0): RandomBytes =>
  (n) =>
    Uint8Array.from({ length: n }, (_, i) => start + i);
const flush = () => new Promise((r) => setTimeout(r, 0));

const counts: LedgerCounts = { cloud: 1, onDevice: 2, rules: 1, private: 3, bytesSent: 120 };

describe('buildControlSnapshot — privacy', () => {
  it('keeps cloud utterances but drops private (on-device/rules) utterances', () => {
    const snap = buildControlSnapshot({
      ai: [
        { source: 'rules', reason: 'exact', utterance: 'two bedroom plan' },
        { source: 'on-device', reason: 'private', utterance: 'thicker by 50' },
        { source: 'cloud', reason: 'big-job', utterance: 'studio apartment' },
      ],
    });
    expect(snap.ai[0].utterance).toBeUndefined();
    expect(snap.ai[1].utterance).toBeUndefined();
    expect(snap.ai[2].utterance).toBe('studio apartment');
    // The private command text must not appear ANYWHERE in the serialised snapshot.
    const json = JSON.stringify(snap);
    expect(json).not.toContain('thicker by 50');
    expect(json).not.toContain('two bedroom plan');
    // source + reason + badge still carried for the private events.
    expect(snap.ai[1]).toMatchObject({ source: 'on-device', reason: 'private', badge: 'On-device · private' });
  });

  it('redacts media and landmark blobs that slip into a cloud utterance', () => {
    const media = 'look data:image/png;base64,AAAABBBBCCCCDDDD here';
    const landmarks = 'pts 0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9 end';
    const snap = buildControlSnapshot({
      ai: [
        { source: 'cloud', reason: 'big-job', utterance: media },
        { source: 'cloud', reason: 'big-job', utterance: landmarks },
      ],
      caption: { heard: media, langCode: 'en' },
    });
    expect(snap.ai[0].utterance).toContain('[media removed]');
    expect(snap.ai[0].utterance).not.toContain('base64');
    expect(snap.ai[1].utterance).toContain('[landmarks removed]');
    expect(snap.caption?.heard).toContain('[media removed]');
    expect(JSON.stringify(snap)).not.toContain('base64,AAAA');
  });

  it('never fakes appliance connectivity (defaults to unknown)', () => {
    expect(buildControlSnapshot({}).appliances).toEqual({ lamp: 'unknown', music: 'unknown' });
    expect(buildControlSnapshot({ appliances: { lamp: 'off' } }).appliances).toEqual({ lamp: 'off', music: 'unknown' });
  });
});

describe('buildControlSnapshot — caps and omissions', () => {
  it('keeps only the newest AI_FEED_MAX events and reports what was dropped', () => {
    const ai = Array.from({ length: AI_FEED_MAX + 5 }, (_, i) => ({
      source: 'cloud' as const, reason: 'big-job' as const, utterance: `cmd ${i}`,
    }));
    const snap = buildControlSnapshot({ ai });
    expect(snap.ai).toHaveLength(AI_FEED_MAX);
    expect(snap.ai[snap.ai.length - 1].utterance).toBe(`cmd ${AI_FEED_MAX + 4}`); // newest kept
    expect(snap.omitted.aiFeed).toBe(5);
  });

  it('caps scene primitives', () => {
    const primitives: ScenePrimitive[] = Array.from({ length: PRIMITIVES_MAX + 10 }, (_, i) => ({
      t: 'seg', x1: i, y1: 0, x2: i + 1, y2: 1,
    }));
    const snap = buildControlSnapshot({ scene: { mode: 'plan', primitives } });
    expect(snap.scene?.primitives).toHaveLength(PRIMITIVES_MAX);
    expect(snap.omitted.primitives).toBe(10);
  });

  it('truncates long free text and keeps the snapshot small', () => {
    const snap = buildControlSnapshot({
      ai: [{ source: 'cloud', reason: 'big-job', utterance: 'x'.repeat(500) }],
      scene: { mode: 'plan', summary: 'y'.repeat(500), primitives: [] },
    });
    expect(snap.ai[0].utterance!.length).toBeLessThanOrEqual(80);
    expect(snap.scene!.summary.length).toBeLessThanOrEqual(120);
    expect(snapshotBytes(snap)).toBeLessThan(2000);
  });

  it('reuses ledger cloud calls verbatim and omits job payloads from the queue', () => {
    const call: CloudCall = { id: 1, job: 'generate', reason: 'big job', sent: 'ops only', bytes: 8, redactions: 0 };
    const job: QueuedJob = {
      id: 'j1', kind: 'plan', mode: 'plan', label: 'studio apartment',
      payload: { prompt: 'SECRET-PROMPT-DETAIL' }, createdAt: 10, seq: 1, status: 'queued',
    };
    const snap = buildControlSnapshot({ ledger: { calls: [call], counts }, queue: [job] });
    expect(snap.ledger.calls[0]).toMatchObject({ job: 'generate', sent: 'ops only' });
    expect(snap.ledger.counts).toEqual(counts);
    expect(snap.queue[0]).toMatchObject({ id: 'j1', kind: 'plan', status: 'queued', label: 'studio apartment', seq: 1 });
    // The raw payload must never be carried into the snapshot.
    expect(JSON.stringify(snap)).not.toContain('SECRET-PROMPT-DETAIL');
  });
});

describe('coerceSnapshot — defensive rebuild of wire data', () => {
  it('bounds a hostile oversized ledger payload and an unknown reason', () => {
    const snap = coerceSnapshot({
      v: 1, rev: 1,
      ledger: { calls: [{ id: 1, job: 'generate', reason: 'big job', sent: 'A'.repeat(500000), bytes: 1, redactions: 0 }], counts },
      ai: [{ source: 'cloud', reason: '__proto__', utterance: 'hi' }],
    })!;
    expect(snap.ledger.calls[0].sent.length).toBeLessThanOrEqual(600);
    expect(snapshotBytes(snap)).toBeLessThan(2000);
    expect(snap.ai[0].reason).toBe('fallback'); // unknown reason clamped to a known key
  });

  it('rejects non-objects and wrong versions', () => {
    expect(coerceSnapshot(null)).toBeNull();
    expect(coerceSnapshot({ v: 2 })).toBeNull();
    expect(coerceSnapshot('nope')).toBeNull();
  });

  it('re-applies privacy rules so a crafted private utterance is still dropped', () => {
    const hostile = {
      v: 1, rev: 3, activeDevice: 'phone',
      ai: [{ source: 'on-device', reason: 'private', utterance: 'LEAKED', badge: 'x' }],
      ledger: { calls: [], counts }, queue: [], appliances: { lamp: 'on', music: 'bogus' },
      caption: null, scene: null, omitted: { aiFeed: 0, ledgerCalls: 0, queue: 0, primitives: 0 },
    };
    const snap = coerceSnapshot(hostile)!;
    expect(snap).not.toBeNull();
    expect(snap.ai[0].utterance).toBeUndefined();
    expect(JSON.stringify(snap)).not.toContain('LEAKED');
    expect(snap.appliances.music).toBe('unknown'); // invalid value clamped
    expect(snap.activeDevice).toBe('phone');
  });
});

describe('controlDemoSnapshots — drives the dashboard', () => {
  it('shows a device switch, a cloud ledger call, a queued job, a caption, and a 3D scene', () => {
    const seq = controlDemoSnapshots();
    expect(seq.length).toBeGreaterThanOrEqual(3);
    expect(seq[0].activeDevice).toBe('laptop');
    const last = seq[seq.length - 1];
    expect(last.activeDevice).toBe('phone'); // device switch
    expect(last.ledger.calls.length).toBeGreaterThan(0);
    expect(last.queue.length).toBeGreaterThan(0);
    expect(last.caption?.langCode).toBe('kn');
    expect(last.scene?.primitives.length).toBeGreaterThan(0);
    // Every demo snapshot stays small and carries no private utterance text.
    for (const s of seq) {
      expect(snapshotBytes(s)).toBeLessThan(4000);
      const priv = s.ai.filter((e) => e.source !== 'cloud');
      for (const e of priv) expect(e.utterance).toBeUndefined();
    }
  });
});

describe('state message + control session over the fake transport', () => {
  it('validates a host state message and rejects non-host senders', () => {
    const snap = buildControlSnapshot({ rev: 1 });
    expect(validateMessage({ v: 1, from: 'host', type: 'state', snapshot: snap })).toMatchObject({ type: 'state' });
    expect(validateMessage({ v: 1, from: 'phone', type: 'state', snapshot: snap })).toBeNull();
    expect(validateMessage({ v: 1, from: 'host', type: 'state', snapshot: { v: 2 } })).toBeNull();
    expect(validateMessage({ v: 1, from: 'control', type: 'hello' })).toMatchObject({ from: 'control', type: 'hello' });
  });

  it('delivers published snapshots to a control session without changing pairing', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    const control = await createControlSession(t, host.token);
    const got: ControlSnapshot[] = [];
    control.onSnapshot((s) => got.push(s));
    await flush();

    await host.publishState(buildControlSnapshot({ rev: 7, activeDevice: 'phone' }));
    await flush();
    expect(got).toHaveLength(1);
    expect(got[0].rev).toBe(7);
    // A read-only dashboard must never flip the host into a phone-paired state.
    expect(host.state()).toBe('waiting');
    expect(control.state()).toBe('paired');
  });

  it('replays the latest snapshot to a dashboard that joins late', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    await host.publishState(buildControlSnapshot({ rev: 42 })); // no dashboard listening yet
    await flush();

    const control = await createControlSession(t, host.token);
    const got: ControlSnapshot[] = [];
    control.onSnapshot((s) => got.push(s));
    await flush();
    expect(got.at(-1)?.rev).toBe(42);
  });

  it('drives a dashboard with the fake adapter demo (playControlDemo)', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    const control = await createControlSession(t, host.token);
    const got: ControlSnapshot[] = [];
    control.onSnapshot((s) => got.push(s));
    await flush();
    // One pass, no delay: publishes the whole scripted sequence to the room.
    await playControlDemo((s) => host.publishState(s), { delayMs: 0 });
    await flush();
    expect(got.length).toBeGreaterThanOrEqual(4);
    expect(got.at(-1)?.activeDevice).toBe('phone'); // the scripted device switch landed
    expect(got.some((s) => s.caption?.langCode === 'kn')).toBe(true);
  });

  it('still pairs a real phone normally while a dashboard watches', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    await createControlSession(t, host.token);
    await flush();
    const phone = await createGuestSession(t, host.token);
    await flush();
    expect(host.state()).toBe('paired');
    expect(phone.state()).toBe('paired');
  });
});
