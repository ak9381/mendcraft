// Shared HTML-escaping helper for the hand-rolled `innerHTML` templates across
// canvas/relay/ui. Escapes quotes too so the same output is safe inside both
// text nodes and `"..."` attribute values.

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]!);
}
