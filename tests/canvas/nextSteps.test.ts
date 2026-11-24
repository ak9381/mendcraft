import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { JourneyStep } from '../../src/canvas/journey';
import {
  createNextStepChips, NEXT_STEP_ROUTE_PATTERNS, nextStepsPrompt, parseNanoPick, routeOf, ruleSuggestions, suggestNextSteps,
  type NextStepCtx,
} from '../../src/canvas/nextSteps';

const STEPS: JourneyStep[] = ['empty', 'devices', 'dashboard', 'music', 'saved', 'floorplan', 'checked', 'language', 'offline', 'shared'];
const ctx: NextStepCtx = { lang: 'en', online: true, phones: 0 };
// The router's world for each step: a plan board exists from the floor-plan
// step on; a speaker exists on the music step.
const world = (step: JourneyStep) => ({
  hasPlanBoard: ['floorplan', 'checked', 'language'].includes(step),
  devices: step === 'music'
    ? [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' as const }, { id: 'speaker-1', label: 'Speaker', kind: 'music' as const }]
    : [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' as const }],
});

describe('ruleSuggestions', () => {
  it.each(STEPS)('%s gives 2–3 steps, each routing to a real command (never the open-ended fallback)', (step) => {
    const steps = ruleSuggestions(step, ctx);
    expect(steps.length).toBeGreaterThanOrEqual(2);
    expect(steps.length).toBeLessThanOrEqual(3);
    expect(new Set(steps.map((s) => s.id)).size).toBe(steps.length);
    for (const s of steps) {
      expect(s.label.length).toBeGreaterThan(0);
      expect(routeOf(s.say, world(step)), `${step}: "${s.say}"`).not.toBe('openEnded');
    }
  });
  it('is deterministic and follows the journey', () => {
    expect(ruleSuggestions('dashboard', ctx)).toEqual(ruleSuggestions('dashboard', ctx));
    expect(ruleSuggestions('music', ctx).map((s) => s.id)).toEqual(['play-music', 'save', 'floorplan']);
    expect(ruleSuggestions('floorplan', ctx).map((s) => s.id)).toEqual(['check', '3d', 'dxf']);
    expect(ruleSuggestions('empty', ctx).map((s) => s.id)).toContain('connect-room');
    expect(ruleSuggestions('empty', ctx).map((s) => s.id)).toContain('floorplan');
    expect(ruleSuggestions('checked', ctx).map((s) => s.id)).toContain('kannada');
  });
  it('drops steps already done on this board and never offers Kannada twice', () => {
    expect(ruleSuggestions('floorplan', { ...ctx, done: ['check'] }).map((s) => s.id)).not.toContain('check');
    expect(ruleSuggestions('saved', { ...ctx, lang: 'kn' }).map((s) => s.id)).not.toContain('kannada');
    expect(ruleSuggestions('floorplan', { ...ctx, done: ['check', '3d', 'dxf'] }).length).toBeGreaterThanOrEqual(2);
  });
  it('only routes a step whose command exists in this build (no phone / offline phrases yet)', () => {
    const all = STEPS.flatMap((s) => ruleSuggestions(s, ctx).map((x) => x.say.toLowerCase()));
    expect(all.some((s) => /phone|offline/.test(s))).toBe(false);
  });
});

describe('routeOf mirrors run() in canvasApp.ts', () => {
  it('every inline pattern it copies is still in run()', () => {
    const src = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
    for (const re of Object.values(NEXT_STEP_ROUTE_PATTERNS)) expect(src, re.source).toContain(re.source);
  });
  it('sends routed phrases to their command and anything else to the open-ended turn', () => {
    const w = world('music');
    expect(routeOf('save', w)).toBe('canvas:save');
    expect(routeOf('play music', w)).toBe('device');
    expect(routeOf('play music', world('dashboard'))).not.toBe('device');
    expect(routeOf('connect this room', w)).toBe('connectRoom');
    expect(routeOf('draw the floor plan', w)).toBe('floorPlan');
    expect(routeOf('add kannada', w)).toBe('kannada');
    expect(routeOf('check accessibility', { ...w, hasPlanBoard: true })).toBe('planExtra:check');
    expect(routeOf('send it to my phone', w)).toBe('openEnded');
  });
});

describe('parseNanoPick', () => {
  const allowed = ruleSuggestions('floorplan', ctx);
  it('keeps Nano order and drops unknown ids', () => {
    expect(parseNanoPick('{"ids":["dxf","hack","check"]}', allowed)?.map((s) => s.id)).toEqual(['dxf', 'check']);
  });
  it('rejects junk, non-arrays, duplicates-only and too-short picks', () => {
    expect(parseNanoPick('not json', allowed)).toBeNull();
    expect(parseNanoPick('{"ids":"check"}', allowed)).toBeNull();
    expect(parseNanoPick('{"ids":["nope","zzz"]}', allowed)).toBeNull();
    expect(parseNanoPick('{"ids":["check","check"]}', allowed)).toBeNull();
    expect(parseNanoPick('', allowed)).toBeNull();
  });
  it('caps at three', () => {
    const many = ruleSuggestions('empty', ctx);
    const ids = JSON.stringify({ ids: [...many.map((s) => s.id), ...many.map((s) => s.id)] });
    expect(parseNanoPick(ids, many)!.length).toBeLessThanOrEqual(3);
  });
});

describe('suggestNextSteps', () => {
  it('no Nano → rules, labelled rules', async () => {
    const r = await suggestNextSteps('dashboard', ctx);
    expect(r.source).toBe('rules');
    expect(r.steps).toEqual(ruleSuggestions('dashboard', ctx));
  });
  it('Nano reorders from the allowed list only', async () => {
    const nano = vi.fn(async () => '{"ids":["floorplan","save"]}');
    const r = await suggestNextSteps('music', ctx, nano);
    expect(r.source).toBe('nano');
    expect(r.steps.map((s) => s.id)).toEqual(['floorplan', 'save']);
    const prompt = (nano.mock.calls[0] as unknown as [string])[0];
    for (const s of ruleSuggestions('music', ctx)) expect(prompt).toContain(s.id);
  });
  it('invalid Nano reply → rules', async () => {
    const r = await suggestNextSteps('music', ctx, async () => 'Sure! Play music first.');
    expect(r).toEqual({ steps: ruleSuggestions('music', ctx), source: 'rules' });
  });
  it('Nano reply with only unknown ids → rules', async () => {
    const r = await suggestNextSteps('music', ctx, async () => '{"ids":["delete-everything"]}');
    expect(r.source).toBe('rules');
  });
  it('Nano throwing → rules', async () => {
    const r = await suggestNextSteps('floorplan', ctx, async () => { throw new Error('not ready'); });
    expect(r.source).toBe('rules');
  });
  it('?sim=1 uses rules and never calls Nano', async () => {
    const nano = vi.fn(async () => '{"ids":["save"]}');
    const r = await suggestNextSteps('music', { ...ctx, sim: true }, nano);
    expect(nano).not.toHaveBeenCalled();
    expect(r.source).toBe('rules');
  });
  it('the prompt carries no board content, only the step and allowed ids', () => {
    const p = nextStepsPrompt('music', ruleSuggestions('music', ctx));
    expect(p).toContain('music');
    expect(p).toMatch(/ids/);
  });
});

// ---- chip row (minimal fake DOM; the suite runs in node) -------------------
class FakeEl {
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  className = '';
  textContent = '';
  type = '';
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  listeners: Record<string, Array<(e: { stopPropagation(): void }) => void>> = {};
  isConnected = true;
  constructor(public ownerDocument: { createElement(t: string): FakeEl }) {}
  append(...els: FakeEl[]) { for (const e of els) { e.parentElement = this; this.children.push(e); } }
  remove() { const p = this.parentElement; if (p) p.children = p.children.filter((c) => c !== this); this.parentElement = null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  addEventListener(t: string, f: (e: { stopPropagation(): void }) => void) { (this.listeners[t] ??= []).push(f); }
  click() { this.listeners.click?.forEach((f) => f({ stopPropagation() {} })); }
  all(): FakeEl[] { return this.children.flatMap((c) => [c, ...c.all()]); }
  querySelectorAll(sel: string) { const cls = sel.slice(1); return this.all().filter((e) => e.className.split(' ').includes(cls)); }
  querySelector(sel: string) { return sel === ':scope > .mc-next' ? this.children.find((c) => c.className === 'mc-next') ?? null : null; }
}
const fakeDoc = { createElement: (): FakeEl => new FakeEl(fakeDoc) };
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createNextStepChips', () => {
  function setup(nano?: (p: string) => Promise<string>) {
    const root = new FakeEl(fakeDoc);
    const frame = new FakeEl(fakeDoc);
    root.append(frame);
    const state = { focused: true, tiles: ['plan'], kind: 'plan' };
    const ran: string[] = [];
    const nanoLines: string[] = [];
    const chips = createNextStepChips({
      root: root as unknown as ParentNode,
      focused: () => state.focused ? { id: 'f1', el: frame as unknown as HTMLElement, board: { kind: state.kind, tiles: state.tiles.map((k) => ({ kind: k })), pinned: false } } : null,
      ctx: () => ({ lang: 'en', online: true, phones: 0 }),
      nano,
      run: (s) => ran.push(s),
      onNano: (l) => nanoLines.push(l),
    });
    return { chips, root, frame, state, ran, nanoLines };
  }
  const row = (frame: FakeEl) => frame.children.find((c) => c.className === 'mc-next');
  const labels = (frame: FakeEl) => row(frame)!.children.filter((c) => c.className.includes('mc-next-chip')).map((c) => c.textContent);

  it('renders the rule chips with an honest "Suggested" tag and runs the chip say', async () => {
    const t = setup();
    t.chips.refresh(); await flush();
    expect(labels(t.frame)).toEqual(['Check accessibility', 'Show 3D', 'Export DXF']);
    expect(row(t.frame)!.children[0].textContent).toBe('Suggested');
    row(t.frame)!.children[1].click();
    expect(t.ran).toEqual(['check accessibility']);
    t.chips.refresh(); await flush();
    // Checked now: the journey moves on to Kannada.
    expect(labels(t.frame)[0]).toBe('Add Kannada');
  });
  it('a Nano pick is tagged on-device and logged as a nano line', async () => {
    const t = setup(async () => '{"ids":["3d","check"]}');
    t.chips.refresh(); await flush();
    expect(labels(t.frame)).toEqual(['Show 3D', 'Check accessibility']);
    expect(row(t.frame)!.children[0].textContent).toBe('Nano · on device');
    expect(t.nanoLines[0]).toMatch(/next steps/);
  });
  it('same state does not re-ask; a new step does; overview clears the row', async () => {
    const nano = vi.fn(async () => '{"ids":["check","3d"]}');
    const t = setup(nano);
    t.chips.refresh(); t.chips.refresh(); await flush(); t.chips.refresh(); await flush();
    expect(nano).toHaveBeenCalledTimes(1);
    t.state.kind = 'room'; t.state.tiles = ['lamp', 'music'];
    t.chips.refresh(); await flush();
    expect(nano).toHaveBeenCalledTimes(2);
    t.state.focused = false;
    t.chips.refresh();
    expect(t.root.querySelectorAll('.mc-next')).toHaveLength(0);
  });
});
