// Deterministic UI-mode accessibility checks (pure, no DOM, no AI): WCAG text
// contrast, touch-target size, and missing input labels. Thresholds +
// citations live in core/a11y.ts. Fixes are raw UiOp envelopes (re-validated
// on apply); the cloud model only explains and may propose alternatives.

import { UI_A11Y, UI_CITATIONS, type A11yIssue } from '../../core/a11y';
import {
  layoutFrame,
  type Frame,
  type StackNode,
  type UiDoc,
  type UiNode,
} from './doc';

// ─── WCAG contrast (pure math) ─────────────────────────────────────────────

/** Parse #rgb / #rrggbb into [r,g,b] 0–255; null for anything else. */
export function parseHex(color: string): [number, number, number] | null {
  const m = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

/** WCAG relative luminance of an sRGB hex colour. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseHex(color);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21); null when either colour cannot be parsed. */
export function contrastRatio(fg: string, bg: string): number | null {
  const lf = relativeLuminance(fg);
  const lb = relativeLuminance(bg);
  if (lf === null || lb === null) return null;
  const [hi, lo] = lf >= lb ? [lf, lb] : [lb, lf];
  return (hi + 0.05) / (lo + 0.05);
}

/** The darker-or-white replacement that maximises contrast against `bg`. */
export function bestTextColor(bg: string): string {
  const dark = '#0f172a';
  return (contrastRatio(dark, bg) ?? 0) >= (contrastRatio('#ffffff', bg) ?? 0) ? dark : '#ffffff';
}

// ─── Checks ────────────────────────────────────────────────────────────────

interface Placed {
  node: UiNode;
  /** Effective background behind the node: nearest ancestor stack fill, else
   *  the frame background. */
  bg: string;
}

function collectNodes(frame: Frame): Placed[] {
  const out: Placed[] = [];
  const walk = (stack: StackNode, bg: string): void => {
    const own = stack.fill ?? bg;
    for (const child of stack.children) {
      out.push({ node: child, bg: own });
      if (child.type === 'stack') walk(child, own);
    }
  };
  out.push({ node: frame.root, bg: frame.background });
  walk(frame.root, frame.background);
  return out;
}

export function checkContrast(doc: UiDoc): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const { contrast, largeTextPx, largeBoldPx } = UI_A11Y;
  for (const frame of doc.frames) {
    for (const { node, bg } of collectNodes(frame)) {
      let fg: string | null = null;
      let against: string = bg;
      let large = false;
      if (node.type === 'text') {
        fg = node.color;
        large = node.size >= largeTextPx || (node.size >= largeBoldPx && node.weight >= 700);
      } else if (node.type === 'button') {
        fg = node.textColor;
        against = node.fill;
      } else {
        continue;
      }
      const ratio = contrastRatio(fg, against);
      if (ratio === null) continue; // non-hex colour — out of scope
      const need = large ? contrast.large : contrast.normal;
      if (ratio >= need) continue;
      issues.push({
        id: `contrast-${node.id}`,
        rule: 'contrast',
        severity: 'fail',
        message:
          `${node.type === 'button' ? 'Button' : 'Text'} ${node.id} has ${ratio.toFixed(2)}:1 contrast ` +
          `(${fg} on ${against}) — needs ≥ ${need}:1.`,
        citation: UI_CITATIONS.contrast,
        targetIds: [node.id],
        fix: { op: 'set_style', target: node.id, color: bestTextColor(against) },
        fixLabel: `Recolour text to ${bestTextColor(against)}`,
      });
    }
  }
  return issues;
}

export function checkTargetSizes(doc: UiDoc): A11yIssue[] {
  const issues: A11yIssue[] = [];
  const min = UI_A11Y.minTargetPx;
  for (const frame of doc.frames) {
    const boxes = layoutFrame(frame);
    for (const { node } of collectNodes(frame)) {
      if (node.type !== 'button' && node.type !== 'input' && node.type !== 'icon') continue;
      const box = boxes.get(node.id);
      if (!box) continue;
      // Inputs measure the field, not the label line above it.
      const h = node.type === 'input' ? node.height : box.h;
      const w = node.type === 'icon' ? box.w : Infinity;
      const short = Math.min(h, w);
      if (short >= min) continue;
      issues.push({
        id: `target-${node.id}`,
        rule: 'target-size',
        severity: 'fail',
        message: `${node.type} ${node.id} is ${Math.round(short)} px — touch targets need ≥ ${min} px.`,
        citation: UI_CITATIONS.targetSize,
        targetIds: [node.id],
        fix:
          node.type === 'icon'
            ? { op: 'set_size', target: node.id, w: min, h: min }
            : { op: 'set_size', target: node.id, h: min },
        fixLabel: `Resize to ${min} px`,
      });
    }
  }
  return issues;
}

export function checkLabels(doc: UiDoc): A11yIssue[] {
  const issues: A11yIssue[] = [];
  for (const frame of doc.frames) {
    for (const { node } of collectNodes(frame)) {
      if (node.type !== 'input') continue;
      if (node.label.trim() || node.placeholder.trim()) continue;
      issues.push({
        id: `label-${node.id}`,
        rule: 'missing-label',
        severity: 'fail',
        message: `Input ${node.id} has no label or placeholder — screen readers announce nothing.`,
        citation: UI_CITATIONS.label,
        targetIds: [node.id],
        fix: { op: 'set_text', target: node.id, text: 'Label' },
        fixLabel: 'Add a label',
      });
    }
  }
  return issues;
}

/** All UI-mode accessibility checks, in display order. Pure and deterministic. */
export function checkUiAccessibility(doc: UiDoc): A11yIssue[] {
  return [...checkContrast(doc), ...checkTargetSizes(doc), ...checkLabels(doc)];
}
