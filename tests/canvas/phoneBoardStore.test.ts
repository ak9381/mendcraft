// @vitest-environment happy-dom
// A board a laptop sends to a phone arrives as relay wire JSON. The phone
// re-checks it (coerceSnapshot → coerceSurfacePlan → coerceControls), shows it,
// and keeps it as a `board` artifact made by whoever made it on the laptop.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { applyGuestSnapshot } from '../../src/canvas/phoneCanvasRuntime';
import { buildControlSnapshot, coerceSnapshot } from '../../src/relay/controlSnapshot';
import { splitCanvasDoc } from '../../src/canvas/canvasPersistence';
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
    await vi.waitFor(() => expect(saved.at(-1)?.frames.length).toBe(1));
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
    await vi.waitFor(() => expect(saved.at(-1)?.frames.length).toBe(1));
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
