// Pure builders for the CONNECT AI turns, reusing aiTurn's SurfaceRequest / SentInfo shape.
// (a) pointConnect(deviceGuess) -> scripted Gemini JSON proposing ONE tile, receipt "1 photo of what you pointed at, your words"
// (b) roomScan(found[]) -> scripted JSON proposing one tile per device, receipt "5 photos of the room"
// (c) byName(utterance) -> uses identify.ts identityFromWords/deviceNameIn to propose the tile, Nano-only (receipt null)
// Plus mergeTiles(plan, newTiles) that adds tiles to an existing room SurfacePlan without duplicates and within MAX_TILES.

import {
  MAX_TILES,
  tileComponentId,
  type SurfacePlan,
  type TileSpec,
} from './surfacePlan';
import {
  scriptedEngine,
  type DeviceHint,
  type SentInfo,
  type SurfaceEngine,
  type SurfaceRequest,
} from './aiTurn';
import { deviceNameIn, identityFromWords, isAddDevicePhrase, type DeviceIdentity } from '../devices/identify';
import type { FoundDevice } from '../devices/addDeviceFlow';

export type DeviceGuess =
  | string
  | { kind?: string; label?: string; id?: string; brand?: string };

export type FoundDeviceItem =
  | string
  | DeviceHint
  | FoundDevice
  | { id?: string; label?: string; name?: string; kind?: string; host?: string };

export interface ConnectTurnResult {
  sent: SentInfo;
  json: string;
  plan: SurfacePlan;
  request: SurfaceRequest;
  engine: SurfaceEngine;
}

function toValidId(raw: string, fallback: string): string {
  const clean = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(clean) ? clean : fallback;
}

export type DeviceTileSpec =
  | { type: 'lamp'; deviceId: string; label: string }
  | { type: 'music'; deviceId: string; label: string }
  | { type: 'switch'; deviceId: string; label: string };

export function mapKindToTile(kind: string, label: string, explicitId?: string): DeviceTileSpec {
  const k = kind.toLowerCase();
  const baseLabel = label.trim() || 'Device';
  if (k === 'speaker' || k === 'music') {
    return {
      type: 'music',
      deviceId: toValidId(explicitId ?? baseLabel, 'speaker-1'),
      label: baseLabel,
    };
  }
  if (k === 'plug' || k === 'switch' || k === 'fan' || k === 'tv' || k === 'ac') {
    return {
      type: 'switch',
      deviceId: toValidId(explicitId ?? baseLabel, 'switch-1'),
      label: baseLabel,
    };
  }
  return {
    type: 'lamp',
    deviceId: toValidId(explicitId ?? baseLabel, 'lamp-1'),
    label: baseLabel,
  };
}

export function pointConnect(
  deviceGuess?: DeviceGuess,
  opts: { frameTitle?: string; sim?: boolean } = {},
): ConnectTurnResult {
  let kind = 'lamp';
  let label = 'Lamp';
  let id: string | undefined;

  if (typeof deviceGuess === 'string') {
    const raw = deviceGuess.trim().toLowerCase();
    if (raw === 'speaker' || raw === 'music') {
      kind = 'speaker';
      label = 'Speaker';
      id = 'speaker-1';
    } else {
      kind = 'lamp';
      label = deviceGuess.trim() || 'Lamp';
      id = toValidId(label, 'lamp-1');
    }
  } else if (deviceGuess && typeof deviceGuess === 'object') {
    kind = deviceGuess.kind ?? 'lamp';
    label = deviceGuess.label ?? (kind === 'speaker' ? 'Speaker' : 'Lamp');
    id = deviceGuess.id ? toValidId(deviceGuess.id, 'device-1') : undefined;
  }

  const tile = mapKindToTile(kind, label, id);
  const title = opts.frameTitle ?? 'This room';
  const plan: SurfacePlan = {
    kind: 'room',
    title,
    tiles: [tile],
  };
  const json = JSON.stringify(plan, null, 2);

  const sentReceipt = '1 photo of what you pointed at, your words';
  const sim = opts.sim ?? true;
  const routeLine = sim
    ? `SIM · Gemini · cloud — ${sentReceipt}`
    : `Gemini · cloud — ${sentReceipt}`;

  const sent: SentInfo = {
    engine: 'gemini',
    prompt: `You build one board on a smart canvas. Propose 1 tile to add for the device you see pointed at: ${tile.label} (${tile.type}).`,
    sent: sentReceipt,
    routeLine,
    sim,
  };

  const request: SurfaceRequest = {
    utterance: 'connect what I am pointing at',
    frameTitle: title,
    devices: [{ id: tile.deviceId, label: tile.label, kind: tile.type }],
  };

  return {
    sent,
    json,
    plan,
    request,
    engine: scriptedEngine('gemini', json),
  };
}

// ---- point-to-connect from a REAL identification ---------------------------

/** What identifyDevice (Nano first, Gemini cloud second) said about the crop. */
export interface PointIdentifyResult {
  identity: DeviceIdentity;
  /** Where it really ran: 'on-device' (Nano) or 'cloud' (Gemini). */
  source: string;
  ms?: number;
}

export type PointOutcome =
  | { ok: true; turn: ConnectTurnResult; identity: DeviceIdentity; /** Photo bytes that left (0 on device). */ extraBytes: number; /** Honest status to say (speaker: Spotify Connect). */ note?: string }
  | { ok: false; message: string; /** Several connected devices fit: ask which one. */ choices?: DeviceHint[] };

export const POINT_UNSURE_MESSAGE = 'I couldn’t tell what you’re pointing at — try naming it.';
export const POINT_MIN_CONFIDENCE = 0.5;

/** ?sim=1: the scripted identity — a WiZ lamp, never a speaker. */
export const SIM_POINT_IDENTITY: DeviceIdentity = {
  kind: 'smart-bulb', brand: 'WiZ', model: '', label: 'WiZ desk lamp', confidence: 0.92,
};

export function fmtBytes(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;
}

const isWizText = (s: string | undefined): boolean => /\bwiz\b|^wiz-/i.test(s ?? '');
const isWizIdentity = (id: DeviceIdentity): boolean => isWizText(id.brand) || isWizText(id.label);
const isWizDevice = (d: DeviceHint): boolean => isWizText(d.id) || isWizText(d.label);

/** Identity → the tile kind mapKindToTile understands, or null when it isn't
 *  something a tile can control. No default: an unknown is never a speaker. */
function pointKind(id: DeviceIdentity): string | null {
  const k = id.kind.toLowerCase();
  if (isWizIdentity(id)) return 'lamp';
  if (k === 'smart-bulb' || k === 'lamp' || k === 'bulb') return 'lamp';
  if (k === 'speaker') return 'speaker';
  if (k === 'plug' || k === 'fan' || k === 'tv' || k === 'ac') return k;
  return null;
}

const KIND_WORDS: Record<string, string> = { 'smart-bulb': 'smart bulb', tv: 'TV', ac: 'AC' };
const kindWord = (id: DeviceIdentity): string => KIND_WORDS[id.kind] ?? (isWizIdentity(id) ? 'WiZ light' : id.kind);
const article = (w: string): string => (/^[aeiou]/i.test(w) && !/^u[a-z]/.test(w) ? 'an' : 'a');

/** A speaker tile is software: the Spotify-aware connector finds the Connect
 *  device (e.g. /marshall/i) at play time, so pointing at one proposes the
 *  tile even with no hardware device registered. Never claims a hardware link. */
export const SPEAKER_ADDED_NOTE = 'Speaker added — it will play through Spotify Connect if your Marshall is awake in Spotify.';
export const SPEAKER_ADDED_GENERIC_NOTE = 'Speaker added — it will play through Spotify Connect if that speaker is awake in Spotify.';
export const SPEAKER_ON_BOARD = 'The speaker is already on this board.';
const isMarshall = (id: Pick<DeviceIdentity, 'brand' | 'label'>): boolean => /marshall/i.test(`${id.brand ?? ''} ${id.label ?? ''}`);
const LAMP_OR_SPEAKER: DeviceHint[] = [
  { id: 'kind:lamp', label: 'lamp', kind: 'lamp' },
  { id: 'kind:speaker', label: 'speaker', kind: 'speaker' },
];
export const LAMP_OR_SPEAKER_QUESTION = 'Which one — the lamp or the speaker?';

export const notConnectedMessage = (id: DeviceIdentity): string => {
  const w = kindWord(id);
  return `I see ${article(w)} ${w}, but it isn’t connected here yet — try adding it as a device.`;
};

const GENERIC_WORDS = new Set(['the', 'lamp', 'light', 'bulb', 'speaker', 'device', 'smart', 'wiz', 'plug', 'fan', 'one']);
const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w));

/** Her reply to "desk lamp or ceiling light?": the full label, else a
 *  distinctive word ("desk") that names exactly one choice. */
export function pickPointChoice(text: string, choices: readonly DeviceHint[]): DeviceHint | null {
  const said = text.toLowerCase();
  const full = choices.filter((c) => c.label && said.includes(c.label.toLowerCase()));
  if (full.length === 1) return full[0];
  const heard = new Set(words(text));
  const hit = choices.filter((c) => words(c.label).some((w) => heard.has(w)));
  return hit.length === 1 ? hit[0] : null;
}

export const pointChoiceQuestion = (choices: readonly DeviceHint[]): string => {
  const names = choices.map((c) => c.label);
  const list = names.length <= 2 ? names.join(' or ') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
  return `Which one — ${list}?`;
};

/** Turn a pointed-at identification into ONE proposed tile bound to a device
 *  that is really connected here, labelled with where the identify ran.
 *  - null / low confidence / unknown kind → unsure message, no proposal.
 *  - no connected device of that kind (a WiZ device only for a WiZ identity
 *    or a label match) → "isn't connected here yet", no proposal.
 *  - several fit → `choices` to ask about (pass `chosenId` with the answer).
 *  Bytes: the crop counts once per cloud send (`cloudSends`). */
export function pointConnectFromIdentity(
  result: PointIdentifyResult | null,
  opts: {
    frameTitle?: string; sim?: boolean; cropBytes?: number; devices?: DeviceHint[]; onBoard?: string[]; prompt?: string;
    cloudSends?: number; chosenId?: string;
    /** The photo was taken and identified on the paired iPhone: nothing left this device. */
    viaIphone?: boolean;
    /** Real lamps reachable right now: a "smart bulb" (no brand seen) may be
     *  one of them, so they are offered for it like a WiZ identity would be. */
    realLamps?: string[];
  } = {},
): PointOutcome {
  if (!result || !(result.identity.confidence >= POINT_MIN_CONFIDENCE)) return { ok: false, message: POINT_UNSURE_MESSAGE };
  let identity = result.identity;
  // Lamp and speaker both near the finger: ask, then rebuild from her answer.
  const alsoKind = identity.alsoKind ? pointKind({ ...identity, kind: identity.alsoKind, brand: identity.alsoBrand ?? '', label: '' }) : null;
  const firstKind = pointKind(identity);
  if (opts.chosenId?.startsWith('kind:')) {
    const k = opts.chosenId.slice(5);
    const brand = k === firstKind ? identity.brand : (identity.alsoBrand ?? '');
    const label = k === 'speaker' ? (isMarshall({ brand, label: '' }) || (k === firstKind && isMarshall(identity)) ? 'Marshall speaker' : 'Speaker') : k === firstKind ? identity.label : 'Lamp';
    identity = { ...identity, kind: k, brand, label, alsoKind: undefined, alsoBrand: undefined };
    return pointConnectFromIdentity({ ...result, identity }, { ...opts, chosenId: undefined });
  }
  if (alsoKind && firstKind && alsoKind !== firstKind && [alsoKind, firstKind].includes('lamp') && [alsoKind, firstKind].includes('speaker')) {
    return { ok: false, message: LAMP_OR_SPEAKER_QUESTION, choices: LAMP_OR_SPEAKER };
  }
  const kind = firstKind;
  if (!kind) return { ok: false, message: POINT_UNSURE_MESSAGE };

  const want = mapKindToTile(kind, identity.label).type;
  const idWords = new Set(words(identity.label));
  const labelMatch = (d: DeviceHint) => words(d.label).some((w) => idWords.has(w));
  const eligible = (opts.devices ?? []).filter((d) =>
    mapKindToTile(d.kind, d.label, d.id).type === want && (!isWizDevice(d) || isWizIdentity(identity) || labelMatch(d)
      || (identity.kind === 'smart-bulb' && !!opts.realLamps?.includes(d.id))));
  let known: DeviceHint | undefined;
  if (opts.chosenId) known = eligible.find((d) => d.id === opts.chosenId);
  if (!known) {
    const named = eligible.filter(labelMatch);
    const onBoard = new Set(opts.onBoard ?? []);
    const offBoard = eligible.filter((d) => !onBoard.has(d.id));
    const pool = named.length ? named : offBoard.length ? offBoard : eligible;
    if (pool.length === 0 && kind === 'speaker') {
      // Software tile: no hardware binding is claimed.
      if ((opts.onBoard ?? []).some((d) => /^speaker/i.test(d))) return { ok: false, message: SPEAKER_ON_BOARD };
      const marshall = isMarshall(identity);
      known = { id: marshall ? 'speaker-marshall' : 'speaker-1', label: marshall ? 'Marshall speaker' : 'Speaker', kind: 'speaker' };
    } else if (pool.length === 0) return { ok: false, message: notConnectedMessage(identity) };
    else if (pool.length > 1) return { ok: false, message: pointChoiceQuestion(pool), choices: pool };
    else known = pool[0];
  }
  if (!known) return { ok: false, message: POINT_UNSURE_MESSAGE };
  const software = kind === 'speaker' && !(opts.devices ?? []).some((d) => d.id === known!.id);
  const tile = mapKindToTile(known.kind, known.label, known.id);

  const title = opts.frameTitle ?? 'This room';
  const plan: SurfacePlan = { kind: 'room', title, tiles: [tile] };
  const json = JSON.stringify(plan, null, 2);

  const sim = !!opts.sim;
  const cloud = result.source === 'cloud';
  const sends = Math.max(cloud ? 1 : 0, Math.round(opts.cloudSends ?? 0));
  const crop = Math.max(0, Math.round(opts.cropBytes ?? 0));
  const bytes = crop * sends;
  const what = sends > 1 ? `the photo crop of what you pointed at, sent ${sends}× (${fmtBytes(bytes)})` : `1 photo crop of what you pointed at (${fmtBytes(bytes)})`;
  const sentReceipt = cloud && !opts.viaIphone ? `${what}, sent for this answer only; Mendcraft keeps no copy` : null;
  const line = opts.viaIphone
    ? `iPhone camera — identified ${cloud ? 'via Gemini · cloud from the iPhone' : 'on the iPhone'}; nothing left this laptop`
    : cloud
      ? `Gemini · cloud — ${sentReceipt}`
      : 'Nano · on device — the photo never left this device';
  const sent: SentInfo = {
    // Identified on the iPhone: nothing ran or left on THIS device, so no
    // Gemini lane here — the neutral this-device side, with the iPhone route.
    engine: cloud && !opts.viaIphone ? 'gemini' : 'nano',
    prompt: opts.prompt ?? `Name the device in this photo crop of what she is pointing at.`,
    sent: sentReceipt,
    routeLine: sim ? `SIM · ${line}` : line,
    sim,
  };
  const request: SurfaceRequest = {
    utterance: 'connect what I am pointing at',
    frameTitle: title,
    devices: [{ id: tile.deviceId, label: tile.label, kind: tile.type }],
  };
  return {
    ok: true,
    identity,
    extraBytes: cloud && !opts.viaIphone ? bytes : 0,
    turn: { sent, json, plan, request, engine: scriptedEngine(sent.engine, json) },
    ...(software ? { note: /marshall/i.test(tile.label) ? SPEAKER_ADDED_NOTE : SPEAKER_ADDED_GENERIC_NOTE } : {}),
  };
}

/** Ledger receipt for a point that produced no proposal. `sent` only when a
 *  cloud model actually answered; a send with no answer "may have reached"
 *  Gemini; no sends → nothing left. Bytes = crop × sends either way. */
export function pointFailureReceipt(o: { cropBytes: number; cloudSends: number; cloudAnswered?: boolean }): { bytes: number; line: string } {
  const sends = Math.max(0, Math.round(o.cloudSends));
  const bytes = Math.max(0, Math.round(o.cropBytes)) * sends;
  if (!sends || !bytes) return { bytes: 0, line: 'Nano · on device — nothing left this device' };
  const times = sends > 1 ? `, ${sends}×` : '';
  return o.cloudAnswered
    ? { bytes, line: `Gemini · cloud — photo crop (${fmtBytes(bytes)}${times}) sent for this answer only; Mendcraft keeps no copy` }
    : { bytes, line: `Gemini · cloud — photo crop (${fmtBytes(bytes)}${times}) may have reached Gemini — no answer came back` };
}

/** Scripted 5-photo scan result: a lamp and a speaker. Used in SIM, and as the
 *  fallback when no photo identifications have come back yet. */
export const SIM_SCAN_DEVICES: FoundDeviceItem[] = [
  { id: 'lamp-1', label: 'Lamp', kind: 'lamp' },
  { id: 'speaker-1', label: 'Speaker', kind: 'speaker' },
];

/** Devices to propose after a room scan. Live passes Gemini/Nano photo IDs in
 *  `found`; with none it returns none. Only SIM falls back to the scripted
 *  lamp + speaker (and roomScan labels those SIM) — never a live run. */
export function foundAfterScan(
  found: FoundDeviceItem[] | undefined,
  opts: { sim?: boolean } = {},
): FoundDeviceItem[] {
  if (found && found.length) return found;
  return opts.sim ? SIM_SCAN_DEVICES : [];
}

export function roomScan(
  found: FoundDeviceItem[] = [],
  opts: { frameTitle?: string; sim?: boolean } = {},
): ConnectTurnResult {
  const title = opts.frameTitle ?? 'This room';
  const tiles: DeviceTileSpec[] = [];
  const seenIds = new Set<string>();

  const items = foundAfterScan(found, { sim: opts.sim ?? true });

  for (let i = 0; i < items.length && tiles.length < MAX_TILES; i++) {
    const item = items[i];
    let kind = 'lamp';
    let label = `Device ${i + 1}`;
    let rawId: string | undefined;

    if (typeof item === 'string') {
      label = item;
      kind = item.toLowerCase().includes('speaker') ? 'speaker' : 'lamp';
    } else if (item && typeof item === 'object') {
      const obj = item as Record<string, unknown>;
      kind = typeof obj.kind === 'string' ? obj.kind : 'lamp';
      label =
        typeof obj.label === 'string'
          ? obj.label
          : typeof obj.name === 'string'
          ? obj.name
          : `Device ${i + 1}`;
      rawId = typeof obj.id === 'string' ? obj.id : typeof obj.host === 'string' ? obj.host : undefined;
    }

    const tile = mapKindToTile(kind, label, rawId ? toValidId(rawId, `device-${i + 1}`) : undefined);
    const did = tile.deviceId;
    if (seenIds.has(did)) {
      tile.deviceId = `${did}-${i + 1}`;
    }
    seenIds.add(tile.deviceId);
    tiles.push(tile);
  }

  const plan: SurfacePlan = {
    kind: 'room',
    title,
    tiles,
  };
  const json = JSON.stringify(plan, null, 2);

  const sentReceipt = '5 photos of the room';
  const sim = opts.sim ?? true;
  const routeLine = sim
    ? `SIM · Gemini · cloud — ${sentReceipt}`
    : `Gemini · cloud — ${sentReceipt}`;

  const sent: SentInfo = {
    engine: 'gemini',
    prompt: `You build one board on a smart canvas. Propose tiles for devices scanned across 5 camera frames: ${tiles.map((t) => t.label).join(', ')}.`,
    sent: sentReceipt,
    routeLine,
    sim,
  };

  const request: SurfaceRequest = {
    utterance: 'scan the room',
    frameTitle: title,
    devices: tiles.map((t) => ({ id: t.deviceId, label: t.label, kind: t.type })),
  };

  return {
    sent,
    json,
    plan,
    request,
    engine: scriptedEngine('gemini', json),
  };
}

export function byName(
  utterance: string,
  opts: { frameTitle?: string; sim?: boolean; devices?: DeviceHint[] } = {},
): ConnectTurnResult | null {
  const idFromWords = identityFromWords(utterance);
  const nameInWords = deviceNameIn(utterance);

  if (!idFromWords && !nameInWords) {
    return null;
  }

  const kind = idFromWords?.kind ?? nameInWords!.kind;
  const label = idFromWords?.label ?? (nameInWords!.name.charAt(0).toUpperCase() + nameInWords!.name.slice(1));

  // A known device whose label she named wins over minting a new id, so
  // "connect the speaker" lands on the real speaker-1 instead of a dead tile.
  const said = utterance.toLowerCase();
  const known = opts.devices?.find((d) => d.label && said.includes(d.label.toLowerCase()));
  const tile = known ? mapKindToTile(known.kind, known.label, known.id) : mapKindToTile(kind, label);
  const title = opts.frameTitle ?? 'This room';
  const plan: SurfacePlan = {
    kind: 'room',
    title,
    tiles: [tile],
  };
  const json = JSON.stringify(plan, null, 2);

  const sim = opts.sim ?? false;
  const routeLine = sim
    ? 'SIM · Nano · on device — nothing left this device'
    : 'Nano · on device — nothing left this device';

  const sent: SentInfo = {
    engine: 'nano',
    prompt: `You build one board on a smart canvas. Propose 1 tile for: "${utterance}".`,
    sent: null,
    routeLine,
    sim,
  };

  const request: SurfaceRequest = {
    utterance,
    frameTitle: title,
    devices: [{ id: tile.deviceId, label: tile.label, kind: tile.type }],
  };

  return {
    sent,
    json,
    plan,
    request,
    engine: scriptedEngine('nano', json),
  };
}

/** Route a spoken connect ask: a generic "connect a device" opens the sheet,
 *  a named "connect the speaker" becomes a by-name Nano turn, anything else
 *  (room-connect, device commands) is not ours. */
export function connectAsk(text: string): 'sheet' | 'byName' | null {
  if (!isAddDevicePhrase(text)) return null;
  return deviceNameIn(text) ? 'byName' : 'sheet';
}

export function mergeTiles(plan: SurfacePlan, newTiles: TileSpec[]): SurfacePlan {
  const existing = [...plan.tiles];
  const seen = new Set<string>();

  for (const t of existing) {
    seen.add(tileComponentId(t));
    if ('deviceId' in t && t.deviceId) {
      seen.add(`dev:${t.deviceId}`);
    }
  }

  const merged = [...existing];
  for (const t of newTiles) {
    if (merged.length >= MAX_TILES) break;
    const cid = tileComponentId(t);
    const did = 'deviceId' in t && t.deviceId ? `dev:${t.deviceId}` : null;
    if (seen.has(cid) || (did && seen.has(did))) continue;

    seen.add(cid);
    if (did) seen.add(did);
    merged.push(t);
  }

  return {
    kind: plan.kind ?? 'room',
    title: plan.title,
    tiles: merged,
  };
}
