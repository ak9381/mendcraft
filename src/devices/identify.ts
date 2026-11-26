// DEVICE IDENTIFY / CONNECTOR WRITE / EFFECT CHECK — prompts, JSON-Schema
// constraints and response validators (pure, DOM-free). The model calls live
// in ai/hybrid.ts; everything a model returns is validated here first.
//
//   identify  : ONE camera frame → what device is this? (PREFER_ON_DEVICE)
//   write     : identity → declarative connector JSON  (ONLY_IN_CLOUD, once)
//   check     : BEFORE + AFTER frames + success cue → done / not_done / unsure
//               (PREFER_ON_DEVICE) — the proof Control Anything lacked.

import { ALLOWED_HTTP_PORTS, ALLOWED_UDP_PORTS, DISCOVERY_METHODS } from './connector';

export interface DeviceIdentity {
  kind: string;
  brand: string;
  model: string;
  /** Friendly name to show her ("WiZ bulb"). */
  label: string;
  confidence: number;
  /** Where it is in the frame, normalised 0–1 (for aiming the gimbal). */
  box?: { x: number; y: number; w: number; h: number };
  /** Point-to-connect: a second device is about as close to where she points
   *  (its kind and brand), so the canvas asks which one instead of guessing. */
  alsoKind?: string;
  alsoBrand?: string;
}

export type EffectVerdict = 'done' | 'not_done' | 'unsure';

export const DEVICE_KINDS = ['smart-bulb', 'lamp', 'speaker', 'tv', 'fan', 'plug', 'ac', 'other', 'none'] as const;

export const IDENTIFY_CONSTRAINT = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: [...DEVICE_KINDS] },
    brand: { type: 'string' },
    model: { type: 'string' },
    label: { type: 'string' },
    confidence: { type: 'number' },
    box: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } } },
    alsoKind: { type: 'string' },
    alsoBrand: { type: 'string' },
  },
  required: ['kind', 'label', 'confidence'],
};

export const EFFECT_CONSTRAINT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['done', 'not_done', 'unsure'] },
    reason: { type: 'string' },
  },
  required: ['verdict'],
};

/** Cloud connector-writer schema. Free-form payload JSON can't be expressed in
 *  a Firebase Schema, so templates come back as JSON strings (payloadJson /
 *  bodyJson) and are parsed as data by coerceConnector. */
export const CONNECTOR_CONSTRAINT = {
  type: 'object',
  properties: {
    deviceKind: { type: 'string' },
    brand: { type: 'string' },
    protocol: { type: 'string' },
    discovery: { type: 'object', properties: { method: { type: 'string' }, service: { type: 'string' }, port: { type: 'number' } }, required: ['method'] },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' }, label: { type: 'string' }, successCue: { type: 'string' },
          params: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { type: 'string' }, min: { type: 'number' }, max: { type: 'number' }, default: { type: 'number' } } } },
          request: {
            type: 'object',
            properties: {
              transport: { type: 'string' }, port: { type: 'number' }, method: { type: 'string' }, path: { type: 'string' },
              payloadJson: { type: 'string' }, bodyJson: { type: 'string' },
            },
            required: ['transport'],
          },
        },
        required: ['id', 'label', 'request'],
      },
    },
    test: { type: 'object', properties: { action: { type: 'string' }, prepare: { type: 'string' } } },
    supported: { type: 'boolean' },
  },
  required: ['actions', 'discovery'],
};

/** What she gave us besides the frame: where she points (room mode, frame
 *  coords 0–1) and/or what she named ("the lamp"). */
export interface IdentifyHint { pointer?: { x: number; y: number }; name?: string }

export function buildIdentifyPrompt(hint: IdentifyHint = {}): string {
  const extra: string[] = [];
  if (hint.pointer) extra.push(`The person is pointing at x=${hint.pointer.x.toFixed(2)}, y=${hint.pointer.y.toFixed(2)} (0-1, from the top-left); pick the device nearest to where she points. If a second device is about equally close, also set "alsoKind" (and "alsoBrand") to it; otherwise leave them out.`);
  if (hint.name) extra.push(`She called it "${hint.name.replace(/"/g, "'").slice(0, 40)}"; pick the device that matches.`);
  const which = extra.length ? 'the device she means' : 'the single main electrical device';
  return `You see ONE photo from a home camera${extra.length ? ' that may show a whole room' : ''}. Name ${which} in it that could be controlled over Wi-Fi (a smart bulb, lamp, speaker, TV, fan, plug or AC).${extra.length ? `\n${extra.join('\n')}` : ''}
Reply JSON: {"kind": one of ${DEVICE_KINDS.join('|')}, "brand": brand if a logo or shape makes it clear else "", "model": "", "label": short friendly name, "confidence": 0-1, "box": {"x","y","w","h"} as 0-1 fractions of the image}.
Speakers count too: e.g. a Marshall speaker (black/brown box, brass knobs, script logo) is kind "speaker", brand "Marshall" — only when you can see it.
If no such device is visible use kind "none". Do not guess a brand you cannot see.`;
}

export function buildConnectorPrompt(id: DeviceIdentity): string {
  return `Write a LAN connector for a ${id.brand || 'unknown brand'} ${id.kind}${id.model ? ` (${id.model})` : ''} as DATA, not code.
Rules: transports only "udp" (ports ${ALLOWED_UDP_PORTS.join(', ')}) or "http" (ports ${ALLOWED_HTTP_PORTS.join(', ')}, methods GET/POST/PUT, path starting with "/").
discovery.method one of ${DISCOVERY_METHODS.join(', ')}. Never include a host or IP. Up to 6 actions with ids like "power-on", "power-off", "brightness".
Each action: params (name, type number|boolean, min, max, default), request with payloadJson (udp) or path + bodyJson (http) where values are "{{paramName}}" placeholders, and successCue = what a camera would SEE when it worked.
Set test.action to a visible action and test.prepare to its opposite (e.g. power-off then power-on). Only use the device's documented local protocol; if it has none, return {"supported": false, "actions": [], "discovery": {"method": "manual"}}.`;
}

export function buildEffectPrompt(cue: string): string {
  return `Two photos from the same camera: FIRST was taken before an action, SECOND after. Expected change: "${cue.replace(/"/g, "'").slice(0, 160)}".
Compare them. Reply JSON {"verdict": "done" if the second photo clearly shows the expected change, "not_done" if it clearly does not, "unsure" if you cannot tell, "reason": one short sentence}.`;
}

const clamp01 = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);
const s = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Validate an identify answer. Null for unparseable or kind "none". */
export function parseIdentity(raw: unknown): DeviceIdentity | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const kind = s(o.kind, 20).toLowerCase();
  if (!kind || kind === 'none') return null;
  const k = (DEVICE_KINDS as readonly string[]).includes(kind) ? kind : 'other';
  const conf = clamp01(o.confidence) ?? 0.5;
  const label = s(o.label, 40) || `${s(o.brand, 30)} ${k}`.trim();
  const out: DeviceIdentity = { kind: k, brand: s(o.brand, 30), model: s(o.model, 40), label, confidence: conf };
  const also = s(o.alsoKind, 20).toLowerCase();
  if (also && also !== 'none' && also !== k && (DEVICE_KINDS as readonly string[]).includes(also)) {
    out.alsoKind = also;
    const ab = s(o.alsoBrand, 30);
    if (ab) out.alsoBrand = ab;
  }
  const b = o.box && typeof o.box === 'object' ? (o.box as Record<string, unknown>) : null;
  if (b) {
    const x = clamp01(b.x), y = clamp01(b.y), w = clamp01(b.w), h = clamp01(b.h);
    if (x !== null && y !== null && w !== null && h !== null && w > 0 && h > 0) out.box = { x, y, w, h };
  }
  return out;
}

export function parseEffect(raw: unknown): { verdict: EffectVerdict; reason: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const v = o.verdict;
  if (v !== 'done' && v !== 'not_done' && v !== 'unsure') return null;
  return { verdict: v, reason: s(o.reason, 160) };
}

/** Did the writer say this device has no usable local protocol? */
export function writerSaysUnsupported(raw: unknown): boolean {
  return !!raw && typeof raw === 'object' && (raw as Record<string, unknown>).supported === false;
}

/** "add device" in English or Kannada (typed or spoken). */
export function isAddDevicePhrase(utterance: string): boolean {
  const t = utterance.trim().toLowerCase().replace(/[.!?।]+$/u, '');
  if (/^(please\s+)?(add|connect|pair|set ?up)\s+(a\s+|the\s+|new\s+|my\s+|this\s+)*(device|lamp|light|bulb|speaker|fan|tv|plug)s?(\s+please)?$/.test(t)) return true;
  if (/^(new|add) device$/.test(t)) return true;
  // Kannada: ಸಾಧನ (device) + ಸೇರಿಸು/ಸೇರಿಸಿ (add) / ಜೋಡಿಸು/ಜೋಡಿಸಿ (connect); ಹೊಸ ಸಾಧನ (new device);
  // also the common English loan "ಡಿವೈಸ್".
  if (/(ಸಾಧನ|ಡಿವೈಸ್|ದೀಪ|ಲೈಟ್)\S*\s*(ಸೇರಿಸ|ಜೋಡಿಸ|ಕನೆಕ್ಟ್|ಆಡ್)/u.test(t)) return true;
  if (/(ಸೇರಿಸ|ಜೋಡಿಸ|ಆಡ್)\S*\s*(ಸಾಧನ|ಡಿವೈಸ್)/u.test(t)) return true;
  if (/ಹೊಸ\s*(ಸಾಧನ|ಡಿವೈಸ್)/u.test(t)) return true;
  return false;
}

/** Words she might use for a device, mapped to a kind. */
const NAME_KINDS: Array<[RegExp, string, string]> = [
  [/\b(lamp|light|bulb)s?\b|ದೀಪ|ಲೈಟ್|ಬಲ್ಬ್/u, 'smart-bulb', 'lamp'],
  [/\b(speaker|music)\b|ಸ್ಪೀಕರ್/u, 'speaker', 'speaker'],
  [/\b(tv|television)\b|ಟಿವಿ/u, 'tv', 'TV'],
  [/\bfan\b|ಫ್ಯಾನ್/u, 'fan', 'fan'],
  [/\bplug\b|ಪ್ಲಗ್/u, 'plug', 'plug'],
];

/** The device word in "add the lamp" (null if she only said "add device"). */
export function deviceNameIn(utterance: string): { kind: string; name: string } | null {
  const t = utterance.toLowerCase();
  for (const [re, kind, name] of NAME_KINDS) if (re.test(t)) return { kind, name };
  return null;
}

/** Voice-only mode: an identity from words alone (no camera). A lamp is
 *  assumed WiZ — the one Wi-Fi bulb Mendcraft ships a connector for. */
export function identityFromWords(utterance: string): DeviceIdentity | null {
  const n = deviceNameIn(utterance);
  if (!n) return null;
  const wiz = n.kind === 'smart-bulb';
  return { kind: n.kind, brand: wiz ? 'WiZ' : '', model: '', label: wiz ? 'Lamp (WiZ)' : n.name, confidence: wiz ? 0.6 : 0.3 };
}
