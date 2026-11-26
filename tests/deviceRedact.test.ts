import { describe, expect, it } from 'vitest';
import { createDeviceIdSession, redactDeviceIds, restoreDeviceIds } from '../src/privacy/deviceRedact';

describe('device id session', () => {
  it('assigns stable, first-seen-order placeholders', () => {
    const s = createDeviceIdSession();
    expect(s.tokenFor('lamp-a')).toBe('Device 1');
    expect(s.tokenFor('lamp-b')).toBe('Device 2');
    expect(s.tokenFor('lamp-a')).toBe('Device 1'); // stable, not reassigned
  });

  it('reverse-looks-up a real id by its token, null for an unknown token', () => {
    const s = createDeviceIdSession();
    s.tokenFor('speaker-a');
    expect(s.idFor('Device 1')).toBe('speaker-a');
    expect(s.idFor('Device 9')).toBeNull();
  });
});

describe('redactDeviceIds / restoreDeviceIds round trip', () => {
  it('swaps real ids for tokens, longest id first, and restores them', () => {
    const s = createDeviceIdSession();
    const ids = ['lamp-a', 'speaker-a', 'speaker-10'];
    const prompt = '- lamp-a: Desk lamp (lamp)\n- speaker-a: Speaker (music)\n- speaker-10: Speaker 10 (music)';
    const redacted = redactDeviceIds(prompt, ids, s);
    expect(redacted).toBe('- Device 1: Desk lamp (lamp)\n- Device 2: Speaker (music)\n- Device 3: Speaker 10 (music)');
    // speaker-10's prefix never leaks into speaker-a's placeholder.
    expect(redacted).not.toContain('speaker-a');

    const reply = '{"deviceId":"Device 1"} and {"deviceId":"Device 3"}';
    expect(restoreDeviceIds(reply, s)).toBe('{"deviceId":"lamp-a"} and {"deviceId":"speaker-10"}');
  });

  it('leaves an unrecognised "Device N" mention alone', () => {
    const s = createDeviceIdSession();
    expect(restoreDeviceIds('Device 4 is unknown here', s)).toBe('Device 4 is unknown here');
  });

  it('never assigns a token for an id that never appears in the text', () => {
    const s = createDeviceIdSession();
    redactDeviceIds('no ids mentioned', ['lamp-a'], s);
    expect(s.idFor('Device 1')).toBeNull();
  });
});
