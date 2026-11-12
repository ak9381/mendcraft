// UI-mode exporters. `toHtml` writes a clean, single-file HTML+CSS document for
// the active frame — flexbox auto-layout, a system font stack, and semantic
// tags (h1/p/button/input with <label>, img placeholder with alt). `toSvg`
// writes a flat SVG of the frame (Figma / Illustrator can import it). Both are
// pure strings so they unit-test without a DOM; the download/clipboard helpers
// live in controller.ts.

import {
  layoutFrame,
  type Frame,
  type StackNode,
  type UiNode,
} from './doc';

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const pad = (depth: number) => '  '.repeat(depth);

function alignToFlex(a: StackNode['align']): string {
  return a === 'start' ? 'flex-start' : a === 'end' ? 'flex-end' : a === 'center' ? 'center' : 'stretch';
}
function justifyToFlex(j: StackNode['justify']): string {
  return j === 'start' ? 'flex-start' : j === 'end' ? 'flex-end' : j === 'center' ? 'center' : 'space-between';
}

/** Inline style for one node (kept per-node so the export is a single file). */
function styleFor(node: UiNode): string {
  const parts: string[] = [];
  switch (node.type) {
    case 'stack': {
      parts.push('display:flex', `flex-direction:${node.direction}`, `gap:${node.gap}px`);
      if (node.padding) parts.push(`padding:${node.padding}px`);
      parts.push(`align-items:${alignToFlex(node.align)}`, `justify-content:${justifyToFlex(node.justify)}`);
      if (node.fill) parts.push(`background:${node.fill}`);
      if (node.radius) parts.push(`border-radius:${node.radius}px`);
      break;
    }
    case 'text':
      parts.push(`margin:0`, `font-size:${node.size}px`, `font-weight:${node.weight}`, `color:${node.color}`);
      break;
    case 'button':
      parts.push(
        'border:0', 'cursor:pointer', `background:${node.fill}`, `color:${node.textColor}`,
        `border-radius:${node.radius}px`, `height:${node.height}px`, 'padding:0 20px',
        'font-size:15px', 'font-weight:600',
      );
      break;
    case 'input':
      parts.push(
        'box-sizing:border-box', `height:${node.height}px`, 'padding:0 12px', 'font-size:15px',
        'border:1px solid #cbd5e1', 'border-radius:8px', 'background:#fff', 'color:#0f172a', 'width:100%',
      );
      break;
    case 'image':
      parts.push(
        `width:${node.w}px`, `height:${node.h}px`, `border-radius:${node.radius}px`,
        'background:#e2e8f0', 'object-fit:cover', 'display:block',
      );
      break;
    case 'rect':
      parts.push(`width:${node.w}px`, `height:${node.h}px`, `background:${node.fill}`, `border-radius:${node.radius}px`);
      break;
  }
  return parts.join(';');
}

function renderNode(node: UiNode, depth: number): string {
  const style = styleFor(node);
  const s = (extra = '') => ` style="${style}"${extra}`;
  switch (node.type) {
    case 'text': {
      const tag = node.role === 'heading' ? 'h1' : 'p';
      return `${pad(depth)}<${tag}${s()}>${esc(node.text)}</${tag}>`;
    }
    case 'button':
      return `${pad(depth)}<button type="button"${s()}>${esc(node.label)}</button>`;
    case 'input': {
      const id = node.id;
      const label = node.label
        ? `${pad(depth)}<label for="${id}" style="display:flex;flex-direction:column;gap:6px;font-size:13px;color:#475569">${esc(node.label)}\n`
        : '';
      const input = `${pad(depth + (node.label ? 1 : 0))}<input id="${id}" type="${node.inputType}" placeholder="${esc(node.placeholder)}"${s()} />`;
      return node.label ? `${label}${input}\n${pad(depth)}</label>` : input;
    }
    case 'image':
      return `${pad(depth)}<img alt="Image placeholder"${s()} src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" />`;
    case 'rect':
      return `${pad(depth)}<div${s()}></div>`;
    case 'stack': {
      const kids = node.children.map((c) => renderNode(c, depth + 1)).join('\n');
      return `${pad(depth)}<div${s()}>\n${kids}\n${pad(depth)}</div>`;
    }
  }
}

/** A clean, single-file HTML+CSS document for the frame. */
export function toHtml(frame: Frame): string {
  const body = renderNode(frame.root, 3);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(frame.name)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ${FONT_STACK}; background: #f1f5f9; }
    .frame { width: ${frame.w}px; min-height: ${frame.h}px; margin: 0 auto; background: ${frame.background}; }
  </style>
</head>
<body>
  <main class="frame" aria-label="${esc(frame.name)}">
${body}
  </main>
</body>
</html>
`;
}

// ── Flat SVG export (Figma / Illustrator import) ──────────────────────────

function svgEsc(s: string): string {
  return esc(s);
}

function svgForNode(node: UiNode, box: { x: number; y: number; w: number; h: number }): string {
  switch (node.type) {
    case 'text': {
      const anchor = 'start';
      return `  <text x="${box.x}" y="${Math.round(box.y + node.size)}" font-family="${FONT_STACK}" font-size="${node.size}" font-weight="${node.weight}" fill="${node.color}" text-anchor="${anchor}">${svgEsc(node.text)}</text>`;
    }
    case 'button':
      return (
        `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${node.radius}" fill="${node.fill}" />\n` +
        `  <text x="${Math.round(box.x + box.w / 2)}" y="${Math.round(box.y + box.h / 2 + 5)}" font-family="${FONT_STACK}" font-size="15" font-weight="600" fill="${node.textColor}" text-anchor="middle">${svgEsc(node.label)}</text>`
      );
    case 'input':
      return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="8" fill="#ffffff" stroke="#cbd5e1" />` +
        (node.placeholder ? `\n  <text x="${box.x + 12}" y="${Math.round(box.y + box.h / 2 + 5)}" font-family="${FONT_STACK}" font-size="15" fill="#94a3b8">${svgEsc(node.placeholder)}</text>` : '');
    case 'image':
      return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${node.radius}" fill="#e2e8f0" />`;
    case 'rect':
      return `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${node.radius}" fill="${node.fill}" />`;
    case 'stack':
      return node.fill
        ? `  <rect x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" rx="${node.radius ?? 0}" fill="${node.fill}" />`
        : '';
  }
}

/** A flat SVG of the frame (uses the same pure layout as the renderer). */
export function toSvg(frame: Frame): string {
  const boxes = layoutFrame(frame);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.w}" height="${frame.h}" viewBox="0 0 ${frame.w} ${frame.h}">`,
    `  <rect x="0" y="0" width="${frame.w}" height="${frame.h}" fill="${frame.background}" />`,
  ];
  const walk = (s: StackNode) => {
    const sb = boxes.get(s.id);
    if (sb && s.fill) parts.push(svgForNode(s, sb));
    for (const c of s.children) {
      const box = boxes.get(c.id);
      if (!box) continue;
      if (c.type === 'stack') walk(c);
      else parts.push(svgForNode(c, box));
    }
  };
  walk(frame.root);
  parts.push('</svg>');
  return parts.join('\n') + '\n';
}
