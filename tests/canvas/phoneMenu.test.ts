import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PHONE_GROUPS, PHONE_PRIMARY, sheetStyle } from '../../src/canvas/phoneMenu';

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
const barMarkup = app.slice(app.indexOf('<div class="mc-bar-btns">'), app.indexOf('<form class="mc-say">'));
// Desktop-only tools (a second window; laptop-side phone arrangement) are deliberately absent on phones.
const DESKTOP_ONLY = new Set(['monitor', 'swap']);
const toolbarCmds = [...barMarkup.matchAll(/data-cmd="([a-z]+)"/g)].map((m) => m[1]).filter((c) => !DESKTOP_ONLY.has(c!));

describe('phone tools menu', () => {
  it('puts every desktop tool in exactly one place on phones', () => {
    const placed = [...PHONE_PRIMARY, ...PHONE_GROUPS.flatMap((g) => g.cmds)];
    expect(new Set(placed).size).toBe(placed.length);
    expect([...placed].sort()).toEqual([...toolbarCmds].sort());
  });
  it('keeps the thumb bar to at most 4 actions including Menu', () => {
    expect(PHONE_PRIMARY.length + 1).toBeLessThanOrEqual(4);
  });
  it('labels every group', () => {
    for (const g of PHONE_GROUPS) expect(g.title.trim().length).toBeGreaterThan(0);
  });
  it('picks the sheet style from the platform', () => {
    expect(sheetStyle('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toBe('ios');
    expect(sheetStyle('Mozilla/5.0 (Linux; Android 15; A001)')).toBe('android');
    expect(sheetStyle('Mozilla/5.0 (Linux; Android 15)', 'ios')).toBe('ios');
    expect(sheetStyle('Mozilla/5.0 (iPhone)', 'android')).toBe('android');
  });
});
