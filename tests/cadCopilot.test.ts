// CAD copilot (src/cad): guideline check, staircase, plan Q&A, typed tool set,
// copilot parsing, materials, layers. All deterministic, no network.

import { describe, expect, it } from 'vitest';
import { PlanEngine } from '../src/plan/engine';
import { validatePlanOp } from '../src/plan/ops';
import type { PlanDoc } from '../src/plan/doc';
import { checkGuidelines, guidelineSet, roomKind, GUIDELINE_LABEL, GUIDELINE_NOTE, summarizeReport } from '../src/cad/guidelines';
import { planStair, parseFloorHeight, proposeStair, stairLegend } from '../src/cad/stairs';
import { answerPlanQuestion, isPlanQuestion, isSimplePlanQuestion } from '../src/cad/planQA';
import { CAD_TOOLS, coerceToolCall, toolToAction, describeCall, CAD_TOOL_CONSTRAINT, cadToolPrompt } from '../src/cad/tools';
import { parseCopilot, regionFromWords, isInstantCopilot, shouldNanoPickIntent, refineCadPick, copilotAnswerPrompt, compactPlanSummary } from '../src/cad/copilot';
import { coerceMaterialPlan, coerceSetMaterialsOp, colorFromMaterialName, isSetMaterialsOp, makeSetMaterialsOp, presetFor, MATERIAL_PRESETS, CONVERT_LOOK, sunVector } from '../src/cad/materials';
import { filterLayers, layerFromWords } from '../src/cad/layers';
import { fixtureSymbol } from '../src/plan/fixtures';

function run(engine: PlanEngine, env: Record<string, unknown>) {
  const v = validatePlanOp(env);
  if (!v.ok) throw new Error(v.error);
  const r = engine.apply(v.op);
  if (!r.ok) throw new Error(r.error);
}

function house(): PlanEngine {
  const e = new PlanEngine();
  run(e, { op: 'add_room', x: 0, y: 0, w: 4000, h: 3500, name: 'Bedroom' });
  run(e, { op: 'add_room', x: 4000, y: 0, w: 1400, h: 1200, name: 'Bath' });
  return e;
}
const docOf = (e: PlanEngine): PlanDoc => e.getState();

describe('guideline check', () => {
  it('is labelled a guideline check with the not-certified note', () => {
    const r = checkGuidelines(docOf(house()));
    expect(r.label).toBe(GUIDELINE_LABEL);
    expect(r.note).toMatch(/not certified/i);
    expect(GUIDELINE_NOTE).toMatch(/design aid/i);
  });

  it('flags a too-small bathroom area and passes a big bedroom', () => {
    const r = checkGuidelines(docOf(house()), 'international');
    const ids = r.issues.map((i) => i.rule);
    expect(ids).toContain('room-area'); // 1.4 × 1.2 = 1.68 m² < 2.5
    expect(r.issues.some((i) => i.message.includes('Bedroom') && i.rule === 'room-area')).toBe(false);
  });

  it('region is a swappable layer: India allows a 1.8 m² bathroom', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_room', x: 0, y: 0, w: 1500, h: 1300, name: 'Bathroom' }); // 1.95 m²
    expect(checkGuidelines(docOf(e), 'india').issues.some((i) => i.rule === 'room-area')).toBe(false);
    expect(checkGuidelines(docOf(e), 'international').issues.some((i) => i.rule === 'room-area')).toBe(true);
    expect(guidelineSet('nope').id).toBe('international');
  });

  it('flags a narrow door with a fix op to the region minimum', () => {
    const e = house();
    const wall = docOf(e).walls[0].id;
    run(e, { op: 'add_door', target: wall, width: 700 });
    const r = checkGuidelines(docOf(e), 'india');
    const door = r.issues.find((i) => i.rule === 'door-width');
    expect(door?.fix).toMatchObject({ op: 'set_width', width: 800 });
  });

  it('checks stair rise and tread', () => {
    const e = new PlanEngine();
    run(e, { op: 'add_fixture', kind: 'stairs', x: 0, y: 0, w: 2000, d: 1000, rotation: 0, steps: 12, rise: 250 });
    const rules = checkGuidelines(docOf(e)).issues.map((i) => i.rule);
    expect(rules).toContain('stair-rise');
    expect(rules).toContain('stair-tread'); // 2000/12 = 167 mm
  });

  it('classifies rooms by name', () => {
    expect(roomKind('Master Bedroom')).toBe('habitable');
    expect(roomKind('WC')).toBe('wc');
    expect(roomKind('Kitchen')).toBe('kitchen');
    expect(roomKind('Store')).toBeNull();
  });

  it('summarises in one line', () => {
    expect(summarizeReport(checkGuidelines(docOf(house())))).toMatch(/Guideline check/);
  });
});

describe('staircase', () => {
  it('keeps rise and tread inside the guideline range', () => {
    for (const region of ['international', 'india', 'us'] as const) {
      const g = guidelineSet(region);
      for (const h of [2700, 3000, 3200, 3600]) {
        const p = planStair(h, g);
        expect(p.rise).toBeLessThanOrEqual(g.stair.riseMax + 1e-9);
        expect(p.rise).toBeGreaterThanOrEqual(g.stair.riseMin - 1e-9);
        expect(p.tread).toBeGreaterThanOrEqual(g.stair.treadMin);
        expect(Math.abs(p.rise * p.risers - h)).toBeLessThan(1e-6);
      }
    }
  });

  it('parses floor heights in m, cm, mm and feet', () => {
    expect(parseFloorHeight('3 metres')).toBe(3000);
    expect(parseFloorHeight('floor height 3.2 m')).toBe(3200);
    expect(parseFloorHeight('300 cm')).toBe(3000);
    expect(parseFloorHeight('2850 mm')).toBe(2850);
    expect(parseFloorHeight('10 feet')).toBe(3048);
    expect(parseFloorHeight('a staircase')).toBeNull();
  });

  it('proposes ONE batch op (stairs + legend) that the engine accepts and checks clean', () => {
    const e = house();
    const p = proposeStair(docOf(e), { floorHeight: 3000, region: 'international' });
    expect(p.op.op).toBe('batch');
    expect(p.legend).toMatch(/^UP · \d+ risers × \d+ mm · tread \d+ mm/);
    run(e, p.op);
    const d = docOf(e);
    const st = d.fixtures.find((f) => f.kind === 'stairs')!;
    expect(st.steps).toBe(p.plan.risers);
    expect(d.texts.some((t) => t.text === p.legend)).toBe(true);
    // The stair it designed passes its own guideline check.
    expect(checkGuidelines(d).issues.filter((i) => i.category === 'stairs')).toEqual([]);
    // One undo removes the whole stair + legend.
    run(e, { op: 'undo' });
    expect(docOf(e).fixtures.length).toBe(0);
    expect(docOf(e).texts.length).toBe(0);
  });

  it('draws one tread line per riser (minus one) and a DN legend', () => {
    const syms = fixtureSymbol({ kind: 'stairs', w: 3000, d: 1000, steps: 10 });
    expect(syms.filter((s) => s.t === 'line').length).toBe(9 + 3);
    expect(stairLegend(planStair(3000, guidelineSet('us')), 'down')).toMatch(/^DN/);
  });
});

describe('plan questions (numbers from the drawing)', () => {
  it('answers wall thickness from the data', () => {
    const e = house();
    expect(answerPlanQuestion(docOf(e), "what's the wall thickness?")?.text).toMatch(/\d+ mm thick/);
    const wall = docOf(e).walls[0];
    run(e, { op: 'select', target: wall.id });
    expect(answerPlanQuestion(docOf(e), 'how thick is this wall?')?.text).toBe(`This wall is ${wall.thickness} mm thick.`);
  });

  it('answers room size and door widths', () => {
    const e = house();
    expect(answerPlanQuestion(docOf(e), 'how big is the bedroom?')?.text).toMatch(/4\.00 m by 3\.50 m, about 14\.0 m²/);
    run(e, { op: 'add_door', target: docOf(e).walls[0].id, width: 900 });
    expect(answerPlanQuestion(docOf(e), 'how wide are the doors?')?.text).toMatch(/900 mm/);
  });

  it('separates questions from edits', () => {
    expect(isPlanQuestion("what's the wall thickness?")).toBe(true);
    expect(isPlanQuestion('how big is the kitchen')).toBe(true);
    expect(isPlanQuestion('make this wall 4 meters long')).toBe(false);
    expect(isPlanQuestion('play some music')).toBe(false);

    expect(isPlanQuestion('wall thickness')).toBe(true);
    expect(isPlanQuestion('door width of the bathroom')).toBe(true);
    expect(answerPlanQuestion(docOf(house()), 'wall thickness')?.kind).toBe('wall-thickness');
    expect(isSimplePlanQuestion("what's the wall thickness?")).toBe(true);
    expect(isSimplePlanQuestion('how big is the bedroom?')).toBe(true);
    expect(isSimplePlanQuestion('how wide are the doors?')).toBe(true);
    expect(isSimplePlanQuestion('Does the bathroom door leave enough width for a wheelchair, and what is the wall thickness?')).toBe(false);
    expect(isSimplePlanQuestion('Should we take down the wall between the kitchen and the living room?')).toBe(false);
  });

  it('compacts a plan summary and keeps the copilot prompt short', () => {
    const walls = Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, lenMm: 4000, thick: 100 }));
    const raw = JSON.stringify({
      rev: 3,
      selected: 'w0',
      walls,
      openings: [{ id: 'd1', kind: 'door', wall: 'w0', width: 900 }],
      rooms: [{ id: 'r1', name: 'Bedroom', areaM2: 14 }],
      dims: 2,
    });
    const compact = compactPlanSummary(raw);
    expect(compact.length).toBeLessThan(raw.length + 1);
    expect(compact).toMatch(/"thick":100/);
    expect(compact).toMatch(/900/);
    const prompt = copilotAnswerPrompt('Does the bathroom door leave enough width for a wheelchair?', raw, 'International');
    expect(prompt.length).toBeLessThan(900);
    expect(prompt).toMatch(/never certified compliance/i);
    expect(prompt).toContain('wheelchair');

  });
});

describe('typed CAD tool set', () => {
  it('covers draw, edit, delete, stairs, layers, view, 3D, walk and checks', () => {
    const names = CAD_TOOLS.map((t) => t.name);
    for (const n of ['add_wall', 'add_room', 'add_door', 'add_window', 'move', 'delete', 'add_stair', 'add_dim', 'show_layer', 'zoom', 'view_3d', 'walkthrough', 'guideline_check', 'measure', 'set_materials']) {
      expect(names).toContain(n);
    }
    expect((CAD_TOOL_CONSTRAINT.properties as Record<string, unknown>).tool).toBeTruthy();
    expect(cadToolPrompt('{}')).toMatch(/add_stair/);
  });

  it('rejects unknown tools and missing required args; drops unknown args', () => {
    expect(coerceToolCall({ tool: 'explode' })).toBeNull();
    expect(coerceToolCall({ tool: 'set_length', args: {} })).toBeNull();
    expect(coerceToolCall({ tool: 'set_length', args: { length: '4000', evil: 1 } })).toEqual({ tool: 'set_length', args: { length: 4000 } });
  });

  it('maps edits to plan ops that validate, and views to app actions', () => {
    const a = toolToAction({ tool: 'move', args: { dx: 500 } });
    expect(a.kind).toBe('op');
    if (a.kind === 'op') expect(validatePlanOp(a.op).ok).toBe(true);
    const b = toolToAction({ tool: 'show_layer', args: { layer: 'furniture', visible: false } });
    expect(b).toMatchObject({ kind: 'app', action: 'show_layer' });
    expect(toolToAction({ tool: 'show_layer', args: { layer: 'cats' } }).kind).toBe('error');
    expect(describeCall({ tool: 'add_stair', args: {} })).toMatch(/staircase/);
  });
});

describe('copilot parsing', () => {
  const tool = (u: string, walking = false) => {
    const r = parseCopilot(u, { walking });
    return r && r.kind === 'tool' ? r.call : null;
  };
  it('routes the three CAD asks', () => {
    expect(tool('does my current drawing follow all code regulations?')?.tool).toBe('guideline_check');
    expect(tool('check my plan against NBC rules')?.args).toEqual({ region: 'india' });
    expect(tool('build me a staircase for 3.2 metres')).toEqual({ tool: 'add_stair', args: { floorHeight: 3200 } });
    expect(tool('convert my 2D to 3D render')?.tool).toBe('set_materials');
  });
  it('site visit: walkthrough, plan questions, walk steps', () => {
    expect(tool('give me a virtual walkthrough')).toEqual({ tool: 'walkthrough', args: { on: true } });
    expect(tool("what's the wall thickness?")?.tool).toBe('measure');
    expect(tool('turn left', true)).toEqual({ tool: 'walk_step', args: { step: 'turn_left' } });
    expect(tool('forward', true)?.args).toEqual({ step: 'forward' });
    expect(tool('stop', true)).toEqual({ tool: 'walkthrough', args: { on: false } });
    expect(tool('forward', false)).toBeNull();
  });
  it('review + checklist meta', () => {
    expect(parseCopilot('accept all')).toEqual({ kind: 'meta', meta: 'accept-all' });
    expect(parseCopilot('revert the last change')).toEqual({ kind: 'meta', meta: 'revert-last' });
    expect(parseCopilot('show me the history')).toEqual({ kind: 'meta', meta: 'open-changes' });
    expect(parseCopilot('email the client')).toEqual({ kind: 'meta', meta: 'email-client' });
    expect(parseCopilot('open the site checklist')).toEqual({ kind: 'meta', meta: 'open-checklist' });
  });
  it('layers and zoom; leaves normal edits alone', () => {
    expect(tool('hide the furniture')).toEqual({ tool: 'show_layer', args: { layer: 'furniture', visible: false } });
    expect(tool('zoom in')?.args).toEqual({ to: 'in' });
    expect(parseCopilot('add a door')).toBeNull();
    expect(parseCopilot('make this wall 4 meters')).toBeNull();
    expect(regionFromWords('in bangalore')).toBe('india');
  });
});

describe('3D materials (data, no image model)', () => {
  it('coerces untrusted JSON: bad colours fall back, numbers clamp', () => {
    const p = coerceMaterialPlan({ walls: { color: '#ABCDEF', roughness: 7 }, floor: { color: 'red' }, lighting: { sunElevation: 200 } });
    expect(p?.walls).toMatchObject({ color: '#abcdef', roughness: 1 });
    expect(p?.floor.color).toBe(MATERIAL_PRESETS.default.floor.color);
    expect(p?.lighting.sunElevation).toBe(89);
    expect(coerceMaterialPlan({ walls: { color: 'nope' } })).toBeNull();
  });
  it('offline presets from her words; sun vector points up', () => {
    expect(presetFor('evening light').label).toBe('Evening');
    expect(sunVector(MATERIAL_PRESETS.warm.lighting).z).toBeGreaterThan(0);
    expect(presetFor('convert 2D to 3D')).toEqual(CONVERT_LOOK);
    expect(presetFor('convert 2D to 3D').walls.name).toBe('matte white paint');
    expect(presetFor('convert 2D to 3D').floor.name).toBe('light oak parquet');
  });
  it('resolves paint and wood names when the model skips hex', () => {
    expect(colorFromMaterialName('matte white paint')).toBe('#f7f6f2');
    expect(colorFromMaterialName('light oak parquet')).toBe('#e4c9a0');
    expect(colorFromMaterialName('red')).toBeNull();
    const p = coerceMaterialPlan({
      walls: { name: 'matte white paint', color: 'white' },
      floor: { name: 'light oak parquet', color: 'light oak' },
      lighting: { sunIntensity: 1.5 },
    });
    expect(p?.walls.color).toBe('#f7f6f2');
    expect(p?.floor.color).toBe('#e4c9a0');
    const dark = coerceMaterialPlan({
      walls: { name: 'matte white paint', color: '#4a4a32' },
      floor: { name: 'light oak parquet', color: '#2a1a10' },
      lighting: { ambientIntensity: 1 },
    });
    expect(dark?.walls.color).toBe('#f7f6f2');
    expect(dark?.floor.color).toBe('#e4c9a0');
    const grey = coerceMaterialPlan({
      walls: { name: 'matte white paint', color: '#cbd5e1' },
      floor: { name: 'light oak parquet', color: '#e5e7eb' },
      lighting: { ambientIntensity: 1 },
    });
    expect(grey?.walls.color).toBe('#f7f6f2');
    expect(grey?.floor.color).toBe('#e4c9a0');
  });
});

describe('layers (view only)', () => {
  it('hides furniture without touching the drawing', () => {
    const e = house();
    run(e, { op: 'add_fixture', kind: 'sofa', x: 1000, y: 1000, w: 2000, d: 900, rotation: 0 });
    const d = docOf(e);
    expect(filterLayers(d, new Set(['furniture'])).fixtures.length).toBe(0);
    expect(d.fixtures.length).toBe(1);
    expect(layerFromWords('the dimensions')).toBe('dims');
  });
});

describe('Nano-first copilot routing', () => {
  it('keeps accept / reject / walk-stop on rules even when Nano is ready', () => {
    expect(isInstantCopilot(parseCopilot('accept'))).toBe(true);
    expect(isInstantCopilot(parseCopilot('reject all'))).toBe(true);
    expect(isInstantCopilot(parseCopilot('stop', { walking: true }))).toBe(true);
    expect(isInstantCopilot(parseCopilot('convert 2D to 3D'))).toBe(false);
    expect(isInstantCopilot(parseCopilot('check my plan'))).toBe(false);
  });

  it('offers recognised canvas tools to Nano when the on-device model is ready', () => {
    const convert = parseCopilot('convert 2D to 3D');
    expect(shouldNanoPickIntent(true, convert)).toBe(true);
    expect(shouldNanoPickIntent(false, convert)).toBe(false);
    expect(shouldNanoPickIntent(true, parseCopilot('accept'))).toBe(false);
    expect(shouldNanoPickIntent(true, parseCopilot('hello there'))).toBe(false);
    expect(cadToolPrompt('{}')).toMatch(/set_materials/);
    expect(describeCall({ tool: 'set_materials', args: { style: 'convert 2D to 3D' } })).toMatch(/3D view/);
    expect(refineCadPick('convert 2D to 3D', { tool: 'view_3d', args: { on: true } }).tool).toBe('set_materials');
    expect(refineCadPick('3D view', { tool: 'view_3d', args: { on: true } }).tool).toBe('view_3d');
    expect(refineCadPick('convert 2D to 3D', { tool: 'set_materials', args: { style: 'warm' } }).args).toEqual({ style: 'warm' });
  });
});

describe('set_materials change-log op', () => {
  it('round-trips a materials proposal and drops junk', () => {
    const plan = MATERIAL_PRESETS.warm;
    const op = makeSetMaterialsOp(plan, MATERIAL_PRESETS.default, false);
    expect(isSetMaterialsOp(op)).toBe(true);
    const got = coerceSetMaterialsOp(op);
    expect(got?.plan.label).toBe('Warm home');
    expect(got?.previous3d).toBe(false);
    expect(coerceSetMaterialsOp({ op: 'add_room' })).toBeNull();
    expect(coerceSetMaterialsOp({ op: 'set_materials', plan: { walls: { color: 'nope' } } })).toBeNull();
  });
});
