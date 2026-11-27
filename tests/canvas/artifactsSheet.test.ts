// @vitest-environment happy-dom
// The Artifacts sheet: every stored artifact with its kind, title, maker and
// date; Remove takes it out of the store (and its board off the canvas);
// Export writes only checked artifacts; Import checks every entry exactly as a
// load does and counts what it leaves out. Nothing in a file is ever run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENGINE_LABEL, EXPORT_FORMAT, NOT_AN_EXPORT_LINE, approvalDate, exportArtifacts, importArtifacts, mountArtifactsSheet,
} from '../../src/canvas/artifactsSheet';
import { createMemoryArtifactStore } from '../../src/artifacts/store';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { joinCanvasDoc } from '../../src/canvas/canvasPersistence';
import type { Artifact } from '../../src/artifacts/artifact';
import type { CanvasDoc } from '../../src/canvas/frames';
import { board } from '../artifacts/sample';
import { KN_PACK } from '../helpers/knPack';

const AT = Date.UTC(2026, 10, 27, 10, 0, 0);
const pack = (): Artifact => ({ id: 'pack-kn', kind: 'pack', v: 1, title: 'Language: kn', by: 'gemini', at: AT - 1000, status: 'approved', data: KN_PACK as unknown as Record<string, unknown> });
const connector = (source: string, port = 38899): Record<string, unknown> => ({
  id: 'connector-wiz-bulb', kind: 'connector', v: 1, title: 'WiZ bulb', by: 'gemini', at: AT, status: 'approved',
  data: {
    connector: {
      deviceKind: 'bulb', brand: 'WiZ', protocol: 'udp-json', source,
      discovery: { method: 'wiz-udp-broadcast', port: 38899 },
      actions: [{ id: 'on', label: 'On', request: { transport: 'udp', port, payload: { method: 'setPilot', params: { state: true } } } }],
    },
    intents: { on: { action: 'on' } },
  },
});

let handle: CanvasHandle | null = null;
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });
const flush = () => new Promise((r) => setTimeout(r, 0));

function sheetOn(store = createMemoryArtifactStore(), onChange = vi.fn()) {
  const host = document.createElement('div');
  document.body.append(host);
  const said: string[] = [];
  const sheet = mountArtifactsSheet(host, { store, onChange, say: (l) => said.push(l) });
  return { host, sheet, said, onChange, store };
}

describe('the Artifacts sheet', () => {
  it('the sheet lists kind, title, engine label and date for each artifact', async () => {
    const store = createMemoryArtifactStore([board('f1', { title: 'Desk', at: AT, by: 'replay' }), pack()]);
    const { host, sheet } = sheetOn(store);
    sheet.open();
    await vi.waitFor(() => expect(host.querySelectorAll('.mc-artifacts-row').length).toBe(2));
    const rows = [...host.querySelectorAll('.mc-artifacts-row')].map((r) => ({
      kind: r.querySelector('.mc-artifacts-kind')?.textContent, title: r.querySelector('.mc-artifacts-name')?.textContent, made: r.querySelector('.mc-artifacts-made')?.textContent,
    }));
    expect(rows[0]).toEqual({ kind: 'Board', title: 'Desk', made: `${ENGINE_LABEL.replay} · approved ${approvalDate(AT)}` });
    expect(rows[1]).toEqual({ kind: 'Language pack', title: 'Language: kn', made: `${ENGINE_LABEL.gemini} · approved ${approvalDate(AT - 1000)}` });
    expect(approvalDate(AT)).toBe('27 Nov 2026');
    expect(ENGINE_LABEL).toEqual({ nano: 'Gemini Nano · on device', gemini: 'Gemini · cloud', apple: 'Apple · on device', person: 'You', replay: 'Replay · recorded reply' });
    // Every button is a big target (the CSS gives them 56 px; here: they are buttons with text).
    for (const b of host.querySelectorAll('.mc-artifacts-sheet button')) expect((b.textContent ?? '').trim()).not.toBe('');
  });

  it('Remove deletes the artifact and the board leaves the canvas after onChange', async () => {
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const kitchen = board('f2', { title: 'Kitchen', at: AT + 1 });
    kitchen.data = { ...kitchen.data, frame: { ...(kitchen.data.frame as object), title: 'Kitchen' } };
    const rows = [board('f1', { title: 'Desk', at: AT }), kitchen];
    const store = createMemoryArtifactStore(rows);
    const doc = joinCanvasDoc(null, rows) as CanvasDoc;
    const removed: string[][] = [];
    const saved: CanvasDoc[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, {
      autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, doc,
      artifactStore: store, onArtifactsRemoved: (ids) => removed.push(ids), onPersist: (d) => saved.push(d),
    });
    expect(handle.frames().map((f) => f.title)).toEqual(['Desk', 'Kitchen']);
    handle.run('show artifacts');
    const sheetEl = root.querySelector<HTMLElement>('.mc-artifacts-sheet')!;
    expect(sheetEl.hidden).toBe(false);
    await vi.waitFor(() => expect(sheetEl.querySelectorAll('.mc-artifacts-row').length).toBe(2));
    const desk = sheetEl.querySelector<HTMLButtonElement>('[data-artifact="board-f1"] .mc-artifacts-remove')!;
    desk.click(); // the first tap only asks
    await flush();
    expect((await store.list()).length).toBe(2);
    expect(desk.textContent).toBe('Tap again to remove');
    desk.click();
    await vi.waitFor(() => expect(handle!.frames().map((f) => f.title)).toEqual(['Kitchen']));
    expect((await store.list()).map((a) => a.id)).toEqual(['board-f2']);
    expect(removed).toEqual([['board-f1']]);
    await vi.waitFor(() => expect(saved.at(-1)?.frames.map((f) => f.id)).toEqual(['f2']));
    expect(root.textContent).toContain('Removed “Desk”.');
    await vi.waitFor(() => expect(sheetEl.querySelectorAll('.mc-artifacts-row').length).toBe(1));
  });

  it('import refuses: wrong kind, 500000-char entry, connector with port 22, connector source builtin; keeps the valid board', async () => {
    const valid = board('f1', { title: 'Desk', at: AT });
    const huge = board('f9', { title: 'Huge', data: { ...valid.data, pad: 'x'.repeat(500_000) } });
    const file = JSON.stringify({
      format: EXPORT_FORMAT, version: 1,
      artifacts: [{ ...valid, id: 'script-f1', kind: 'script' }, huge, connector('cloud', 22), connector('builtin'), valid],
    });
    const got = importArtifacts(file);
    expect(got.dropped).toBe(4);
    expect(got.ok.map((a) => a.id)).toEqual(['board-f1']);
    // Through the sheet: only the valid board reaches the store, and the count is said.
    const { sheet, store, said, onChange } = sheetOn();
    await sheet.importText(file);
    expect((await store.list()).map((a) => a.id)).toEqual(['board-f1']);
    expect(said.at(-1)).toBe('Imported 1 artifact. 4 entries failed their check and were left out.');
    expect(onChange).toHaveBeenCalledTimes(1);
    // A file whose every entry fails changes nothing.
    const none = sheetOn();
    await none.sheet.importText(JSON.stringify([connector('builtin')]));
    expect(await none.store.list()).toEqual([]);
    expect(none.said.at(-1)).toBe('Nothing was imported. 1 entry failed its check and was left out. Nothing changed.');
    expect(none.onChange).not.toHaveBeenCalled();
  });

  it('import of text that is not JSON says "That file isn\'t a Mendcraft export. Nothing changed."', async () => {
    expect(NOT_AN_EXPORT_LINE).toBe("That file isn't a Mendcraft export. Nothing changed.");
    const { sheet, store, said, onChange } = sheetOn(createMemoryArtifactStore([board()]));
    for (const text of ['not json at all', '{"format":"something-else","artifacts":[]}', '42', '']) {
      await sheet.importText(text);
      expect(said.at(-1)).toBe(NOT_AN_EXPORT_LINE);
    }
    expect((await store.list()).length).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('export writes only checked artifacts and only their envelope (no tokens, nothing else)', async () => {
    const withExtra = { ...board('f1'), token: 'secret-token', wizToken: 'abc' } as unknown as Artifact;
    const bad = { ...board('f2'), data: { frame: board().data.frame, plan: { kind: 'room', tiles: 'nope' } } } as Artifact;
    const text = exportArtifacts([withExtra, bad]);
    expect(text).not.toMatch(/token/i);
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe(EXPORT_FORMAT);
    expect(parsed.artifacts.map((a: Artifact) => a.id)).toEqual(['board-f1']);
    expect(Object.keys(parsed.artifacts[0]).sort()).toEqual(['at', 'by', 'data', 'id', 'kind', 'status', 'title', 'v']);
    // Round trip: an export imports back whole.
    expect(importArtifacts(text)).toEqual({ ok: [expect.objectContaining({ id: 'board-f1' })], dropped: 0 });
    // The sheet's Export reads the store through the load check.
    const { sheet, said } = sheetOn(createMemoryArtifactStore([withExtra, bad]));
    const out = await sheet.exportNow();
    expect(out).toBe(text);
    expect(said.at(-1)).toBe('Exported 1 artifact to mendcraft-artifacts.json. It holds no tokens and no settings.');
  });
});
