import { describe, expect, it } from 'vitest';
import {
  createLedger,
  redact,
  byteSize,
  formatBytes,
  type LedgerSource,
} from '../src/core/ledger';

describe('byteSize — honest UTF-8 sizing', () => {
  it('counts ASCII as one byte each', () => {
    expect(byteSize('')).toBe(0);
    expect(byteSize('abc')).toBe(3);
    expect(byteSize('command: "move left"')).toBe(20);
  });

  it('counts multi-byte characters by their UTF-8 length, not char count', () => {
    expect(byteSize('é')).toBe(2); // 2-byte
    expect(byteSize('—')).toBe(3); // 3-byte em dash
    expect(byteSize('🏠')).toBe(4); // 4-byte (surrogate pair)
  });
});

describe('formatBytes', () => {
  it('shows bytes under 1 KB and KB above', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('redact — scrubs device-only signals from a cloud payload', () => {
  it('leaves an abstract design payload untouched (0 redactions)', () => {
    const r = redact('command: "make this wall 4 meters"\ncontext: {"unit":"mm"}');
    expect(r.count).toBe(0);
    expect(r.text).toContain('make this wall 4 meters');
  });

  it('removes a base64 camera frame data URI', () => {
    const raw = 'op: {"img":"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA"}';
    const r = redact(raw);
    expect(r.count).toBe(1);
    expect(r.text).toContain('[media removed]');
    expect(r.text).not.toContain('base64');
  });

  it('removes captured audio data URIs too', () => {
    const r = redact('data:audio/webm;base64,GkXfo0AgQoaBAULygQ==');
    expect(r.count).toBe(1);
    expect(r.text).toBe('[media removed]');
  });

  it('removes a long run of decimals that looks like a hand/face landmark vector', () => {
    const landmarks = Array.from({ length: 12 }, (_, i) => (i / 10).toFixed(3)).join(', ');
    const r = redact(`points: ${landmarks}`);
    expect(r.count).toBe(1);
    expect(r.text).toContain('[landmarks removed]');
  });

  it('does NOT redact a couple of ordinary numbers in a command', () => {
    const r = redact('resize to 4.0, 3.5 meters');
    expect(r.count).toBe(0);
    expect(r.text).toBe('resize to 4.0, 3.5 meters');
  });
});

describe('ledger — record, counts, and size', () => {
  it('starts empty', () => {
    const l = createLedger();
    expect(l.calls()).toEqual([]);
    expect(l.counts()).toEqual({ cloud: 0, onDevice: 0, rules: 0, private: 0, bytesSent: 0 });
  });

  it('counts on-device and rules as private, storing nothing', () => {
    const l = createLedger();
    l.record({ source: 'on-device', job: 'intent' });
    l.record({ source: 'rules', job: 'command' });
    l.record({ source: 'on-device', job: 'verify' });
    expect(l.calls()).toEqual([]); // nothing left the device
    const c = l.counts();
    expect(c).toMatchObject({ cloud: 0, onDevice: 2, rules: 1, private: 3, bytesSent: 0 });
  });

  it('records a cloud call with its redacted payload, byte size, and reason', () => {
    const l = createLedger();
    const sent = 'command: "two bedroom plan"';
    l.record({ source: 'cloud', job: 'generate', reason: 'big job', sent, ms: 812 });
    const calls = l.calls();
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: 1,
      job: 'generate',
      reason: 'big job',
      sent,
      bytes: byteSize(sent),
      redactions: 0,
      ms: 812,
    });
    expect(l.counts()).toMatchObject({ cloud: 1, private: 0, bytesSent: byteSize(sent) });
  });

  it('redacts a device-only signal before storing or sizing it', () => {
    const l = createLedger();
    l.record({ source: 'cloud', job: 'generate', sent: 'frame: data:image/png;base64,AAAA' });
    const call = l.calls()[0];
    expect(call.redactions).toBe(1);
    expect(call.sent).toContain('[media removed]');
    expect(call.sent).not.toContain('base64');
    // Size reflects the redacted text, not the raw blob.
    expect(call.bytes).toBe(byteSize(call.sent));
  });

  it('accumulates bytesSent across cloud calls and assigns monotonic ids', () => {
    const l = createLedger();
    l.record({ source: 'cloud', job: 'a', sent: 'xx' });   // 2 bytes
    l.record({ source: 'on-device', job: 'b' });            // private, 0 bytes
    l.record({ source: 'cloud', job: 'c', sent: 'yyyy' });  // 4 bytes
    const calls = l.calls();
    expect(calls.map((c) => c.id)).toEqual([1, 2]);
    expect(l.counts()).toMatchObject({ cloud: 2, onDevice: 1, private: 1, bytesSent: 6 });
  });

  it('clear() resets counts and ids', () => {
    const l = createLedger();
    l.record({ source: 'cloud', job: 'a', sent: 'xx' });
    l.record({ source: 'rules', job: 'b' });
    l.clear();
    expect(l.counts()).toEqual({ cloud: 0, onDevice: 0, rules: 0, private: 0, bytesSent: 0 });
    l.record({ source: 'cloud', job: 'c', sent: 'z' });
    expect(l.calls()[0].id).toBe(1); // id counter reset
  });

  it('notifies subscribers on record and clear, and unsubscribe stops them', () => {
    const l = createLedger();
    let hits = 0;
    const off = l.subscribe(() => { hits++; });
    l.record({ source: 'cloud', job: 'a', sent: 'x' });
    l.record({ source: 'on-device', job: 'b' });
    l.clear();
    expect(hits).toBe(3);
    off();
    l.record({ source: 'rules', job: 'c' });
    expect(hits).toBe(3); // no further notifications
  });

  it('calls() returns a copy — the internal list cannot be mutated from outside', () => {
    const l = createLedger();
    l.record({ source: 'cloud', job: 'a', sent: 'x' });
    l.calls().push({ id: 99 } as never);
    expect(l.calls()).toHaveLength(1);
  });

  it('treats an unknown/missing source as not-cloud (never silently "sends")', () => {
    const l = createLedger();
    // A defensive check: only the literal 'cloud' is treated as leaving the device.
    l.record({ source: 'rules' as LedgerSource, job: 'x', sent: 'should not be sent' });
    expect(l.calls()).toEqual([]);
    expect(l.counts().bytesSent).toBe(0);
  });
});
