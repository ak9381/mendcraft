import { describe, expect, it } from 'vitest';
import { buildEnergyShowcaseDoc } from '../../src/canvas/showcaseFixture';
import { expandPlan } from '../../src/canvas/surfacePlan';

describe('energy showcase fixture', () => {
  it('builds a valid doc with one frame and a nested multi-section plan', () => {
    const doc = buildEnergyShowcaseDoc();
    expect(doc.frames).toHaveLength(1);
    const plan = doc.surfaces[doc.frames[0].id];
    expect(plan.tiles.map((t) => t.type)).toEqual(['grid', 'split']);
  });

  it('includes a grid of stats and a split of tabs beside a visual card', () => {
    const doc = buildEnergyShowcaseDoc();
    const plan = doc.surfaces[doc.frames[0].id];
    const grid = plan.tiles[0];
    if (grid.type !== 'grid') throw new Error();
    expect(grid.children).toHaveLength(3);
    expect(grid.children.every((c) => c.type === 'stat')).toBe(true);

    const split = plan.tiles[1];
    if (split.type !== 'split') throw new Error();
    expect(split.direction).toBe('row');

    const tabs = split.first[0];
    if (tabs.type !== 'tabs') throw new Error();
    expect(tabs.tabs.map((t) => t.label)).toEqual(['Usage', 'Devices', 'Settings']);

    const card = split.second[0];
    if (card.type !== 'card') throw new Error();
    expect(card.children[0].type).toBe('visual');
    expect(split.second).toHaveLength(1);
  });

  it('expands to A2UI messages without throwing, with a sanitized VisualTile markup', () => {
    const doc = buildEnergyShowcaseDoc();
    const plan = doc.surfaces[doc.frames[0].id];
    const msgs = expandPlan(plan, 's1', { 'wiz-desk': { on: false, brightness: 40 } });
    const updateComponents = msgs.find((m) => 'updateComponents' in m) as { updateComponents: { components: Array<{ component: string; markup?: string }> } };
    const visual = updateComponents.updateComponents.components.find((c) => c.component === 'VisualTile');
    expect(visual?.markup).toContain('data-action="zone-living"');
    expect(visual?.markup).not.toMatch(/<script/i);
  });
});
