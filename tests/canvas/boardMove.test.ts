// @vitest-environment happy-dom
// Send is a MOVE: a board sent to a phone leaves the laptop (hidden, with a
// "Bring back" chip) and comes back by the chip or by voice — its pin taken
// off, so the phone takes it off too. A reload keeps it on the phone.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { joinCanvasDoc } from '../../src/canvas/canvasPersistence';
import { board as sampleBoard } from '../artifacts/sample';
import type { CanvasDoc } from '../../src/canvas/frames';
import { parseCanvasCommand } from '../../src/canvas/canvasCommands';
import { PHONE_NAME } from '../../src/canvas/edgeTransfer';

type Win = { __mcLastBoardSnapshot?: { board?: unknown; boardFor?: string; pins?: { ios: string | null; android: string | null }; boardPin?: string } };
let handle: CanvasHandle | null = null;
let root: HTMLElement;
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; try { localStorage.clear(); } catch { /* none */ } });

async function laptop(saved: CanvasDoc[] = [], from?: CanvasDoc): Promise<CanvasHandle> {
  delete (window as Win).__mcLastBoardSnapshot;
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const doc = from ?? joinCanvasDoc(null, [sampleBoard('f1'), sampleBoard('f2', { title: 'Notes' })]) as CanvasDoc;
  root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, { autoHands: false, reducedMotion: true, sim: true, connector: { run: async () => ({}) }, doc, artifactBy: () => 'gemini', onPersist: (d) => saved.push(d) });
  const h = handle;
  h.run('connect devices');
  await vi.waitFor(() => expect(h.edgeLayout().right).toBeTruthy(), { timeout: 18000 });
  if (!from) await h.focus('f1');
  return h;
}
const frameEl = (id: string) => root.querySelector<HTMLElement>(`[data-frame="${id}"]`);
const chips = () => [...root.querySelectorAll<HTMLElement>('.mc-away-chip')];

describe('send is a move, with a way back', () => {
  it('a sent board leaves the laptop: hidden, a chip names the phone, focus moves on, the pin is on the wire', async () => {
    const h = await laptop();
    const target = h.edgeLayout().right as 'ios' | 'android';
    const rect = { ...h.frames().find((f) => f.id === 'f1')!.rect };
    expect(await h.sendBoard('right')).toBe(true);
    expect(h.frames().find((f) => f.id === 'f1')?.away).toBe(target);
    expect(frameEl('f1')?.hidden).toBe(true);
    expect(frameEl('f2')?.hidden).toBe(false);
    expect(chips()).toHaveLength(1);
    expect(chips()[0].textContent).toContain(`Desk · on the ${PHONE_NAME[target]}`);
    expect(chips()[0].querySelector('button')?.textContent).toBe('Bring back');
    await vi.waitFor(() => expect(root.querySelector('[data-frame="f2"].focused')).toBeTruthy());
    const snap = (window as Win).__mcLastBoardSnapshot!;
    expect(snap.pins?.[target]).toBe('f1');
    expect(snap.boardPin).toBe('f1');
    // The board's place on the canvas is kept for its return.
    expect(h.frames().find((f) => f.id === 'f1')!.rect).toEqual(rect);
  }, 45000);

  it('Bring back (the chip): shown again where it was, focused, said, the pin off the wire', async () => {
    const h = await laptop();
    const target = h.edgeLayout().right as 'ios' | 'android';
    const rect = { ...h.frames().find((f) => f.id === 'f1')!.rect };
    expect(await h.sendBoard('right')).toBe(true);
    const mark = h.statusMark();
    chips()[0].querySelector<HTMLButtonElement>('button')!.click();
    expect(h.frames().find((f) => f.id === 'f1')?.away).toBeUndefined();
    expect(frameEl('f1')?.hidden).toBe(false);
    expect(chips()).toHaveLength(0);
    expect(h.frames().find((f) => f.id === 'f1')!.rect).toEqual(rect);
    expect(h.statusSince(mark)).toContain(`Brought Desk back from the ${PHONE_NAME[target]}.`);
    const snap = (window as Win).__mcLastBoardSnapshot!;
    expect(snap.pins).toEqual({ ios: null, android: null });
    expect(snap.board).toBeUndefined();
    await vi.waitFor(() => expect(root.querySelector('[data-frame="f1"].focused')).toBeTruthy());
  }, 45000);

  it('Bring back by voice: "bring the board back" and "get it back from the …"', async () => {
    const h = await laptop();
    const target = h.edgeLayout().right as 'ios' | 'android';
    expect(await h.sendBoard('right')).toBe(true);
    h.run('bring the board back');
    expect(h.frames().find((f) => f.id === 'f1')?.away).toBeUndefined();
    expect((window as Win).__mcLastBoardSnapshot!.pins).toEqual({ ios: null, android: null });
    await h.focus('f1');
    expect(await h.sendBoard('right')).toBe(true);
    const other = target === 'ios' ? 'nothing phone' : 'iphone';
    const mark = h.statusMark();
    h.run(`get it back from the ${other}`);
    expect(h.statusSince(mark).join(' ')).toContain('No board is on the');
    expect(h.frames().find((f) => f.id === 'f1')?.away).toBe(target);
    h.run(`take it back from the ${target === 'ios' ? 'iphone' : 'nothing phone'}`);
    expect(h.frames().find((f) => f.id === 'f1')?.away).toBeUndefined();
  }, 45000);

  it('a reload keeps the board on the phone (away and pinned)', async () => {
    const saved: CanvasDoc[] = [];
    const h = await laptop(saved);
    const target = h.edgeLayout().right as 'ios' | 'android';
    expect(await h.sendBoard('right')).toBe(true);
    h.save();
    await vi.waitFor(() => expect(saved.at(-1)?.frames.find((f) => f.id === 'f1')?.away).toBe(target), { timeout: 8000 });
    h.destroy(); handle = null;
    const again = await laptop([], saved.at(-1));
    expect(again.frames().find((f) => f.id === 'f1')?.away).toBe(target);
    expect(frameEl('f1')?.hidden).toBe(true);
    expect(chips()).toHaveLength(1);
    again.run('bring it back');
    expect(frameEl('f1')?.hidden).toBe(false);
  }, 60000);
});

describe('parseCanvasCommand: bring back', () => {
  it('parses the bring-back phrases, never "pin"', () => {
    expect(parseCanvasCommand('bring the board back')).toEqual({ type: 'bringBack' });
    expect(parseCanvasCommand('Bring it back')).toEqual({ type: 'bringBack' });
    expect(parseCanvasCommand('get my status board back from the Nothing phone')).toEqual({ type: 'bringBack', from: 'android' });
    expect(parseCanvasCommand('take the dashboard back from the iPhone')).toEqual({ type: 'bringBack', from: 'ios' });
    expect(parseCanvasCommand('pin it')).toEqual({ type: 'pin', on: true });
    expect(parseCanvasCommand('go back')).toEqual({ type: 'back' });
  });
});
