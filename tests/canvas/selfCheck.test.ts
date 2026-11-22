// SELF-CHECK: dump format, every assertion (missing control, unreachable,
// overlap, empty label, unwired action), the one-fix-pass cap, sim
// determinism, and the checking-mark states — all against a fake DOM (same
// trick handPointerPipeline.test.ts uses), no jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterTilesRendered, assertControlCount, assertLabels, assertNonOverlapping, assertReachable, assertWired,
  checkTile, dumpText, dumpTile, expectedControlCount, mountSelfCheckBadge, replayTaps,
  runSelfCheck, scriptedFixJson, selectSelfCheckTargets, statusLine, type TileDump,
} from '../../src/canvas/selfCheck';
import { createHandPointer } from '../../src/canvas/handPointer';
import type { TileSpec } from '../../src/canvas/surfacePlan';
import { fakeDoc, fakeEl, fakeHost, installSelfCheckGlobals } from '../helpers/selfCheckDom';

beforeEach(() => { installSelfCheckGlobals(); });
afterEach(() => {
  delete (globalThis as Record<string, unknown>).innerWidth;
  delete (globalThis as Record<string, unknown>).innerHeight;
});

describe('dumpTile / dumpText', () => {
  it('collects only controls inside the host, with their label and rect', () => {
    const host = fakeHost({ left: 0, top: 0, width: 200, height: 100 }, { 'data-mc-tile': 't0' });
    const inside = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 }, { 'aria-label': 'Power' });
    inside.parentElement = host;
    const outside = fakeEl('button', { left: 500, top: 500, width: 40, height: 20 }, { 'aria-label': 'Elsewhere' });
    const doc = fakeDoc([inside, outside]);
    const dump = dumpTile(host, doc);
    expect(dump.controls).toHaveLength(1);
    expect(dump.controls[0].label).toBe('Power');
    expect(dump.label).toBe('t0');
    const text = dumpText(dump);
    expect(text).toContain('tile mc-lamp-tile "t0"');
    expect(text).toMatch(/control button#\S+ "Power"/);
  });
});

describe('assertControlCount ("missing control")', () => {
  it('flags a tile that rendered fewer controls than its spec implies', () => {
    const dump: TileDump = { role: 'row', label: 'Row', rect: { left: 0, top: 0, width: 10, height: 10 }, controls: [] };
    const spec: TileSpec = { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' };
    expect(assertControlCount(dump, spec)).toEqual([{ kind: 'missing-control', detail: 'expected at least 1, found 0' }]);
  });
  it('passes once enough controls are present', () => {
    const el = fakeEl('button', { left: 0, top: 0, width: 10, height: 10 });
    const dump: TileDump = { role: 'row', label: 'Row', rect: { left: 0, top: 0, width: 10, height: 10 }, controls: [{ id: 'a', kind: 'button', label: 'A', rect: el.getBoundingClientRect(), el }] };
    expect(assertControlCount(dump, { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' })).toEqual([]);
  });
});

describe('expectedControlCount', () => {
  it('counts one control for a device/scene/connect/plan leaf', () => {
    expect(expectedControlCount({ type: 'switch', deviceId: 'd', label: 'Fan' })).toBe(1);
    expect(expectedControlCount({ type: 'scene', sceneId: 's', label: 'Movie' })).toBe(1);
    expect(expectedControlCount({ type: 'connect', label: 'Add' })).toBe(1);
  });
  it('counts form fields plus the submit button', () => {
    expect(expectedControlCount({
      type: 'form', title: 'Settings', submitLabel: 'Save',
      fields: [{ kind: 'toggle', id: 'a', label: 'A' }, { kind: 'slider', id: 'b', label: 'B' }],
    })).toBe(3);
  });
  it('counts a table row action per row, or zero with none', () => {
    const base = { type: 'table' as const, title: 'T', columns: ['x'], rows: [['1'], ['2']] };
    expect(expectedControlCount({ ...base, rowActionLabel: 'Open' })).toBe(2);
    expect(expectedControlCount(base)).toBe(0);
  });
  it('counts data-action zones in a visual tile, and has no controls of its own for a stat/chart', () => {
    expect(expectedControlCount({ type: 'visual', title: 'Map', markup: '<rect data-action="a"/><rect data-action="b"/>' })).toBe(2);
    expect(expectedControlCount({ type: 'stat', label: 'Usage', value: '12' })).toBe(0);
    expect(expectedControlCount({ type: 'chart', title: 'C', chartType: 'bar', series: [] })).toBe(0);
  });
  it('sums recursively through containers', () => {
    const lamp: TileSpec = { type: 'lamp', deviceId: 'd1', label: 'Lamp' };
    const sw: TileSpec = { type: 'switch', deviceId: 'd2', label: 'Fan' };
    expect(expectedControlCount({ type: 'row', children: [lamp, sw] })).toBe(2);
    expect(expectedControlCount({ type: 'split', direction: 'row', first: [lamp], second: [sw] })).toBe(2);
  });
});

describe('assertReachable ("unreachable")', () => {
  const tileRect = { left: 0, top: 0, width: 100, height: 100 };
  it('flags a control whose centre sits outside the tile bounds', () => {
    const el = fakeEl('button', { left: 500, top: 500, width: 20, height: 20 });
    const doc = fakeDoc([el]);
    const dump: TileDump = { role: 'row', label: 'Row', rect: tileRect, controls: [{ id: 'a', kind: 'button', label: 'A', rect: el.getBoundingClientRect(), el }] };
    expect(assertReachable(dump, doc)).toEqual([{ kind: 'unreachable', id: 'a' }]);
  });
  it('flags a control the hit-test resolves to something else', () => {
    const el = fakeEl('button', { left: 10, top: 10, width: 20, height: 20 });
    const other = fakeEl('button', { left: 10, top: 10, width: 20, height: 20 });
    const doc = fakeDoc([other]); // elementFromPoint there never finds `el`
    const dump: TileDump = { role: 'row', label: 'Row', rect: tileRect, controls: [{ id: 'a', kind: 'button', label: 'A', rect: el.getBoundingClientRect(), el }] };
    expect(assertReachable(dump, doc)).toEqual([{ kind: 'unreachable', id: 'a' }]);
  });
  it('passes a control inside the tile that hit-tests back to itself', () => {
    const el = fakeEl('button', { left: 10, top: 10, width: 20, height: 20 });
    const doc = fakeDoc([el]);
    const dump: TileDump = { role: 'row', label: 'Row', rect: tileRect, controls: [{ id: 'a', kind: 'button', label: 'A', rect: el.getBoundingClientRect(), el }] };
    expect(assertReachable(dump, doc)).toEqual([]);
  });
});

describe('assertNonOverlapping ("overlap")', () => {
  it('flags two controls whose rects overlap by more than a sliver', () => {
    const a = fakeEl('button', { left: 0, top: 0, width: 40, height: 40 });
    const b = fakeEl('button', { left: 20, top: 20, width: 40, height: 40 });
    const dump: TileDump = {
      role: 'row', label: 'Row', rect: { left: 0, top: 0, width: 100, height: 100 },
      controls: [
        { id: 'a', kind: 'button', label: 'A', rect: a.getBoundingClientRect(), el: a },
        { id: 'b', kind: 'button', label: 'B', rect: b.getBoundingClientRect(), el: b },
      ],
    };
    expect(assertNonOverlapping(dump)).toEqual([{ kind: 'overlap', a: 'a', b: 'b' }]);
  });
  it('passes neighbouring controls that merely touch', () => {
    const a = fakeEl('button', { left: 0, top: 0, width: 40, height: 40 });
    const b = fakeEl('button', { left: 40, top: 0, width: 40, height: 40 });
    const dump: TileDump = {
      role: 'row', label: 'Row', rect: { left: 0, top: 0, width: 100, height: 100 },
      controls: [
        { id: 'a', kind: 'button', label: 'A', rect: a.getBoundingClientRect(), el: a },
        { id: 'b', kind: 'button', label: 'B', rect: b.getBoundingClientRect(), el: b },
      ],
    };
    expect(assertNonOverlapping(dump)).toEqual([]);
  });
});

describe('assertLabels ("empty label")', () => {
  it('flags a control with no usable label', () => {
    const el = fakeEl('button', { left: 0, top: 0, width: 10, height: 10 });
    const dump: TileDump = { role: 'row', label: 'Row', rect: { left: 0, top: 0, width: 10, height: 10 }, controls: [{ id: 'a', kind: 'button', label: '   ', rect: el.getBoundingClientRect(), el }] };
    expect(assertLabels(dump)).toEqual([{ kind: 'empty-label', id: 'a' }]);
  });
});

describe('replayTaps / assertWired ("unwired action")', () => {
  it('activates every control through the real dispatch path, dry-run', () => {
    const a = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 }, { 'aria-label': 'A' });
    const b = fakeEl('button', { left: 100, top: 10, width: 40, height: 20 }, { 'aria-label': 'B' });
    const doc = fakeDoc([a, b]);
    const pointer = createHandPointer(doc, { dryRun: true });
    const dump: TileDump = {
      role: 'row', label: 'Row', rect: { left: 0, top: 0, width: 200, height: 40 },
      controls: [
        { id: 'a', kind: 'button', label: 'A', rect: a.getBoundingClientRect(), el: a },
        { id: 'b', kind: 'button', label: 'B', rect: b.getBoundingClientRect(), el: b },
      ],
    };
    const replay = replayTaps(pointer, dump);
    pointer.destroy();
    expect(replay).toEqual([{ id: 'a', activated: true }, { id: 'b', activated: true }]);
    expect(assertWired(replay)).toEqual([]);
  });
  it('flags a control whose tap never lands on it', () => {
    const a = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 });
    const doc = fakeDoc([a]); // the dump's own control isn't in the doc's control list
    const stray = fakeEl('button', { left: 500, top: 500, width: 40, height: 20 });
    const dump: TileDump = {
      role: 'row', label: 'Row', rect: { left: 0, top: 0, width: 600, height: 600 },
      controls: [{ id: 'stray', kind: 'button', label: 'Stray', rect: stray.getBoundingClientRect(), el: stray }],
    };
    const pointer = createHandPointer(doc, { dryRun: true });
    const replay = replayTaps(pointer, dump);
    pointer.destroy();
    expect(replay).toEqual([{ id: 'stray', activated: false }]);
    expect(assertWired(replay)).toEqual([{ kind: 'unwired', id: 'stray' }]);
  });
});

describe('checkTile', () => {
  it('composes every assertion and reports ok on a sound tile', () => {
    const host = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const btn = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 }, { 'aria-label': 'Power' });
    btn.parentElement = host;
    const doc = fakeDoc([btn]);
    const outcome = checkTile(host, { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, doc);
    expect(outcome.ok).toBe(true);
    expect(outcome.failures).toEqual([]);
    expect(statusLine(outcome)).toBe('self-check: 1 control, tap replay ok, 0 overlaps');
  });
});

describe('selectSelfCheckTargets (canvas wiring: entries ↔ rendered hosts)', () => {
  const lamp = (id: string, path: number[]) => ({ id, path, spec: { type: 'lamp' as const, deviceId: id, label: id }, label: id });

  it('pairs only top-level entries with a rendered host when wantPath is omitted (the build/morph-all path)', () => {
    const entries = [lamp('a', [0]), lamp('nested', [0, 0]), lamp('b', [1])];
    const hostA = fakeHost({ left: 0, top: 0, width: 10, height: 10 });
    const hostNested = fakeHost({ left: 0, top: 0, width: 10, height: 10 });
    const hostB = fakeHost({ left: 0, top: 0, width: 10, height: 10 });
    const targets = selectSelfCheckTargets(entries, [hostA, hostNested, hostB]);
    expect(targets.map((t) => t.id)).toEqual(['a', 'b']); // nested (path.length 2) excluded
    expect(targets[0].host).toBe(hostA);
  });

  it('matches a single entry by wantPath (the morph-splice / edit-commit path)', () => {
    const entries = [lamp('a', [0]), lamp('b', [1])];
    const hostA = fakeHost({ left: 0, top: 0, width: 10, height: 10 });
    const hostB = fakeHost({ left: 0, top: 0, width: 10, height: 10 });
    const targets = selectSelfCheckTargets(entries, [hostA, hostB], [1]);
    expect(targets.map((t) => t.id)).toEqual(['b']);
  });

  it('drops an entry whose host has not rendered yet — the exact shape of the original bug', () => {
    const entries = [lamp('a', [0]), lamp('b', [1])];
    // Only "a" has rendered so far; "b"'s host is still pending (undefined).
    const targets = selectSelfCheckTargets(entries, [fakeHost({ left: 0, top: 0, width: 10, height: 10 }), undefined]);
    expect(targets.map((t) => t.id)).toEqual(['a']);
  });
});

describe('afterTilesRendered (defers past pending Lit/A2UI renders)', () => {
  it('runs immediately once the schedule callback fires', () => {
    let ran = false;
    const schedule = (cb: () => void) => cb();
    afterTilesRendered(() => { ran = true; }, schedule);
    expect(ran).toBe(true);
  });

  it('default schedule (a macrotask) waits out microtasks queued before it — even nested ones, ' +
    'the same chain a Lit surface + its nested tiles produce', async () => {
    const order: string[] = [];
    // Simulates the A2UI surface's own render (job A) queueing a nested
    // tile's render (job B) from inside it — two levels of microtask, both
    // queued before afterTilesRendered's macrotask below.
    queueMicrotask(() => { order.push('surface-render'); queueMicrotask(() => order.push('nested-tile-render')); });
    afterTilesRendered(() => order.push('self-check'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['surface-render', 'nested-tile-render', 'self-check']);
  });

  it('calling self-check synchronously (the original bug) would run BEFORE any of that has rendered', () => {
    const order: string[] = [];
    queueMicrotask(() => order.push('surface-render'));
    order.push('self-check-synchronous'); // what the old code effectively did
    expect(order).toEqual(['self-check-synchronous']); // render hasn't happened yet — hosts are empty
  });
});

describe('mountSelfCheckBadge (checking mark states)', () => {
  it('starts checking (amber) and moves to passed or warning', () => {
    const host = fakeHost({ left: 0, top: 0, width: 40, height: 20 });
    let captured: any = null;
    const doc = fakeDoc([], { body: { append: (el: any) => { captured = el; } } });
    const badge = mountSelfCheckBadge(host, doc);
    expect(captured.className).toBe('mc-self-check is-checking');
    badge.setState('passed');
    expect(captured.className).toBe('mc-self-check is-passed');
    badge.setState('warning');
    expect(captured.className).toBe('mc-self-check is-warning');
  });
});

describe('scriptedFixJson (sim determinism)', () => {
  it('is a pure identity pass-through — same input always yields the same text', () => {
    const spec: TileSpec = { type: 'switch', deviceId: 'd2', label: 'Fan' };
    expect(scriptedFixJson(spec)).toBe(JSON.stringify(spec));
    expect(scriptedFixJson(spec)).toBe(scriptedFixJson(spec));
  });
});

describe('runSelfCheck', () => {
  it('passes immediately with no fix pass when the tile checks out', async () => {
    const host = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const btn = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 }, { 'aria-label': 'Power' });
    btn.parentElement = host;
    let badgeEl: any = null;
    const doc = fakeDoc([btn], { body: { append: (...els: any[]) => { for (const e of els) if (typeof e.className === 'string' && e.className.includes('mc-self-check')) badgeEl = e; } } });
    const logs: string[] = [];
    const requestFix = vi.fn();
    const applyFix = vi.fn();
    const stat = await runSelfCheck({
      host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, doc,
      log: (_e, _v, d) => logs.push(d), requestFix, applyFix,
    });
    expect(stat.passed).toBe(true);
    expect(stat.fixPassS).toBeNull();
    expect(typeof stat.dumpReplayMs).toBe('number');
    expect(requestFix).not.toHaveBeenCalled();
    expect(applyFix).not.toHaveBeenCalled();
    expect(badgeEl.className).toBe('mc-self-check is-passed');
    expect(logs.some((d) => d.includes('tap replay ok'))).toBe(true);
  });

  it('runs at most one Gemini fix pass, and leaves the warning mark if it still fails', async () => {
    const host = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const newHost = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const doc = fakeDoc([]); // no controls anywhere — the lamp's one expected control never renders
    const logs: string[] = [];
    const requestFix = vi.fn().mockResolvedValue('{"type":"lamp","deviceId":"d1","label":"Desk lamp"}');
    const applyFix = vi.fn().mockResolvedValue(newHost);
    const stat = await runSelfCheck({
      host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, doc,
      log: (_e, _v, d) => logs.push(d), requestFix, applyFix,
    });
    expect(requestFix).toHaveBeenCalledTimes(1);
    expect(applyFix).toHaveBeenCalledTimes(1);
    expect(stat.passed).toBe(false);
    expect(stat.fixPassS).not.toBeNull();
    expect(logs.some((d) => d.includes('still') && d.includes('after one fix'))).toBe(true);
  });

  it('marks a warning with no fix pass when the host offers none', async () => {
    const host = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const doc = fakeDoc([]);
    let badgeEl: any = null;
    const bodiedDoc = { ...doc, body: { append: (...els: any[]) => { for (const e of els) if (typeof e.className === 'string' && e.className.includes('mc-self-check')) badgeEl = e; } } };
    const stat = await runSelfCheck({ host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, doc: bodiedDoc, log: () => {} });
    expect(stat.passed).toBe(false);
    expect(badgeEl.className).toBe('mc-self-check is-warning');
  });
});
