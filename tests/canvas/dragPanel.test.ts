import { describe, expect, it } from 'vitest';
import { clampToViewport, loadPanelPos, savePanelPos, clearPanelPos, mountDraggablePanel, type DragPanelElement, type DragHandleElement, type PointerLikeEvent } from '../../src/canvas/dragPanel';

describe('clampToViewport', () => {
  it('leaves an on-screen panel alone', () => {
    expect(clampToViewport({ left: 100, top: 100 }, { width: 300, height: 200 }, { width: 1000, height: 800 })).toEqual({ left: 100, top: 100 });
  });
  it('pulls a panel back onto screen from past any edge', () => {
    expect(clampToViewport({ left: -500, top: -500 }, { width: 300, height: 200 }, { width: 1000, height: 800 })).toEqual({ left: 8, top: 8 });
    expect(clampToViewport({ left: 5000, top: 5000 }, { width: 300, height: 200 }, { width: 1000, height: 800 })).toEqual({ left: 692, top: 592 });
  });
  it('centers a panel bigger than the viewport instead of pinning two opposite edges', () => {
    // margin-only clamp on an oversized panel: both edges collapse to the margin.
    expect(clampToViewport({ left: 0, top: 0 }, { width: 2000, height: 2000 }, { width: 1000, height: 800 })).toEqual({ left: 8, top: 8 });
  });
});

describe('panel position persistence', () => {
  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      clear: () => m.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  }
  it('round-trips a saved position', () => {
    const s = memoryStorage();
    expect(loadPanelPos(s, 'nano')).toBeNull();
    savePanelPos(s, 'nano', { left: 40, top: 60 });
    expect(loadPanelPos(s, 'nano')).toEqual({ left: 40, top: 60 });
    expect(loadPanelPos(s, 'gemini')).toBeNull(); // separate key per panel id
    clearPanelPos(s, 'nano');
    expect(loadPanelPos(s, 'nano')).toBeNull();
  });
  it('treats a corrupt stored value as absent rather than throwing', () => {
    const s = memoryStorage();
    s.setItem('mc.panelPos.nano', 'not json');
    expect(loadPanelPos(s, 'nano')).toBeNull();
  });
  it('a storage that throws (private mode) never breaks the caller', () => {
    const angry: Storage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); },
      clear: () => {}, key: () => null, length: 0,
    } as Storage;
    expect(() => savePanelPos(angry, 'nano', { left: 1, top: 1 })).not.toThrow();
    expect(loadPanelPos(angry, 'nano')).toBeNull();
    expect(() => clearPanelPos(angry, 'nano')).not.toThrow();
  });
});

describe('mountDraggablePanel', () => {
  function makePanel(initialRect = { left: 300, top: 120, width: 400, height: 240 }) {
    const classes = new Set<string>();
    const style = { left: '', top: '', height: '' };
    const panel: DragPanelElement = {
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
      style,
      getBoundingClientRect: () => ({
        ...initialRect,
        left: style.left ? parseFloat(style.left) : initialRect.left,
        top: style.top ? parseFloat(style.top) : initialRect.top,
      }),
      before: () => {},
    };
    return { panel, classes, style };
  }

  function makeHandle(): DragHandleElement & { fire(type: string, e: PointerLikeEvent): void } {
    const listeners: Record<string, ((e: PointerLikeEvent) => void)[]> = {};
    return {
      addEventListener(type, fn) { (listeners[type] ??= []).push(fn); },
      removeEventListener(type, fn) { listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn); },
      setPointerCapture() {},
      fire(type, e) { (listeners[type] ?? []).forEach((fn) => fn(e)); },
    };
  }

  function memoryStorage(): Storage {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k),
      clear: () => m.clear(), key: () => null, length: 0,
    } as Storage;
  }

  it('starts docked (not floating) until the first drag', () => {
    const { panel } = makePanel();
    const handle = makeHandle();
    const dock = mountDraggablePanel(panel, handle, { id: 'nano', storage: memoryStorage(), win: { innerWidth: 1280, innerHeight: 800 } });
    expect(dock.floating).toBe(false);
  });

  it('drags: pointerdown then pointermove by a delta moves the panel by that delta, clamped on screen', () => {
    const { panel, classes, style } = makePanel({ left: 300, top: 120, width: 400, height: 240 });
    const handle = makeHandle();
    const dock = mountDraggablePanel(panel, handle, { id: 'nano', storage: memoryStorage(), win: { innerWidth: 1280, innerHeight: 800 } });
    handle.fire('pointerdown', { clientX: 320, top: 0, clientY: 140 } as never);
    expect(dock.floating).toBe(true);
    expect(classes.has('is-floating')).toBe(true);
    handle.fire('pointermove', { clientX: 370, clientY: 190 } as never); // +50,+50
    expect(style.left).toBe('350px');
    expect(style.top).toBe('170px');
    handle.fire('pointerup', { clientX: 370, clientY: 190 } as never);
  });

  it('clamps a drag that would push the panel off screen', () => {
    const { panel, style } = makePanel({ left: 300, top: 120, width: 400, height: 240 });
    const handle = makeHandle();
    mountDraggablePanel(panel, handle, { id: 'nano', storage: memoryStorage(), win: { innerWidth: 1000, innerHeight: 800 } });
    handle.fire('pointerdown', { clientX: 300, clientY: 120 } as never);
    handle.fire('pointermove', { clientX: 3000, clientY: 3000 } as never); // way past the edge
    expect(style.left).toBe('592px'); // 1000 - 400 - 8
    expect(style.top).toBe('552px'); // 800 - 240 - 8
  });

  it('persists the dropped position and restores it on the next mount (same session)', () => {
    const storage = memoryStorage();
    const { panel: panelA } = makePanel({ left: 300, top: 120, width: 400, height: 240 });
    const handleA = makeHandle();
    mountDraggablePanel(panelA, handleA, { id: 'nano', storage, win: { innerWidth: 1280, innerHeight: 800 } });
    handleA.fire('pointerdown', { clientX: 300, clientY: 120 } as never);
    handleA.fire('pointermove', { clientX: 320, clientY: 150 } as never);
    handleA.fire('pointerup', { clientX: 320, clientY: 150 } as never);

    const { panel: panelB, style: styleB } = makePanel({ left: 999, top: 999, width: 400, height: 240 });
    const handleB = makeHandle();
    const dockB = mountDraggablePanel(panelB, handleB, { id: 'nano', storage, win: { innerWidth: 1280, innerHeight: 800 } });
    expect(dockB.floating).toBe(true);
    expect(styleB.left).toBe('320px');
    expect(styleB.top).toBe('150px');
  });

  it('resetPosition undocks back to the flow and clears the saved spot', () => {
    const storage = memoryStorage();
    const { panel, classes, style } = makePanel();
    const handle = makeHandle();
    const dock = mountDraggablePanel(panel, handle, { id: 'gemini', storage, win: { innerWidth: 1280, innerHeight: 800 } });
    handle.fire('pointerdown', { clientX: 300, clientY: 120 } as never);
    handle.fire('pointermove', { clientX: 340, clientY: 160 } as never);
    handle.fire('pointerup', { clientX: 340, clientY: 160 } as never);
    expect(dock.floating).toBe(true);
    dock.resetPosition();
    expect(dock.floating).toBe(false);
    expect(classes.has('is-floating')).toBe(false);
    expect(style.left).toBe('');
    expect(style.top).toBe('');
    expect(loadPanelPos(storage, 'gemini')).toBeNull();
  });

  it('a pointercancel ends the drag like pointerup (no stuck drag state)', () => {
    const { panel, style } = makePanel();
    const handle = makeHandle();
    mountDraggablePanel(panel, handle, { id: 'nano', win: { innerWidth: 1280, innerHeight: 800 } });
    handle.fire('pointerdown', { clientX: 300, clientY: 120 } as never);
    handle.fire('pointermove', { clientX: 320, clientY: 140 } as never);
    handle.fire('pointercancel', { clientX: 320, clientY: 140 } as never);
    const before = style.left;
    handle.fire('pointermove', { clientX: 900, clientY: 900 } as never); // ignored: no drag in progress
    expect(style.left).toBe(before);
  });
});
