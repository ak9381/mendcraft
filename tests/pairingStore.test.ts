import { describe, it, expect } from 'vitest';
import {
  loadPhonePair, savePhonePair, clearPhonePair, rememberPhoneSide,
  loadHostToken, saveHostToken, clearHostToken, rememberHostPhone, hostRoomToResume,
  ensureDeviceId, loadPhonePin, savePhonePin, clearPhonePin,
  type StorageLike,
} from '../src/relay/pairingStore';

function memStore(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

const TOKEN = 'ABCDEFGHJKMNPQRSTVWXYZ01'; // 24 crockford chars

describe('pairingStore phone pair', () => {
  it('round-trips a valid pair', () => {
    const s = memStore();
    savePhonePair(s, { token: TOKEN, hubName: 'This Mac', deviceId: 'dev-abc123', platform: 'android', side: 'left' });
    const got = loadPhonePair(s);
    expect(got).toEqual({ token: TOKEN, hubName: 'This Mac', deviceId: 'dev-abc123', platform: 'android', side: 'left' });
  });

  it('rejects a bad token', () => {
    const s = memStore();
    s.setItem('mc.relay.phonePair', JSON.stringify({ token: 'nope', deviceId: 'x' }));
    expect(loadPhonePair(s)).toBeNull();
  });

  it('defaults hubName and drops invalid platform/side', () => {
    const s = memStore();
    s.setItem('mc.relay.phonePair', JSON.stringify({ token: TOKEN, deviceId: 'dev-1', platform: 'x', side: 'up' }));
    const got = loadPhonePair(s)!;
    expect(got.hubName).toBe('the laptop');
    expect(got.platform).toBeUndefined();
    expect(got.side).toBeUndefined();
  });

  it('rememberPhoneSide patches an existing pair only', () => {
    const s = memStore();
    rememberPhoneSide(s, 'right', 'ios'); // no pair yet → no-op
    expect(loadPhonePair(s)).toBeNull();
    savePhonePair(s, { token: TOKEN, hubName: 'Mac', deviceId: 'dev-1' });
    rememberPhoneSide(s, 'right', 'ios');
    expect(loadPhonePair(s)).toMatchObject({ side: 'right', platform: 'ios' });
  });

  it('clears', () => {
    const s = memStore();
    savePhonePair(s, { token: TOKEN, hubName: 'Mac', deviceId: 'dev-1' });
    clearPhonePair(s);
    expect(loadPhonePair(s)).toBeNull();
  });
});

describe('pairingStore host token (resume)', () => {
  it('round-trips and normalises case', () => {
    const s = memStore();
    saveHostToken(s, TOKEN);
    expect(loadHostToken(s)).toBe(TOKEN);
    expect(loadHostToken(memStore())).toBeNull();
  });
  it('rejects malformed tokens', () => {
    const s = memStore();
    saveHostToken(s, 'short');
    expect(loadHostToken(s)).toBeNull();
    clearHostToken(s);
  });
});

describe('C2: which room a new pairing opens', () => {
  const OTHER = 'ZYXWVTSRQPNMKJHGFEDCBA98';
  it('no phone ever proved itself in the stored room: a new room (the stored token is forgotten)', () => {
    const s = memStore();
    saveHostToken(s, TOKEN);
    expect(hostRoomToResume(s)).toBeUndefined();
    expect(loadHostToken(s)).toBeNull();
  });
  it('a phone is remembered in it: the same room, so remembered phones rejoin and a reload keeps it', () => {
    const s = memStore();
    saveHostToken(s, TOKEN);
    rememberHostPhone(s, TOKEN);
    expect(hostRoomToResume(s)).toBe(TOKEN);
    expect(hostRoomToResume(s)).toBe(TOKEN); // asked again (a reload): still the same room
  });
  it('a phone remembered in an OLDER room does not keep the new one', () => {
    const s = memStore();
    rememberHostPhone(s, OTHER);
    saveHostToken(s, TOKEN);
    expect(hostRoomToResume(s)).toBeUndefined();
  });
  it('nothing stored: a new room', () => {
    expect(hostRoomToResume(memStore())).toBeUndefined();
  });
});

describe('pairingStore deviceId', () => {
  it('generates once and is stable', () => {
    const s = memStore();
    const id1 = ensureDeviceId(s, () => 'dev-fixed-id');
    const id2 = ensureDeviceId(s, () => 'dev-other');
    expect(id1).toBe('dev-fixed-id');
    expect(id2).toBe('dev-fixed-id'); // remembered, gen not called again
  });
});

describe('pairingStore pin', () => {
  it('defaults to not pinned, round-trips', () => {
    const s = memStore();
    expect(loadPhonePin(s)).toEqual({ pinned: false });
    savePhonePin(s, { pinned: true, board: { kind: 'room', title: 't', tiles: [] }, at: 5 });
    const got = loadPhonePin(s);
    expect(got.pinned).toBe(true);
    expect(got.at).toBe(5);
    clearPhonePin(s);
    expect(loadPhonePin(s)).toEqual({ pinned: false });
  });
});

describe('pairingStore resilience', () => {
  it('survives a null storage and throwing storage', () => {
    expect(loadPhonePair(null)).toBeNull();
    expect(loadHostToken(undefined)).toBeNull();
    const boom: StorageLike = {
      getItem: () => { throw new Error('denied'); },
      setItem: () => { throw new Error('denied'); },
      removeItem: () => { throw new Error('denied'); },
    };
    expect(loadPhonePair(boom)).toBeNull();
    expect(() => savePhonePair(boom, { token: TOKEN, hubName: 'x', deviceId: 'd' })).not.toThrow();
  });
});
