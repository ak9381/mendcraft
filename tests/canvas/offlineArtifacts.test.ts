// @vitest-environment happy-dom
// Offline: everything she approved comes back from the artifact store with no
// network call; a Gemini-only ask waits for the connection and says so; a
// proposal still waiting for Approve is never stored; and asks saved for two
// languages run one at a time when the connection is back.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { createReplayEngines } from '../../src/canvas/replayEngine';
import { coerceLayout, joinCanvasDoc, splitCanvasDoc } from '../../src/canvas/canvasPersistence';
import { createMemoryArtifactStore, loadArtifacts } from '../../src/artifacts/store';
import { LANG_STRING_KEYS, type LanguagePack } from '../../src/canvas/languagePack';
import { CANVAS_DOC_VERSION, type CanvasDoc } from '../../src/canvas/frames';
import type { Artifact } from '../../src/artifacts/artifact';
import { KN_PACK } from '../helpers/knPack';

const DRAWING = { walls: [{ id: 'w1', a: { x: 0, y: 0 }, b: { x: 3, y: 0 }, thickness: 0.1 }], openings: [], rooms: [], dims: [], fixtures: [], texts: [], selectedId: null, selectedIds: [] };
const startDoc = (): CanvasDoc => ({
  version: CANVAS_DOC_VERSION, camera: { x: 0, y: 0, z: 1 }, focusId: null,
  frames: [
    { id: 'f1', kind: 'room', title: 'Desk', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false },
    { id: 'f2', kind: 'plan', title: 'Floor plan', rect: { x: 1160, y: 0, w: 1000, h: 680 }, pinned: false },
  ],
  surfaces: {
    f1: { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'Temperature', value: '21 °C' }] },
    f2: { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'f2-cad', template: 'blank' }] },
  },
  drawings: { f2: { 'f2-cad': DRAWING } },
  lang: 'kn', pack: KN_PACK,
});
const packOf = (lang: string, word: string): LanguagePack => ({ lang, strings: Object.fromEntries(LANG_STRING_KEYS.map((k) => [k, word])) as LanguagePack['strings'], phrases: {} });

let handle: CanvasHandle | null = null;
let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  fetchSpy = vi.fn(async () => { throw new Error('offline'); });
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; vi.unstubAllGlobals(); });
function mount(opts: Parameters<typeof mountCanvas>[1] = {}): { h: CanvasHandle; root: HTMLElement } {
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, ...opts });
  return { h: handle, root };
}
const said = (h: CanvasHandle, line: string): boolean => h.statusSince(0).some((t) => t.includes(line));
const reviewTitle = (root: HTMLElement): string => root.querySelector<HTMLElement>('.mc-review-dialog:not([hidden]) .mc-review-title')?.textContent ?? '';

describe('offline artifacts', () => {
  it('offline: boards, the plan drawing and the pack load from the store with no network call', async () => {
    // What a session approved, split and stored the way canvasMain stores it.
    const { layout, put } = splitCanvasDoc(startDoc(), [], () => 'gemini', 5000);
    const store = createMemoryArtifactStore(put);
    const loaded = await loadArtifacts(store);
    expect(loaded.dropped).toEqual([]);
    const doc = joinCanvasDoc(coerceLayout(JSON.parse(JSON.stringify(layout))), loaded.ok);
    const { h, root } = mount({ online: false, doc, packs: loaded.ok.filter((a) => a.kind === 'pack'), artifactStore: store });
    expect(h.frames().map((f) => f.title)).toEqual(['Desk', 'Floor plan']);
    expect(h.snapshot().surfaces.f1?.tiles).toHaveLength(1);
    expect(h.snapshot().drawings?.f2?.['f2-cad']).toMatchObject({ walls: [{ id: 'w1' }] });
    expect(root.querySelector('[data-i18n=showEverything]')?.textContent?.trim()).toBe(KN_PACK.strings.showEverything);
    expect(root.querySelector('[data-cmd=offline]')?.getAttribute('aria-pressed')).toBe('true');
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('offline: a Gemini-only ask is queued and says so; a pending proposal is not stored', async () => {
    const store = createMemoryArtifactStore();
    let prev: Artifact[] = [];
    const saves: CanvasDoc[] = [];
    const study = JSON.stringify({ kind: 'room', title: 'Study', tiles: [{ type: 'stat', label: 'Temperature', value: '21 °C' }] });
    const { h, root } = mount({
      online: false, artifactStore: store, engines: createReplayEngines({ 'nano.board': study }),
      onPersist: (d) => {
        saves.push(d);
        const out = splitCanvasDoc(d, prev, () => 'nano', Date.now());
        for (const a of out.put) void store.put(a);
        prev = [...prev.filter((a) => !out.put.some((p) => p.id === a.id)), ...out.put];
      },
    });
    h.run('add Hindi');
    await vi.waitFor(() => expect(said(h, "Writing a Hindi pack needs Gemini, and you are offline. I'll ask Gemini when you're back online. Nothing changed.")).toBe(true));
    h.run('new board');
    const id = h.frames()[0].id;
    h.run('connect everything in this room');
    await vi.waitFor(() => expect(reviewTitle(root)).not.toBe(''), { timeout: 8000 });
    h.save();
    await new Promise((r) => setTimeout(r, 300));
    expect(saves.length).toBeGreaterThan(0);
    expect(saves.every((d) => !d.surfaces[id])).toBe(true);
    expect((await store.list()).filter((a) => a.kind === 'board')).toEqual([]);
    expect((await store.list()).filter((a) => a.kind === 'pack')).toEqual([]);
  });

  it('two languages asked offline run one at a time on reconnect; the second is not lost', async () => {
    const packs: Record<string, LanguagePack> = { hi: packOf('hi', 'सब दिखाओ'), ta: packOf('ta', 'எல்லாம் காட்டு') };
    const asked: string[] = [];
    const gemini = (_kind: string, sub?: string) => ({
      id: 'gemini' as const, sim: false,
      stream: async () => { asked.push(sub ?? ''); return JSON.stringify(packs[sub ?? ''] ?? {}); },
    });
    const { h, root } = mount({ online: false, engines: { gemini } });
    h.run('add Hindi');
    h.run('add Tamil');
    expect(asked).toEqual([]);
    root.querySelector<HTMLElement>('[data-cmd=offline]')!.click(); // back online
    await vi.waitFor(() => expect(reviewTitle(root)).toBe('Add Hindi'), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 700));
    expect(asked).toEqual(['hi']); // the second waits for this review
    expect(h.statusSince(0).some((t) => t.startsWith('Finish the review first'))).toBe(false);
    h.keep();
    await vi.waitFor(() => expect(reviewTitle(root)).toBe('Add Tamil'), { timeout: 8000 });
    expect(asked).toEqual(['hi', 'ta']);
    h.drop();
    await vi.waitFor(() => expect(said(h, 'Kept Hindi. Nothing changed.')).toBe(true));
    expect(h.statusSince(0).some((t) => t.startsWith('Finish the review first'))).toBe(false);
  });
});
