// "Convert my 2D to 3D": the plan's own 3D view, dressed by Gemini. Gemini
// proposes materials and lighting as STRUCTURED DATA (colours, roughness, sun
// angle) which code validates and applies to the three.js scene. No image
// model is used (photo renders need paid billing, which is off).

export interface SurfaceLook { color: string; roughness: number; name: string }

export interface MaterialPlan {
  label: string;
  walls: SurfaceLook;
  floor: SurfaceLook;
  structure: SurfaceLook;
  furniture: SurfaceLook;
  sanitary: SurfaceLook;
  lighting: {
    sunIntensity: number;
    /** Compass angle of the sun, degrees (0 = north / +y, 90 = east / +x). */
    sunAzimuth: number;
    /** Height of the sun above the horizon, degrees. */
    sunElevation: number;
    sunColor: string;
    ambientIntensity: number;
    skyColor: string;
  };
  notes: string;
}

export const PHOTO_RENDER_NOTE = 'Photo-style render needs paid image billing, which is off. Using live 3D with Gemini materials instead.';

const SURFACES = ['walls', 'floor', 'structure', 'furniture', 'sanitary'] as const;

export const MATERIAL_PRESETS: Record<'default' | 'warm' | 'bright' | 'evening', MaterialPlan> = {
  default: {
    label: 'Plain model',
    walls: { color: '#cbd5e1', roughness: 0.9, name: 'Grey card' },
    floor: { color: '#e5e7eb', roughness: 0.95, name: 'Plain floor' },
    structure: { color: '#94a3b8', roughness: 0.85, name: 'Concrete' },
    furniture: { color: '#b08968', roughness: 0.85, name: 'Wood' },
    sanitary: { color: '#e2e8f0', roughness: 0.6, name: 'Ceramic' },
    lighting: { sunIntensity: 1.2, sunAzimuth: 135, sunElevation: 55, sunColor: '#ffffff', ambientIntensity: 1.4, skyColor: '#eef2f7' },
    notes: '',
  },
  warm: {
    label: 'Warm home',
    walls: { color: '#f3e9dc', roughness: 0.9, name: 'Warm white plaster' },
    floor: { color: '#a47148', roughness: 0.7, name: 'Teak wood' },
    structure: { color: '#8d8478', roughness: 0.8, name: 'Kota stone' },
    furniture: { color: '#7f5539', roughness: 0.75, name: 'Walnut' },
    sanitary: { color: '#f8f9fa', roughness: 0.4, name: 'Glazed ceramic' },
    lighting: { sunIntensity: 1.5, sunAzimuth: 120, sunElevation: 40, sunColor: '#fff1d6', ambientIntensity: 1.1, skyColor: '#f6efe6' },
    notes: 'Warm plaster walls and a wooden floor in morning light.',
  },
  bright: {
    label: 'Bright and airy',
    walls: { color: '#ffffff', roughness: 0.85, name: 'White paint' },
    floor: { color: '#d6d3d1', roughness: 0.5, name: 'Light marble' },
    structure: { color: '#a8a29e', roughness: 0.7, name: 'Light concrete' },
    furniture: { color: '#c8b6a6', roughness: 0.8, name: 'Oak' },
    sanitary: { color: '#ffffff', roughness: 0.3, name: 'White ceramic' },
    lighting: { sunIntensity: 1.8, sunAzimuth: 180, sunElevation: 65, sunColor: '#ffffff', ambientIntensity: 1.6, skyColor: '#f1f5f9' },
    notes: 'White walls, light marble and strong midday sun.',
  },
  evening: {
    label: 'Evening',
    walls: { color: '#e9e3d5', roughness: 0.9, name: 'Cream paint' },
    floor: { color: '#6b4f3a', roughness: 0.7, name: 'Dark wood' },
    structure: { color: '#78716c', roughness: 0.8, name: 'Stone' },
    furniture: { color: '#5c4033', roughness: 0.75, name: 'Rosewood' },
    sanitary: { color: '#f1f5f9', roughness: 0.4, name: 'Ceramic' },
    lighting: { sunIntensity: 0.9, sunAzimuth: 260, sunElevation: 12, sunColor: '#ffb870', ambientIntensity: 0.7, skyColor: '#2f3a4f' },
    notes: 'Low warm sun from the west, darker floor.',
  },
};

/** Default dress for "convert 2D to 3D" when she hasn't named a style.
 *  Also the coerce fallback so a thin Gemini payload doesn't leave grey-card walls. */
export const CONVERT_LOOK: MaterialPlan = {
  label: 'Convert 2D to 3D',
  walls: { color: '#f7f6f2', roughness: 0.85, name: 'matte white paint' },
  floor: { color: '#e4c9a0', roughness: 0.7, name: 'light oak parquet' },
  structure: { color: '#a8a29e', roughness: 0.7, name: 'Light concrete' },
  furniture: { color: '#c8b6a6', roughness: 0.8, name: 'Oak' },
  sanitary: { color: '#ffffff', roughness: 0.3, name: 'White ceramic' },
  lighting: { sunIntensity: 1.6, sunAzimuth: 135, sunElevation: 55, sunColor: '#fffaf0', ambientIntensity: 1.5, skyColor: '#eef2f7' },
  notes: 'Walls matte white paint, floor light oak parquet.',
};

/** Plain-JSON schema for the cloud response (converted to a Firebase Schema). */
const SURFACE_SCHEMA = {
  type: 'object',
  properties: { color: { type: 'string' }, roughness: { type: 'number' }, name: { type: 'string' } },
  required: ['color'],
};
export const MATERIAL_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    walls: SURFACE_SCHEMA, floor: SURFACE_SCHEMA, structure: SURFACE_SCHEMA,
    furniture: SURFACE_SCHEMA, sanitary: SURFACE_SCHEMA,
    lighting: {
      type: 'object',
      properties: {
        sunIntensity: { type: 'number' }, sunAzimuth: { type: 'number' }, sunElevation: { type: 'number' },
        sunColor: { type: 'string' }, ambientIntensity: { type: 'number' }, skyColor: { type: 'string' },
      },
    },
    notes: { type: 'string' },
  },
  required: ['walls', 'floor', 'lighting'],
};

export const MATERIAL_PROMPT = `You are an interior designer dressing a simple 3D model of a floor plan. Choose realistic materials and daylight that suit the request. If she just asks to convert 2D to 3D with no style, use matte white paint walls (#f7f6f2) and light oak parquet floors (#e4c9a0) with bright, even daylight so the walls read white and the floor reads light oak. Reply with ONE JSON object only: {"label":"<2-4 words>","walls":{"color":"#rrggbb","roughness":0..1,"name":"<material>"},"floor":{...},"structure":{...},"furniture":{...},"sanitary":{...},"lighting":{"sunIntensity":0.3..2.5,"sunAzimuth":0..360,"sunElevation":5..85,"sunColor":"#rrggbb","ambientIntensity":0.3..2,"skyColor":"#rrggbb"},"notes":"<one sentence>"}. Hex colours only.`;

const HEX6 = /^#?[0-9a-f]{6}$/i;
const HEX3 = /^#?[0-9a-f]{3}$/i;
const RGB = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const num = (v: unknown, fb: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fb;

/** Accept #rgb, #rrggbb, rrggbb, or rgb(r,g,b). Named colours fall back. */
export function parseHexColor(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (HEX6.test(s)) return `#${s.replace(/^#/, '').toLowerCase()}`;
  if (HEX3.test(s)) {
    const h = s.replace(/^#/, '').toLowerCase();
    return `#${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  const m = s.match(RGB);
  if (m) {
    const ch = (n: string) => clamp(Number(n), 0, 255).toString(16).padStart(2, '0');
    return `#${ch(m[1])}${ch(m[2])}${ch(m[3])}`;
  }
  return null;
}
const hex = (v: unknown, fb: string) => parseHexColor(v) ?? fb;

/** Paint / wood colour words the model often returns instead of a hex value.
 *  Generic CSS names like "red" stay unresolved so junk output still falls
 *  back to the preset. */
export function colorFromMaterialName(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!t) return null;
  if (/\blight\s+oak\b|\boak\s+parquet\b|\bwhite\s+oak\b/.test(t)) return '#e4c9a0';
  if (/\boak\b/.test(t)) return '#d4b08c';
  if (/\bteak\b/.test(t)) return '#a47148';
  if (/\bwalnut\b/.test(t)) return '#7f5539';
  if (/\bparquet\b/.test(t)) return '#e4c9a0';
  if (t === 'white' || t === 'matt white' || t === 'matte white') return '#f7f6f2';
  if (/\bwhite\b/.test(t) && !/oak|wood|wash/.test(t)) return '#f7f6f2';
  if (/\bivory\b|\bcream\b/.test(t)) return '#f4ead3';
  return null;
}

function luminance(hexColor: string): number {
  const n = parseInt(hexColor.slice(1), 16);
  if (Number.isNaN(n)) return 0;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function isNearGrey(hexColor: string): boolean {
  const n = parseInt(hexColor.slice(1), 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return Math.max(r, g, b) - Math.min(r, g, b) < 28;
}

/** Hex first, then a colour word on the colour field, then a guess from the
 *  material name. If the name says white/oak but the hex is grey, muddy, or
 *  too dark, prefer the named look so walls actually read white and floors
 *  read light oak — not the default grey card. */
function resolveLookColor(color: unknown, name: string, fb: string): string {
  const fromHex = parseHexColor(color);
  const fromWord = typeof color === 'string' ? colorFromMaterialName(color) : null;
  const fromName = colorFromMaterialName(name);
  const resolved = fromHex ?? fromWord ?? fromName ?? fb;
  const label = `${typeof color === 'string' ? color : ''} ${name}`.toLowerCase();
  if (fromName && /\b(white|ivory|cream)\b/.test(label) && (luminance(resolved) < 0.9 || isNearGrey(resolved))) {
    return fromName;
  }
  if (fromName && /\b(oak|parquet)\b/.test(label) && (luminance(resolved) < 0.55 || isNearGrey(resolved))) {
    return fromName;
  }
  return resolved;
}

function lookColorIsUsable(color: unknown, name: string): boolean {
  if (parseHexColor(color)) return true;
  if (typeof color === 'string' && colorFromMaterialName(color)) return true;
  return !!colorFromMaterialName(name);
}

/** Untrusted model JSON → a safe MaterialPlan (missing parts fall back to the
 *  base preset), or null when nothing usable came back. */
export function coerceMaterialPlan(raw: unknown, base: MaterialPlan = MATERIAL_PRESETS.default): MaterialPlan | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  let usable = 0;
  const out: MaterialPlan = JSON.parse(JSON.stringify(base));
  for (const k of SURFACES) {
    const s = o[k];
    if (!s || typeof s !== 'object') continue;
    const r = s as Record<string, unknown>;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 40) : base[k].name;
    if (lookColorIsUsable(r.color, name)) usable++;
    out[k] = {
      color: resolveLookColor(r.color, name, base[k].color),
      roughness: num(r.roughness, base[k].roughness, 0, 1),
      name,
    };
  }
  const l = o.lighting && typeof o.lighting === 'object' ? (o.lighting as Record<string, unknown>) : {};
  out.lighting = {
    sunIntensity: num(l.sunIntensity, base.lighting.sunIntensity, 0.2, 3),
    sunAzimuth: ((num(l.sunAzimuth, base.lighting.sunAzimuth, -720, 720) % 360) + 360) % 360,
    sunElevation: num(l.sunElevation, base.lighting.sunElevation, 2, 89),
    sunColor: hex(l.sunColor, base.lighting.sunColor),
    ambientIntensity: num(l.ambientIntensity, base.lighting.ambientIntensity, 0.2, 2.5),
    skyColor: hex(l.skyColor, base.lighting.skyColor),
  };
  const lit = o.lighting && typeof o.lighting === 'object' ? Object.keys(o.lighting as object).length > 0 : false;
  if (usable === 0 && !lit) return null;
  out.label = typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : 'Gemini look';
  out.notes = typeof o.notes === 'string' ? o.notes.trim().slice(0, 200) : '';
  return out;
}

/** Offline / no-cloud: pick a preset from her words. */
export function presetFor(utterance: string): MaterialPlan {
  const t = utterance.toLowerCase();
  if (/\b(evening|night|sunset|dusk)\b/.test(t)) return MATERIAL_PRESETS.evening;
  if (/\b(bright|airy|white|modern|marble)\b/.test(t)) return MATERIAL_PRESETS.bright;
  if (/\b(convert|2d\s*to\s*3d|two-?d to three-?d|dress the model|make it 3d)\b/.test(t)) return CONVERT_LOOK;
  return MATERIAL_PRESETS.warm;
}

/** Sun direction vector (x east, y north, z up) for three.js. */
export function sunVector(l: MaterialPlan['lighting']): { x: number; y: number; z: number } {
  const az = (l.sunAzimuth * Math.PI) / 180;
  const el = (l.sunElevation * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(el), y: Math.cos(az) * Math.cos(el), z: Math.sin(el) };
}

/** Change-log op for a 3D materials/lighting proposal (not a plan-document op). */
export interface SetMaterialsOp {
  op: 'set_materials';
  plan: MaterialPlan;
  previous: MaterialPlan | null;
  previous3d: boolean;
}

export function makeSetMaterialsOp(plan: MaterialPlan, previous: MaterialPlan | null, previous3d: boolean): Record<string, unknown> {
  return { op: 'set_materials', plan, previous, previous3d };
}

export function isSetMaterialsOp(op: Record<string, unknown> | null | undefined): boolean {
  return !!op && op.op === 'set_materials';
}

/** Untrusted change-log / sync payload → a safe materials op, or null. */
export function coerceSetMaterialsOp(raw: unknown): SetMaterialsOp | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (o.op !== 'set_materials') return null;
  const plan = coerceMaterialPlan(o.plan);
  if (!plan) return null;
  const previous = o.previous ? coerceMaterialPlan(o.previous) : null;
  return { op: 'set_materials', plan, previous, previous3d: o.previous3d === true };
}
