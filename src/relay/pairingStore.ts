// Remembered pairing state — PURE over an injected Storage, so a phone that was
// paired once never has to retype the code and a laptop can RESUME the same room
// token across reloads (the old createHostSession always minted a fresh token,
// which would strand remembered phones). No DOM, no network: everything here is
// localStorage key plumbing with defensive parsing, unit-tested.

import type { PhonePlatform, Side } from '../canvas/screenLayout';

/** The subset of the Web Storage API we touch. Injectable for tests/sim. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const K_PHONE_PAIR = 'mc.relay.phonePair';
const K_HOST_TOKEN = 'mc.relay.hostToken';
const K_DEVICE_ID = 'mc.relay.deviceId';
const K_PHONE_PIN = 'mc.relay.phonePin';

/** What a phone remembers about the hub it paired with. `side`/`platform` let it
 *  pre-fill the screen-arrangement step and know which viewport edge is "inner". */
export interface PhonePair {
  token: string;
  hubName: string;
  deviceId: string;
  platform?: PhonePlatform;
  side?: Side;
}

/** Local pin state on the phone: a pinned dashboard/board keeps working offline. */
export interface PhonePin {
  pinned: boolean;
  /** The last board snapshot captured at pin time (re-validated before render). */
  board?: unknown;
  at?: number;
}

function read(storage: StorageLike | null | undefined, key: string): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(storage: StorageLike | null | undefined, key: string, value: string): void {
  if (!storage) return;
  try {
    storage.setItem(key, value);
  } catch {
    // Quota / private mode: remembering is best-effort, never fatal.
  }
}

function remove(storage: StorageLike | null | undefined, key: string): void {
  if (!storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // ignore
  }
}

function parse(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const TOKEN_RE = /^[0-9A-Z]{24}$/;

/** The remembered phone→hub pairing, or null when nothing valid is stored. */
export function loadPhonePair(storage: StorageLike | null | undefined): PhonePair | null {
  const o = parse(read(storage, K_PHONE_PAIR));
  if (!o) return null;
  const token = typeof o.token === 'string' ? o.token : '';
  const deviceId = typeof o.deviceId === 'string' ? o.deviceId : '';
  if (!TOKEN_RE.test(token) || !deviceId) return null;
  const pair: PhonePair = {
    token,
    hubName: typeof o.hubName === 'string' && o.hubName ? o.hubName.slice(0, 60) : 'the laptop',
    deviceId: deviceId.slice(0, 64),
  };
  if (o.platform === 'android' || o.platform === 'ios') pair.platform = o.platform;
  if (o.side === 'left' || o.side === 'right') pair.side = o.side;
  return pair;
}

export function savePhonePair(storage: StorageLike | null | undefined, pair: PhonePair): void {
  if (!TOKEN_RE.test(pair.token)) return;
  write(storage, K_PHONE_PAIR, JSON.stringify(pair));
}

/** Update just the arrangement fields of a remembered pair (no-op if none). */
export function rememberPhoneSide(
  storage: StorageLike | null | undefined,
  side: Side,
  platform?: PhonePlatform,
): void {
  const pair = loadPhonePair(storage);
  if (!pair) return;
  pair.side = side;
  if (platform) pair.platform = platform;
  savePhonePair(storage, pair);
}

export function clearPhonePair(storage: StorageLike | null | undefined): void {
  remove(storage, K_PHONE_PAIR);
}

/** The host's RESUMABLE room token — so a laptop reload rejoins the same room
 *  that remembered phones are still pointed at, instead of minting a fresh one. */
export function loadHostToken(storage: StorageLike | null | undefined): string | null {
  const raw = (read(storage, K_HOST_TOKEN) ?? '').trim().toUpperCase();
  return TOKEN_RE.test(raw) ? raw : null;
}

export function saveHostToken(storage: StorageLike | null | undefined, token: string): void {
  if (TOKEN_RE.test(token)) write(storage, K_HOST_TOKEN, token);
}

export function clearHostToken(storage: StorageLike | null | undefined): void {
  remove(storage, K_HOST_TOKEN);
}

const K_HOST_PHONE = 'mc.relay.hostPhoneRoom';

/** A phone proved itself live in this room (its announce named this laptop's
 *  session), so that phone remembers the room and rejoins it on its own. */
export function rememberHostPhone(storage: StorageLike | null | undefined, token: string): void {
  if (TOKEN_RE.test(token) && read(storage, K_HOST_PHONE) !== token) write(storage, K_HOST_PHONE, token);
}

/** The room a NEW pairing opens (C2). A stored room that a phone remembers is
 *  resumed, so remembered phones rejoin silently and a laptop reload keeps the
 *  room. A stored room no phone ever proved itself in is forgotten: the new
 *  pairing mints a new room, so whoever heard an earlier code holds nothing. */
export function hostRoomToResume(storage: StorageLike | null | undefined): string | undefined {
  const token = loadHostToken(storage);
  if (!token) return undefined;
  if (read(storage, K_HOST_PHONE) === token) return token;
  clearHostToken(storage);
  return undefined;
}

const K_LAYOUT = 'mc.relay.layout';

/** The laptop's remembered screen arrangement (which phone is on which side).
 *  Stored as the raw {left,right} shape; defaults to the empty layout. */
export function loadLayout(storage: StorageLike | null | undefined): { left: unknown; right: unknown } | null {
  return parse(read(storage, K_LAYOUT)) as { left: unknown; right: unknown } | null;
}

export function saveLayout(storage: StorageLike | null | undefined, layout: { left: unknown; right: unknown }): void {
  write(storage, K_LAYOUT, JSON.stringify({ left: layout.left ?? null, right: layout.right ?? null }));
}

/** A stable per-device id (survives reloads), generated once and remembered. The
 *  id is opaque and non-identifying — it only lets the hub tell two phones apart
 *  (e.g. which side each is on). `gen` is injectable for deterministic tests. */
export function ensureDeviceId(
  storage: StorageLike | null | undefined,
  gen: () => string = randomDeviceId,
): string {
  const existing = read(storage, K_DEVICE_ID);
  if (existing && existing.length >= 6) return existing.slice(0, 64);
  const id = gen().slice(0, 64);
  write(storage, K_DEVICE_ID, id);
  return id;
}

function randomDeviceId(): string {
  // Non-crypto is fine — this is a local nickname, not a capability.
  const g = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (g?.getRandomValues) {
    const b = g.getRandomValues(new Uint8Array(8));
    return `dev-${Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('')}`;
  }
  return `dev-${Math.abs(Math.floor((Date.now?.() ?? 0) ^ 0x9e3779b9)).toString(16)}`;
}

/** The remembered local pin (defaults to not pinned). */
export function loadPhonePin(storage: StorageLike | null | undefined): PhonePin {
  const o = parse(read(storage, K_PHONE_PIN));
  if (!o) return { pinned: false };
  const pin: PhonePin = { pinned: o.pinned === true };
  if (o.board && typeof o.board === 'object') pin.board = o.board;
  if (typeof o.at === 'number' && Number.isFinite(o.at)) pin.at = o.at;
  return pin;
}

export function savePhonePin(storage: StorageLike | null | undefined, pin: PhonePin): void {
  write(storage, K_PHONE_PIN, JSON.stringify(pin));
}

export function clearPhonePin(storage: StorageLike | null | undefined): void {
  remove(storage, K_PHONE_PIN);
}
