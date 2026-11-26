// SELF-CHECK: dump format, every assertion (missing control, unreachable,
// overlap, empty label, unwired action), the one-fix-pass cap, sim
// determinism, and the checking-mark states — all against a fake DOM (same
// trick handPointerPipeline.test.ts uses), no jsdom.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  afterTilesRendered, assertControlCount, assertLabels, assertNonOverlapping, assertReachable, assertWired,
  checkTile, dumpText, dumpTile, expectedControlCount, mountSelfCheckBadge, replayTaps,
  runSelfCheck, selectSelfCheckTargets, statusLine, withScrolledIntoView, type TileDump,
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
  it('still collects a control that sits inside the tile but below the fold', () => {
    const host = fakeHost({ left: 0, top: 2000, width: 200, height: 100 }, { 'data-mc-tile': 't-off' });
    const inside = fakeEl('button', { left: 10, top: 2010, width: 40, height: 20 }, { 'aria-label': 'Power' });
    inside.parentElement = host;
    const dump = dumpTile(host, fakeDoc([inside]));
    expect(dump.controls).toHaveLength(1);
    expect(dump.controls[0].label).toBe('Power');
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
  it('counts one control for a device/scene/connect leaf', () => {
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
  it('expects no controls of its own for a plan board — it has no onXxx action in its schema, ' +
    'unlike lamp/switch/music/scene/connect, because it embeds its own self-contained CAD surface', () => {
    expect(expectedControlCount({ type: 'plan', boardId: 'b1', template: 'studio' })).toBe(0);
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
  it('does not flag a control that sits inside the tile but below the fold — the board is taller than the window, not a broken button', () => {
    const tile = { left: 0, top: 1200, width: 200, height: 100 };
    const el = fakeEl('button', { left: 10, top: 1210, width: 20, height: 20 });
    const doc = fakeDoc([el]);
    const dump: TileDump = { role: 'row', label: 'Row', rect: tile, controls: [{ id: 'a', kind: 'button', label: 'A', rect: el.getBoundingClientRect(), el }] };
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
  it('does NOT fire a real app click handler already bound to the control — the exact shape of ' +
    'the original bug: a Lit tile binds its @click listener at render time, long before the ' +
    'dry-run stop listener existed, so stopping on the control itself (rather than an ancestor) ' +
    'ran too late to prevent it', () => {
    const a = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 }, { 'aria-label': 'A' });
    const doc = fakeDoc([a]);
    let realHandlerFired = false;
    a.addEventListener('click', () => { realHandlerFired = true; }); // the app's own listener, bound first
    const pointer = createHandPointer(doc, { dryRun: true });
    const dump: TileDump = {
      role: 'row', label: 'Row', rect: { left: 0, top: 0, width: 200, height: 40 },
      controls: [{ id: 'a', kind: 'button', label: 'A', rect: a.getBoundingClientRect(), el: a }],
    };
    const replay = replayTaps(pointer, dump);
    pointer.destroy();
    expect(replay).toEqual([{ id: 'a', activated: true }]); // still proves it's wired...
    expect(realHandlerFired).toBe(false); // ...without actually running the real handler
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
  it('does NOT flag a control panned off the viewport as unwired — a dashboard ' +
    'wider/taller than a phone screen leaves tiles off-screen; a tap cannot land ' +
    'there, but that is not a broken wire (same off-viewport rule assertReachable uses)', () => {
    const off = fakeEl('button', { left: -400, top: 300, width: 40, height: 20 }, { 'aria-label': 'Off' });
    const doc = fakeDoc([off]);
    const dump: TileDump = {
      role: 'row', label: 'Row', rect: { left: -500, top: 280, width: 200, height: 60 },
      controls: [{ id: 'off', kind: 'button', label: 'Off', rect: off.getBoundingClientRect(), el: off }],
    };
    const pointer = createHandPointer(doc, { dryRun: true });
    const replay = replayTaps(pointer, dump);
    pointer.destroy();
    expect(replay).toEqual([{ id: 'off', activated: false, offScreen: true }]);
    expect(assertWired(replay)).toEqual([]);
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

describe('withScrolledIntoView', () => {
  it('scrolls the host into view for the callback, then restores every ancestor', () => {
    const parent: any = { scrollTop: 0, scrollLeft: 0, parentElement: null };
    const host: any = {
      scrollTop: 0, scrollLeft: 0, parentElement: parent,
      ownerDocument: { scrollingElement: null },
      scrollIntoView() { parent.scrollTop = 400; },
    };
    const seen = withScrolledIntoView(host, () => parent.scrollTop);
    expect(seen).toBe(400);
    expect(parent.scrollTop).toBe(0);
  });
});

describe('checkTile (plan board chrome)', () => {
  it('passes a plan tile even when nested CAD tools are present — it expects none of its own', () => {
    const host = fakeHost({ left: 0, top: 0, width: 400, height: 300 }, { 'data-mc-tile': 'plan' });
    const tool = fakeEl('button', { left: 8, top: 8, width: 40, height: 20 }, { 'aria-label': 'Select' });
    tool.parentElement = host;
    const outcome = checkTile(host, { type: 'plan', boardId: 'b1', template: 'studio' }, fakeDoc([tool]));
    expect(outcome.ok).toBe(true);
    expect(outcome.failures).toEqual([]);
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
      host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, tileId: 'lamp-d1', doc,
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
      host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, tileId: 'lamp-d1-fixpass', doc,
      log: (_e, _v, d) => logs.push(d), requestFix, applyFix,
    });
    expect(requestFix).toHaveBeenCalledTimes(1);
    expect(applyFix).toHaveBeenCalledTimes(1);
    expect(stat.passed).toBe(false);
    expect(stat.fixPassS).not.toBeNull();
    expect(logs.some((d) => d.includes('still') && d.includes('after one fix'))).toBe(true);
  });

  it('rolls the canvas back to the last good tile when the one-shot fix applies but the re-check still fails', async () => {
    const host = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const broken = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const restored = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    let badgeEl: any = null;
    const doc = fakeDoc([], { body: { append: (...els: any[]) => { for (const e of els) if (typeof e.className === 'string' && e.className.includes('mc-self-check')) badgeEl = e; } } });
    const logs: string[] = [];
    const requestFix = vi.fn().mockResolvedValue('{"type":"lamp"}');
    const applyFix = vi.fn().mockResolvedValue(broken);
    const rollbackFix = vi.fn().mockResolvedValue(restored);
    const commitFix = vi.fn();
    const stat = await runSelfCheck({
      host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, tileId: 'lamp-d1-rollback', doc,
      log: (_e, _v, d) => logs.push(d), requestFix, applyFix, rollbackFix, commitFix,
    });
    expect(applyFix).toHaveBeenCalledTimes(1);
    expect(rollbackFix).toHaveBeenCalledTimes(1);
    expect(commitFix).not.toHaveBeenCalled();
    expect(stat.passed).toBe(false);
    expect(badgeEl.className).toBe('mc-self-check is-warning');
    expect(logs.some((d) => d.includes('restored the last good tile'))).toBe(true);
  });

  it('commits the fix only after the re-check passes', async () => {
    const host = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const fixed = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const btn = fakeEl('button', { left: 10, top: 10, width: 40, height: 20 }, { 'aria-label': 'Power' });
    btn.parentElement = fixed;
    const doc = fakeDoc([]);
    const docAfter = fakeDoc([btn]);
    const requestFix = vi.fn().mockResolvedValue('{"type":"lamp"}');
    const applyFix = vi.fn().mockImplementation(async () => {
      Object.assign(doc, docAfter);
      return fixed;
    });
    const commitFix = vi.fn();
    const rollbackFix = vi.fn();
    const stat = await runSelfCheck({
      host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, tileId: 'lamp-d1-commit', doc,
      log: () => {}, requestFix, applyFix, rollbackFix, commitFix,
    });
    expect(stat.passed).toBe(true);
    expect(commitFix).toHaveBeenCalledTimes(1);
    expect(rollbackFix).not.toHaveBeenCalled();
  });

  it('does not apply a fix the user declined in review — last good tile stays', async () => {
    const host = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const doc = fakeDoc([]);
    const requestFix = vi.fn().mockResolvedValue('{"type":"lamp"}');
    const applyFix = vi.fn();
    const confirmFix = vi.fn().mockResolvedValue(false);
    const logs: string[] = [];
    const stat = await runSelfCheck({
      host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, tileId: 'lamp-d1-declined', doc,
      log: (_e, _v, d) => logs.push(d), requestFix, applyFix, confirmFix,
    });
    expect(confirmFix).toHaveBeenCalledTimes(1);
    expect(applyFix).not.toHaveBeenCalled();
    expect(stat.passed).toBe(false);
    expect(logs.some((d) => d.includes('fix declined'))).toBe(true);
  });

  it('marks a warning with no fix pass when the host offers none', async () => {
    const host = fakeHost({ left: 0, top: 0, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const doc = fakeDoc([]);
    let badgeEl: any = null;
    const bodiedDoc = { ...doc, body: { append: (...els: any[]) => { for (const e of els) if (typeof e.className === 'string' && e.className.includes('mc-self-check')) badgeEl = e; } } };
    const stat = await runSelfCheck({ host, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, tileId: 'lamp-d1-no-fixer', doc: bodiedDoc, log: () => {} });
    expect(stat.passed).toBe(false);
    expect(badgeEl.className).toBe('mc-self-check is-warning');
  });

  it('replaces a tile\'s own mark on a repeat check (e.g. after a drag/resize commit) instead of ' +
    'stacking a new one alongside the stale one — the exact shape of the "mark never follows a ' +
    'moved tile" bug: a leftover first mark always wins a plain `.mc-self-check` lookup', async () => {
    const tileId = 'lamp-wiz-desk';
    const hostBefore = fakeHost({ left: 10, top: 10, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const btnBefore = fakeEl('button', { left: 20, top: 20, width: 40, height: 20 }, { 'aria-label': 'Power' });
    btnBefore.parentElement = hostBefore;
    const mounted: any[] = [];
    const bodyCapture = { append: (...els: any[]) => { for (const e of els) if (typeof e.className === 'string' && e.className.includes('mc-self-check')) mounted.push(e); } };
    const docBefore = fakeDoc([btnBefore], { body: bodyCapture });
    await runSelfCheck({
      host: hostBefore, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, tileId, doc: docBefore,
      log: () => {},
    });
    expect(mounted).toHaveLength(1);
    const firstBadge = mounted[0];

    // The tile moved (drag/resize commit): a fresh host at a new position,
    // self-checked again under the SAME tileId.
    const hostAfter = fakeHost({ left: 400, top: 300, width: 100, height: 40 }, { 'data-mc-tile': 'Desk lamp' });
    const btnAfter = fakeEl('button', { left: 410, top: 310, width: 40, height: 20 }, { 'aria-label': 'Power' });
    btnAfter.parentElement = hostAfter;
    const docAfter = fakeDoc([btnAfter], { body: bodyCapture });
    await runSelfCheck({
      host: hostAfter, spec: { type: 'lamp', deviceId: 'd1', label: 'Desk lamp' }, tileId, doc: docAfter,
      log: () => {},
    });

    // Exactly one LIVE mark for this tile: the stale one was removed before
    // the new one was mounted, so a plain `.mc-self-check` query (which the
    // walk — and a real querySelector — would use) only ever finds the mark
    // at the tile's CURRENT position, not an old one left behind.
    expect(mounted).toHaveLength(2);
    expect(firstBadge.removed).toBe(true);
    const liveMark = mounted[1];
    expect(liveMark.removed).toBe(false);
    expect(liveMark.style.left).toBe(`${400 + 100 - 12}px`);
    expect(liveMark.style.top).toBe(`${300 - 2}px`);
  });
});

describe('assertReachable under app chrome (R4 phone)', () => {
  const tileRect = { left: 0, top: 0, width: 200, height: 200 };
  it('does not flag a board control hidden under the AI panel (chrome outside .mc-world)', () => {
    const world: any = { parentNode: null };
    const el = fakeEl('button', { left: 10, top: 10, width: 20, height: 20 });
    el.parentNode = world;
    const panel = fakeEl('aside', { left: 0, top: 0, width: 400, height: 400 });
    panel.parentNode = null;
    const doc = fakeDoc([el]);
    doc.querySelector = (sel: string) => (sel === '.mc-world' ? world : null);
    doc.elementFromPoint = () => panel;
    const dump: TileDump = { role: 'row', label: 'Row', rect: tileRect, controls: [{ id: 'a', kind: 'button', label: 'A', rect: el.getBoundingClientRect(), el }] };
    expect(assertReachable(dump, doc)).toEqual([]);
  });
  it('still flags a control covered by another board element inside .mc-world', () => {
    const world: any = { parentNode: null };
    const el = fakeEl('button', { left: 10, top: 10, width: 20, height: 20 });
    const other = fakeEl('div', { left: 0, top: 0, width: 400, height: 400 });
    el.parentNode = world; other.parentNode = world;
    const doc = fakeDoc([el]);
    doc.querySelector = (sel: string) => (sel === '.mc-world' ? world : null);
    doc.elementFromPoint = () => other;
    const dump: TileDump = { role: 'row', label: 'Row', rect: tileRect, controls: [{ id: 'a', kind: 'button', label: 'A', rect: el.getBoundingClientRect(), el }] };
    expect(assertReachable(dump, doc)).toEqual([{ kind: 'unreachable', id: 'a' }]);
  });
});
