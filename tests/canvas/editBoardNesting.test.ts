import { describe, expect, it } from 'vitest';
import { topLevelOf, type ContainmentEl } from '../../src/canvas/editBoard';

function fakeEl(name: string, contains: string[]): ContainmentEl & { name: string } {
  return {
    name,
    contains(other: unknown) {
      return contains.includes((other as { name: string }).name);
    },
  };
}

describe('topLevelOf', () => {
  it('keeps a top-level card and a top-level sibling tile, drops the nested stat inside the card', () => {
    const nestedStat = fakeEl('stat-inside-card', []);
    const card = fakeEl('card', [nestedStat.name]);
    const sibling = fakeEl('sibling-tile', []);
    const all = [card, nestedStat, sibling];
    const top = topLevelOf(all);
    expect(top.map((e) => e.name).sort()).toEqual(['card', 'sibling-tile']);
  });

  it('handles multi-level nesting: only the outermost container survives', () => {
    const innerStat = fakeEl('stat', []);
    const grid = fakeEl('grid', [innerStat.name]);
    const tab = fakeEl('tab-panel-content', [grid.name, innerStat.name]);
    const tabs = fakeEl('tabs', [tab.name, grid.name, innerStat.name]);
    const all = [tabs, tab, grid, innerStat];
    expect(topLevelOf(all).map((e) => e.name)).toEqual(['tabs']);
  });

  it('is a no-op when nothing is nested', () => {
    const a = fakeEl('a', []);
    const b = fakeEl('b', []);
    expect(topLevelOf([a, b])).toEqual([a, b]);
  });
});
