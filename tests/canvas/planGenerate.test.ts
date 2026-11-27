// @vitest-environment happy-dom
// A floor plan is generated as checked geometry: the reply is a plan
// document, code draws it (shared walls, ids), and the drawing sits beside a
// plan board whose surface plan holds no geometry. Approve stores the board
// and the drawing as two artifacts; a reload brings both back.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildPlanGeneratePrompt, planFromReply, PLAN_GENERATE_FAIL } from '../../src/canvas/planGenerate';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { createReplayEngines } from '../../src/canvas/replayEngine';
import { joinCanvasDoc, splitCanvasDoc } from '../../src/canvas/canvasPersistence';
import { artifactId, coerceArtifact, frameIdOfArtifactId, type Artifact, type ArtifactBy } from '../../src/artifacts/artifact';
import type { CanvasDoc } from '../../src/canvas/frames';
import { PLAN_TEMPLATES } from '../../src/canvas/surfacePlan';
import { buildPlanTemplate } from '../../src/plan/templates';
import { PLAN_EDIT_EVENT } from '../../src/canvas/planHandSurface';

const REPLY = (JSON.parse(readFileSync(join(__dirname, '../fixtures/replies/gemini.plan.json'), 'utf8')) as { reply: string }).reply;
const room = (name: string, x: number, y: number, w = 3000, h = 3000) => ({ name, x, y, w, h });

describe('planFromReply', () => {
  it('a two-bedroom reply becomes a sanitized doc with at least 5 rooms and shared walls', () => {
    const r = planFromReply(REPLY);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = r.doc as { walls: unknown[]; rooms: { wallIds: string[] }[] };
    expect(doc.rooms.length).toBeGreaterThanOrEqual(5);
    // Shared walls: fewer walls than four per room, and some wall belongs to two rooms.
    expect(doc.walls.length).toBeLessThan(doc.rooms.length * 4);
    const uses = new Map<string, number>();
    for (const rm of doc.rooms) for (const w of rm.wallIds) uses.set(w, (uses.get(w) ?? 0) + 1);
    expect([...uses.values()].some((n) => n >= 2)).toBe(true);
    expect(r.rooms.find((x) => x.name === 'Bedroom 1')).toEqual({ name: 'Bedroom 1', w: 4, h: 3 });
    // The checks speak in rooms, never internal ids.
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings.some((f) => /^The door (into|between) /.test(f))).toBe(true);
    expect(r.findings.join(' ')).not.toMatch(/\b[owr]\d+\b/);
    // Sanitized: nothing selected, every wall finite.
    expect((r.doc as { selectedId: unknown }).selectedId).toBeNull();
  });

  it('a reply with 12 rooms keeps 8', () => {
    const rooms = Array.from({ length: 12 }, (_, i) => room(`Room ${i + 1}`, (i % 4) * 3000, Math.floor(i / 4) * 3000));
    const r = planFromReply(JSON.stringify({ unit: 'mm', rooms }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rooms).toHaveLength(8);
  });

  it('a reply with overlapping rooms or a NaN size is refused with PLAN_GENERATE_FAIL', () => {
    const over = planFromReply(JSON.stringify({ rooms: [room('A', 0, 0), room('B', 1500, 0)] }));
    expect(over).toMatchObject({ ok: false });
    if (!over.ok) expect(over.error).toMatch(/overlaps/);
    const nan = planFromReply(JSON.stringify({ rooms: [room('A', 0, 0), { name: 'B', x: 3000, y: 0, w: 'NaN', h: 3000 }] }));
    expect(nan).toMatchObject({ ok: false });
    expect(planFromReply('{"rooms":[{"name":"A","x":0,"y":0,"w":NaN,"h":3}]}').ok).toBe(false);
    expect(PLAN_GENERATE_FAIL).toBe("I couldn't draw that plan. Nothing was generated.");
  });

  it('a room out of the drawing limits is refused, never clamped', () => {
    expect(planFromReply(JSON.stringify({ rooms: [room('Huge', 0, 0, 1e9, 3000)] }))).toEqual({ ok: false, error: 'room 1 is too big' });
    expect(planFromReply(JSON.stringify({ unit: 'm', rooms: [room('Huge', 0, 0, 60, 3)] }))).toMatchObject({ ok: false });
    expect(planFromReply(JSON.stringify({ rooms: [room('Tiny', 0, 0, 50, 3000)] }))).toEqual({ ok: false, error: 'room 1 is too small' });
    expect(planFromReply(JSON.stringify({ rooms: [room('Far', 1e7, 0)] }))).toEqual({ ok: false, error: 'room 1 is placed outside the drawing' });
    // In metres, a normal room is fine.
    expect(planFromReply(JSON.stringify({ unit: 'm', rooms: [room('Room', 0, 0, 4, 3)] })).ok).toBe(true);
  });

  it('a door or window naming a room or side not in the plan is left out, and the review says so', () => {
    const r = planFromReply(JSON.stringify({ rooms: [room('Studio', 0, 0, 6000, 4000), room('Bath', 6000, 0, 2000, 4000)], doors: [{ room: 'Studio', side: 's', width: 900 }, { room: 'Garage', side: 's' }], windows: [{ room: 'Studio', side: 'up-ish' }] }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.findings).toContain('Left out 2 doors or windows that named a room or side not in the plan.');
  });

  it('prose around the JSON is tolerated', () => {
    const r = planFromReply(`Sure! Here you go.\n${JSON.stringify({ rooms: [room('Studio', 0, 0, 6000, 4000)] })}\nHope it helps.`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rooms).toEqual([{ name: 'Studio', w: 6, h: 4 }]);
  });

  it('the prompt carries her words and the fixed instructions only', () => {
    const s = buildPlanGeneratePrompt('draw a "two bedroom"\nfloor plan');
    expect(s.engine).toBe('gemini');
    expect(s.prompt).toContain('She said: "draw a two bedroom floor plan"');
    expect(s.prompt).not.toMatch(/wiz|lamp|board-/i);
  });

  it('templates are stripped to blank', () => {
    expect(PLAN_TEMPLATES).toEqual(['blank']);
    expect(buildPlanTemplate('blank')).toEqual([]);
  });
});

let handle: CanvasHandle | null = null;
function mount(opts: Parameters<typeof mountCanvas>[1] = {}): { h: CanvasHandle; root: HTMLElement } {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, connector: { run: async () => ({}) }, ...opts });
  return { h: handle, root };
}
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });

const reviewOpen = (root: HTMLElement): boolean => { const d = root.querySelector<HTMLElement>('.mc-review-dialog') ?? document.querySelector<HTMLElement>('.mc-review-dialog'); return !!d && !d.hidden; };
const reviewTitle = (root: HTMLElement): string => root.querySelector('.mc-review-title')?.textContent ?? '';
/** canvasMain's maker rule, minus the stored artifacts: what the handle says. */
const maker = (h: CanvasHandle) => (id: string): ArtifactBy => h.makerOf(id) ?? 'person';

async function generate(saved: CanvasDoc[], extra: Parameters<typeof mountCanvas>[1] = {}) {
  const engines = createReplayEngines({ 'gemini.plan': REPLY });
  const m = mount({ engines, onPersist: (d) => saved.push(d), ...extra });
  m.h.run('draw a two bedroom floor plan');
  await vi.waitFor(() => expect(reviewTitle(m.root)).not.toBe(''), { timeout: 8000 });
  return m;
}

describe('a generated floor plan on its own board', () => {
  it('the proposal holds a plan board with template "blank" and the doc beside it, never inside the SurfacePlan', async () => {
    const saved: CanvasDoc[] = [];
    const { h, root } = await generate(saved);
    const review = root.querySelector('.mc-review-dialog')?.textContent ?? '';
    expect(review).toContain('Bedroom 1');
    expect(review).toMatch(/4 × 3 m/);
    // Nothing applied before Approve: no board made.
    expect(h.frames()).toEqual([]);
    h.keep();
    await vi.waitFor(() => expect(Object.keys(h.snapshot().surfaces)).toHaveLength(1));
    const doc = h.snapshot();
    const [frameId] = Object.keys(doc.surfaces);
    const plan = doc.surfaces[frameId];
    expect(plan.kind).toBe('plan');
    expect(plan.tiles).toEqual([{ type: 'plan', boardId: `${frameId}-cad`, template: 'blank' }]);
    expect(JSON.stringify(plan)).not.toMatch(/walls|Bedroom/);
    expect((doc.drawings?.[frameId]?.[`${frameId}-cad`] as { rooms: unknown[] }).rooms.length).toBe(5);
    expect(h.frames().find((f) => f.id === frameId)?.kind).toBe('plan');
  });

  it('approve stores board-<frame> and plan-<frame>-<boardId>; reload restores the drawing', async () => {
    const saved: CanvasDoc[] = [];
    const { h } = await generate(saved);
    h.keep();
    await vi.waitFor(() => expect(saved.at(-1)?.drawings).toBeTruthy());
    const doc = saved.at(-1)!;
    const frameId = doc.frames[0].id;
    const put = splitCanvasDoc(doc, [], maker(h), 1000).put;
    const ids = put.map((a) => a.id).sort();
    expect(ids).toEqual([artifactId('board', frameId), artifactId('plan', frameId, `${frameId}-cad`)].sort());
    for (const a of put) { expect(coerceArtifact(a).ok).toBe(true); expect(a.by).toBe('gemini'); }
    handle?.destroy(); handle = null;
    const back = joinCanvasDoc({ version: doc.version, camera: doc.camera, focusId: doc.focusId, frames: doc.frames }, put) as CanvasDoc;
    const again = mount({ doc: back });
    expect(again.h.snapshot().drawings?.[frameId]?.[`${frameId}-cad`]).toEqual(doc.drawings?.[frameId]?.[`${frameId}-cad`]);
  });

  it('undo of a generated plan removes its board, drawing and maker; after a reload nothing comes back', async () => {
    const saved: CanvasDoc[] = [];
    const { h } = await generate(saved);
    h.keep();
    await vi.waitFor(() => expect(saved.at(-1)?.drawings).toBeTruthy());
    const frameId = h.frames()[0].id;
    const stored = splitCanvasDoc(saved.at(-1)!, [], maker(h), 1000).put;
    h.undo();
    expect(h.frames()).toEqual([]);
    expect(h.snapshot().drawings).toBeUndefined();
    await vi.waitFor(() => expect(saved.at(-1)?.frames).toEqual([]));
    expect(h.makerOf(artifactId('plan', frameId, `${frameId}-cad`))).toBeUndefined();
    const last = saved.at(-1)!;
    const out = splitCanvasDoc(last, stored, maker(h), 2000);
    expect(out.remove.sort()).toEqual([artifactId('board', frameId), artifactId('plan', frameId, `${frameId}-cad`)].sort());
    const left = stored.filter((a) => !out.remove.includes(a.id));
    handle?.destroy(); handle = null;
    const again = mount({ doc: joinCanvasDoc(out.layout, left) });
    expect(again.h.frames()).toEqual([]);
    expect(again.h.snapshot().drawings).toBeUndefined();
  });

  it('an empty board she is on is reused; a drawn floor plan is never overwritten', async () => {
    const saved: CanvasDoc[] = [];
    const engines = createReplayEngines({ 'gemini.plan': REPLY });
    const { h, root } = mount({ engines, onPersist: (d) => saved.push(d) });
    h.run('new board');
    const empty = h.frames()[0].id;
    await h.focus(empty);
    h.run('draw a two bedroom floor plan');
    await vi.waitFor(() => expect(reviewTitle(root)).not.toBe(''), { timeout: 8000 });
    h.keep();
    await vi.waitFor(() => expect(h.snapshot().surfaces[empty]?.kind).toBe('plan'));
    expect(h.frames()).toHaveLength(1);
    expect(h.frames()[0]).toMatchObject({ id: empty, kind: 'plan', title: 'Floor plan' });
    const first = JSON.stringify(h.snapshot().drawings?.[empty]);
    // Asked again on the drawn plan: a new board; the first drawing stays.
    await vi.waitFor(() => expect(reviewOpen(root)).toBe(false));
    h.run('draw a two bedroom floor plan');
    await vi.waitFor(() => expect(reviewOpen(root)).toBe(true), { timeout: 8000 });
    h.keep();
    await vi.waitFor(() => expect(h.frames()).toHaveLength(2));
    expect(JSON.stringify(h.snapshot().drawings?.[empty])).toBe(first);
    // Undo of the plan on the reused board gives the empty board back.
    h.undo(); h.undo();
    expect(h.frames().map((f) => [f.id, f.title, f.kind])).toEqual([[empty, h.frames()[0].title, h.frames()[0].kind]]);
    expect(h.frames()[0].title).not.toBe('Floor plan');
    expect(h.snapshot().surfaces[empty]).toBeUndefined();
  });

  it('a hand edit to the drawing is hers; the board stays the engine\'s', async () => {
    const saved: CanvasDoc[] = [];
    const { h, root } = await generate(saved);
    h.keep();
    await vi.waitFor(() => expect(Object.keys(h.snapshot().surfaces)).toHaveLength(1));
    const frameId = h.frames()[0].id;
    expect(h.makerOf(artifactId('plan', frameId, `${frameId}-cad`))).toBe('gemini');
    // Her own edit on the plan board (the hand / mouse journal's event).
    const board = root.querySelector(`[data-frame="${frameId}"] mc-plan-board`) ?? root.querySelector(`[data-frame="${frameId}"]`)!;
    board.dispatchEvent(new CustomEvent(PLAN_EDIT_EVENT, { bubbles: true, composed: true, detail: { summary: 'Moved a wall', steps: 1, epoch: 1 } }));
    expect(h.makerOf(artifactId('plan', frameId, `${frameId}-cad`))).toBe('person');
    expect(h.makerOf(artifactId('board', frameId))).toBe('gemini');
  });

  it('a stored board with no change this session has no session maker, so its stored maker stands (an app re-fit is no one\'s)', () => {
    const doc = joinCanvasDoc(null, [{ id: 'board-f1', kind: 'board', v: 1, title: 'Desk', by: 'replay', at: 1, status: 'approved',
      data: { frame: { kind: 'room', title: 'Desk', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }, plan: { kind: 'room', title: 'Desk', tiles: [{ type: 'lamp', deviceId: 'wiz-lamp-7', label: 'Lamp' }] } } }]) as CanvasDoc;
    const { h } = mount({ doc });
    expect(h.makerOf('board-f1')).toBeUndefined();
  });

  it('a phone treats a stored board as the laptop\'s only when it was not stored as hers', () => {
    const plan = { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'T', value: '1' }] };
    const art = (id: string, by: ArtifactBy) => ({ id: `board-${id}`, kind: 'board' as const, v: 1, title: 'Desk', by, at: 1, status: 'approved' as const,
      data: { frame: { kind: 'room', title: 'Desk', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }, plan } });
    const doc = joinCanvasDoc(null, [art('f1', 'gemini'), art('f2', 'person')]) as CanvasDoc;
    const { h } = mount({ doc, phoneShell: true, storedMakers: { f1: 'gemini', f2: 'person' } });
    expect(h.isReceivedFrame('f1')).toBe(true);
    expect(h.isReceivedFrame('f2')).toBe(false);
  });

  it('a stored plan artifact with a wall that has no end point is dropped on load, the board stays', () => {
    const r = planFromReply(REPLY);
    if (!r.ok) throw new Error(r.error);
    const doc = JSON.parse(JSON.stringify(r.doc)) as { walls: Record<string, unknown>[] };
    delete doc.walls[0].b;
    const art = { id: artifactId('plan', 'f1', 'f1-cad'), kind: 'plan', v: 1, title: 'Floor plan', by: 'gemini', at: 1, status: 'approved', data: { frameId: 'f1', boardId: 'f1-cad', doc } };
    expect(coerceArtifact(art).ok).toBe(false);
    const board = { id: 'board-f1', kind: 'board', v: 1, title: 'Floor plan', by: 'gemini', at: 1, status: 'approved',
      data: { frame: { kind: 'plan', title: 'Floor plan', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }, plan: { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'f1-cad', template: 'blank' }] } } };
    const ok = [board, art].map((a) => coerceArtifact(a)).filter((c) => c.ok).map((c) => (c as { value: Artifact }).value);
    const joined = joinCanvasDoc(null, ok) as CanvasDoc;
    expect(joined.frames.map((f) => f.id)).toEqual(['f1']);
    expect(joined.drawings).toBeUndefined();
    expect(frameIdOfArtifactId(art.id)).toBe('f1');
  });

  it('an unreadable reply proposes nothing and says the fail line', async () => {
    const engines = createReplayEngines({ 'gemini.plan': '{"rooms":[{"name":"A","x":0,"y":0,"w":3000,"h":3000},{"name":"B","x":1000,"y":0,"w":3000,"h":3000}]}' });
    const { h, root } = mount({ engines });
    h.run('draw a two bedroom floor plan');
    await vi.waitFor(() => expect(root.textContent).toContain(PLAN_GENERATE_FAIL), { timeout: 8000 });
    expect(h.frames()).toEqual([]);
    expect(reviewTitle(root)).toBe('');
  });
});
