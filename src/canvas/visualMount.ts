// Builds real DOM nodes from a sanitized VisualNode tree (src/canvas/
// visualSanitize.ts) — never pass the sanitizer's `html` string to
// innerHTML; walk `nodes` and create elements one at a time instead, so a
// sanitizer bug can leak at most one already-allowlisted tag, never raw
// markup. Wires every promoted [data-action] element to a real click +
// keyboard (Enter/Space) listener, same action-payload shape fallbackRenderer
// and widgets.ts both already dispatch through.
import { SVG_TAGS, type VisualNode } from './visualSanitize';

const SVG_NS = 'http://www.w3.org/2000/svg';

export interface VisualActionPayload {
  action: string;
  label?: string;
}

export interface MountedEl {
  setAttribute(name: string, value: string): void;
  appendChild(child: unknown): unknown;
  addEventListener(type: string, fn: (e: unknown) => void): void;
}

export interface MountDoc {
  createElement(tag: string): MountedEl;
  createElementNS?(ns: string, tag: string): MountedEl;
  createTextNode(text: string): unknown;
}

function buildOne(n: VisualNode, doc: MountDoc, onAction: (a: VisualActionPayload) => void): unknown {
  if (n.kind === 'text') return doc.createTextNode(n.text);
  const el = SVG_TAGS.has(n.tag) && doc.createElementNS ? doc.createElementNS(SVG_NS, n.tag) : doc.createElement(n.tag);
  for (const [name, value] of Object.entries(n.attrs)) el.setAttribute(name, value);
  for (const child of n.children) el.appendChild(buildOne(child, doc, onAction));
  const action = n.attrs['data-action'];
  if (action) {
    const label = n.attrs['data-label'] || n.attrs['aria-label'] || undefined;
    const fire = () => onAction({ action, label });
    el.addEventListener('click', fire);
    el.addEventListener('keydown', (e) => {
      const key = (e as { key?: string }).key;
      if (key === 'Enter' || key === ' ') fire();
    });
  }
  return el;
}

/** Builds the sanitized tree's top-level nodes as real DOM nodes. */
export function buildVisualDom(nodes: VisualNode[], doc: MountDoc, onAction: (a: VisualActionPayload) => void): unknown[] {
  return nodes.map((n) => buildOne(n, doc, onAction));
}
