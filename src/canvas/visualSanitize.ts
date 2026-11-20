// Pure allowlist sanitizer for VisualTile markup — Gemini's one escape hatch
// into bespoke SVG/HTML. No DOM/document dependency (works the same in the
// browser and in the "node" vitest environment this repo runs in): a small
// hand-rolled tokenizer walks <tag> boundaries, drops anything not on the
// allowlist (tag AND its whole subtree for the explicitly dangerous ones),
// strips every event handler and unsafe URL, and promotes [data-action]
// elements to something hands:reach can actually find (role=button,
// tabindex, aria-label) — never trust this string with innerHTML before it
// has been through here.

export type VisualNode =
  | { kind: 'element'; tag: string; attrs: Record<string, string>; children: VisualNode[] }
  | { kind: 'text'; text: string };

export interface SanitizeResult {
  html: string;
  removed: string[];
  /** The same sanitized result as a walkable tree — renderers build real DOM
   *  nodes from this directly (createElement/setAttribute/appendChild),
   *  rather than re-parsing `html` with innerHTML + querySelectorAll. */
  nodes: VisualNode[];
}

/** Canonical-case SVG tags — a renderer must mint these via
 *  `createElementNS('http://www.w3.org/2000/svg', tag)`, not
 *  `createElement(tag)`, or they render as inert HTMLUnknownElements
 *  instead of actual vector shapes. */
export const SVG_TAGS = new Set([
  'svg', 'g', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'path',
  'text', 'tspan', 'defs', 'use', 'symbol', 'clipPath', 'linearGradient',
  'radialGradient', 'stop', 'marker', 'pattern', 'title', 'desc',
]);

/** lowercase tag name -> canonical output spelling (SVG is case-sensitive). */
const ALLOWED_TAGS: Record<string, string> = {
  svg: 'svg',
  g: 'g',
  rect: 'rect',
  circle: 'circle',
  ellipse: 'ellipse',
  line: 'line',
  polyline: 'polyline',
  polygon: 'polygon',
  path: 'path',
  text: 'text',
  tspan: 'tspan',
  defs: 'defs',
  use: 'use',
  symbol: 'symbol',
  clippath: 'clipPath',
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  stop: 'stop',
  marker: 'marker',
  pattern: 'pattern',
  title: 'title',
  desc: 'desc',
  div: 'div',
  span: 'span',
  p: 'p',
  strong: 'strong',
  em: 'em',
  b: 'b',
  i: 'i',
  br: 'br',
  ul: 'ul',
  ol: 'ol',
  li: 'li',
  h1: 'h1',
  h2: 'h2',
  h3: 'h3',
  h4: 'h4',
  button: 'button',
  label: 'label',
};

/** Explicitly named by the threat model — removed with their whole subtree.
 *  (Anything not in ALLOWED_TAGS is removed too; this list exists so the
 *  removal is deliberate and tested, not an accident of an incomplete
 *  allowlist.) */
const DISALLOWED_TAGS = new Set([
  'script', 'iframe', 'foreignobject', 'object', 'embed', 'link', 'meta', 'base',
  'style', 'noscript', 'template', 'slot', 'form', 'input', 'textarea', 'select',
  'video', 'audio', 'source', 'track', 'img', 'a', 'canvas', 'applet',
]);

/** Void in practice for our allowlist — never expect a matching close tag. */
const VOID_TAGS = new Set(['br']);

const HREF_ATTRS = new Set(['href', 'xlink:href']);

const GENERIC_ATTRS = new Set([
  'id', 'class', 'role', 'aria-label', 'aria-hidden', 'aria-pressed', 'aria-selected',
  'tabindex', 'data-action', 'data-label',
  'width', 'height', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2',
  'points', 'd', 'transform', 'viewbox', 'fill', 'stroke', 'stroke-width',
  'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity',
  'stroke-opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor',
  'dominant-baseline', 'offset', 'stop-color', 'stop-opacity', 'gradientunits',
  'gradienttransform', 'patternunits', 'patterncontentunits', 'preserveaspectratio',
  'markerwidth', 'markerheight', 'orient', 'refx', 'refy', 'style',
  // Not a security concern (no URL, nothing executes) — lets a decorative
  // label sitting on top of a clickable shape get out of the way of hit
  // testing instead of stealing the click from the shape underneath it.
  'pointer-events',
]);

/** Attribute names whose canonical on-the-wire casing we preserve (SVG is
 *  case-sensitive for these); everything else in GENERIC_ATTRS is lowercase. */
const ATTR_CASE: Record<string, string> = {
  viewbox: 'viewBox', gradientunits: 'gradientUnits', gradienttransform: 'gradientTransform',
  patternunits: 'patternUnits', patterncontentunits: 'patternContentUnits',
  preserveaspectratio: 'preserveAspectRatio', markerwidth: 'markerWidth',
  markerheight: 'markerHeight', refx: 'refX', refy: 'refY', 'stroke-width': 'stroke-width',
  'stroke-dasharray': 'stroke-dasharray', 'stroke-linecap': 'stroke-linecap',
  'stroke-linejoin': 'stroke-linejoin', 'fill-opacity': 'fill-opacity',
  'stroke-opacity': 'stroke-opacity', 'font-size': 'font-size', 'font-weight': 'font-weight',
  'font-family': 'font-family', 'text-anchor': 'text-anchor',
  'dominant-baseline': 'dominant-baseline', 'stop-color': 'stop-color',
  'stop-opacity': 'stop-opacity', 'aria-label': 'aria-label', 'aria-hidden': 'aria-hidden',
  'aria-pressed': 'aria-pressed', 'aria-selected': 'aria-selected', 'data-action': 'data-action',
  'data-label': 'data-label',
};

const TAG_RE = /<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)((?:\s+[a-zA-Z_:][a-zA-Z0-9_:.-]*(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'`=<>]+))?)*)\s*(\/?)\s*>/g;
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;

function parseAttrs(attrsStr: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(attrsStr))) {
    const [, name, dq, sq, bare] = m;
    out.push([name, dq ?? sq ?? bare ?? '']);
  }
  return out;
}

function escapeAttr(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function isEventAttr(name: string): boolean {
  return /^on/i.test(name);
}

function humanize(action: string): string {
  const spaced = action.replace(/[-_]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : 'Activate';
}

/** `null` means "drop this attribute entirely". */
function sanitizeAttrValue(lowerName: string, value: string): string | null {
  if (HREF_ATTRS.has(lowerName)) {
    return value.startsWith('#') ? value : null;
  }
  if (lowerName === 'style') {
    if (/url\s*\(/i.test(value) || /expression\s*\(/i.test(value) || /javascript:/i.test(value)) return null;
    return value;
  }
  if (!GENERIC_ATTRS.has(lowerName)) return null;
  return value;
}

/** Strip Gemini-authored SVG/HTML down to a safe allowlisted subset: strips
 *  `<script>`, every `on*` handler, `javascript:`/executable `data:` URLs,
 *  `<iframe>`/`<foreignObject>`/`<object>`/`<embed>`/`<link>`/`<meta>`/
 *  `<base>`/`<img>`, and any non-local `href`/`xlink:href` — then promotes
 *  `[data-action]` elements to `role="button"` + `tabindex="0"` +
 *  `aria-label` so they're real hand-reachable controls once mounted. */
function serialize(nodes: VisualNode[]): string {
  return nodes
    .map((n) => {
      if (n.kind === 'text') return n.text;
      const attrStr = Object.entries(n.attrs)
        .map(([k, v]) => `${k}="${escapeAttr(v)}"`)
        .join(' ');
      const open = `<${n.tag}${attrStr ? ' ' + attrStr : ''}`;
      if (VOID_TAGS.has(n.tag.toLowerCase()) && !n.children.length) return `${open} />`;
      return `${open}>${serialize(n.children)}</${n.tag}>`;
    })
    .join('');
}

export function sanitizeVisualMarkup(raw: string): SanitizeResult {
  const removed: string[] = [];
  if (typeof raw !== 'string' || !raw) return { html: '', removed, nodes: [] };

  const noComments = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<![a-zA-Z][^>]*>/g, '')
    .replace(/<\?[\s\S]*?\?>/g, '');

  const roots: VisualNode[] = [];
  type Frame = { name: string; banned: boolean; node: Extract<VisualNode, { kind: 'element' }> | null };
  const stack: Frame[] = [];
  const appendChild = (node: VisualNode): void => {
    const top = stack[stack.length - 1];
    if (top?.node) top.node.children.push(node);
    else roots.push(node);
  };

  let lastIndex = 0;
  TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TAG_RE.exec(noComments))) {
    const [full, closing, rawName, attrsStr, selfCloseSlash] = m;
    const textBefore = noComments.slice(lastIndex, m.index);
    lastIndex = m.index + full.length;
    const insideBanned = stack.some((s) => s.banned);
    if (!insideBanned && textBefore) appendChild({ kind: 'text', text: textBefore });

    const lname = rawName.toLowerCase();
    const selfClose = !!selfCloseSlash || VOID_TAGS.has(lname);

    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].name === lname) { stack.length = i; break; }
      }
      continue;
    }

    const banned = !ALLOWED_TAGS[lname] || DISALLOWED_TAGS.has(lname);
    if (banned) removed.push(lname);

    if (insideBanned || banned) {
      if (!selfClose) stack.push({ name: lname, banned: true, node: null });
      continue;
    }

    const attrs = parseAttrs(attrsStr);
    const keptAttrs: Record<string, string> = {};
    let hasDataAction = false;
    let hasRole = false;
    let hasAriaLabel = false;
    let hasTabindex = false;
    let dataLabelVal = '';
    let dataActionVal = '';
    for (const [name, value] of attrs) {
      const lowerName = name.toLowerCase();
      if (isEventAttr(lowerName)) { removed.push(`${lname}[${lowerName}]`); continue; }
      if (lowerName === 'data-action') { hasDataAction = true; dataActionVal = value; }
      if (lowerName === 'data-label') dataLabelVal = value;
      if (lowerName === 'role') hasRole = true;
      if (lowerName === 'aria-label') hasAriaLabel = true;
      if (lowerName === 'tabindex') hasTabindex = true;
      const safeVal = sanitizeAttrValue(lowerName, value);
      if (safeVal === null) { removed.push(`${lname}[${lowerName}]`); continue; }
      const outName = ATTR_CASE[lowerName] ?? lowerName;
      keptAttrs[outName] = safeVal;
    }
    if (hasDataAction) {
      if (!hasRole) keptAttrs.role = 'button';
      if (!hasTabindex) keptAttrs.tabindex = '0';
      if (!hasAriaLabel) keptAttrs['aria-label'] = dataLabelVal || humanize(dataActionVal);
    }

    const node: Extract<VisualNode, { kind: 'element' }> = { kind: 'element', tag: ALLOWED_TAGS[lname], attrs: keptAttrs, children: [] };
    appendChild(node);
    if (!selfClose) stack.push({ name: lname, banned: false, node });
  }
  const tail = noComments.slice(lastIndex);
  if (!stack.some((s) => s.banned) && tail) appendChild({ kind: 'text', text: tail });

  return { html: serialize(roots), removed, nodes: roots };
}
