// @vitest-environment happy-dom
// The live (Lit) form tile's submit carries its values to the canvas, and a
// bound form goes down the same path as a tile press: each intent on its
// device's lane, a refusal said and shown on that device's tile.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountCanvas, type CanvasHandle } from '../../src/canvas/canvasApp';
import { joinCanvasDoc } from '../../src/canvas/canvasPersistence';
import { board as sampleBoard } from '../artifacts/sample';
import type { CanvasDoc } from '../../src/canvas/frames';
import type { DeviceIntent } from '../../src/canvas/deviceActions';

const LAMP = 'wiz-lamp-1';
let handle: CanvasHandle | null = null;
afterEach(() => { handle?.destroy(); handle = null; document.body.innerHTML = ''; });

function mount(fields: unknown[]): { h: CanvasHandle; root: HTMLElement; sent: DeviceIntent[] } {
  if (!globalThis.matchMedia) (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const plan = { kind: 'room', title: 'Evening', tiles: [{ type: 'form', title: 'Evening', submitLabel: 'Set', fields }] };
  const doc = joinCanvasDoc({ version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1', frames: [{ id: 'f1', kind: 'room', title: 'Evening', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }] },
    [sampleBoard('f1', { title: 'Evening' }, plan)]) as CanvasDoc;
  const sent: DeviceIntent[] = [];
  const root = document.createElement('div');
  document.body.append(root);
  handle = mountCanvas(root, {
    autoHands: false, reducedMotion: true, doc,
    connector: { run: async (i) => { sent.push(i); return {}; } },
    devices: { [LAMP]: { cls: 'lamp', on: false, brightness: 50 } }, deviceLabels: { [LAMP]: 'Lamp' },
  });
  return { h: handle, root, sent };
}
const submit = async (root: HTMLElement): Promise<void> => {
  await vi.waitFor(() => expect(root.querySelector('mc-form-tile')?.shadowRoot?.querySelector('button.primary')).toBeTruthy(), { timeout: 4000 });
  const tile = root.querySelector('mc-form-tile')!;
  // Touch the toggle so the submit carries a value she set, not only the approved ones.
  const box = tile.shadowRoot!.querySelector<HTMLInputElement>('input[type=checkbox]');
  if (box) { box.checked = true; box.dispatchEvent(new Event('change')); }
  tile.shadowRoot!.querySelector<HTMLButtonElement>('button.primary')!.click();
};

describe('form submit on the live renderer', () => {
  it('carries its values: the touched toggle and the approved slider level reach the lamp, one intent each', async () => {
    const { root, sent } = mount([
      { kind: 'toggle', id: 'power', label: 'Lamp', value: false, bind: { deviceId: LAMP, key: 'on' } },
      { kind: 'slider', id: 'level', label: 'Brightness', value: 70, min: 10, max: 100, bind: { deviceId: LAMP, key: 'brightness' } },
    ]);
    await submit(root);
    // (the store fills in the lamp's level on a power-on, as for any press)
    await vi.waitFor(() => expect(sent).toMatchObject([{ deviceId: LAMP, on: true }, { deviceId: LAMP, brightness: 70 }]), { timeout: 4000 });
    expect(sent).toHaveLength(2);
  }, 15000);

  it('an out-of-range level is refused on the tile, and nothing is sent', async () => {
    const { h, root, sent } = mount([
      { kind: 'toggle', id: 'power', label: 'Lamp', value: false, bind: { deviceId: LAMP, key: 'on' } },
      { kind: 'slider', id: 'level', label: 'Brightness', value: 450, min: 0, max: 500, bind: { deviceId: LAMP, key: 'brightness' } },
    ]);
    const mark = h.statusMark();
    await submit(root);
    await vi.waitFor(() => expect(h.store.get(LAMP).error).toMatch(/Nothing changed\.$/), { timeout: 4000 });
    expect(h.statusSince(mark)).toContain(h.store.get(LAMP).error);
    await new Promise((r) => setTimeout(r, 300));
    expect(sent).toEqual([]);
  }, 15000);
});
