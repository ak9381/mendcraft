import { describe, expect, it } from 'vitest';
import { codeVouchTag, codeVouchedAt, generateRoomToken, type RelayMessage } from '../src/relay/protocol';
import { createFakeTransport, type RelayTransport } from '../src/relay/transport';
import { ALIAS_TTL_MS, createHostSession, resolveRoomId } from '../src/relay/session';
import { loadOpenCode, loadStaleCodes, openCodeStore } from '../src/relay/pairingStore';

/** The fake transport with the Firestore freshness rule: the alias doc holds
 *  only {room}; freshness is read from the room's host messages (server time
 *  from a controllable clock), as firestoreTransport.ts does. */
function firestoreLike(clock: { now: number }) {
  const base = createFakeTransport();
  const rooms = new Map<string, { data: RelayMessage; at: number }[]>();
  const record = (roomId: string, msg: RelayMessage) => {
    if (!rooms.has(roomId)) rooms.set(roomId, []);
    rooms.get(roomId)!.push({ data: JSON.parse(JSON.stringify(msg)) as RelayMessage, at: clock.now });
  };
  const t: RelayTransport = {
    ...base,
    async publish(roomId, msg) {
      await base.publish(roomId, msg);
      record(roomId, msg);
    },
    async publishStamped(roomId, msg) {
      await base.publish(roomId, msg);
      record(roomId, msg);
      return { at: clock.now };
    },
    async aliasFreshAt(code, roomId) {
      const tag = await codeVouchTag(code, roomId);
      return codeVouchedAt(tag, (rooms.get(roomId) ?? []).map((m) => ({ data: m.data as unknown as Record<string, unknown>, at: m.at })));
    },
  };
  return t;
}

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('C2: a code left behind by a reload never comes back in the resumed room', () => {
  it('the review probe: C1 left open, six hours later a resumed session speaks; C1 stays dead', async () => {
    const clock = { now: 1_000_000 };
    const t = firestoreLike(clock);
    const token = generateRoomToken();
    const storage = memStorage();
    const s1 = await createHostSession(t, undefined, { token, now: () => clock.now, openCode: openCodeStore(storage) });
    const c1 = s1.code;
    expect(await resolveRoomId(t, { kind: 'code', code: c1 }, { now: () => clock.now })).toBe(token);
    // The page goes away with the window open: nothing clears the alias doc.
    clock.now += 6 * 3600_000;
    expect(await resolveRoomId(t, { kind: 'code', code: c1 }, { now: () => clock.now })).toBeNull();
    // A resumed session on the same token speaks.
    const s2 = await createHostSession(t, undefined, { token, now: () => clock.now, openCode: openCodeStore(storage) });
    await t.publish(token, { v: 1, from: 'host', type: 'hello' });
    expect(await resolveRoomId(t, { kind: 'code', code: c1 }, { now: () => clock.now })).toBeNull();
    // The resumed room cleared the remembered code's alias doc outright.
    expect(await t.resolveAlias(c1)).toBeNull();
    expect(s2.code).not.toBe(c1);
    expect(await resolveRoomId(t, { kind: 'code', code: s2.code }, { now: () => clock.now })).toBe(token);
    await s2.close();
  });

  it('per code: host messages do not vouch for a code that was not opened again', async () => {
    const clock = { now: 5_000 };
    const t = firestoreLike(clock);
    const token = generateRoomToken();
    const s1 = await createHostSession(t, undefined, { token, now: () => clock.now });
    const c1 = s1.code;
    clock.now += ALIAS_TTL_MS + 1;
    // Nothing remembered the code (an older build): the alias doc is still
    // there, but the new session's messages do not vouch for C1.
    const s2 = await createHostSession(t, undefined, { token, now: () => clock.now });
    await s2.admitMore();
    expect(await t.resolveAlias(c1)).toBe(token);
    expect(await resolveRoomId(t, { kind: 'code', code: c1 }, { now: () => clock.now })).toBeNull();
    expect(await resolveRoomId(t, { kind: 'code', code: s2.code }, { now: () => clock.now })).toBe(token);
    await s2.close();
  });

  it('review sim-3 §4: a resume while the delete fails keeps the old code remembered, and the next session online deletes it', async () => {
    const base = createFakeTransport();
    const token = generateRoomToken();
    const storage = memStorage();
    const s1 = await createHostSession(base, undefined, { token, openCode: openCodeStore(storage) });
    const c1 = s1.code; // the page goes away with C1 open
    // Resumed with the delete failing (offline for that call): the new code still opens.
    let deletesFail = true;
    const flaky: RelayTransport = { ...base, async clearAlias(code) { if (deletesFail) throw new Error('offline'); return base.clearAlias(code); } };
    const s2 = await createHostSession(flaky, undefined, { token, openCode: openCodeStore(storage) });
    expect(await base.resolveAlias(c1)).toBe(token); // still there…
    expect(loadStaleCodes(storage)).toContain(c1); // …and not forgotten
    // Online again: the next session deletes it and forgets it.
    deletesFail = false;
    await s2.close();
    const s3 = await createHostSession(flaky, undefined, { token, openCode: openCodeStore(storage) });
    expect(await base.resolveAlias(c1)).toBeNull();
    expect(loadStaleCodes(storage)).not.toContain(c1);
    await s3.close();
  });

  it('the open code is remembered beside the token and forgotten when cleared', async () => {
    const t = createFakeTransport();
    const storage = memStorage();
    const s = await createHostSession(t, undefined, { openCode: openCodeStore(storage) });
    expect(loadOpenCode(storage)).toBe(s.code);
    await s.endAdmission();
    expect(loadOpenCode(storage)).toBeNull();
    await s.admitMore();
    expect(loadOpenCode(storage)).toBe(s.code);
    await s.close();
    expect(loadOpenCode(storage)).toBeNull();
  });
});
