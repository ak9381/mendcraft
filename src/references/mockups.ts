// Gemini-generated reference drawings and layout mockups, as sanitized SVG
// frames shown on the canvas. Image-generating models need the paid Blaze
// plan; we do not enable billing, so a text model returns SVG (sketches,
// line art, pose/object references, or editable landing-page frames).

import type { GenerateKind } from './browserSearch';
import type { RefHit } from './types';

const ALLOWED_TAGS = new Set([
  'svg', 'g', 'path', 'line', 'rect', 'circle', 'ellipse', 'polyline', 'polygon',
  'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath',
  'mask', 'use', 'title', 'desc', 'symbol', 'pattern',
]);

const ATTR_OK = /^(?:[a-z][a-z0-9:-]*)$/i;
const ATTR_BLOCK = /^(?:on[a-z]+|xmlns:xlink)$/i;

export interface GeneratedOption {
  id: string;
  title: string;
  kind: GenerateKind;
  svg: string;
  dataUrl: string;
}

export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Drop scripts, event handlers, and foreign objects. Keep a bare drawing. */
export function sanitizeSvg(raw: string): string | null {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  const fence = s.match(/```(?:svg)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<svg\b/i);
  if (start < 0) return null;
  s = s.slice(start);
  const end = s.toLowerCase().lastIndexOf('</svg>');
  if (end < 0) return null;
  s = s.slice(0, end + 6);
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, '');
  s = s.replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/javascript:/gi, '');
  // Rebuild with an allow-list so unknown tags (image of remote URL, etc.) drop.
  const pieces: string[] = [];
  const re = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)\b([^>]*)\/?\s*>|([^<]+)/g;
  let m: RegExpExecArray | null;
  const open: string[] = [];
  while ((m = re.exec(s))) {
    if (m[3]) {
      if (open.length) pieces.push(m[3].replace(/&(?![a-z]+;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;'));
      continue;
    }
    const tag = m[1].toLowerCase();
    const isClose = m[0].startsWith('</');
    if (!ALLOWED_TAGS.has(tag)) continue;
    if (isClose) {
      pieces.push(`</${tag}>`);
      if (open[open.length - 1] === tag) open.pop();
      continue;
    }
    const selfClose = /\/\s*>$/.test(m[0]);
    const attrs = sanitizeAttrs(m[2] || '', tag);
    pieces.push(`<${tag}${attrs}${selfClose ? ' /' : ''}>`);
    if (!selfClose) open.push(tag);
  }
  while (open.length) pieces.push(`</${open.pop()}>`);
  const out = pieces.join('');
  if (!/<svg\b/i.test(out)) return null;
  if (!/\bviewBox\s*=/i.test(out) && !/\bwidth\s*=/i.test(out)) {
    return out.replace(/<svg\b/i, '<svg viewBox="0 0 800 600" width="800" height="600"');
  }
  return out;
}

function sanitizeAttrs(raw: string, tag: string): string {
  let out = '';
  const re = /([^\s=]+)(?:\s*=\s*("([^"]*)"|'([^']*)'|(\S+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const name = m[1];
    if (!ATTR_OK.test(name) || ATTR_BLOCK.test(name)) continue;
    const val = m[3] ?? m[4] ?? m[5] ?? '';
    if (/^\s*javascript:/i.test(val)) continue;
    if (/^\s*data:/i.test(val) && tag !== 'svg') continue;
    if (name.toLowerCase() === 'href' || name.toLowerCase() === 'xlink:href') {
      if (!val.startsWith('#')) continue;
    }
    if (val === '') out += ` ${name}`;
    else out += ` ${name}="${val.replace(/"/g, '&quot;')}"`;
  }
  if (tag === 'svg' && !/\bxmlns=/.test(out)) out = ` xmlns="http://www.w3.org/2000/svg"${out}`;
  return out;
}

export function parseGeneratedOptions(text: string, kind: GenerateKind): GeneratedOption[] {
  if (!text) return [];
  let body = text.trim();
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) body = fence[1].trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // A bare array may be wrapped in prose.
    const start = body.indexOf('[');
    const end = body.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try { parsed = JSON.parse(body.slice(start, end + 1)); } catch { return []; }
    } else return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed as { options?: unknown }).options;
  if (!Array.isArray(list)) return [];
  const out: GeneratedOption[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as { title?: unknown; kind?: unknown; svg?: unknown };
    const svg = sanitizeSvg(typeof rec.svg === 'string' ? rec.svg : '');
    if (!svg) continue;
    const k: GenerateKind = rec.kind === 'layout' || rec.kind === 'drawing' ? rec.kind : kind;
    const title = typeof rec.title === 'string' && rec.title.trim() ? rec.title.trim().slice(0, 80) : `Option ${out.length + 1}`;
    out.push({
      id: `gemini-${k}-${out.length + 1}`,
      title,
      kind: k,
      svg,
      dataUrl: svgDataUrl(svg),
    });
    if (out.length >= 4) break;
  }
  return out;
}

export function generatedToHits(options: readonly GeneratedOption[]): RefHit[] {
  return options.map((o) => ({
    id: o.id,
    title: o.title,
    thumbUrl: o.dataUrl,
    fullUrl: o.dataUrl,
    pageUrl: '',
    creator: 'Gemini',
    source: 'Gemini' as const,
    license: 'generated',
    credit: 'Gemini · cloud',
  }));
}

export function refinePromptForMockups(query: string, kind: GenerateKind): string {
  if (kind === 'drawing') {
    return [
      'You are helping someone with limited hand use get reference drawings.',
      'Return ONLY a JSON array of 3 or 4 objects: { "title": string, "kind": "drawing", "svg": string }.',
      'Each svg is a complete <svg viewBox="0 0 800 600" xmlns="http://www.w3.org/2000/svg">…</svg> line-art sketch (black strokes, no fill or flat paper, no text except tiny labels, no scripts, no images, no foreignObject).',
      'Vary the angle, pose, or composition so she can pick one.',
      `Subject: ${query}`,
    ].join(' ');
  }
  return [
    'You are helping someone with limited hand use get layout inspirations she can edit.',
    'Return ONLY a JSON array of 3 or 4 objects: { "title": string, "kind": "layout", "svg": string }.',
    'Each svg is a complete <svg viewBox="0 0 800 1200" xmlns="http://www.w3.org/2000/svg">…</svg> landing-page or UI mockup (rectangles, type labels, simple icons as shapes). No scripts, no images, no foreignObject, no external URLs.',
    'Vary structure (hero, pricing, feature grid, editorial) so she can pick one.',
    `Brief: ${query}`,
  ].join(' ');
}

/** Offline / sim stand-ins so tests and demos do not call the cloud. */
export function fixtureGenerated(query: string, kind: GenerateKind): GeneratedOption[] {
  const topic = query.trim() || (kind === 'drawing' ? 'figure' : 'landing page');
  if (kind === 'drawing') {
    const poses = [
      { title: 'Front view', path: 'M400 80 C360 80 330 140 340 200 C250 220 230 360 300 420 C320 520 360 560 400 560 C440 560 480 520 500 420 C570 360 550 220 460 200 C470 140 440 80 400 80 Z' },
      { title: 'Three-quarter view', path: 'M420 90 C370 90 340 150 350 200 C270 230 260 370 330 430 C350 530 390 570 430 560 C490 540 530 480 540 400 C580 320 540 220 470 200 C480 140 460 90 420 90 Z' },
      { title: 'Side view', path: 'M380 100 C350 110 340 170 350 220 C300 250 310 400 360 450 C370 540 400 570 430 560 C470 540 490 470 480 400 C500 300 470 230 430 210 C430 150 410 100 380 100 Z' },
    ];
    return poses.map((p, i) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"><rect width="800" height="600" fill="#f7f3ea"/><path d="${p.path}" fill="none" stroke="#1a1a1a" stroke-width="6" stroke-linejoin="round"/><text x="40" y="560" font-size="22" fill="#333">${escapeText(p.title)} · ${escapeText(topic)}</text></svg>`;
      return { id: `gemini-drawing-${i + 1}`, title: p.title, kind: 'drawing' as const, svg, dataUrl: svgDataUrl(svg) };
    });
  }
  const layouts = [
    { title: 'Hero + features', bars: [80, 200, 200, 200] },
    { title: 'Editorial split', bars: [240, 120, 120, 200] },
    { title: 'Pricing columns', bars: [80, 80, 280, 140] },
    { title: 'Story scroll', bars: [120, 160, 160, 160] },
  ];
  return layouts.map((l, i) => {
    let y = 80;
    const blocks = l.bars.map((h, j) => {
      const rec = `<rect x="80" y="${y}" width="640" height="${h}" rx="12" fill="${j === 0 ? '#1e3a5f' : '#e8eef5'}" stroke="#1a1a1a" stroke-width="3"/>`;
      y += h + 24;
      return rec;
    }).join('');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1200" width="800" height="1200"><rect width="800" height="1200" fill="#f4f6f8"/><text x="80" y="52" font-size="28" fill="#111">${escapeText(l.title)} · ${escapeText(topic)}</text>${blocks}</svg>`;
    return { id: `gemini-layout-${i + 1}`, title: l.title, kind: 'layout' as const, svg, dataUrl: svgDataUrl(svg) };
  });
}

function escapeText(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Cloud JSON schema for Gemini SVG options (text model, not image generation). */
export const REF_GENERATE_CONSTRAINT: Record<string, unknown> = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          kind: { type: 'string' },
          svg: { type: 'string' },
        },
        required: ['title', 'svg'],
      },
    },
  },
  required: ['options'],
};
