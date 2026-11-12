// UI-mode tools for the shared palette/tool framework (core/tools.ts): Figma-
// like basics. Every placement tool supports click-to-place AND palette drag
// with a ghost; drops over a nested stack insert in flow (with the insertion
// indicator computed by editing.insertionIndex), drops over plain frame space
// place the node absolutely. All mutations go through ctx.apply → controller
// (validated + undoable), so mouse, touch, and pinch behave identically.

import type { Tool, ToolPointer } from '../../core/tools';
import type { PaletteItemSpec } from '../../core/palette';
import { insertionIndex, stackAt, type Segment } from './editing';
import type { Box, Frame, FramePreset } from './doc';

/** What ui tools need from the ui renderer (frame-local px world). */
export interface UiToolCtx {
  apply(op: unknown): { ok: boolean; error?: string };
  frame(): Frame | undefined;
  boxes(): Map<string, Box>;
  toFrame(clientX: number, clientY: number): { x: number; y: number };
  setGhost(b: Box | null, label?: string): void;
  setInsertLine(seg: Segment | null): void;
  setStatus(text: string): void;
  render(): void;
  /** Return to the Select tool after a successful placement. */
  activateSelect(): void;
}

interface Placeable {
  id: string;
  label: string;
  icon: string;
  shortcut: string;
  /** Ghost footprint (intrinsic-ish size) in frame px. */
  w: number;
  h: number;
  /** Extra fields for the add_node op. */
  op: Record<string, unknown>;
  hint: string;
}

const PLACEABLES: Placeable[] = [
  { id: 'rect', label: 'Rectangle', icon: '▭', shortcut: 'r', w: 160, h: 80, op: { nodeType: 'rect' }, hint: 'Click a stack to insert, or empty frame space to place freely.' },
  { id: 'text', label: 'Text', icon: 'T', shortcut: 't', w: 120, h: 22, op: { nodeType: 'text', role: 'body' }, hint: 'Click to add body text.' },
  { id: 'heading', label: 'Heading', icon: 'H', shortcut: 'h', w: 220, h: 42, op: { nodeType: 'text', role: 'heading' }, hint: 'Click to add a heading.' },
  { id: 'button', label: 'Button', icon: '⬭', shortcut: 'b', w: 120, h: 44, op: { nodeType: 'button' }, hint: 'Click to add a button.' },
  { id: 'input', label: 'Input', icon: '⌷', shortcut: 'i', w: 280, h: 66, op: { nodeType: 'input' }, hint: 'Click to add an input field.' },
  { id: 'image', label: 'Image', icon: '🖻', shortcut: 'g', w: 320, h: 180, op: { nodeType: 'image' }, hint: 'Click to add an image placeholder.' },
  { id: 'card', label: 'Card', icon: '▤', shortcut: 'c', w: 280, h: 110, op: { nodeType: 'card' }, hint: 'Click to add a card.' },
  { id: 'navbar', label: 'Navbar', icon: '☰', shortcut: 'n', w: 600, h: 68, op: { nodeType: 'navbar' }, hint: 'Click to add a navigation bar.' },
  { id: 'icon', label: 'Icon', icon: '◯', shortcut: 'o', w: 40, h: 40, op: { nodeType: 'icon' }, hint: 'Click to add a circle icon.' },
  { id: 'divider', label: 'Divider', icon: '—', shortcut: 'l', w: 160, h: 8, op: { nodeType: 'divider' }, hint: 'Click to add a divider.' },
];

const FRAME_TOOLS: Array<{ id: string; label: string; preset: FramePreset; shortcut: string }> = [
  { id: 'frame-desktop', label: 'Desktop 1440', preset: 'desktop', shortcut: 'a' },
  { id: 'frame-tablet', label: 'Tablet 834', preset: 'tablet', shortcut: '' },
  { id: 'frame-mobile', label: 'Mobile 390', preset: 'mobile', shortcut: '' },
];

export function createUiTools(ctx: UiToolCtx): Tool[] {
  const select: Tool = {
    id: 'select',
    label: 'Select',
    icon: '▲',
    shortcut: 'v',
    hint: 'Click to select (Shift adds) · drag to move · Shift+A wraps in a stack.',
    onDown: () => false, // the renderer's own select/drag path handles it
  };

  const frameTools: Tool[] = FRAME_TOOLS.map((f) => ({
    id: f.id,
    label: f.label,
    icon: '⬚',
    shortcut: f.shortcut,
    placeable: true,
    hint: `Click to add a ${f.label} frame.`,
    onDown(p: ToolPointer) {
      void p;
      const r = ctx.apply({ op: 'add_frame', preset: f.preset });
      if (r.ok) {
        ctx.setStatus(`${f.label} frame added.`);
        ctx.activateSelect();
      }
      return true;
    },
    onPlace(p: ToolPointer) {
      this.onDown!(p);
      ctx.setGhost(null);
    },
    onHover() {
      ctx.setGhost(null);
    },
    onCancel() {
      ctx.setGhost(null);
    },
  }));

  const placeTools: Tool[] = PLACEABLES.map((spec) => {
    /** Where would a drop at this pointer land? Updates ghost + indicator. */
    function preview(p: ToolPointer): { parent?: string; index?: number; x?: number; y?: number } | null {
      const f = ctx.frame();
      if (!f) {
        ctx.setGhost(null);
        ctx.setInsertLine(null);
        return null;
      }
      const boxes = ctx.boxes();
      const fp = ctx.toFrame(p.x, p.y);
      const ghost: Box = { x: fp.x - spec.w / 2, y: fp.y - spec.h / 2, w: spec.w, h: spec.h };
      const stack = stackAt(f, boxes, fp);
      if (!stack) {
        ctx.setGhost(null);
        ctx.setInsertLine(null);
        return null;
      }
      if (stack.id === f.root.id) {
        // Free placement on open frame space.
        ctx.setGhost(ghost, spec.label);
        ctx.setInsertLine(null);
        return { x: Math.max(0, Math.round(ghost.x)), y: Math.max(0, Math.round(ghost.y)) };
      }
      const ins = insertionIndex(stack, boxes, fp);
      ctx.setGhost(ghost, spec.label);
      ctx.setInsertLine(ins.line);
      return { parent: stack.id, index: ins.index };
    }

    function place(p: ToolPointer): void {
      if (!ctx.frame()) ctx.apply({ op: 'add_frame', preset: 'desktop' });
      const drop = preview(p);
      ctx.setGhost(null);
      ctx.setInsertLine(null);
      if (!drop) {
        ctx.setStatus('Drop inside the frame to place it.');
        return;
      }
      const r = ctx.apply({ op: 'add_node', ...spec.op, ...drop });
      if (r.ok) {
        ctx.setStatus(`${spec.label} added.`);
        ctx.activateSelect();
        ctx.render();
      }
    }

    return {
      id: spec.id,
      label: spec.label,
      icon: spec.icon,
      shortcut: spec.shortcut,
      placeable: true,
      hint: spec.hint,
      onHover(p) {
        preview(p);
      },
      onDown(p) {
        place(p);
        return true;
      },
      onPlace(p) {
        place(p);
      },
      onCancel() {
        ctx.setGhost(null);
        ctx.setInsertLine(null);
      },
    };
  });

  return [select, ...frameTools, ...placeTools];
}

/** Palette layout: Select, a Frame flyout (desktop/tablet/mobile), then the
 *  element tools in order. */
export function uiPaletteItems(tools: Tool[]): PaletteItemSpec[] {
  const spec = (t: Tool): PaletteItemSpec => ({
    toolId: t.id,
    label: t.label,
    icon: t.icon,
    shortcut: t.shortcut,
    placeable: t.placeable,
  });
  const byId = (id: string) => tools.find((t) => t.id === id)!;
  return [
    spec(byId('select')),
    {
      toolId: 'frame-group',
      label: 'Frame',
      icon: '⬚',
      shortcut: 'a',
      group: FRAME_TOOLS.map((f) => spec(byId(f.id))),
    },
    ...PLACEABLES.map((p) => spec(byId(p.id))),
  ];
}
