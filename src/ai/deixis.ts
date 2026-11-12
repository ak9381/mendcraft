// POINT AND SAY "THIS": resolve a deictic adjustment ("make this brighter")
// from a still camera frame plus the pointer position, via on-device Nano
// (Firebase AI Logic PREFER_ON_DEVICE, image input + structured output — wired
// in hybrid.resolveDeixis()). The model sees a tight JPEG crop around the
// pointer (small payload) and a capped candidate list of canvas elements; it
// answers WHICH thing is meant and WHAT change is asked, never an op directly —
// deixisToOp() builds the op from the mode's real element data, and the engine
// re-validates it like any other op.
//
// This module is PURE: crop geometry, prompt text, response constraint,
// untrusted-JSON parsing, colour math, and the resolution→op mapping. No
// network, no Firebase, no DOM — unit tests never need a model or a camera.

import { NAMED_COLORS, toColor } from '../ui/design/colors';

// ---------------------------------------------------------------------------
// Trigger gate: only run the point-and-say path for a deictic adjustment the
// rule parser could not handle ("this/that/it" + a brightness/colour/size cue).

const DEICTIC_RE = /\b(this|that|these|those|it|here)\b/i;
const ADJUST_WORDS = [
  'brighter', 'brighten', 'lighter', 'lighten', 'darker', 'darken', 'dimmer', 'dim',
  'bigger', 'larger', 'smaller', 'wider', 'narrower', 'longer', 'shorter',
  'color', 'colour',
];
const ADJUST_RE = new RegExp(
  `\\b(${[...ADJUST_WORDS, ...Object.keys(NAMED_COLORS)].join('|')})\\b`, 'i',
);

export function isDeicticAdjust(utterance: string): boolean {
  return DEICTIC_RE.test(utterance) && ADJUST_RE.test(utterance);
}

// ---------------------------------------------------------------------------
// Crop geometry. The frame is cropped to a small square around the pointer so
// the payload stays tiny (one ~320px JPEG, not a full camera frame).

export const DEIXIS_CROP_PX = 320;

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pointer position in CROP pixels (what the prompt reports). */
  pointer: { x: number; y: number } | null;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Square crop of ≤`size` px centred on the (normalized 0..1) pointer, clamped
 *  inside the frame; no pointer → centre crop with pointer omitted. */
export function buildCropRect(
  frameW: number,
  frameH: number,
  pointerNorm: { x: number; y: number } | null,
  size = DEIXIS_CROP_PX,
): CropRect {
  const s = Math.max(1, Math.min(size, Math.floor(frameW), Math.floor(frameH)));
  const cx = pointerNorm ? clamp(pointerNorm.x, 0, 1) * frameW : frameW / 2;
  const cy = pointerNorm ? clamp(pointerNorm.y, 0, 1) * frameH : frameH / 2;
  const x = clamp(Math.round(cx - s / 2), 0, Math.floor(frameW) - s);
  const y = clamp(Math.round(cy - s / 2), 0, Math.floor(frameH) - s);
  return {
    x, y, w: s, h: s,
    pointer: pointerNorm ? { x: Math.round(cx - x), y: Math.round(cy - y) } : null,
  };
}

// ---------------------------------------------------------------------------
// Prompt + structured-output constraint.

/** One canvas element the model may name as the referent. */
export interface DeixisCandidate {
  id: string;
  kind: string;
  label?: string;
}

export const MAX_DEIXIS_CANDIDATES = 8;
export const MAX_DEIXIS_LABEL = 24;

/** Plain JSON Schema for both Nano's responseConstraint and (converted) the
 *  cloud responseSchema — same shape, one source of truth. */
export const DEIXIS_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    object: { type: 'string' },
    property: { type: 'string' },
    direction: { type: 'string' },
    color: { type: 'string' },
    confidence: { type: 'number' },
  },
  required: ['target', 'property'],
};

export interface DeixisPromptInput {
  hasImage: boolean;
  /** Pointer position in crop pixels (null when no camera crop was taken). */
  pointer: { x: number; y: number } | null;
  candidates: readonly DeixisCandidate[];
  space: 'plan' | 'ui';
}

/** Prompt for one resolution call. The transcript is JSON.stringify-escaped so
 *  speech can never close the quoted field and smuggle instructions. */
export function buildDeixisPrompt(utterance: string, input: DeixisPromptInput): string {
  const cands = input.candidates.slice(0, MAX_DEIXIS_CANDIDATES).map((c) => {
    const o: Record<string, unknown> = { id: c.id, kind: c.kind };
    if (c.label) o.label = c.label.slice(0, MAX_DEIXIS_LABEL);
    return o;
  });
  const img = input.hasImage
    ? `The attached photo is a small crop of the user's camera view${
      input.pointer ? `; their pointer is at pixel (${input.pointer.x}, ${input.pointer.y}) of the crop` : ''}.`
    : 'No photo is attached; the pointer is on the design canvas.';
  return `The user pointed at something and spoke. Work out what "this/that/it" refers to and what change they want.
${img}
Design-canvas elements (first = directly under the pointer): ${JSON.stringify(cands)}
Transcript: ${JSON.stringify(utterance)}
Reply with ONLY JSON: {"target": an id from the list above, or "pointed" for the first listed element, or "none" if they mean something outside the canvas; "object": 1-3 words naming the pointed thing (from the photo if attached); "property": "brightness"|"color"|"size"; "direction": "increase"|"decrease"; "color": a color name or #hex (only when property is "color"); "confidence": 0..1}.
Never invent ids. Unsure => "target":"none" with low confidence.`;
}

// ---------------------------------------------------------------------------
// Untrusted-response parsing.

export type DeixisProperty = 'brightness' | 'color' | 'size';

export interface DeixisResolution {
  /** A candidate id, 'pointed' (first candidate), or 'none'. */
  target: string;
  /** Short name of the pointed thing (used to match a real object to canvas). */
  object?: string;
  property: DeixisProperty;
  direction: 'increase' | 'decrease';
  /** Normalized #rrggbb (property 'color' only). */
  color?: string;
  confidence: number;
}

const PROPERTY_SYNONYMS: Record<string, DeixisProperty> = {
  brightness: 'brightness', brighter: 'brightness', darker: 'brightness', lightness: 'brightness',
  color: 'color', colour: 'color', fill: 'color',
  size: 'size', bigger: 'size', smaller: 'size', scale: 'size', width: 'size', length: 'size',
};
const DECREASE_WORDS = new Set(['decrease', 'down', 'darker', 'darken', 'dim', 'smaller', 'shorter', 'narrower', 'lower']);
const INCREASE_WORDS = new Set(['increase', 'up', 'brighter', 'brighten', 'bigger', 'larger', 'wider', 'longer', 'raise']);

function coerceConfidence(v: unknown): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0.5;
  const scaled = Number.isInteger(n) && n >= 2 && n <= 100 ? n / 100 : n;
  return clamp(scaled, 0, 1);
}

/** Validate untrusted model JSON into a DeixisResolution (or null). A target
 *  id that is not in `candidateIds` is coerced to 'none' — never invented. */
export function parseDeixisResult(raw: unknown, candidateIds: readonly string[]): DeixisResolution | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const property = typeof o.property === 'string' ? PROPERTY_SYNONYMS[o.property.trim().toLowerCase()] : undefined;
  if (!property) return null;
  let target = typeof o.target === 'string' ? o.target.trim() : 'none';
  if (target !== 'pointed' && target !== 'none' && !candidateIds.includes(target)) target = 'none';
  const dirWord = typeof o.direction === 'string' ? o.direction.trim().toLowerCase() : '';
  const direction = DECREASE_WORDS.has(dirWord) ? 'decrease'
    : INCREASE_WORDS.has(dirWord) ? 'increase' : 'increase';
  const res: DeixisResolution = { target, property, direction, confidence: coerceConfidence(o.confidence) };
  if (typeof o.object === 'string' && o.object.trim()) res.object = o.object.trim().slice(0, 48);
  if (property === 'color') {
    const hex = toColor(o.color);
    if (!hex) return null; // a colour change without a usable colour is useless
    res.color = hex;
  }
  return res;
}

/** Match a real-world object label ("lamp", "blue button") to a canvas element
 *  by candidate kind/label word overlap. Used when target === 'none' but the
 *  camera saw something nameable. Null when nothing matches. */
export function matchCandidateByLabel(
  objectLabel: string | undefined,
  candidates: readonly DeixisCandidate[],
): string | null {
  if (!objectLabel) return null;
  const words = objectLabel.toLowerCase().split(/\s+/).filter(Boolean);
  for (const c of candidates) {
    const hay = `${c.kind} ${c.label ?? ''}`.toLowerCase();
    if (words.some((w) => w.length >= 3 && hay.includes(w))) return c.id;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Resolution → op. The caller supplies the target's CURRENT properties (read
// from the mode's doc) so this stays pure; the engine re-validates the op.

export const BRIGHTNESS_STEP = 0.3; // blend fraction toward white/black
export const SIZE_FACTOR_UP = 1.25;
export const SIZE_FACTOR_DOWN = 0.8;

/** Lighten (increase) or darken a #rrggbb / named colour by blending toward
 *  white or black. Null for an unparseable colour. */
export function adjustBrightness(color: string, direction: 'increase' | 'decrease'): string | null {
  const hex = toColor(color);
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const to = direction === 'increase' ? 255 : 0;
  const mix = (ch: number): number => Math.round(ch + (to - ch) * BRIGHTNESS_STEP);
  const chans = [1, 3, 5].map((i) => mix(parseInt(hex.slice(i, i + 2), 16)));
  return `#${chans.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** What the op builder needs to know about the resolved element. */
export interface DeixisTargetInfo {
  id: string;
  space: 'plan' | 'ui';
  kind: string;
  /** ui: current paint (button/rect/icon/stack fill, or text color). */
  fill?: string;
  /** ui: current font size (text nodes). */
  fontSize?: number;
  /** ui: current fixed box (image/rect). */
  w?: number;
  h?: number;
  /** plan: wall length / opening width, mm. */
  lengthMm?: number;
  widthMm?: number;
}

/** Build the mode op for a resolution, from real current values. Null when the
 *  property does not apply to this element (caller says so honestly). */
export function deixisToOp(res: DeixisResolution, info: DeixisTargetInfo): Record<string, unknown> | null {
  const factor = res.direction === 'increase' ? SIZE_FACTOR_UP : SIZE_FACTOR_DOWN;
  if (info.space === 'ui') {
    if (res.property === 'color') {
      return info.kind === 'text'
        ? { op: 'set_style', target: info.id, color: res.color }
        : { op: 'set_fill', target: info.id, fill: res.color };
    }
    if (res.property === 'brightness') {
      if (!info.fill) return null;
      const fill = adjustBrightness(info.fill, res.direction);
      if (!fill) return null;
      return info.kind === 'text'
        ? { op: 'set_style', target: info.id, color: fill }
        : { op: 'set_fill', target: info.id, fill };
    }
    // size
    if (typeof info.fontSize === 'number') {
      return { op: 'set_style', target: info.id, size: Math.round(info.fontSize * factor) };
    }
    if (typeof info.w === 'number' || typeof info.h === 'number') {
      const op: Record<string, unknown> = { op: 'set_size', target: info.id };
      if (typeof info.w === 'number') op.w = Math.round(info.w * factor);
      if (typeof info.h === 'number') op.h = Math.round(info.h * factor);
      return op;
    }
    return null;
  }
  // plan: only geometry has a size; brightness/colour have no plan meaning.
  if (res.property !== 'size') return null;
  if (typeof info.lengthMm === 'number') {
    return { op: 'set_length', target: info.id, nums: { length: Math.round(info.lengthMm * factor) }, unit: 'mm' };
  }
  if (typeof info.widthMm === 'number') {
    return { op: 'set_width', target: info.id, nums: { width: Math.round(info.widthMm * factor) }, unit: 'mm' };
  }
  return null;
}
