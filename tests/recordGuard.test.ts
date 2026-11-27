import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { envSecrets, foreignDevices, unsafeFixture } from '../scripts/recordGuard.lib.mjs';
import { JOURNEY_DEVICES } from '../scripts/journey.lib.mjs';

const file = (reply: string) => ({ engine: 'gemini', model: 'm', turnKind: 'board', recordedAt: '2026-11-27T00:00:00Z', promptSha: 'a'.repeat(64), source: 'recorded', reply });
const opts = { devices: JOURNEY_DEVICES };

describe('what the recorder refuses to write', () => {
  it('a reply on the journey fixtures passes, its sha-256 included', () => {
    expect(unsafeFixture(file('{"kind":"room","tiles":[{"type":"lamp","deviceId":"wiz-lamp-1","label":"Desk lamp"},{"type":"music","deviceId":"Device 2","label":"Speaker"}]}'), opts)).toBeNull();
    expect(unsafeFixture(file('{"t":"Home","d":["wiz-lamp-1","speaker-sim","gimbal"]}'), opts)).toBeNull();
    expect(unsafeFixture(file('{"rooms":[{"name":"Bedroom 1","x":0,"y":3000,"w":4000,"h":3000}]}'), opts)).toBeNull();
  });

  it('a device id or device-tile label the journey did not set up', () => {
    expect(foreignDevices('{"t":"Home","d":["wiz-a8bb50e1"]}', JOURNEY_DEVICES)).toEqual(['wiz-a8bb50e1']);
    expect(unsafeFixture(file('{"tiles":[{"type":"lamp","deviceId":"bedroom-wiz","label":"Lamp"}]}'), opts)).toMatch(/a device the journey did not set up/);
    expect(unsafeFixture(file('{"tiles":[{"type":"music","deviceId":"speaker-sim","label":"Akash\'s Echo"}]}'), opts)).toMatch(/a device the journey did not set up/);
    expect(unsafeFixture(file('prose "deviceId": "real-plug-7" then'), opts)).toMatch(/a device/);
  });

  it('keys, tokens, emails, addresses and hardware ids', () => {
    expect(unsafeFixture(file(`{"k":"AIza${'x'.repeat(30)}"}`), opts)).toBe('an API key');
    expect(unsafeFixture(file('{"h":"192.168.1.40"}'), opts)).toBe('an IP address');
    expect(unsafeFixture(file('{"m":"a8:bb:50:e1:02:03"}'), opts)).toBe('a MAC address');
    expect(unsafeFixture(file('{"m":"a8bb50e10203"}'), opts)).toBe('a hardware id');
    expect(unsafeFixture(file('{"e":"me@example.com"}'), opts)).toBe('an email address');
    expect(unsafeFixture(file('{"t":"Bearer abcdefghijklmnopqrstuv"}'), opts)).toBe('a bearer or access token');
  });

  it('any value from .env.local', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mc-guard-'));
    writeFileSync(join(dir, '.env.local'), 'VITE_SPOTIFY_CLIENT_ID=zz-secret-client-77\n# comment\nSHORT=abc\n');
    const secrets = envSecrets(join(dir, '.env.local'));
    expect(secrets).toEqual(['zz-secret-client-77']);
    expect(unsafeFixture(file('{"c":"zz-secret-client-77"}'), { ...opts, secrets })).toBe('a value from .env.local');
  });
});
