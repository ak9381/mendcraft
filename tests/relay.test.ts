import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CODE_LENGTH,
  ROOM_MESSAGE_DATA_BASE64_MAX,
  TOKEN_ALPHABET,
  TOKEN_LENGTH,
  advancePair,
  buildJoinUrl,
  fitsRoomMessageRules,
  generateRoomToken,
  groupCode,
  isRemoteRoute,
  normalizeCode,
  pairStateLabel,
  parseJoinInput,
  shortCodeOf,
  validateCommand,
  validateMessage,
  validateMusic,
  type PairState,
  type RandomBytes,
  type RelayMessage,
} from '../src/relay/protocol';
import { createFakeTransport } from '../src/relay/transport';
import { ALIAS_TTL_MS, createGuestSession, createHostSession, resolveRoomId } from '../src/relay/session';

const seqRandom =
  (start = 0): RandomBytes =>
  (n) =>
    Uint8Array.from({ length: n }, (_, i) => start + i);

/** Wait for the fake transport's microtask deliveries to drain. */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('relay tokens, codes, and URLs', () => {
  it('generates tokens of the right length and alphabet', () => {
    const token = generateRoomToken();
    expect(token).toHaveLength(TOKEN_LENGTH);
    for (const ch of token) expect(TOKEN_ALPHABET).toContain(ch);
    expect(generateRoomToken()).not.toBe(generateRoomToken());
  });

  it('is deterministic under an injected random source', () => {
    expect(generateRoomToken(seqRandom())).toBe(generateRoomToken(seqRandom()));
    expect(generateRoomToken(seqRandom(7))).not.toBe(generateRoomToken(seqRandom()));
  });

  it('derives and groups the short code', () => {
    const token = generateRoomToken(seqRandom());
    const code = shortCodeOf(token);
    expect(code).toBe(token.slice(0, CODE_LENGTH));
    expect(groupCode(code)).toBe(`${code.slice(0, 4)}-${code.slice(4)}`);
  });

  it('normalizes typed codes (case, separators, O/I/L misreads)', () => {
    expect(normalizeCode(' abcd-efgh ')).toBe('ABCDEFGH');
    expect(normalizeCode('o1Il')).toBe('0111');
  });

  it('builds and parses the join URL round trip', () => {
    const token = generateRoomToken(seqRandom());
    const url = buildJoinUrl('https://mendcraft.web.app/', token);
    expect(url).toBe(`https://mendcraft.web.app/remote?room=${token}`);
    expect(parseJoinInput(url)).toEqual({ kind: 'token', token });
  });

  it('parses bare tokens, short codes, and rejects garbage', () => {
    const token = generateRoomToken(seqRandom());
    expect(parseJoinInput(token.toLowerCase())).toEqual({ kind: 'token', token });
    expect(parseJoinInput('abcd-efgh')).toEqual({ kind: 'code', code: 'ABCDEFGH' });
    expect(parseJoinInput('')).toBeNull();
    expect(parseJoinInput('not a code!!')).toBeNull();
    expect(parseJoinInput('https://mendcraft.web.app/remote')).toBeNull();
    expect(parseJoinInput('https://mendcraft.web.app/remote?room=short')).toBeNull();
  });

  it('routes /remote and ?view=remote to the phone page', () => {
    expect(isRemoteRoute('/remote', '')).toBe(true);
    expect(isRemoteRoute('/remote/', '?room=X')).toBe(true);
    expect(isRemoteRoute('/', '?view=remote')).toBe(true);
    expect(isRemoteRoute('/', '')).toBe(false);
    expect(isRemoteRoute('/remotely', '')).toBe(false);
  });
});

describe('relay message envelope', () => {
  it('accepts well-formed messages', () => {
    expect(validateMessage({ v: 1, from: 'phone', type: 'hello' })).toEqual({ v: 1, from: 'phone', type: 'hello' });
    expect(validateMessage({ v: 1, from: 'host', type: 'bye' })).toEqual({ v: 1, from: 'host', type: 'bye' });
    expect(validateMessage({ v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'undo' } })).toMatchObject({
      type: 'cmd', cmd: { kind: 'undo' },
    });
    expect(
      validateMessage({ v: 1, from: 'phone', type: 'frame', mimeType: 'image/jpeg', dataBase64: 'abc' }),
    ).toMatchObject({ type: 'frame', mimeType: 'image/jpeg' });
  });

  it('rejects malformed messages', () => {
    expect(validateMessage(null)).toBeNull();
    expect(validateMessage({ v: 2, from: 'phone', type: 'hello' })).toBeNull();
    expect(validateMessage({ v: 1, from: 'attacker', type: 'hello' })).toBeNull();
    expect(validateMessage({ v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'rm -rf' } })).toBeNull();
    expect(validateMessage({ v: 1, from: 'phone', type: 'frame', mimeType: 'text/html', dataBase64: 'x' })).toBeNull();
    expect(validateMessage({ v: 1, from: 'phone', type: 'frame', mimeType: 'image/jpeg', dataBase64: '' })).toBeNull();
  });

  it('validates commands field by field', () => {
    expect(validateCommand({ kind: 'nudge', dx: 1, dy: 0 })).toEqual({ kind: 'nudge', dx: 1, dy: 0 });
    expect(validateCommand({ kind: 'nudge', dx: 0, dy: 0 })).toBeNull(); // no direction
    expect(validateCommand({ kind: 'nudge', dx: 5, dy: 0 })).toBeNull(); // not a unit step
    expect(validateCommand({ kind: 'command', text: 'add a door' })).toMatchObject({ text: 'add a door' });
    expect(validateCommand({ kind: 'command', text: '' })).toBeNull();
    expect(validateCommand({ kind: 'command', text: 'x'.repeat(501) })).toBeNull();
    expect(validateCommand({ kind: 'mic' })).toEqual({ kind: 'mic' });
  });

  it('validates + clamps music status, and only the phone may send it', () => {
    expect(validateMusic({ title: 'Song', playing: true, volume: 0.4 })).toEqual({ title: 'Song', playing: true, volume: 0.4 });
    expect(validateMusic({ title: 'Song', playing: true, volume: 9 })).toEqual({ title: 'Song', playing: true, volume: 1 });
    expect(validateMusic({ title: 'Song', playing: 'yes', volume: 1 })).toBeNull();
    expect(validateMusic({ title: 123, playing: true, volume: 1 })).toBeNull();
    expect(validateMessage({ v: 1, from: 'phone', type: 'music', music: { title: 'S', playing: false, volume: 0.2 } }))
      .toMatchObject({ type: 'music', music: { title: 'S', playing: false } });
    // A host must not publish music (only the phone drives playback).
    expect(validateMessage({ v: 1, from: 'host', type: 'music', music: { title: 'S', playing: false, volume: 0.2 } }))
      .toBeNull();
  });
});

describe('room-write rules shape (mirrors firestore.rules isValidMessage)', () => {
  const at = new Date();

  it('accepts every real message shape a client publishes', () => {
    const samples: unknown[] = [
      { v: 1, from: 'phone', type: 'hello', at },
      { v: 1, from: 'host', type: 'bye', at },
      { v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'undo' }, at },
      { v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'command', text: 'add a door' }, at },
      { v: 1, from: 'control', type: 'run', run: { runId: 'r1', recipeId: 'c1', device: 'lamp' }, at },
      { v: 1, from: 'host', type: 'runStatus', runStatus: { runId: 'r1', recipeId: 'c1', status: 'running' }, at },
      { v: 1, from: 'control', type: 'runControl', runControl: { runId: 'r1', decision: 'confirm' }, at },
      { v: 1, from: 'phone', type: 'frame', mimeType: 'image/jpeg', dataBase64: 'a'.repeat(5000), at },
      { v: 1, from: 'phone', type: 'music', music: { title: 'Song', playing: true, volume: 0.5 }, at },
      { v: 1, from: 'host', type: 'state', snapshot: { v: 1 }, at },
      { v: 1, from: 'phone', type: 'privacyAsk', ask: { jobId: 'j1', text: 'hi' }, at },
      { v: 1, from: 'host', type: 'privacyReply', reply: { jobId: 'j1', text: 'hi', routeLine: 'x', sentBytes: 2, cleaned: true }, at },
    ];
    for (const s of samples) expect(fitsRoomMessageRules(s)).toBe(true);
  });

  it('rejects a payload with a key outside the known message shape', () => {
    expect(fitsRoomMessageRules({ v: 1, from: 'phone', type: 'hello', at, extra: 'nope' })).toBe(false);
  });

  it('rejects a camera still over the size cap', () => {
    const big = 'a'.repeat(ROOM_MESSAGE_DATA_BASE64_MAX + 1);
    expect(
      fitsRoomMessageRules({ v: 1, from: 'phone', type: 'frame', mimeType: 'image/jpeg', dataBase64: big, at }),
    ).toBe(false);
    const ok = 'a'.repeat(ROOM_MESSAGE_DATA_BASE64_MAX);
    expect(
      fitsRoomMessageRules({ v: 1, from: 'phone', type: 'frame', mimeType: 'image/jpeg', dataBase64: ok, at }),
    ).toBe(true);
  });

  it('rejects an unknown role or type', () => {
    expect(fitsRoomMessageRules({ v: 1, from: 'attacker', type: 'hello', at })).toBe(false);
    expect(fitsRoomMessageRules({ v: 1, from: 'phone', type: 'evil', at })).toBe(false);
    expect(fitsRoomMessageRules({ v: 2, from: 'phone', type: 'hello', at })).toBe(false);
  });

  it('rejects a non-map payload for a nested field', () => {
    expect(fitsRoomMessageRules({ v: 1, from: 'phone', type: 'cmd', cmd: 'not-a-map', at })).toBe(false);
  });
});

describe('pairing state machine', () => {
  it('walks idle → waiting → paired → gone', () => {
    let s: PairState = 'idle';
    s = advancePair(s, 'create');
    expect(s).toBe('waiting');
    s = advancePair(s, 'peer-hello');
    expect(s).toBe('paired');
    s = advancePair(s, 'peer-bye');
    expect(s).toBe('gone');
    expect(advancePair(s, 'peer-hello')).toBe('paired'); // rejoin
    expect(advancePair(s, 'close')).toBe('idle');
  });

  it('ignores transitions that make no sense', () => {
    expect(advancePair('idle', 'peer-hello')).toBe('idle');
    expect(advancePair('waiting', 'peer-bye')).toBe('waiting');
    expect(advancePair('paired', 'create')).toBe('paired');
  });

  it('has a status line for every state and role', () => {
    for (const state of ['idle', 'waiting', 'paired', 'gone', 'disconnected'] as const) {
      expect(pairStateLabel(state, 'host')).toBeTruthy();
      expect(pairStateLabel(state, 'phone')).toBeTruthy();
    }
  });

  it('moves to an explicit disconnected state on a listener error, from any non-idle state', () => {
    expect(advancePair('idle', 'listen-error')).toBe('idle'); // never started listening
    expect(advancePair('waiting', 'listen-error')).toBe('disconnected');
    expect(advancePair('paired', 'listen-error')).toBe('disconnected');
    expect(advancePair('gone', 'listen-error')).toBe('disconnected');
    // A fresh peer-hello (resubscribe succeeded) recovers it.
    expect(advancePair('disconnected', 'peer-hello')).toBe('paired');
    expect(advancePair('disconnected', 'close')).toBe('idle');
  });
});

describe('fake transport', () => {
  it('delivers published messages to room subscribers only', async () => {
    const t = createFakeTransport();
    const got: RelayMessage[] = [];
    const stop = t.subscribe('room-a', (m) => got.push(m));
    const other: RelayMessage[] = [];
    t.subscribe('room-b', (m) => other.push(m));
    await t.publish('room-a', { v: 1, from: 'phone', type: 'hello' });
    await flush();
    expect(got).toHaveLength(1);
    expect(other).toHaveLength(0);
    stop();
    await t.publish('room-a', { v: 1, from: 'phone', type: 'bye' });
    await flush();
    expect(got).toHaveLength(1);
  });

  it('refuses malformed messages at the publish boundary', async () => {
    const t = createFakeTransport();
    await expect(
      t.publish('r', { v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'evil' } } as never),
    ).rejects.toThrow(/malformed/);
  });

  it('stores, resolves, and clears short-code aliases', async () => {
    const t = createFakeTransport();
    await t.setAlias('ABCDEFGH', 'token-1');
    expect(await t.resolveAlias('ABCDEFGH')).toBe('token-1');
    await t.clearAlias('ABCDEFGH');
    expect(await t.resolveAlias('ABCDEFGH')).toBeNull();
  });
});

describe('host session short-code alias TTL', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('auto-expires the short code if nobody joins in time', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    expect(await t.resolveAlias(host.code)).toBe(host.token);
    await vi.advanceTimersByTimeAsync(ALIAS_TTL_MS);
    expect(await t.resolveAlias(host.code)).toBeNull();
    // A late close() after the alias already expired must not throw.
    await host.close();
  });

  it('does not fire the expiry timer once the phone has paired', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    const guest = await createGuestSession(t, host.token);
    await vi.advanceTimersByTimeAsync(0);
    expect(host.state()).toBe('paired');
    expect(await t.resolveAlias(host.code)).toBeNull(); // cleared on pair, not by the timer
    await vi.advanceTimersByTimeAsync(ALIAS_TTL_MS);
    await guest.close();
    await host.close();
  });
});

describe('host + guest sessions over the fake transport', () => {
  it('pairs, exchanges commands and frames, and parts', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    expect(host.state()).toBe('waiting');
    expect(host.code).toBe(shortCodeOf(host.token));
    expect(await t.resolveAlias(host.code)).toBe(host.token);

    const hostStates: PairState[] = [];
    host.onState((s) => hostStates.push(s));
    const commands: unknown[] = [];
    host.onCommand((c) => commands.push(c));
    const frames: string[] = [];
    host.onFrame((f) => frames.push(f.mimeType));

    const guest = await createGuestSession(t, host.token);
    await flush();
    expect(host.state()).toBe('paired');
    expect(guest.state()).toBe('paired');
    expect(await t.resolveAlias(host.code)).toBeNull(); // alias cleared on pair

    await guest.sendCommand({ kind: 'undo' });
    await guest.sendCommand({ kind: 'command', text: 'add a door' });
    await guest.sendFrame({ mimeType: 'image/jpeg', dataBase64: 'ZGF0YQ==' });
    await flush();
    expect(commands).toEqual([{ kind: 'undo' }, { kind: 'command', text: 'add a door' }]);
    expect(frames).toEqual(['image/jpeg']);

    await guest.close();
    await flush();
    expect(host.state()).toBe('gone');
    expect(hostStates).toContain('paired');
    expect(hostStates).toContain('gone');

    await host.close();
    expect(host.state()).toBe('idle');
  });

  it('moves to disconnected (not a silent freeze) when the transport listener errors', async () => {
    const base = createFakeTransport();
    const errorCbs: Array<() => void> = [];
    const flaky: typeof base = {
      ...base,
      subscribe(roomId, onMsg, onError) {
        if (onError) errorCbs.push(onError);
        return base.subscribe(roomId, onMsg, onError);
      },
    };
    const host = await createHostSession(flaky, seqRandom());
    const guest = await createGuestSession(flaky, host.token);
    await flush();
    expect(host.state()).toBe('paired');

    // host's listener is the first subscribe() call.
    expect(errorCbs.length).toBeGreaterThanOrEqual(1);
    errorCbs[0]!();
    expect(host.state()).toBe('disconnected');

    await guest.close();
    await host.close();
  });

  it('relays phone music state to the host while paired', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    const music: unknown[] = [];
    host.onMusic((m) => music.push(m));
    const guest = await createGuestSession(t, host.token);
    await flush();
    await guest.sendMusic({ title: 'Clair de Lune', playing: true, volume: 0.5 });
    await flush();
    expect(music).toEqual([{ title: 'Clair de Lune', playing: true, volume: 0.5 }]);
  });

  it('ignores commands and frames while not paired', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    const commands: unknown[] = [];
    host.onCommand((c) => commands.push(c));
    // A command published straight to the room without a hello first.
    await t.publish(host.token, { v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'undo' } });
    await flush();
    expect(commands).toHaveLength(0);
  });

  it('resolves a room id from a token or a short code', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    expect(await resolveRoomId(t, { kind: 'token', token: host.token })).toBe(host.token);
    expect(await resolveRoomId(t, { kind: 'code', code: host.code })).toBe(host.token);
    expect(await resolveRoomId(t, { kind: 'code', code: 'ZZZZZZZZ' })).toBeNull();
  });

  it('a phone reload can rejoin the same room', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    const guest1 = await createGuestSession(t, host.token);
    await flush();
    await guest1.close();
    await flush();
    expect(host.state()).toBe('gone');
    const guest2 = await createGuestSession(t, host.token);
    await flush();
    expect(host.state()).toBe('paired');
    expect(guest2.state()).toBe('paired');
  });
});

describe('privacyAsk / privacyReply on the wire', () => {
  it('accepts a phone ask and a host reply, and rejects the wrong role', () => {
    const ask = { jobId: 'pv-1', text: 'email Priya Rao' };
    expect(validateMessage({ v: 1, from: 'phone', type: 'privacyAsk', ask })).toEqual({
      v: 1, from: 'phone', type: 'privacyAsk', ask,
    });
    expect(validateMessage({ v: 1, from: 'host', type: 'privacyAsk', ask })).toBeNull();
    const reply = { jobId: 'pv-1', text: 'Hi Priya Rao', routeLine: 'routed via Mac: Nano cleaned, then Gemini', sentBytes: 20, cleaned: true };
    expect(validateMessage({ v: 1, from: 'host', type: 'privacyReply', reply })).toMatchObject({ type: 'privacyReply', reply });
    expect(validateMessage({ v: 1, from: 'phone', type: 'privacyReply', reply })).toBeNull();
  });

  it('a guest ask is cleaned on the host and the filled reply comes back', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    const guest = await createGuestSession(t, host.token);
    await flush();
    host.onPrivacyAsk((ask) => {
      void host.sendPrivacyReply({
        jobId: ask.jobId,
        text: 'Hi Priya Rao',
        routeLine: 'routed via Mac: Nano cleaned, then Gemini',
        sentBytes: 24,
        cleaned: true,
      });
    });
    const reply = await guest.sendPrivacyAsk({ jobId: 'pv-9', text: 'email Priya Rao' });
    expect(reply.text).toBe('Hi Priya Rao');
    expect(reply.cleaned).toBe(true);
    expect(reply.sentBytes).toBe(24);
  });

  it('rejects an in-flight privacyAsk immediately on close(), instead of hanging for the full timeout', async () => {
    const t = createFakeTransport();
    const host = await createHostSession(t, seqRandom());
    const guest = await createGuestSession(t, host.token);
    await flush();
    // The host never replies — without the fix this would hang for timeoutMs.
    const pending = guest.sendPrivacyAsk({ jobId: 'pv-10', text: 'email Priya Rao' }, 20000);
    await flush();
    await guest.close();
    await expect(pending).rejects.toThrow(/closed/);
    await host.close();
  });
});
