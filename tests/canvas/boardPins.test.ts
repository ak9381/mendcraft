// @vitest-environment happy-dom
// Pin state on the wire: every board snapshot says which board each phone
// holds (`pins`). A phone whose pin is null takes the boards it received from
// the laptop off (frame, surface, drawings and its stored artifacts) and
// keeps the boards she made on it. The laptop keeps its pins across a reload.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { applyGuestSnapshot } from '../../src/canvas/phoneCanvasRuntime';
import { buildControlSnapshot, coerceSnapshot } from '../../src/relay/controlSnapshot';
import { joinCanvasDoc, splitCanvasDoc } from '../../src/canvas/canvasPersistence';
import { board as sampleBoard } from '../artifacts/sample';
import type { CanvasDoc } from '../../src/canvas/frames';
import { PINS_KEY } from '../../src/canvas/edgeTransfer';

const STATUS = { kind: 'room', title: 'Status board', tiles: [{ type: 'stat', label: 'Lamps', value: '2 on' }] };

let handle: CanvasHandle | null = null;
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; try { localStorage.clear(); } catch { /* none */ } });
const mm = (): void => { if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} }); };

function phone(saved: CanvasDoc[], doc?: CanvasDoc): CanvasHandle {
  mm();
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, phoneShell: true, nativePhone: false, ...(doc ? { doc } : {}), onPersist: (d) => saved.push(d) });
  return handle;
}
const wire = (o: Record<string, unknown>): unknown => JSON.parse(JSON.stringify(buildControlSnapshot({ rev: 1, ...o })));
const receive = (h: CanvasHandle, raw: unknown): boolean => {
  const snap = coerceSnapshot(raw);
  return !!snap && applyGuestSnapshot(snap, h.showRemoteBoard, 'android', undefined, undefined, () => { h.clearRemoteBoards(); });
};

describe('a phone follows the laptop\'s pins', () => {
  it('a sent board shows; pins null takes it off (frame, surface, saved board) and her own board stays', async () => {
    const saved: CanvasDoc[] = [];
    const mine = { version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1', frames: [{ id: 'f1', kind: 'note' as const, title: 'My notes', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }] };
    const notes = { kind: 'room', title: 'My notes', tiles: [{ type: 'stat', label: 'Mine', value: '1' }] };
    const doc = joinCanvasDoc(mine, [{ id: 'board-f1', kind: 'board', v: 1, title: 'My notes', by: 'person', at: 1, status: 'approved', data: { frame: { kind: 'note', title: 'My notes', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }, plan: notes } }] as never) as CanvasDoc;
    const h = phone(saved, doc);
    expect(receive(h, wire({ board: STATUS, boardFor: 'android', boardBy: 'gemini', pins: { ios: null, android: 'f7' }, boardPin: 'f7' }))).toBe(true);
    await vi.waitFor(() => expect(h.frames().map((f) => f.title)).toContain('Status board'));
    const recvId = h.frames().find((f) => f.title === 'Status board')!.id;
    expect(h.isReceivedFrame(recvId)).toBe(true);
    h.save();
    await vi.waitFor(() => expect(saved.at(-1)?.frames.length).toBe(2), { timeout: 8000 });
    const before = saved.at(-1)!;
    const prev = splitCanvasDoc(before, [], () => 'gemini', 1).put;

    // Brought back on the laptop: pins.android is null.
    expect(receive(h, wire({ rev: 2, pins: { ios: null, android: null } }))).toBe(false);
    expect(h.frames().map((f) => f.title)).toEqual(['My notes']);
    expect(h.snapshot().surfaces[recvId]).toBeUndefined();
    expect(h.isReceivedFrame(recvId)).toBe(false);
    await vi.waitFor(() => expect(saved.at(-1)?.frames.map((f) => f.id)).toEqual(['f1']), { timeout: 8000 });
    const after = splitCanvasDoc(saved.at(-1)!, prev, () => 'person', 2);
    expect(after.remove).toContain(`board-${recvId}`);
    expect(after.remove).not.toContain('board-f1');

    // Reload the phone from what it saved: the board is still gone.
    h.destroy(); handle = null;
    const again = phone([], saved.at(-1)!);
    expect(again.frames().map((f) => f.title)).toEqual(['My notes']);
    // The laptop republishes (still nothing pinned here): nothing changes.
    expect(receive(again, wire({ rev: 3, pins: { ios: null, android: null } }))).toBe(false);
    expect(again.frames().map((f) => f.title)).toEqual(['My notes']);
  });

  it('a board pinned for another pin id is refused; the other phone\'s board never shows here', () => {
    const h = phone([]);
    expect(receive(h, wire({ board: STATUS, boardFor: 'android', boardBy: 'gemini', pins: { ios: null, android: 'f2' }, boardPin: 'f9' }))).toBe(false);
    expect(receive(h, wire({ board: STATUS, boardFor: 'ios', boardBy: 'gemini', pins: { ios: 'f9', android: 'f2' }, boardPin: 'f9' }))).toBe(false);
    expect(h.frames()).toEqual([]);
  });
});

describe('the laptop puts its pins on every board snapshot', () => {
  type Win = { __mcLastBoardSnapshot?: { board?: unknown; boardFor?: string; pins?: unknown; boardPin?: string } };
  async function laptop(): Promise<CanvasHandle> {
    delete (window as Win).__mcLastBoardSnapshot;
    mm();
    const doc = joinCanvasDoc(null, [sampleBoard('f1', { title: 'Desk' })]) as CanvasDoc;
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, { autoHands: false, reducedMotion: true, sim: true, connector: { run: async () => ({}) }, doc, artifactBy: () => 'gemini' });
    const h = handle;
    h.run('connect devices');
    await vi.waitFor(() => expect(h.edgeLayout().right).toBeTruthy(), { timeout: 18000 });
    await h.focus('f1');
    return h;
  }

  it('a send sets that phone\'s pin and stores it; a reloaded laptop still carries it', async () => {
    let h = await laptop();
    const right = h.edgeLayout().right!;
    expect(await h.sendBoard('right')).toBe(true);
    const snap = (window as Win).__mcLastBoardSnapshot!;
    expect(snap.boardFor).toBe(right);
    expect(snap.pins).toEqual(right === 'ios' ? { ios: 'f1', android: null } : { ios: null, android: 'f1' });
    expect(snap.boardPin).toBe('f1');
    expect(JSON.parse(localStorage.getItem(PINS_KEY) ?? 'null')).toEqual(snap.pins);

    // Reload: the stored pin is read back; the next republish carries it.
    h.destroy(); handle = null;
    h = await laptop();
    delete (window as Win).__mcLastBoardSnapshot;
    h.run('swap phone sides');
    await vi.waitFor(() => expect((window as Win).__mcLastBoardSnapshot).toBeTruthy());
    const re = (window as Win).__mcLastBoardSnapshot!;
    expect(re.pins).toEqual(snap.pins);
    expect(re.boardFor).toBe(right);
    expect(re.boardPin).toBe('f1');
  }, 60000);
});
