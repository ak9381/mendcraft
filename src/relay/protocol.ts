// Relay pairing protocol — pure helpers, no DOM and no Firebase. A laptop
// (host) opens a room named by a high-entropy capability token; a phone
// (guest) joins by scanning the QR URL or typing the short code. Everything
// here is deterministic and unit-tested: token/code generation, join-URL
// build/parse, the message envelope, and the pairing state machine.

/** Crockford base32: no I/L/O/U, so codes survive being read aloud or typed. */
import type { ControlSnapshot } from './controlSnapshot';

export const TOKEN_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** 24 chars × 5 bits = 120 bits of entropy — the room id is the capability. */
export const TOKEN_LENGTH = 24;
/** Typable short code: the first 8 token chars (40 bits), shown grouped. */
export const CODE_LENGTH = 8;

export type RandomBytes = (n: number) => Uint8Array;

/** Default randomness (web crypto); injectable for deterministic tests. */
export const cryptoRandom: RandomBytes = (n) => {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
};

/** A fresh high-entropy room token (also the Firestore doc id — capability URL). */
export function generateRoomToken(random: RandomBytes = cryptoRandom): string {
  const bytes = random(TOKEN_LENGTH);
  let out = '';
  for (let i = 0; i < TOKEN_LENGTH; i++) out += TOKEN_ALPHABET[bytes[i] % 32];
  return out;
}

/** The typable short code for a token (its first 8 chars, un-grouped). */
export function shortCodeOf(token: string): string {
  return token.slice(0, CODE_LENGTH);
}

/** "ABCD-EFGH" — how the short code is displayed and read aloud. */
export function groupCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}`;
}

/** Uppercase, strip separators, and map the easy misreads (O→0, I/L→1). */
export function normalizeCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

function isTokenString(s: string, len: number): boolean {
  if (s.length !== len) return false;
  for (const ch of s) if (!TOKEN_ALPHABET.includes(ch)) return false;
  return true;
}

/** The QR URL a phone opens: `${origin}/remote?room=TOKEN`. */
export function buildJoinUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/remote?room=${token}`;
}

export type JoinInput =
  | { kind: 'token'; token: string }
  | { kind: 'code'; code: string }
  | null;

/**
 * Parse whatever the user typed/scanned: a full join URL, a bare room token,
 * or a short code (with or without the dash). Returns null when it is neither.
 */
export function parseJoinInput(raw: string): JoinInput {
  const text = raw.trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text) || text.includes('room=')) {
    const m = /[?&]room=([^&\s]+)/.exec(text);
    if (!m) return null;
    const token = normalizeCode(m[1]);
    return isTokenString(token, TOKEN_LENGTH) ? { kind: 'token', token } : null;
  }
  const norm = normalizeCode(text);
  if (isTokenString(norm, TOKEN_LENGTH)) return { kind: 'token', token: norm };
  if (isTokenString(norm, CODE_LENGTH)) return { kind: 'code', code: norm };
  return null;
}

/** Does this location want the phone /remote page instead of the editor? */
export function isRemoteRoute(pathname: string, search: string): boolean {
  if (/^\/remote\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('view') === 'remote';
}

/**
 * Does this location want the phone-focused /phone page? It is the same remote
 * page in a "lamp & music" variant — the install target for the iPhone PWA
 * (manifest start_url). Matches `/phone` or `?view=phone`.
 */
export function isPhoneRoute(pathname: string, search: string): boolean {
  if (/^\/phone\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('view') === 'phone';
}

/** Does this location want the iPad /control dashboard instead of the editor? */
export function isControlRoute(pathname: string, search: string): boolean {
  if (/^\/control\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('view') === 'control';
}

/** Does this location want the static /judges page (the guided-tour landing)? */
export function isJudgesRoute(pathname: string, search: string): boolean {
  if (/^\/judges\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('view') === 'judges';
}

// ---- message envelope -------------------------------------------------------

// 'control' is the read-only iPad dashboard: it subscribes to a host's room and
// receives privacy-safe state snapshots. It never drives the editor, so it only
// ever sends presence (hello/bye) — never a command or a frame.
export type RelayRole = 'host' | 'phone' | 'control';

export type RelayCommandKind = 'undo' | 'redo' | 'command' | 'nudge' | 'mic';

export interface RelayCommand {
  kind: RelayCommandKind;
  /** For kind 'command': the typed utterance to run through the shared pipeline. */
  text?: string;
  /** For kind 'nudge': unit direction, each of dx/dy in {-1, 0, 1}. */
  dx?: number;
  dy?: number;
}

/** The phone's in-app music player state, relayed to the host so it can appear
 *  on the /control dashboard. Carries only title/playing/volume — no audio. */
export interface MusicStatus {
  title: string;
  playing: boolean;
  /** 0..1 */
  volume: number;
}

export type RelayMessage =
  | { v: 1; from: RelayRole; type: 'hello' }
  | { v: 1; from: RelayRole; type: 'bye' }
  | { v: 1; from: RelayRole; type: 'cmd'; cmd: RelayCommand }
  /** A low-rate JPEG still from the phone camera — goes ONLY to the paired
   *  laptop via the room, never to Firebase AI, and is never ledgered. */
  | { v: 1; from: RelayRole; type: 'frame'; mimeType: string; dataBase64: string }
  /** The phone's music-player state (title/playing/volume) — relayed to the host
   *  so the /control dashboard can show it. No audio ever leaves the phone. */
  | { v: 1; from: 'phone'; type: 'music'; music: MusicStatus }
  /** The laptop's privacy-safe state for the iPad /control dashboard. Only a
   *  host sends it; the snapshot carries NO camera/landmark/audio (see
   *  controlSnapshot.ts). Validated loosely here and re-coerced on receipt. */
  | { v: 1; from: 'host'; type: 'state'; snapshot: ControlSnapshot };

const COMMAND_KINDS: readonly string[] = ['undo', 'redo', 'command', 'nudge', 'mic'];

function isUnit(n: unknown): boolean {
  return n === undefined || n === -1 || n === 0 || n === 1;
}

/** Validate a command payload from the wire; null when malformed. */
export function validateCommand(raw: unknown): RelayCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.kind !== 'string' || !COMMAND_KINDS.includes(c.kind)) return null;
  if (c.kind === 'command' && (typeof c.text !== 'string' || !c.text.trim() || c.text.length > 500)) return null;
  if (c.kind === 'nudge' && !(isUnit(c.dx) && isUnit(c.dy) && (c.dx || c.dy))) return null;
  const out: RelayCommand = { kind: c.kind as RelayCommandKind };
  if (typeof c.text === 'string') out.text = c.text;
  if (typeof c.dx === 'number') out.dx = c.dx;
  if (typeof c.dy === 'number') out.dy = c.dy;
  return out;
}

/** Validate a music-status payload from the wire; null when malformed. */
export function validateMusic(raw: unknown): MusicStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.title !== 'string' || m.title.length > 200) return null;
  if (typeof m.playing !== 'boolean') return null;
  if (typeof m.volume !== 'number' || !Number.isFinite(m.volume)) return null;
  return { title: m.title, playing: m.playing, volume: Math.min(1, Math.max(0, m.volume)) };
}

/** Validate a whole message from the wire; null when malformed. */
export function validateMessage(raw: unknown): RelayMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m.v !== 1) return null;
  if (m.from !== 'host' && m.from !== 'phone' && m.from !== 'control') return null;
  const from = m.from as RelayRole;
  switch (m.type) {
    case 'hello':
      return { v: 1, from, type: 'hello' };
    case 'bye':
      return { v: 1, from, type: 'bye' };
    case 'state':
      // Only a host publishes state; the payload is validated loosely here
      // (object with the snapshot version) and defensively re-coerced by the
      // dashboard via coerceSnapshot before anything is rendered.
      if (from !== 'host') return null;
      if (typeof m.snapshot !== 'object' || m.snapshot === null) return null;
      if ((m.snapshot as { v?: unknown }).v !== 1) return null;
      return { v: 1, from: 'host', type: 'state', snapshot: m.snapshot as ControlSnapshot };
    case 'cmd': {
      const cmd = validateCommand(m.cmd);
      return cmd ? { v: 1, from, type: 'cmd', cmd } : null;
    }
    case 'frame':
      if (typeof m.mimeType !== 'string' || !m.mimeType.startsWith('image/')) return null;
      if (typeof m.dataBase64 !== 'string' || !m.dataBase64) return null;
      return { v: 1, from, type: 'frame', mimeType: m.mimeType, dataBase64: m.dataBase64 };
    case 'music': {
      // Only the phone drives music; the host relays it onto the dashboard.
      if (from !== 'phone') return null;
      const music = validateMusic(m.music);
      return music ? { v: 1, from: 'phone', type: 'music', music } : null;
    }
    default:
      return null;
  }
}

// ---- pairing state machine --------------------------------------------------

export type PairState = 'idle' | 'waiting' | 'paired' | 'gone';
export type PairEvent = 'create' | 'peer-hello' | 'peer-bye' | 'close';

/** Advance the pairing state; unknown transitions keep the current state. */
export function advancePair(state: PairState, event: PairEvent): PairState {
  if (event === 'close') return 'idle';
  switch (state) {
    case 'idle':
      return event === 'create' ? 'waiting' : state;
    case 'waiting':
      return event === 'peer-hello' ? 'paired' : state;
    case 'paired':
      return event === 'peer-bye' ? 'gone' : state;
    case 'gone':
      // A peer may rejoin the same room (e.g. the phone reloaded).
      return event === 'peer-hello' ? 'paired' : state;
  }
}

/** Human status line for a pairing state (used by both panel and phone page). */
export function pairStateLabel(state: PairState, role: RelayRole): string {
  switch (state) {
    case 'idle':
      return 'Not paired.';
    case 'waiting':
      return role === 'host' ? 'Waiting for a phone to join…' : 'Joining room…';
    case 'paired':
      return role === 'host' ? 'Phone remote connected.' : 'Paired with the laptop.';
    case 'gone':
      return role === 'host' ? 'Phone left the room.' : 'Laptop left the room.';
  }
}
