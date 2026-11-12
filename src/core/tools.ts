// Shared on-canvas tool framework (mode-agnostic). A palette-driven tool state
// machine fed by ONE pointer stream in client px: the renderer forwards both
// native mouse/touch events and the pinch-derived ViewportHandle calls here, so
// every tool works hands-free for free. Plan mode builds its Tool[] against
// ToolContext today; ui mode reuses the same framework with its own tools.

export interface ToolPointer {
  /** Client (CSS px) coordinates, same space as MouseEvent.clientX/Y. */
  x: number;
  y: number;
  source: 'mouse' | 'pinch';
}

/** Transient feedback layer the active tool draws into (screen px). The host
 *  renderer re-runs the registered draw callback after every render. */
export interface OverlayDraw {
  line(a: { x: number; y: number }, b: { x: number; y: number }, color?: string, width?: number, dash?: string): void;
  dot(p: { x: number; y: number }, color?: string, r?: number): void;
  label(p: { x: number; y: number }, text: string, color?: string): void;
  rect(a: { x: number; y: number }, b: { x: number; y: number }, stroke?: string, fill?: string): void;
}

/** Everything a tool needs from its host renderer/controller. Mode-agnostic:
 *  world points are generic {x,y} (mm for plan, px for ui). */
export interface ToolContext {
  /** Apply a raw op through the mode controller (validated + undoable). */
  apply(op: unknown): { ok: boolean; error?: string };
  toWorld(clientX: number, clientY: number): { x: number; y: number };
  toScreen(p: { x: number; y: number }): { x: number; y: number };
  /** Screen px per world unit (for pixel-based capture radii). */
  scale(): number;
  pick(clientX: number, clientY: number): string | null;
  select(id: string | null): void;
  selectedId(): string | null;
  snapshot(): unknown;
  render(): void;
  /** Register (or clear) the transient overlay draw callback + redraw. */
  setOverlay(draw: ((ov: OverlayDraw) => void) | null): void;
  /** One-line hint under the canvas ("Click to start a wall…"). */
  setStatus(text: string): void;
  /** Trash-zone hit test + hover highlight (drag-to-delete). */
  overTrash(clientX: number, clientY: number): boolean;
  setTrashHover(on: boolean): void;
}

export interface Tool {
  id: string;
  label: string;
  /** Short glyph for the palette button. */
  icon: string;
  /** e.g. 'w' or 'shift+m' (displayed in the tooltip). */
  shortcut: string;
  /** Palette item supports press-drag-release placement onto the canvas. */
  placeable?: boolean;
  /** Placeholder tool (not implemented yet) — palette marks it. */
  stub?: boolean;
  hint?: string;
  onActivate?(): void;
  onDeactivate?(): void;
  /** Return true when the tool consumed the press (false → host may pan). */
  onDown?(p: ToolPointer): boolean;
  onMove?(p: ToolPointer): void;
  /** Pointer travels with no button/pinch held (ghost previews). */
  onHover?(p: ToolPointer): void;
  onUp?(p: ToolPointer): void;
  /** Tool-specific keys (Enter finish, …). Return true if consumed. */
  onKey?(e: KeyboardEvent): boolean;
  /** Esc / tool switch: abort any in-progress gesture. */
  onCancel?(): void;
  /** Palette pick-and-place released over the canvas. */
  onPlace?(p: ToolPointer): void;
}

/** Does a keydown match a 'shift+m' style shortcut? Ctrl/Alt/Meta never match
 *  plain shortcuts so browser/app chords stay untouched. Pure + unit-tested. */
export function matchesShortcut(
  e: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  shortcut: string,
): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const parts = shortcut.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  const wantShift = parts.includes('shift');
  if (e.shiftKey !== wantShift) return false;
  return e.key.toLowerCase() === key;
}

export interface ToolController {
  tools: Tool[];
  activeId(): string;
  active(): Tool;
  activate(id: string): void;
  /** Palette press-drag placement: arm the tool and track a ghost until up. */
  beginPlace(id: string, p: ToolPointer): void;
  placing(): boolean;
  down(p: ToolPointer): boolean;
  move(p: ToolPointer): void;
  hover(p: ToolPointer): void;
  up(p: ToolPointer): void;
  /** Esc, tool shortcuts, then active-tool keys. True if consumed. */
  handleKey(e: KeyboardEvent): boolean;
  cancel(): void;
}

export function createToolController(
  tools: Tool[],
  opts: { defaultId: string; onToolChange?: (id: string) => void },
): ToolController {
  let activeId = opts.defaultId;
  let placingTool: Tool | null = null;
  let downConsumed = false;

  const byId = (id: string) => tools.find((t) => t.id === id);
  const active = () => byId(activeId) ?? tools[0];

  function activate(id: string): void {
    const next = byId(id);
    if (!next) return;
    if (id !== activeId) {
      active().onCancel?.();
      active().onDeactivate?.();
    }
    activeId = id;
    next.onActivate?.();
    opts.onToolChange?.(id);
  }

  return {
    tools,
    activeId: () => activeId,
    active,
    activate,
    beginPlace(id, p) {
      activate(id);
      placingTool = byId(id) ?? null;
      placingTool?.onHover?.(p);
    },
    placing: () => placingTool !== null,
    down(p) {
      downConsumed = active().onDown?.(p) ?? false;
      return downConsumed;
    },
    move(p) {
      if (placingTool) {
        placingTool.onHover?.(p);
        return;
      }
      if (downConsumed) active().onMove?.(p);
    },
    hover(p) {
      (placingTool ?? active()).onHover?.(p);
    },
    up(p) {
      if (placingTool) {
        placingTool.onPlace?.(p);
        placingTool = null;
        return;
      }
      if (downConsumed) active().onUp?.(p);
      downConsumed = false;
    },
    handleKey(e) {
      if (e.key === 'Escape') {
        placingTool = null;
        active().onCancel?.();
        return true;
      }
      if (active().onKey?.(e)) return true;
      if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        for (const t of tools) {
          if (matchesShortcut(e, t.shortcut)) {
            activate(t.id);
            return true;
          }
        }
      }
      return false;
    },
    cancel() {
      placingTool = null;
      active().onCancel?.();
    },
  };
}
