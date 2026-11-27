// @vitest-environment happy-dom
// The Artifacts sheet: every stored artifact with its kind, title, maker and
// date; Remove takes it out of the store (and its board off the canvas);
// Export writes only checked artifacts; Import checks every entry exactly as a
// load does and counts what it leaves out. Nothing in a file is ever run.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ENGINE_LABEL, EXPORT_FORMAT, IMPORT_MAX_BYTES, IMPORT_MAX_CHARS, NOT_AN_EXPORT_LINE, approvalDate, exportArtifacts, importArtifacts, madeLine, makerLabel,
  mountArtifactsSheet, planImport,
} from '../../src/canvas/artifactsSheet';
import { coerceArtifact } from '../../src/artifacts/artifact';
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
    expect(handle.statusSince(0)).toContain('Removed “Desk”. Tap Undo remove to put it back.');
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
    // Through the sheet: shown first, written only on Import; only the valid board reaches the store.
    const { host, sheet, store, said, onChange } = sheetOn();
    sheet.open();
    await sheet.importText(file);
    expect(await store.list()).toEqual([]);
    expect(host.querySelector<HTMLElement>('.mc-artifacts-confirm')!.hidden).toBe(false);
    host.querySelector<HTMLButtonElement>('.mc-artifacts-do-import')!.click();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect((await store.list()).map((a) => a.id)).toEqual(['board-f1']);
    expect(said.at(-1)).toBe('Imported 1 artifact. 4 entries failed their check and were left out.');
    // A file whose every entry fails changes nothing (and asks nothing).
    const none = sheetOn();
    await none.sheet.importText(JSON.stringify({ format: EXPORT_FORMAT, version: 1, artifacts: [connector('builtin')] }));
    expect(await none.store.list()).toEqual([]);
    expect(none.said.at(-1)).toBe('Nothing was imported. 1 entry failed its check and was left out. Nothing changed.');
    expect(none.host.querySelector<HTMLElement>('.mc-artifacts-confirm')!.hidden).toBe(true);
    expect(none.onChange).not.toHaveBeenCalled();
  });

  it('import shows what it adds, replaces and hides, and names each connector; Cancel writes nothing', async () => {
    // 200 stored (the cap), one of them "Desk": the file replaces Desk and adds a board and a connector.
    const stored = [board('f1', { title: 'Desk', at: AT }), ...Array.from({ length: 199 }, (_, i) => board(`s${i}`, { title: `Old ${i}`, at: i }))];
    const store = createMemoryArtifactStore(stored);
    const file = JSON.stringify({ format: EXPORT_FORMAT, version: 1, artifacts: [board('f1', { title: 'Desk' }), board('f2', { title: 'Kitchen' }), connector('cloud')] });
    const { host, sheet, said, onChange } = sheetOn(store);
    const importing = vi.fn();
    sheet.open();
    await sheet.importText(file);
    const lines = [...host.querySelectorAll('.mc-artifacts-confirm-line')].map((p) => p.textContent);
    expect(lines).toEqual(['Adds 2, replaces 1 (Desk), hides 2 older (over the 200 cap).', 'Connectors: WiZ bulb.', 'Nothing is written until you tap Import.']);
    const btns = [...host.querySelectorAll<HTMLButtonElement>('.mc-artifacts-confirm button')].map((b) => b.textContent);
    expect(btns).toEqual(['Import', 'Cancel']);
    expect(host.querySelector('.mc-artifacts-sheet')!.hasAttribute('data-hand-always')).toBe(true);
    host.querySelector<HTMLButtonElement>('.mc-artifacts-cancel-import')!.click();
    await flush();
    expect(said.at(-1)).toBe('Import cancelled. Nothing changed.');
    expect(JSON.stringify(await store.list())).toBe(JSON.stringify(stored));
    expect(onChange).not.toHaveBeenCalled();
    expect(importing).not.toHaveBeenCalled();
    expect(host.querySelector<HTMLElement>('.mc-artifacts-confirm')!.hidden).toBe(true);
    expect(planImport(importArtifacts(file), [])).toMatchObject({ adds: 3, replaces: [], hides: 0, connectors: ['WiZ bulb'] });
  });

  it('imported rows are labelled imported with the original maker, at = now; a recorded reply is refused outside a test build', async () => {
    const NOW = AT + 86_400_000;
    const file = JSON.stringify({ format: EXPORT_FORMAT, version: 1, artifacts: [board('f1', { by: 'gemini', at: 5 }), board('f2', { by: 'replay' })] });
    const prod = importArtifacts(file, { now: NOW, allowReplay: false });
    expect(prod.dropped).toBe(1);
    expect(prod.ok).toEqual([expect.objectContaining({ id: 'board-f1', by: 'gemini', at: NOW, imported: true })]);
    expect(importArtifacts(file, { now: NOW, allowReplay: true }).ok.map((a) => a.id)).toEqual(['board-f1', 'board-f2']);
    expect(makerLabel(prod.ok[0])).toBe('Imported · Gemini · cloud');
    expect(madeLine(prod.ok[0])).toBe(`Imported · Gemini · cloud · imported ${approvalDate(NOW)}`);
    // The flag is checked like the rest of the envelope.
    expect(coerceArtifact({ ...board(), imported: true }).ok).toBe(true);
    expect(coerceArtifact({ ...board(), imported: 'yes' }).ok).toBe(false);
    // The sheet row and the board head say it.
    const store = createMemoryArtifactStore(prod.ok);
    const { host, sheet } = sheetOn(store);
    sheet.open();
    await vi.waitFor(() => expect(host.querySelector('.mc-artifacts-made')?.textContent).toBe(`Imported · Gemini · cloud · imported ${approvalDate(NOW)}`));
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, doc: joinCanvasDoc(null, prod.ok), artifactInfo: () => ({ by: 'gemini', at: NOW, imported: true }) });
    await vi.waitFor(() => expect(root.querySelector('[data-frame=f1] .mc-frame-by')?.textContent).toBe(`Imported · Gemini · cloud · ${approvalDate(NOW)}`));
  });

  it('an edit still waiting to save is saved before the import is written, and no save writes over it after', async () => {
    if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const ops: string[] = [];
    const base = createMemoryArtifactStore([board('f1', { title: 'Desk', at: AT })]);
    const store = { ...base, put: async (a: Artifact) => { ops.push(`put ${a.id} ${a.title}${a.imported ? ' (imported)' : ''}`); await base.put(a); } };
    const imported: string[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    handle = mountCanvas(root, {
      autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, doc: joinCanvasDoc(null, [board('f1', { title: 'Desk' })]),
      artifactStore: store, onArtifactsImported: (line) => imported.push(line),
      // Like canvasMain: every save writes each board it holds (here, unconditionally).
      onPersist: (d) => { ops.push(`save ${d.frames.map((f) => f.title).join(',')}`); for (const f of d.frames) if (d.surfaces[f.id]) void store.put({ ...board(f.id, { title: f.title }), at: AT }); },
    });
    handle.run('new board'); // an edit inside the save debounce
    handle.run('show artifacts');
    const sheetEl = root.querySelector<HTMLElement>('.mc-artifacts-sheet')!;
    const kitchen = board('f1', { title: 'Kitchen' });
    kitchen.data = { ...kitchen.data, frame: { ...(kitchen.data.frame as object), title: 'Kitchen' } };
    const fileText = JSON.stringify({ format: EXPORT_FORMAT, version: 1, artifacts: [kitchen] });
    // Drive the real sheet: hand it the file the way the file picker does.
    const input = sheetEl.querySelector<HTMLInputElement>('.mc-artifacts-file')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [{ size: fileText.length, text: async () => fileText }] });
    input.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(sheetEl.querySelector<HTMLElement>('.mc-artifacts-confirm')!.hidden).toBe(false));
    expect(ops.filter((o) => o.startsWith('save'))).toEqual([]); // still in its debounce
    sheetEl.querySelector<HTMLButtonElement>('.mc-artifacts-do-import')!.click();
    await vi.waitFor(() => expect(imported).toEqual(['Imported 1 artifact.']));
    // The flush came first, then the import; nothing was saved after it.
    const saveAt = ops.findIndex((o) => o.startsWith('save'));
    const importAt = ops.indexOf('put board-f1 Kitchen (imported)');
    expect(saveAt).toBeGreaterThanOrEqual(0);
    expect(ops[saveAt]).toBe('save Desk,Board 2');
    expect(importAt).toBeGreaterThan(saveAt);
    handle.save();
    handle.run('new board');
    await new Promise((r) => setTimeout(r, 400));
    expect(ops.slice(importAt + 1)).toEqual([]);
    expect((await base.list()).find((a) => a.id === 'board-f1')).toMatchObject({ title: 'Kitchen', imported: true });
  });

  it('Undo remove puts the removed row back as it was', async () => {
    const desk = board('f1', { title: 'Desk', at: AT, by: 'nano' });
    const { host, sheet, store, said, onChange } = sheetOn(createMemoryArtifactStore([desk]));
    sheet.open();
    await vi.waitFor(() => expect(host.querySelectorAll('.mc-artifacts-row').length).toBe(1));
    const remove = host.querySelector<HTMLButtonElement>('.mc-artifacts-remove')!;
    remove.click(); await flush(); remove.click();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(await store.list()).toEqual([]);
    const undo = host.querySelector<HTMLButtonElement>('.mc-artifacts-undo')!;
    expect(undo.hidden).toBe(false);
    undo.click();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    expect(await store.list()).toEqual([desk]);
    expect(said.at(-1)).toBe('Put back “Desk”.');
    expect(undo.hidden).toBe(true);
  });

  it('a failed Undo remove says "Couldn\'t put back …" and keeps Undo remove to try again', async () => {
    const desk = board('f1', { title: 'Desk', at: AT, by: 'nano' });
    const store = createMemoryArtifactStore([desk]);
    const { host, sheet, said, onChange } = sheetOn(store);
    sheet.open();
    await vi.waitFor(() => expect(host.querySelectorAll('.mc-artifacts-row').length).toBe(1));
    const remove = host.querySelector<HTMLButtonElement>('.mc-artifacts-remove')!;
    remove.click(); await flush(); remove.click();
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    const put = store.put.bind(store);
    store.put = () => Promise.reject(new Error('quota exceeded'));
    const undo = host.querySelector<HTMLButtonElement>('.mc-artifacts-undo')!;
    undo.click();
    await vi.waitFor(() => expect(said.at(-1)).toMatch(/^Couldn't put back “Desk”/));
    expect(said.at(-1)).toBe("Couldn't put back “Desk”: the store couldn't be changed (quota exceeded). Nothing changed.");
    expect(said.join(' ')).not.toMatch(/Imported/);
    expect(undo.hidden).toBe(false);
    store.put = put;
    undo.click();
    await vi.waitFor(() => expect(said.at(-1)).toBe('Put back “Desk”.'));
    expect(await store.list()).toEqual([desk]);
  });

  it('Import counts again at the tap: a store that changed meanwhile shows the new counts and asks again', async () => {
    const store = createMemoryArtifactStore([board('f1', { title: 'Desk', at: AT })]);
    const file = JSON.stringify({ format: EXPORT_FORMAT, version: 1, artifacts: [board('f1', { title: 'Desk' }), board('f2', { title: 'Kitchen' })] });
    const { host, sheet, said } = sheetOn(store);
    sheet.open();
    await sheet.importText(file);
    const lines = () => [...host.querySelectorAll('.mc-artifacts-confirm-line')].map((p) => p.textContent);
    expect(lines()[0]).toBe('Adds 1, replaces 1 (Desk).');
    // Meanwhile Kitchen is saved from the canvas: the file would now replace it too.
    await store.put(board('f2', { title: 'Kitchen', at: AT }));
    host.querySelector<HTMLButtonElement>('.mc-artifacts-do-import')!.click();
    await vi.waitFor(() => expect(lines()[0]).toBe('Adds 0, replaces 2 (Desk, Kitchen).'));
    expect(host.querySelector<HTMLElement>('.mc-artifacts-confirm')!.hidden).toBe(false);
    expect(said.at(-1)).toMatch(/^What is stored changed\. Adds 0, replaces 2 \(Desk, Kitchen\)\. Tap Import to bring them in, or Cancel\.$/);
    expect((await store.list()).find((a) => a.id === 'board-f2')?.at).toBe(AT); // nothing written yet
    // Tapped again with nothing changed: written.
    host.querySelector<HTMLButtonElement>('.mc-artifacts-do-import')!.click();
    await vi.waitFor(() => expect(said.at(-1)).toBe('Imported 2 artifacts.'));
  });

  it('import of text that is not JSON says "That file isn\'t a Mendcraft export. Nothing changed."', async () => {
    expect(NOT_AN_EXPORT_LINE).toBe("That file isn't a Mendcraft export. Nothing changed.");
    const { sheet, store, said, onChange } = sheetOn(createMemoryArtifactStore([board()]));
    // A bare array is not an export either: the envelope is required.
    for (const text of ['not json at all', '{"format":"something-else","artifacts":[]}', '42', '', JSON.stringify([board()])]) {
      await sheet.importText(text);
      expect(said.at(-1)).toBe(NOT_AN_EXPORT_LINE);
    }
    expect((await store.list()).length).toBe(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(IMPORT_MAX_BYTES).toBe(Math.ceil(IMPORT_MAX_CHARS * 1.1));
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
    // Round trip: an export imports back whole, as imported rows.
    expect(importArtifacts(text)).toEqual({ ok: [expect.objectContaining({ id: 'board-f1', imported: true })], dropped: 0 });
    // The sheet's Export reads the store through the load check.
    const { sheet, said } = sheetOn(createMemoryArtifactStore([withExtra, bad]));
    const out = await sheet.exportNow();
    expect(out).toBe(text);
    expect(said.at(-1)).toBe('Exported 1 artifact to mendcraft-artifacts.json. It holds no tokens and no settings.');
  });
});
