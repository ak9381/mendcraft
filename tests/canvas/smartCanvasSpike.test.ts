import { describe, expect, it, vi } from 'vitest';
import { MessageProcessor, Catalog } from '@a2ui/web_core/v0_9';
import { coerceSurfacePlan, expandPlan, MAX_TILES, ROOM_CATALOG_ID, type A2uiMessage } from '../../src/canvas/surfacePlan';
import { gateMessages } from '../../src/canvas/gate';
import { CATALOG_SCHEMAS, DeviceTileApi, PlanBoardApi } from '../../src/canvas/catalogApi';
import { createSurfaceProposal } from '../../src/canvas/proposalBuffer';
import { createDeviceStore } from '../../src/canvas/deviceActions';

const draft = { kind: 'room', title: 'Studio', tiles: [{ type: 'lamp', deviceId: 'wiz-1', label: 'Desk lamp' }, { type: 'plan', boardId: 'plan-1', template: 'blank' }] };

describe('surface plan', () => {
  it('coerces a valid draft', () => {
    const r = coerceSurfacePlan(draft);
    expect(r.ok).toBe(true);
  });
  it('rejects unknown tile types, bad ids and too many tiles', () => {
    expect(coerceSurfacePlan({ ...draft, tiles: [{ type: 'script', src: 'x' }] }).ok).toBe(false);
    expect(coerceSurfacePlan({ ...draft, tiles: [{ type: 'lamp', deviceId: '../etc' }] }).ok).toBe(false);
    const many = Array.from({ length: MAX_TILES + 1 }, (_, i) => ({ type: 'lamp', deviceId: `l-${i}` }));
    expect(coerceSurfacePlan({ ...draft, tiles: many }).ok).toBe(false);
  });
  it('aliases type tab to tabs, and drops unknown siblings with a note instead of refusing the plan', () => {
    const r = coerceSurfacePlan({
      kind: 'room',
      title: 'Studio',
      tiles: [
        { type: 'lamp', deviceId: 'wiz-1', label: 'Desk lamp' },
        { type: 'tab', label: 'Lights', children: [{ type: 'switch', deviceId: 'sw-1', label: 'Switch' }] },
        { type: 'script', src: 'x' },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tiles.some((t) => t.type === 'lamp')).toBe(true);
    const tabs = r.value.tiles.find((t) => t.type === 'tabs');
    expect(tabs && tabs.type === 'tabs' && tabs.tabs[0].label).toBe('Lights');
    expect(r.notes?.some((n) => /script/i.test(n))).toBe(true);
  });
  it('strips markup from labels', () => {
    const r = coerceSurfacePlan({ ...draft, tiles: [{ type: 'lamp', deviceId: 'a', label: '<img onerror=x>Lamp' }] });
    expect(r.ok && r.value.tiles[0].type === 'lamp' && r.value.tiles[0].label).toBe('img onerror=xLamp');
  });
  it('expands deterministically', () => {
    const p = coerceSurfacePlan(draft);
    if (!p.ok) throw new Error();
    const a = expandPlan(p.value, 's1', { 'wiz-1': { on: true, brightness: 40 } });
    const b = expandPlan(p.value, 's1', { 'wiz-1': { on: true, brightness: 40 } });
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ createSurface: { surfaceId: 's1', catalogId: ROOM_CATALOG_ID } });
  });
});

describe('gate', () => {
  const p = coerceSurfacePlan(draft);
  if (!p.ok) throw new Error();
  const msgs = expandPlan(p.value, 's1', { 'wiz-1': { on: false, brightness: 50 } });
  it('passes our own expanded messages', () => {
    const r = gateMessages(msgs, CATALOG_SCHEMAS);
    expect(r).toEqual({ ok: true, messages: msgs });
  });
  it('rejects an unknown component before A2UI sees it', () => {
    const evil = [{ version: 'v0.9', updateComponents: { surfaceId: 's1', components: [{ id: 'x', component: 'EvilScript', src: 'alert(1)' }] } }];
    const r = gateMessages(evil, CATALOG_SCHEMAS);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors[0]).toMatch(/unknown component "EvilScript"/);
  });
  it('rejects extra props, foreign catalogs and unknown message kinds', () => {
    const extra = [{ version: 'v0.9', updateComponents: { surfaceId: 's1', components: [{ id: 'p', component: 'PlanBoard', boardId: 'p1', template: 'blank', onload: 'x' }] } }];
    expect(gateMessages(extra, CATALOG_SCHEMAS).ok).toBe(false);
    expect(gateMessages([{ version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'https://evil.example/c.json' } }], CATALOG_SCHEMAS).ok).toBe(false);
    expect(gateMessages([{ version: 'v0.9', runScript: { surfaceId: 's' } }], CATALOG_SCHEMAS).ok).toBe(false);
  });
});

describe('A2UI processor accepts gated messages (DOM-free)', () => {
  it('creates the surface and holds data', () => {
    const cat = new Catalog(ROOM_CATALOG_ID, '0.9', [{ ...DeviceTileApi }, { ...PlanBoardApi }] as never);
    const proc = new MessageProcessor([cat]);
    const created: string[] = [];
    proc.onSurfaceCreated((s: { id: string }) => created.push(s.id));
    const p = coerceSurfacePlan(draft);
    if (!p.ok) throw new Error();
    proc.processMessages(expandPlan(p.value, 's1', { 'wiz-1': { on: true, brightness: 40 } }) as never);
    expect(created).toEqual(['s1']);
  });
});

describe('proposal buffer', () => {
  it('applies only on accept, once', () => {
    const apply = vi.fn();
    const prop = createSurfaceProposal('p1', 'gemini', 'Grouped by scene', [{ version: 'v0.9' } as A2uiMessage], apply);
    expect(apply).not.toHaveBeenCalled();
    expect(prop.accept()).toBe(true);
    expect(prop.accept()).toBe(false);
    expect(apply).toHaveBeenCalledTimes(1);
  });
  it('reject never applies', () => {
    const apply = vi.fn();
    const prop = createSurfaceProposal('p2', 'nano', 'Draft', [], apply);
    prop.reject();
    expect(prop.accept()).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('device actions', () => {
  it('pending, then ack updates state and emits data-model updates', async () => {
    const emitted: A2uiMessage[] = [];
    const store = createDeviceStore({ l: { on: false, brightness: 50 } }, { run: async (i) => ({ on: i.on ?? false, brightness: i.brightness ?? 50 }) }, (m) => emitted.push(m), () => 's1');
    const s = await store.act({ deviceId: 'l', on: true, brightness: 40 });
    expect(s).toEqual({ on: true, brightness: 40, pending: false, error: '' });
    expect(emitted).toHaveLength(2);
    expect((emitted[0].updateDataModel as { value: { pending: boolean } }).value.pending).toBe(true);
  });
  it('timeout rolls back and shows an error', async () => {
    vi.useFakeTimers();
    const store = createDeviceStore({ l: { on: false, brightness: 50 } }, { run: () => new Promise(() => {}) }, () => {}, () => 's1', 100);
    const pr = store.act({ deviceId: 'l', on: true });
    await vi.advanceTimersByTimeAsync(150);
    const s = await pr;
    vi.useRealTimers();
    expect(s.on).toBe(false);
    expect(s.error).toBe("Couldn't reach the lamp");
  });
});
