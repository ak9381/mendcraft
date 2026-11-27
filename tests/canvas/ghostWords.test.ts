import { describe, expect, it } from 'vitest';
import { ghostLeaves, ghostWords } from '../../src/canvas/ghostWords';
import { parsePartialPlan } from '../../src/canvas/aiTurn';

describe('ghostWords (the draft preview names each tile for what it is)', () => {
  it('a devices table drafts as a devices table, never a floor plan', () => {
    const w = ghostWords({ type: 'table', title: 'Connected devices', columns: ['Device'], rows: [], source: 'devices', fields: ['device'] });
    expect(w).toEqual({ kind: 'Devices table', full: 'Devices table · Connected devices' });
    expect(w.full).not.toMatch(/plan/i);
  });

  it('a streamed "show my devices" reply drafts a devices table', () => {
    const chunk = '{"kind":"room","title":"Connected Devices","tiles":[{"type":"table","title":"Your devices","source":"devices","fields":["device","status"]}';
    const g = parsePartialPlan(chunk);
    expect(g.tiles).toHaveLength(1);
    expect(g.tiles.map((t) => ghostWords(t).full)).toEqual(['Devices table · Your devices']);
  });

  it('every other kind keeps its own word; only a plan tile says Floor plan', () => {
    expect(ghostWords({ type: 'lamp', deviceId: 'l', label: 'Desk lamp' }).full).toBe('Lamp · Desk lamp');
    expect(ghostWords({ type: 'plan', boardId: 'b', template: 'blank' }).full).toBe('Floor plan');
    expect(ghostWords({ type: 'stat', label: 'Power', value: '4 W' }).full).toBe('Stat · Power');
    expect(ghostWords({ type: 'chart', title: 'Use', chartType: 'bar', series: [] }).kind).toBe('Chart');
    expect(ghostWords({ type: 'table', title: 'Plain', columns: [], rows: [] }).full).toBe('Table · Plain');
    expect(ghostWords({ type: 'gimbal' }).full).toBe('Stand');
    expect(ghostWords({ type: 'row', children: [] }).kind).toBe('Group');
    for (const t of [{ type: 'stat', label: 'x', value: '1' }, { type: 'form', title: 'f', fields: [], submitLabel: 'Go' }, { type: 'visual', title: 'v', markup: '' }] as const) {
      expect(ghostWords(t as never).full).not.toBe('Floor plan');
    }
  });
});

describe('ghostLeaves (the draft opens containers)', () => {
  it('a card around a devices table drafts the table itself', () => {
    const g = parsePartialPlan('{"kind":"room","title":"Devices","tiles":[{"type":"card","title":"What is connected","children":[{"type":"table","title":"Your devices","source":"devices","fields":["device","status"]}]}]}');
    expect(ghostLeaves(g.tiles).map((t) => ghostWords(t).full)).toEqual(['Devices table · Your devices']);
  });
  it('rows, tabs and splits open in order; an empty card drafts nothing', () => {
    const leaves = ghostLeaves([
      { type: 'row', children: [{ type: 'lamp', deviceId: 'a', label: 'A' }] },
      { type: 'tabs', tabs: [{ label: 't', children: [{ type: 'lamp', deviceId: 'b', label: 'B' }] }] },
      { type: 'split', direction: 'row', first: [{ type: 'lamp', deviceId: 'c', label: 'C' }], second: [] },
      { type: 'card', title: 'empty', children: [] },
    ]);
    expect(leaves.map((t) => ghostWords(t).full)).toEqual(['Lamp · A', 'Lamp · B', 'Lamp · C']);
  });
});
