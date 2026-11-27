// @vitest-environment happy-dom
// A board a laptop sends to a phone arrives as relay wire JSON. The phone
// re-checks it (coerceSnapshot → coerceSurfacePlan → coerceControls), shows it,
// and keeps it as a `board` artifact made by whoever made it on the laptop.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { applyGuestSnapshot } from '../../src/canvas/phoneCanvasRuntime';
import { buildControlSnapshot, coerceSnapshot } from '../../src/relay/controlSnapshot';
import { joinCanvasDoc, splitCanvasDoc } from '../../src/canvas/canvasPersistence';
import { board as sampleBoard } from '../artifacts/sample';
import { coerceArtifact, frameIdOfArtifactId, type Artifact } from '../../src/artifacts/artifact';
import type { CanvasDoc } from '../../src/canvas/frames';

const LAMP = 'wiz-lamp-1';
/** A generated lamp board, as the laptop approved it. */
const BOARD = {
  kind: 'room', title: 'Lamp',
  tiles: [{
    type: 'lamp', deviceId: LAMP, label: 'Lamp',
    controls: [
      { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } },
      { kind: 'chips', label: 'Brightness', options: [{ label: 'Dim', intent: { brightness: 20 } }, { label: 'Full', intent: { brightness: 100 } }] },
    ],
  }],
};

let handle: CanvasHandle | null = null;
function phone(saved: CanvasDoc[]): { h: CanvasHandle; root: HTMLElement } {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, phoneShell: true, onPersist: (d) => saved.push(d) });
  return { h: handle, root };
}
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });

/** What the laptop puts on the relay (built, then serialized as on the wire). */
function wire(board: unknown, extra: Record<string, unknown> = {}): unknown {
  return JSON.parse(JSON.stringify({ ...buildControlSnapshot({ rev: 3, board, boardFor: 'ios', boardBy: 'gemini' }), ...extra }));
}
/** The phone's own save of what it shows: the same split canvasMain stores. */
function stored(h: CanvasHandle, doc: CanvasDoc | undefined): Artifact[] {
  if (!doc) return [];
  return splitCanvasDoc(doc, [], (id) => h.receivedBy(frameIdOfArtifactId(id) ?? '') ?? 'person', 5000).put;
}
const receive = (h: CanvasHandle, raw: unknown): boolean => {
  const snap = coerceSnapshot(raw);
  return !!snap && applyGuestSnapshot(snap, h.showRemoteBoard, 'ios');
};

describe('a board received on the phone', () => {
  it('a received board is coerced again and stored as a board artifact on the phone', async () => {
    const saved: CanvasDoc[] = [];
    const { h } = phone(saved);
    expect(receive(h, wire(BOARD))).toBe(true);
    await vi.waitFor(() => expect(saved.at(-1)?.frames.length).toBe(1), { timeout: 8000 });
    const put = stored(h, saved.at(-1));
    const boards = put.filter((a) => a.kind === 'board');
    expect(boards).toHaveLength(1);
    // Made by the laptop's engine, not by her on the phone.
    expect(boards[0].by).toBe('gemini');
    expect(coerceArtifact(boards[0]).ok).toBe(true);
    const tile = (boards[0].data as { plan: { tiles: { controls?: unknown[] }[] } }).plan.tiles[0];
    expect(tile.controls).toHaveLength(2);
    // Until she edits it here, the board stays the laptop engine's.
    expect(h.receivedBy(h.frames()[0].id)).toBe('gemini');
  });

  it('a received board with controls for a device the phone cannot reach shows them as Not connected', async () => {
    const { h, root } = phone([]);
    expect(h.store.get(LAMP)).toBeUndefined();
    expect(receive(h, wire(BOARD))).toBe(true);
    const text = (): string => [...root.querySelectorAll('mc-device-tile')].map((t) => (t.shadowRoot?.textContent ?? '') + t.textContent).join(' ');
    await vi.waitFor(() => expect(text()).toContain('Not connected'), { timeout: 3000 });
  });

  it('a received board with a forged out-of-range control loses that control', async () => {
    const saved: CanvasDoc[] = [];
    const { h } = phone(saved);
    // Forged on the wire, after the laptop's own check.
    const raw = wire(BOARD) as { board: typeof BOARD };
    (raw.board.tiles[0].controls[1] as { options: unknown[] }).options.push({ label: 'Blast', intent: { brightness: 500 } });
    raw.board.tiles[0].controls.push({ kind: 'button', label: 'Max', intent: { brightness: 900 } } as never);
    expect(receive(h, raw)).toBe(true);
    await vi.waitFor(() => expect(saved.at(-1)?.frames.length).toBe(1), { timeout: 8000 });
    const plan = h.snapshot().surfaces[h.frames()[0].id];
    const json = JSON.stringify(plan);
    expect(json).not.toContain('Blast');
    expect(json).not.toContain('Max');
    expect(json).toContain('Full');
    const board = stored(h, saved.at(-1)).find((a) => a.kind === 'board');
    expect(JSON.stringify(board?.data)).not.toMatch(/Blast|Max|500|900/);
  });

  it('a received payload that is not a plan stores nothing', async () => {
    const saved: CanvasDoc[] = [];
    const { h } = phone(saved);
    for (const junk of [{ kind: 'room', tiles: 'nope' }, '<script>x</script>', 42, { kind: 'room', title: 'X', tiles: [{ type: 'eval', code: '1' }] }]) {
      expect(receive(h, wire(junk))).toBe(false);
    }
    expect(receive(h, 'not a snapshot')).toBe(false);
    h.save();
    await new Promise((r) => setTimeout(r, 400));
    expect(h.frames()).toEqual([]);
    expect(saved.flatMap((d) => stored(h, d)).filter((a) => a.kind === 'board')).toEqual([]);
  });
});

describe('the laptop sends only a board that says who made it', () => {
  type Win = { __mcLastBoardSnapshot?: { board?: unknown; boardBy?: string; boardFor?: string } };
  async function laptop(by: 'gemini' | undefined): Promise<{ h: CanvasHandle; saved: CanvasDoc[] }> {
    delete (window as Win).__mcLastBoardSnapshot;
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const saved: CanvasDoc[] = [];
    const doc = joinCanvasDoc(null, [sampleBoard('f1', { title: 'Desk' })]) as CanvasDoc;
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, { autoHands: false, reducedMotion: true, sim: true, connector: { run: async () => ({}) }, doc, onPersist: (d) => saved.push(d), artifactBy: () => by });
    const h = handle;
    // Two SIM phones (dev/test build + sim), then back to the stored board.
    h.run('connect devices');
    await vi.waitFor(() => expect(h.edgeLayout().right).toBeTruthy(), { timeout: 18000 });
    await h.focus('f1');
    return { h, saved };
  }

  it('a board with no known maker is not sent, and the laptop says so', async () => {
    const { h } = await laptop(undefined);
    const mark = h.statusMark();
    expect(await h.sendBoard('right')).toBe(false);
    expect(h.statusSince(mark)).toContain("Couldn't send the board — it doesn't say who made it. Nothing was sent.");
    expect((window as Win).__mcLastBoardSnapshot?.board).toBeUndefined();
  }, 45000);

  it('a board with a maker goes with it', async () => {
    const { h } = await laptop('gemini');
    expect(await h.sendBoard('right')).toBe(true);
    const snap = (window as Win).__mcLastBoardSnapshot;
    expect(snap?.board).toBeTruthy();
    expect(snap?.boardBy).toBe('gemini');
  }, 45000);

  it('pairing makes no fixed devices table: only her board is on the canvas and stored', async () => {
    const { h, saved } = await laptop('gemini');
    expect(h.frames().map((f) => f.title)).not.toContain('Connected devices');
    h.save();
    await vi.waitFor(() => expect(saved.length).toBeGreaterThan(0), { timeout: 8000 });
    expect(saved.at(-1)?.frames.map((f) => f.id)).toEqual(['f1']);
  }, 45000);
});

describe('a phone shows each board once (ported from sim-main remote-dedup)', () => {
  const FP = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'fx-cad', template: 'blank' }] };
  const rect = { x: 0, y: 0, w: 1000, h: 680 };
  it('a received board carries the received mark into the saved layout', async () => {
    const saved: CanvasDoc[] = [];
    const { h } = phone(saved);
    expect(receive(h, wire(BOARD))).toBe(true);
    await vi.waitFor(() => expect(saved.at(-1)?.frames.length).toBe(1), { timeout: 8000 });
    expect(saved.at(-1)!.frames[0].from).toBe('laptop');
    expect(splitCanvasDoc(saved.at(-1)!, [], () => 'person', 1).layout.frames[0].from).toBe('laptop');
  });
  it('the same board received again goes to the frame already showing it, and a copy goes', async () => {
    const saved: CanvasDoc[] = [];
    const layout = { version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1', frames: [
      { id: 'f1', kind: 'note' as const, title: 'Notes', rect, pinned: false },
      { id: 'f2', kind: 'plan' as const, title: 'Floor plan', rect: { ...rect, x: 1100 }, pinned: false, from: 'laptop' as const },
      { id: 'f3', kind: 'plan' as const, title: 'Floor plan', rect: { ...rect, x: 2200 }, pinned: false, from: 'laptop' as const },
    ] };
    const art = (id: string, plan: unknown, kind: string) => ({ id: `board-${id}`, kind: 'board' as const, v: 1, title: 'x', by: 'gemini' as const, at: 1, status: 'approved' as const,
      data: { frame: { kind, title: 'x', rect, pinned: false }, plan } });
    const notes = { kind: 'room', title: 'Notes', tiles: [{ type: 'stat', label: 'T', value: '1' }] };
    const doc = joinCanvasDoc(layout, [art('f1', notes, 'note'), art('f2', FP, 'plan'), art('f3', FP, 'plan')]) as CanvasDoc;
    expect(doc?.frames.length).toBe(3);
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, phoneShell: true, nativePhone: false, doc, onPersist: (d) => saved.push(d) });
    expect(handle.frames().map((f) => f.id)).toEqual(['f1', 'f2', 'f3']); // not the native app: nothing collapses on load
    expect(receive(handle, wire(FP))).toBe(true);
    await vi.waitFor(() => expect(saved.at(-1)?.frames.map((f) => f.id)).toEqual(['f1', 'f2']), { timeout: 8000 });
    expect(saved.at(-1)!.surfaces.f1).toEqual(notes); // her board was never taken for a copy
  });
  it('the native phone app collapses copies an older build saved, on load — never her own boards', () => {
    const layout = { version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null, frames: [
      { id: 'f1', kind: 'room' as const, title: 'Desk', rect, pinned: false, from: 'laptop' as const },
      { id: 'f2', kind: 'room' as const, title: 'Desk', rect: { ...rect, x: 1100 }, pinned: false, from: 'laptop' as const },
      { id: 'f3', kind: 'room' as const, title: 'Desk', rect: { ...rect, x: 2200 }, pinned: false },
      { id: 'f4', kind: 'room' as const, title: 'Desk', rect: { ...rect, x: 3300 }, pinned: false },
    ] };
    const desk = { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'T', value: '1' }] };
    const art = (id: string) => ({ id: `board-${id}`, kind: 'board' as const, v: 1, title: 'Desk', by: 'gemini' as const, at: 1, status: 'approved' as const,
      data: { frame: { kind: 'room', title: 'Desk', rect, pinned: false }, plan: desk } });
    const doc = joinCanvasDoc(layout, ['f1', 'f2', 'f3', 'f4'].map(art)) as CanvasDoc;
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, phoneShell: true, nativePhone: true, doc, onPersist: () => undefined });
    expect(handle.frames().map((f) => f.id)).toEqual(['f1', 'f3', 'f4']);
  });
});
