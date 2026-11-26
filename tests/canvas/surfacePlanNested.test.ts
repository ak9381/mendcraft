import { describe, expect, it } from 'vitest';
import { coerceSurfacePlan, expandPlan, MAX_DEPTH, MAX_NODES, tileComponentId } from '../../src/canvas/surfacePlan';

function deepRow(depth: number): unknown {
  let node: unknown = { type: 'stat', label: 'Deep', value: '1' };
  for (let i = 0; i < depth; i++) node = { type: 'row', children: [node] };
  return node;
}

describe('nested surface plan', () => {
  it('coerces a nested tree: Tabs > [Grid of stats + chart, Card > form]', () => {
    const raw = {
      kind: 'room',
      title: 'Energy',
      tiles: [
        {
          type: 'tabs',
          tabs: [
            {
              label: 'Overview',
              children: [
                {
                  type: 'grid',
                  columns: 3,
                  children: [
                    { type: 'stat', label: 'Power', value: '1.2 kW', trend: 'up' },
                    { type: 'stat', label: 'Cost', value: '$12', trend: 'down' },
                    { type: 'chart', title: 'Usage', chartType: 'bar', series: [{ label: 'Mon', value: 3 }] },
                  ],
                },
              ],
            },
            {
              label: 'Settings',
              children: [
                {
                  type: 'card',
                  title: 'Thermostat',
                  children: [
                    { type: 'form', title: 'Set temp', submitLabel: 'Apply', fields: [{ kind: 'slider', id: 'temp', label: 'Temp', value: 70, min: 60, max: 80 }] },
                  ],
                },
              ],
            },
          ],
        },
        { type: 'row', children: [{ type: 'lamp', deviceId: 'wiz-1', label: 'Desk lamp' }] },
      ],
    };
    const r = coerceSurfacePlan(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tiles).toHaveLength(2);
    expect(r.value.tiles[0].type).toBe('tabs');

    const msgs = expandPlan(r.value, 's1', { 'wiz-1': { on: true, brightness: 40 } });
    const updateComponents = msgs.find((m) => 'updateComponents' in m) as { updateComponents: { components: Array<{ id: string; component: string; children?: unknown }> } };
    const byId = new Map(updateComponents.updateComponents.components.map((c) => [c.id, c]));
    const root = byId.get('root') as { children: string[] };
    expect(root.children.length).toBe(3); // title + 2 top-level tiles
    const tabsComp = [...byId.values()].find((c) => c.component === 'Tabs') as { tabs: Array<{ label: string; child: string }> };
    expect(tabsComp.tabs).toHaveLength(2);
    const gridComp = [...byId.values()].find((c) => c.component === 'Grid') as { children: string[]; columns: number };
    expect(gridComp.children).toHaveLength(3);
    expect(gridComp.columns).toBe(3);
    const lampComp = [...byId.values()].find((c) => c.component === 'DeviceTile');
    expect(lampComp).toBeTruthy();

    // deterministic
    const msgs2 = expandPlan(r.value, 's1', { 'wiz-1': { on: true, brightness: 40 } });
    expect(msgs2).toEqual(msgs);
  });

  it('rejects a tree deeper than MAX_DEPTH', () => {
    const raw = { kind: 'room', title: 'x', tiles: [deepRow(MAX_DEPTH + 2)] };
    const r = coerceSurfacePlan(raw);
    expect(r.ok).toBe(false);
  });

  it('rejects a tree with more than MAX_NODES total nodes', () => {
    const children = Array.from({ length: MAX_NODES }, (_, i) => ({ type: 'stat', label: `S${i}`, value: '1' }));
    const raw = { kind: 'room', title: 'x', tiles: [{ type: 'row', children }] };
    const r = coerceSurfacePlan(raw);
    expect(r.ok).toBe(false);
  });

  it('rejects an unknown nested tile type', () => {
    const raw = { kind: 'room', title: 'x', tiles: [{ type: 'row', children: [{ type: 'evil', src: 'x' }] }] };
    expect(coerceSurfacePlan(raw).ok).toBe(false);
  });

  it('gives stable positional component ids for container tiles', () => {
    const raw = { kind: 'room', title: 'x', tiles: [{ type: 'row', children: [{ type: 'stat', label: 'A', value: '1' }] }] };
    const r = coerceSurfacePlan(raw);
    if (!r.ok) throw new Error();
    expect(tileComponentId(r.value.tiles[0], [0])).toBe(tileComponentId(r.value.tiles[0], [0]));
  });
});

describe('new component schemas', () => {
  it('rejects a Grid with an out-of-enum column count', async () => {
    const { gateMessages } = await import('../../src/canvas/gate');
    const { CATALOG_SCHEMAS } = await import('../../src/canvas/catalogApi');
    const bad = [{ version: 'v0.9', updateComponents: { surfaceId: 's', components: [{ id: 'g', component: 'Grid', columns: 7, children: [] }] } }];
    expect(gateMessages(bad, CATALOG_SCHEMAS).ok).toBe(false);
  });
});

describe('visual tile markup is sanitized at coerce time', () => {
  it('strips a <script> from a visual tile before it ever becomes a SurfacePlan', () => {
    const raw = { kind: 'room', title: 'x', tiles: [{ type: 'visual', title: 'Zone map', markup: '<svg><script>evil()</script><rect data-action="z" width="1" height="1"/></svg>' }] };
    const r = coerceSurfacePlan(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const visual = r.value.tiles[0];
    if (visual.type !== 'visual') throw new Error();
    expect(visual.markup).not.toMatch(/script/i);
    expect(visual.markup).not.toMatch(/evil/);
    expect(visual.markup).toContain('data-action="z"');
  });
});
