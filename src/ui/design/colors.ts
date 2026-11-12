// Tiny named-colour table + hex validation for the UI-design mode. Shared by
// the op validator and the rule parser ("make the button blue" / "#0ea5e9").

export const NAMED_COLORS: Record<string, string> = {
  black: '#0f172a', white: '#ffffff', grey: '#94a3b8', gray: '#94a3b8',
  slate: '#64748b', blue: '#2563eb', indigo: '#4f46e5', sky: '#0ea5e9',
  cyan: '#06b6d4', teal: '#14b8a6', green: '#16a34a', emerald: '#10b981',
  lime: '#65a30d', yellow: '#eab308', amber: '#f59e0b', orange: '#f97316',
  red: '#ef4444', rose: '#f43f5e', pink: '#ec4899', purple: '#9333ea',
  violet: '#7c3aed', brown: '#92400e', transparent: 'transparent',
};

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalise an untrusted colour string to a hex / named value, or undefined. */
export function toColor(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const t = v.trim().toLowerCase();
  if (!t) return undefined;
  if (HEX_RE.test(t)) return t;
  if (NAMED_COLORS[t]) return NAMED_COLORS[t];
  // "light blue" / "dark red" → the base colour (good enough for a mock).
  const base = t.replace(/^(light|dark|bright|deep|pale)\s+/, '');
  return NAMED_COLORS[base];
}

/** True for pale fills (e.g. white/near-white cards) that need a border + shadow
 *  to read against a white page. Non-hex / unknown values are treated as dark. */
export function isLightColor(v: string | undefined): boolean {
  if (!v) return false;
  const hex = toColor(v);
  if (!hex || !hex.startsWith('#')) return false;
  const h = hex.slice(1);
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (full.length !== 6) return false;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  // Perceived luminance (0..255); pale cards sit high on this scale.
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 218;
}

/** First named/hex colour mentioned in a token list (for the rule parser). */
export function findColor(tokens: string[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    const c = toColor(tokens[i]);
    if (c) return c;
  }
  return undefined;
}
