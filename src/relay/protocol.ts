// Relay pairing protocol — pure helpers, no DOM and no Firebase. A laptop
// (host) opens a room named by a high-entropy capability token; a phone
// (guest) joins by hearing the laptop chime (last-resort: short code). Everything
// here is deterministic and unit-tested: token/code generation, join-URL
// build/parse, the message envelope, and the pairing state machine.

import type { ControlSnapshot } from './controlSnapshot';
import {
  validatePrivacyAsk,
  validatePrivacyReply,
  type PrivacyAsk,
  type PrivacyReply,
} from '../ai/privacyRouter';

export type { PrivacyAsk, PrivacyReply } from '../ai/privacyRouter';

/** Crockford base32: no I/L/O/U, so codes survive being read aloud or typed. */
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

/** Does this location want the /mobile phone companion (the pair /
 *  dashboard / split story)? Matches `/mobile` or `?view=mobile`; boot redirects
 *  it to the standalone /mobile.html entry. */
export function isMobileRoute(pathname: string, search: string): boolean {
  if (/^\/mobile\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('view') === 'mobile';
}

/** Does this location want the optional /control dashboard instead of the editor? */
export function isControlRoute(pathname: string, search: string): boolean {
  if (/^\/control\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('view') === 'control';
}

/** Does this location want the static /judges page (the guided-tour landing)? */
export function isJudgesRoute(pathname: string, search: string): boolean {
  if (/^\/judges\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('view') === 'judges';
}

/** Spotify OAuth callback: `/spotify` or `?view=spotify`. */
export function isSpotifyRoute(pathname: string, search: string): boolean {
  if (/^\/spotify\/?$/.test(pathname)) return true;
  return new URLSearchParams(search).get('view') === 'spotify';
}

/** The hands-free editor lives at /studio (and under judge sim/play query flags). */
export function isStudioRoute(pathname: string, search: string): boolean {
  if (/^\/studio\/?$/.test(pathname)) return true;
  const q = new URLSearchParams(search);
  if (q.get('view') === 'studio') return true;
  // Judge walks and sim mode still belong to the editor, even if the path is /.
  if (q.has('sim') || q.has('play') || q.has('mode')) return true;
  return false;
}

/** The marketing landing is only exact `/` (no other view/sim/play flags). */
export function isLandingRoute(pathname: string, search: string): boolean {
  if (!(pathname === '/' || pathname === '')) return false;
  if (isStudioRoute(pathname, search)) return false;
  if (isRemoteRoute(pathname, search)) return false;
  if (isPhoneRoute(pathname, search)) return false;
  if (isMobileRoute(pathname, search)) return false;
  if (isControlRoute(pathname, search)) return false;
  if (isJudgesRoute(pathname, search)) return false;
  if (isSpotifyRoute(pathname, search)) return false;
  return true;
}

// ---- message envelope -------------------------------------------------------

// 'control' is the optional read-only /control dashboard: it subscribes to a host's room and
// receives privacy-safe state snapshots. It never drives the editor, so it only
// ever sends presence (hello/bye) — never a command or a frame.
export type RelayRole = 'host' | 'phone' | 'control';

// 'transfer' and 'announce' are the cross-device pick-and-drop kinds. They
// PIGGYBACK on the existing `cmd` message (which firestore.rules only requires
// to be a map) and carry their JSON payload in `text` — so no new message
// `type` and no new top-level key is added, and no rules deploy is needed.
//   • 'transfer' — a committed tile move (phone→host, or host relaying one on):
//     text is a serialized TileTransfer (see canvas/tileTransfer.ts).
//   • 'announce' — a phone telling the hub who it is (deviceId/platform/side):
//     text is a small JSON object the hub coerces.
//   • 'aiEvent' — a phone's compact AI-activity line for the laptop's AI
//     monitor (engine/verb/short redacted text/state/the phone's own cloud
//     byte total). Display only: not model inference, never ledgered. Text is
//     a small JSON object coerced by canvas/phoneAiFeed.ts.
//   • 'whoIsThere' — host → phones: "announce yourselves again". Sent after a
//     phone drops (the relay can't say which one), so the phones still here
//     re-announce. No payload. Phones only honour it from the host.
//   • 'sensePoint' — host → phones: "take the point-to-connect photo with your
//     camera" (iPhone hand sensing). text: {"platform":"ios"}. Phones only
//     honour it from the host, and only for their own platform.
//   • 'pointResult' — phone → host: what that photo was identified as (or why
//     not). text: a small JSON object coerced by canvas/phonePoint.ts. The
//     photo itself never rides the relay.
//   • 'gimbalCue' — host → phones: "play this DockKit body-language move"
//     (nod yes on Approve, shake no on a refusal, wakeup on pairing). text is
//     exactly one of GIMBAL_CUES — never user content. Phones only honour it
//     from the host; the host rate-limits it (GIMBAL_CUE_MIN_GAP_MS).
//   • 'gimbalMode' — host → phones: "switch the docked stand to this mode"
//     (the laptop's gimbal tile: follow me / follow my hands / hold still).
//     text is exactly one of GIMBAL_MODES — never user content. The iPhone
//     runs it through the same handler as the spoken phrase and re-announces
//     what DockKit REALLY reports; the laptop never claims the switch itself.
//   • 'ping' — phone → host: "are you really there?". text: JSON {n, sid?} —
//     n is the phone's one-time nonce, sid the host session it believes it is
//     talking to. 'pong' — host → phone: JSON {n, sid} echoing the nonce with
//     the host's current session id. This round trip is the phone's only
//     proof that the laptop hears it ("Laptop ✓"); a hello or an old state
//     message in the room is not. Handled inside the sessions.
export type RelayCommandKind =
  | 'undo' | 'redo' | 'command' | 'nudge' | 'mic' | 'transfer' | 'announce' | 'aiEvent' | 'whoIsThere'
  | 'sensePoint' | 'pointResult' | 'gimbalCue' | 'gimbalMode' | 'ping' | 'pong';

/** The only DockKit animations the laptop may ask for (no user content). */
export type GimbalCueKind = 'yes' | 'no' | 'wakeup';
export const GIMBAL_CUES: readonly GimbalCueKind[] = ['yes', 'no', 'wakeup'];
/** At most one gimbal cue per this many ms (the sender's gate). */
export const GIMBAL_CUE_MIN_GAP_MS = 2000;
/** The receiver's gate: a little shorter, so relay jitter between two cues
 *  the sender spaced 2 s apart never drops a valid one. */
export const GIMBAL_CUE_RECEIVE_GAP_MS = 1500;
export function isGimbalCue(v: unknown): v is GimbalCueKind {
  return typeof v === 'string' && (GIMBAL_CUES as readonly string[]).includes(v);
}

/** The only gimbal modes the laptop may ask the docked iPhone for: the same
 *  words parseGimbalSpeech returns for "follow me" / "follow my hands" /
 *  "hold still". */
export type GimbalModeKind = 'face' | 'hands' | 'hold';
export const GIMBAL_MODES: readonly GimbalModeKind[] = ['face', 'hands', 'hold'];
export function isGimbalMode(v: unknown): v is GimbalModeKind {
  return typeof v === 'string' && (GIMBAL_MODES as readonly string[]).includes(v);
}

export interface CueLimiter {
  /** Would `kind` pass now? Doesn't stamp. */
  ready(kind?: GimbalCueKind): boolean;
  /** Record that `kind` was sent/played now. */
  mark(kind?: GimbalCueKind): void;
  /** ready + mark in one step: true = go, false = drop. */
  allow(kind?: GimbalCueKind): boolean;
}

/** A "<= 1 per minGapMs" gate. One exception: a 'no' right after a 'yes'
 *  (a refusal straight after an Approve) is let through once; the gap
 *  restarts from it. */
export function createCueLimiter(minGapMs = GIMBAL_CUE_MIN_GAP_MS, now: () => number = () => Date.now()): CueLimiter {
  let last = -Infinity;
  let lastKind: GimbalCueKind | null = null;
  const ready = (kind?: GimbalCueKind): boolean =>
    now() - last >= minGapMs || (kind === 'no' && lastKind === 'yes');
  const mark = (kind?: GimbalCueKind): void => { last = now(); lastKind = kind ?? null; };
  return {
    ready,
    mark,
    allow(kind) {
      if (!ready(kind)) return false;
      mark(kind);
      return true;
    },
  };
}

/** Gimbal modes: at most one per `minGapMs` (default 1 s), and the same mode
 *  again within `sameModeMs` (default 5 s) is a repeat, dropped. A different
 *  mode after the gap always passes; the same mode passes again once the
 *  window is over (the stand may have changed on its own meanwhile). */
export const GIMBAL_MODE_MIN_GAP_MS = 1000;
export const GIMBAL_MODE_REPEAT_MS = 5000;
export interface ModeLimiter {
  ready(mode: GimbalModeKind): boolean;
  mark(mode: GimbalModeKind): void;
  allow(mode: GimbalModeKind): boolean;
}
export function createModeLimiter(minGapMs = GIMBAL_MODE_MIN_GAP_MS, sameModeMs = GIMBAL_MODE_REPEAT_MS, now: () => number = () => Date.now()): ModeLimiter {
  let last = -Infinity;
  let lastMode: GimbalModeKind | null = null;
  const ready = (mode: GimbalModeKind): boolean => {
    const gap = now() - last;
    if (gap < minGapMs) return false;
    return !(mode === lastMode && gap < sameModeMs);
  };
  const mark = (mode: GimbalModeKind): void => { last = now(); lastMode = mode; };
  return { ready, mark, allow(mode) { if (!ready(mode)) return false; mark(mode); return true; } };
}

export interface RelayCommand {
  kind: RelayCommandKind;
  /** For 'command': the typed utterance to run. For 'transfer'/'announce': the
   *  size-capped JSON payload (parsed by the canvas, never run as an utterance). */
  text?: string;
  /** For kind 'nudge': unit direction, each of dx/dy in {-1, 0, 1}. */
  dx?: number;
  dy?: number;
}

/** Max length of a 'command' utterance. */
export const CMD_TEXT_MAX = 500;
/** Max length of a 'transfer'/'announce' JSON blob carried in `cmd.text`. Well
 *  under the room-message document limit; a tile spec is far smaller. */
export const CMD_JSON_MAX = 16_000;
/** Max length of a 'ping'/'pong' JSON blob ({n, sid}). */
export const PING_JSON_MAX = 160;
/** A host session id / ping nonce: short, opaque, no user content. */
export function isSessionId(x: unknown): x is string {
  return typeof x === 'string' && /^[A-Za-z0-9_-]{4,40}$/.test(x);
}
/** Parse a ping/pong payload; null when malformed. */
export function parsePing(text: unknown): { n: string; sid: string | null } | null {
  if (typeof text !== 'string' || text.length > PING_JSON_MAX) return null;
  try {
    const o = JSON.parse(text) as { n?: unknown; sid?: unknown };
    if (!o || typeof o !== 'object' || !isSessionId(o.n)) return null;
    return { n: o.n, sid: isSessionId(o.sid) ? o.sid : null };
  } catch { return null; }
}
/** Max length of an 'aiEvent' JSON blob — one short activity line. */
export const AI_EVENT_JSON_MAX = 600;

/** The phone's in-app music player state, relayed to the host so it can appear
 *  on the /control dashboard. Carries only title/playing/volume — no audio. */
export interface MusicStatus {
  title: string;
  playing: boolean;
  /** 0..1 */
  volume: number;
}

/** The recipe devices a run request can be addressed to. Kept inline (not
 *  imported from recipes) so the protocol stays DOM/feature-free. */
export const RUN_DEVICES: readonly string[] = ['designer', 'browser', 'lamp', 'music', 'android', 'iphone'];

/** "Run this saved recipe" — sent from the optional /control dashboard (or a phone)
 *  into the room; the device that owns the recipe executes it. */
export interface RelayRunRequest {
  runId: string;
  recipeId: string;
  /** Which device owns / should run it. */
  device: string;
  /** Who tapped Run (display only). */
  by?: string;
}

export type RunStatusKind = 'queued' | 'running' | 'awaiting-confirm' | 'done' | 'error' | 'rejected';

/** Live status of a run, published by the executing device back to the room. */
export interface RelayRunStatus {
  runId: string;
  recipeId: string;
  status: RunStatusKind;
  /** 1-based current step and total, when known. */
  step?: number;
  total?: number;
  detail?: string;
}

/** Confirm / cancel a run that stopped on a send/submit-style step. Sent back to
 *  the executing device from whoever is allowed to approve (control or host). */
export interface RelayRunControl {
  runId: string;
  decision: 'confirm' | 'cancel';
  /** The step index being approved (defensive; the device re-checks). */
  step?: number;
}

export type RelayMessage =
  | { v: 1; from: RelayRole; type: 'hello' }
  | { v: 1; from: RelayRole; type: 'bye' }
  | { v: 1; from: RelayRole; type: 'cmd'; cmd: RelayCommand }
  /** Run a saved recipe on its owning device. */
  | { v: 1; from: RelayRole; type: 'run'; run: RelayRunRequest }
  /** Live run status back to the room. */
  | { v: 1; from: RelayRole; type: 'runStatus'; runStatus: RelayRunStatus }
  /** Approve / reject a confirm-gated step. */
  | { v: 1; from: RelayRole; type: 'runControl'; runControl: RelayRunControl }
  /** A low-rate JPEG still from the phone camera — goes ONLY to the paired
   *  laptop via the room, never to Firebase AI, and is never ledgered. */
  | { v: 1; from: RelayRole; type: 'frame'; mimeType: string; dataBase64: string }
  /** The phone's music-player state (title/playing/volume) — relayed to the host
   *  so the /control dashboard can show it. No audio ever leaves the phone. */
  | { v: 1; from: 'phone'; type: 'music'; music: MusicStatus }
  /** The laptop's privacy-safe state for the optional /control dashboard. Only a
   *  host sends it; the snapshot carries NO camera/landmark/audio (see
   *  controlSnapshot.ts). Validated loosely here and re-coerced on receipt. */
  | { v: 1; from: 'host'; type: 'state'; snapshot: ControlSnapshot }
  /** Phone → desktop hub: raw prompt for Nano+rules redaction. Not sent to Gemini. */
  | { v: 1; from: 'phone'; type: 'privacyAsk'; ask: PrivacyAsk }
  /** Hub → phone: names filled back, plus the route line and Gemini byte count. */
  | { v: 1; from: 'host'; type: 'privacyReply'; reply: PrivacyReply };

const COMMAND_KINDS: readonly string[] = ['undo', 'redo', 'command', 'nudge', 'mic', 'transfer', 'announce', 'aiEvent', 'whoIsThere', 'sensePoint', 'pointResult', 'gimbalCue', 'gimbalMode', 'ping', 'pong'];
/** Kinds whose `text` is a JSON payload (parsed by the canvas), not an utterance. */
const JSON_KINDS: readonly string[] = ['transfer', 'announce', 'aiEvent', 'sensePoint', 'pointResult', 'ping', 'pong'];

function isUnit(n: unknown): boolean {
  return n === undefined || n === -1 || n === 0 || n === 1;
}

/** Validate a command payload from the wire; null when malformed. */
export function validateCommand(raw: unknown): RelayCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.kind !== 'string' || !COMMAND_KINDS.includes(c.kind)) return null;
  if (c.kind === 'command' && (typeof c.text !== 'string' || !c.text.trim() || c.text.length > CMD_TEXT_MAX)) return null;
  // 'transfer'/'announce' require a non-empty, size-capped JSON blob in `text`.
  if (JSON_KINDS.includes(c.kind) && (typeof c.text !== 'string' || !c.text || c.text.length > CMD_JSON_MAX)) return null;
  if (c.kind === 'aiEvent' && (c.text as string).length > AI_EVENT_JSON_MAX) return null;
  if ((c.kind === 'ping' || c.kind === 'pong') && (c.text as string).length > PING_JSON_MAX) return null;
  // 'whoIsThere' may carry the host's session id, nothing else.
  if (c.kind === 'whoIsThere' && c.text !== undefined && !isSessionId(c.text)) return null;
  // 'gimbalCue' carries one allow-listed word and nothing else.
  if (c.kind === 'gimbalCue') return isGimbalCue(c.text) ? { kind: 'gimbalCue', text: c.text } : null;
  if (c.kind === 'gimbalMode') return isGimbalMode(c.text) ? { kind: 'gimbalMode', text: c.text } : null;
  if (c.kind === 'nudge' && !(isUnit(c.dx) && isUnit(c.dy) && (c.dx || c.dy))) return null;
  const out: RelayCommand = { kind: c.kind as RelayCommandKind };
  if (typeof c.text === 'string') out.text = c.text;
  if (typeof c.dx === 'number') out.dx = c.dx;
  if (typeof c.dy === 'number') out.dy = c.dy;
  return out;
}

const RUN_STATUS_KINDS: readonly string[] = ['queued', 'running', 'awaiting-confirm', 'done', 'error', 'rejected'];

const idLike = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 64;

const maybeStep = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1000 ? v : undefined;

/** Validate a recipe-run request from the wire; null when malformed. */
export function validateRunRequest(raw: unknown): RelayRunRequest | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!idLike(r.runId) || !idLike(r.recipeId)) return null;
  if (typeof r.device !== 'string' || !RUN_DEVICES.includes(r.device)) return null;
  const out: RelayRunRequest = { runId: r.runId, recipeId: r.recipeId, device: r.device };
  if (typeof r.by === 'string' && r.by.length <= 60) out.by = r.by;
  return out;
}

/** Validate a run-status payload from the wire; null when malformed. */
export function validateRunStatus(raw: unknown): RelayRunStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  if (!idLike(s.runId) || !idLike(s.recipeId)) return null;
  if (typeof s.status !== 'string' || !RUN_STATUS_KINDS.includes(s.status)) return null;
  const out: RelayRunStatus = { runId: s.runId, recipeId: s.recipeId, status: s.status as RunStatusKind };
  const step = maybeStep(s.step);
  const total = maybeStep(s.total);
  if (step !== undefined) out.step = step;
  if (total !== undefined) out.total = total;
  if (typeof s.detail === 'string' && s.detail.length <= 200) out.detail = s.detail;
  return out;
}

/** Validate a run-control (confirm/cancel) payload from the wire; null when malformed. */
export function validateRunControl(raw: unknown): RelayRunControl | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const c = raw as Record<string, unknown>;
  if (!idLike(c.runId)) return null;
  if (c.decision !== 'confirm' && c.decision !== 'cancel') return null;
  const out: RelayRunControl = { runId: c.runId, decision: c.decision };
  const step = maybeStep(c.step);
  if (step !== undefined) out.step = step;
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
      // dashboard via coerceSnapshot before anything is rendered. The cast
      // below is UNCHECKED wire data — every consumer of this message's
      // `snapshot` MUST call coerceSnapshot() on it before reading any field.
      if (from !== 'host') return null;
      if (typeof m.snapshot !== 'object' || m.snapshot === null) return null;
      if ((m.snapshot as { v?: unknown }).v !== 1) return null;
      return { v: 1, from: 'host', type: 'state', snapshot: m.snapshot as ControlSnapshot };
    case 'cmd': {
      const cmd = validateCommand(m.cmd);
      return cmd ? { v: 1, from, type: 'cmd', cmd } : null;
    }
    case 'run': {
      const run = validateRunRequest(m.run);
      return run ? { v: 1, from, type: 'run', run } : null;
    }
    case 'runStatus': {
      const runStatus = validateRunStatus(m.runStatus);
      return runStatus ? { v: 1, from, type: 'runStatus', runStatus } : null;
    }
    case 'runControl': {
      const runControl = validateRunControl(m.runControl);
      return runControl ? { v: 1, from, type: 'runControl', runControl } : null;
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
    case 'privacyAsk': {
      if (from !== 'phone') return null;
      const ask = validatePrivacyAsk(m.ask);
      return ask ? { v: 1, from: 'phone', type: 'privacyAsk', ask } : null;
    }
    case 'privacyReply': {
      if (from !== 'host') return null;
      const reply = validatePrivacyReply(m.reply);
      return reply ? { v: 1, from: 'host', type: 'privacyReply', reply } : null;
    }
    default:
      return null;
  }
}

// ---- room-write rules mirror -------------------------------------------------

/** Keep in lockstep with `isValidMessage` in firestore.rules — this is a pure
 *  TS mirror of the same shape/size check, so client payloads can be tested
 *  against it without a Firestore emulator.
 *
 *  NOTE (transfer/announce): the cross-device pick-and-drop kinds add NO new
 *  message `type` and NO new top-level key — they are ordinary `cmd` messages
 *  whose `cmd` map carries the payload in `text`. The rules only require `cmd`
 *  to be a map (checked by isMapField below) and `type` to be `cmd`, so these
 *  kinds already fit without any firestore.rules change / deploy. */
const ROOM_MESSAGE_KEYS: readonly string[] = [
  'v', 'from', 'type', 'at',
  'cmd', 'run', 'runStatus', 'runControl',
  'mimeType', 'dataBase64', 'music', 'snapshot', 'ask', 'reply',
];
const ROOM_MESSAGE_TYPES: readonly string[] = [
  'hello', 'bye', 'cmd', 'run', 'runStatus', 'runControl',
  'frame', 'music', 'state', 'privacyAsk', 'privacyReply',
];
/** ~150KB of raw JPEG once decoded — well above the 320px-wide, quality-0.5
 *  stills remotePage.ts actually sends. */
export const ROOM_MESSAGE_DATA_BASE64_MAX = 200_000;
const ROOM_MESSAGE_MIME_TYPE_MAX = 40;

function isSizedString(data: Record<string, unknown>, key: string, maxSize: number): boolean {
  if (!(key in data)) return true;
  const v = data[key];
  return typeof v === 'string' && v.length <= maxSize;
}
function isMapField(data: Record<string, unknown>, key: string): boolean {
  if (!(key in data)) return true;
  const v = data[key];
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** True when a room-message write would pass firestore.rules' `isValidMessage`
 *  (shape allowlist + size caps). Ignores the `at` server-timestamp sentinel's
 *  exact value since that only resolves on the server. */
export function fitsRoomMessageRules(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const data = raw as Record<string, unknown>;
  return (
    Object.keys(data).every((k) => ROOM_MESSAGE_KEYS.includes(k)) &&
    data.v === 1 &&
    (data.from === 'host' || data.from === 'phone' || data.from === 'control') &&
    typeof data.type === 'string' && ROOM_MESSAGE_TYPES.includes(data.type) &&
    isSizedString(data, 'mimeType', ROOM_MESSAGE_MIME_TYPE_MAX) &&
    isSizedString(data, 'dataBase64', ROOM_MESSAGE_DATA_BASE64_MAX) &&
    isMapField(data, 'cmd') &&
    isMapField(data, 'run') &&
    isMapField(data, 'runStatus') &&
    isMapField(data, 'runControl') &&
    isMapField(data, 'music') &&
    isMapField(data, 'snapshot') &&
    isMapField(data, 'ask') &&
    isMapField(data, 'reply')
  );
}

// ---- pairing state machine --------------------------------------------------

export type PairState = 'idle' | 'waiting' | 'paired' | 'gone' | 'disconnected';
export type PairEvent = 'create' | 'peer-hello' | 'peer-bye' | 'close' | 'listen-error';

/** Advance the pairing state; unknown transitions keep the current state. */
export function advancePair(state: PairState, event: PairEvent): PairState {
  if (event === 'close') return 'idle';
  // A dropped/denied listener (rules change, transport failure) can hit from
  // any state except idle — surface it explicitly instead of freezing on the
  // last-known state, which looks connected when it is not.
  if (event === 'listen-error') return state === 'idle' ? state : 'disconnected';
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
    case 'disconnected':
      // The listener can resubscribe and see the peer again.
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
    case 'disconnected':
      return 'Connection lost — check your network.';
  }
}
