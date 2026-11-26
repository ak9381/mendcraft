import { describe, expect, it } from 'vitest';
import { PlanEngine } from '../../src/plan/engine';
import { validatePlanOp, type PlanOp } from '../../src/plan/ops';
import { buildPlanTemplate } from '../../src/plan/templates';
import type { PlanDoc } from '../../src/plan/doc';
import { scriptedEngine, type SentInfo, type SurfaceEngine } from '../../src/canvas/aiTurn';
import {
  applyPlanEdit, buildPlanEditRequest, findRoom, isPlanEditAsk, isPlanEditOnPlanBoard, parsePlanEdit, planRooms, runPlanEditTurn, simPlanEdit, stackedWallPairs, PLAN_EDIT_FAIL,
} from '../../src/canvas/planEdit';
import { roomArea } from '../../src/plan/doc';
import { unsupportedConstraintKeywords } from '../../src/canvas/nanoPlan';
import { diffPlanDocs } from '../../src/canvas/planDiff';
import { opWord } from '../../src/canvas/reviewDialog';

function twoBedroom(): PlanDoc {
  const e = new PlanEngine();
  const ops = buildPlanTemplate('twoBedroom').map((o) => validatePlanOp(o)).filter((v): v is { ok: true; op: PlanOp } => v.ok).map((v) => v.op);
  e.applyGenerated(ops);
  return structuredClone(e.getState());
}

/** A live on-device engine that replies with fixed texts, in order. */
function fakeNano(replies: string[], handoff?: SurfaceEngine): SurfaceEngine & { prompts: string[] } {
  const prompts: string[] = [];
  return {
    id: 'nano', sim: false, prompts, handoff,
    async stream(prompt, onText, o) { prompts.push(prompt); o?.onStart?.(); o?.onReady?.(); const r = replies.shift() ?? ''; onText(r); return r; },
  };
}
function fakeGemini(reply: string): SurfaceEngine & { calls: number } {
  const e = {
    id: 'gemini' as const, sim: false, calls: 0,
    async stream(_p: string, onText: (f: string) => void, o?: { onCloudSend?: () => void }) { e.calls++; o?.onCloudSend?.(); onText(reply); return reply; },
  };
  return e as never;
}

describe('plan edit: rooms, prompt, parse', () => {
  const doc = twoBedroom();
  const rooms = planRooms(doc);
  it('reads the kept plan as five named rooms', () => {
    expect(rooms.map((r) => r.name)).toEqual(['Bedroom 1', 'Bedroom 2', 'Living room', 'Kitchen', 'Bathroom']);
    expect(findRoom(rooms, 'bedroom two')?.name).toBe('Bedroom 2');
    expect(findRoom(rooms, 'the kitchen')?.name).toBe('Kitchen');
  });
  it('gives Nano the rooms as compact context and a schema Chrome accepts', () => {
    const r = buildPlanEditRequest('add a study next to bedroom 2', rooms);
    expect(r.user).toContain('Bedroom 2 4x3 m at (4,3)');
    expect(r.user).toContain('She said: "add a study next to bedroom 2"');
    expect(unsupportedConstraintKeywords(r.constraint)).toEqual([]);
    expect(r.prompt.length).toBeLessThan(900);
  });
  it('refuses a reply that names no real room, or says none', () => {
    expect(parsePlanEdit('{"a":"add","r":"Garage","n":"Study"}', rooms).ok).toBe(false);
    expect(parsePlanEdit('{"a":"none"}', rooms).ok).toBe(false);
    expect(parsePlanEdit('Okay, I can do that!', rooms).ok).toBe(false);
    expect(parsePlanEdit('{"a":"add","r":"Bedroom 2"}', rooms).ok).toBe(false); // no name
  });
  it('a bare edit on the plan board needs a room of this plan, or "it" + a size or side', () => {
    const names = rooms.map((r) => r.name);
    expect(isPlanEditOnPlanBoard('widen bedroom two', names)).toBe(true);
    expect(isPlanEditOnPlanBoard('make it 1 m wider', names)).toBe(true);
    expect(isPlanEditOnPlanBoard('make me laugh', names)).toBe(false);
    expect(isPlanEditOnPlanBoard('call my daughter', names)).toBe(false);
  });
  it('tells plan edits from other asks', () => {
    for (const t of ['add a study next to bedroom 2', 'remove the bathroom', 'make the kitchen bigger', 'add a window to bedroom 1', 'add stairs in the living room']) expect(isPlanEditAsk(t), t).toBe(true);
    for (const t of ['hi', 'turn on the desk lamp', 'make a dashboard', 'add a lamp to the kitchen', 'what is a bedroom']) expect(isPlanEditAsk(t), t).toBe(false);
  });
});

describe('plan edit: applied to a copy', () => {
  const doc = twoBedroom();
  const before = JSON.stringify(doc);
  it('adds a study beside bedroom 2, sharing its wall, with a door', () => {
    const r = applyPlanEdit(doc, { a: 'add', r: 'Bedroom 2', n: 'Study' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const study = planRooms(r.value.doc).find((x) => x.name === 'Study')!;
    expect(study).toMatchObject({ x: 8000, y: 3000, w: 3000, h: 3000 });
    expect(r.value.summary).toBe('Add Study (3 × 3 m) east of Bedroom 2');
    expect(r.value.doc.openings.length).toBe(doc.openings.length + 1);
    expect(JSON.stringify(doc)).toBe(before); // the original is untouched
    const changes = diffPlanDocs(doc, r.value.doc);
    expect(changes).toContainEqual(expect.objectContaining({ op: 'add', label: 'Study' }));
    const doors = changes.find((c) => c.label === 'Doors');
    expect(doors).toMatchObject({ op: 'change', detail: '5, now 6' });
    expect(opWord(doors!)).toBe('Change'); // not read as a rename
  });
  it('removes a room but keeps the walls its neighbours share', () => {
    const r = applyPlanEdit(doc, { a: 'remove', r: 'Bedroom 2' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(planRooms(r.value.doc).map((x) => x.name)).not.toContain('Bedroom 2');
    expect(planRooms(r.value.doc).find((x) => x.name === 'Bedroom 1')).toMatchObject({ x: 0, y: 3000, w: 4000, h: 3000 });
    expect(diffPlanDocs(doc, r.value.doc)).toContainEqual(expect.objectContaining({ op: 'remove', label: 'Bedroom 2' }));
  });
  it('renames, widens into free space, adds a window and stairs', () => {
    const ren = applyPlanEdit(doc, { a: 'rename', r: 'Bedroom 2', n: 'Study' });
    expect(ren.ok).toBe(true);
    if (ren.ok) expect(diffPlanDocs(doc, ren.value.doc)).toContainEqual(expect.objectContaining({ op: 'change', label: 'Bedroom 2', detail: 'renamed to Study' }));
    const big = applyPlanEdit(doc, { a: 'resize', r: 'Bedroom 2', s: 'n', m: 1 });
    expect(big.ok).toBe(true);
    if (big.ok) {
      expect(planRooms(big.value.doc).find((x) => x.name === 'Bedroom 2')).toMatchObject({ w: 4000, h: 4000 });
      expect(big.value.doc.openings.filter((o) => o.kind === 'window').length).toBe(doc.openings.filter((o) => o.kind === 'window').length);
    }
    expect(applyPlanEdit(doc, { a: 'window', r: 'Kitchen' }).ok).toBe(true);
    const st = applyPlanEdit(doc, { a: 'stairs', r: 'Living room' });
    expect(st.ok && st.value.doc.fixtures.some((f) => f.kind === 'stairs')).toBe(true);
  });
  it('refuses an edit that would run into another room', () => {
    expect(applyPlanEdit(doc, { a: 'resize', r: 'Bedroom 1', s: 'e', m: 1 }).ok).toBe(false);
  });
  it('the SIM rules read the common phrasings', () => {
    const rooms = planRooms(doc);
    expect(JSON.parse(simPlanEdit('add a study next to bedroom 2', rooms))).toEqual({ a: 'add', r: 'Bedroom 2', n: 'Study' });
    expect(JSON.parse(simPlanEdit('remove the bathroom', rooms))).toEqual({ a: 'remove', r: 'Bathroom' });
    expect(JSON.parse(simPlanEdit('what time is it', rooms))).toEqual({ a: 'none' });
  });
});

describe('plan edit turn (fake models)', () => {
  const doc = twoBedroom();
  const said = 'add a study next to bedroom 2';
  it('valid Nano edit → an edited copy, Nano only, nothing sent', async () => {
    const gem = fakeGemini('{"a":"none"}');
    const nano = fakeNano(['{"a":"add","r":"Bedroom 2","n":"Study"}'], gem);
    const sent: SentInfo[] = [];
    const out = await runPlanEditTurn(said, doc, nano, { onSent: (s) => sent.push(s) }, { canHandoff: () => true });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.si.engine).toBe('nano');
    expect(out.si.sent).toBeNull();
    expect(gem.calls).toBe(0);
    expect(sent.map((s) => s.engine)).toEqual(['nano']);
    expect(planRooms(out.value.doc).some((r) => r.name === 'Study')).toBe(true);
  });
  it('invalid edits → refused after one repair; nothing changes', async () => {
    const nano = fakeNano(['Okay, I can do that!', '{"a":"add","r":"Attic","n":"Study"}']);
    const snapshot = JSON.stringify(doc);
    const out = await runPlanEditTurn(said, doc, nano, {}, { canHandoff: () => false });
    expect(out.ok).toBe(false);
    expect(nano.prompts.length).toBe(2);
    expect(JSON.stringify(doc)).toBe(snapshot);
    expect(PLAN_EDIT_FAIL).toBe('I couldn’t change the plan — try drawing it with your hand or say it another way.');
  });
  it('offline → Nano only: no Gemini call even when Nano fails', async () => {
    const gem = fakeGemini('{"a":"add","r":"Bedroom 2","n":"Study"}');
    const nano = fakeNano(['not json', '{"a":"add","r":"Attic","n":"Study"}'], gem);
    const out = await runPlanEditTurn(said, doc, nano, {}, { canHandoff: () => false });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.offline).toBe(true);
    expect(gem.calls).toBe(0);
  });
  it('online and Nano can’t → Gemini makes it, with its own receipt and booked send', async () => {
    const gem = fakeGemini('{"a":"add","r":"Bedroom 2","n":"Study"}');
    const nano = fakeNano(['not json', 'still not json'], gem);
    const handed: SentInfo[] = [];
    let booked = 0;
    const out = await runPlanEditTurn(said, doc, nano, { onHandoff: (s) => handed.push(s), onCloudSend: () => booked++ }, { canHandoff: () => true });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.si.engine).toBe('gemini');
    expect(out.handedOff).toBe(true);
    expect(handed[0].routeLine).toMatch(/Nano couldn’t make the edit/);
    expect(booked).toBe(1);
  });
  it('a SIM engine is labelled SIM', async () => {
    const out = await runPlanEditTurn(said, doc, scriptedEngine('nano', simPlanEdit(said, planRooms(doc)), { delayMs: 0 }));
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.si.routeLine).toMatch(/^SIM · Nano/);
  });
  it('Nano saying "none" ends the turn: no repair, no Gemini, even online', async () => {
    const gem = fakeGemini('{"a":"add","r":"Bedroom 2","n":"Study"}');
    const nano = fakeNano(['{"a":"none"}'], gem);
    const out = await runPlanEditTurn(said, doc, nano, {}, { canHandoff: () => true });
    expect(out.ok).toBe(false);
    expect(nano.prompts.length).toBe(1);
    expect(gem.calls).toBe(0);
  });
  it('no Nano on this device and offline: Gemini is never called', async () => {
    const gem = fakeGemini('{"a":"add","r":"Bedroom 2","n":"Study"}');
    const sent: SentInfo[] = [];
    const out = await runPlanEditTurn(said, doc, gem, { onSent: (s) => sent.push(s) }, { canHandoff: () => false });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.offline).toBe(true);
    expect(gem.calls).toBe(0);
    expect(sent).toEqual([]);
  });
  it('redacted names: the receipt is what left, and the reply gets the real name back before parsing', async () => {
    const ren = applyPlanEdit(doc, { a: 'rename', r: 'Bedroom 2', n: 'Asha’s room' });
    expect(ren.ok).toBe(true);
    if (!ren.ok) return;
    const prompts: string[] = [];
    const gem = { id: 'gemini' as const, sim: false, async stream(p: string, onText: (f: string) => void) { prompts.push(p); const r = '{"a":"add","r":"PERSON_1’s room","n":"Study"}'; onText(r); return r; } } as SurfaceEngine;
    const sent: SentInfo[] = [];
    const out = await runPlanEditTurn('add a study next to Asha’s room', ren.value.doc, gem, { onSent: (s) => sent.push(s) }, {
      canHandoff: () => true,
      cloudPrompt: (p) => p.replace(/Asha/g, 'PERSON_1'),
      restoreReply: (r) => r.replace(/PERSON_1/g, 'Asha'),
    });
    expect(prompts[0]).not.toContain('Asha');
    expect(sent[0].prompt).toBe(prompts[0]); // the receipt is the prompt that really left
    expect(sent[0].sent).not.toMatch(/addresses/);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.value.summary).toBe('Add Study (3 × 3 m) east of Asha’s room');
  });
  it('two rooms with the same name: asks which, changes nothing, no repair', async () => {
    const twin = applyPlanEdit(doc, { a: 'add', r: 'Bedroom 2', n: 'Study' });
    expect(twin.ok).toBe(true);
    if (!twin.ok) return;
    const d = structuredClone(twin.value.doc);
    d.rooms.find((r) => r.name === 'Study')!.name = 'Bedroom 2';
    const nano = fakeNano(['{"a":"remove","r":"Bedroom 2"}']);
    const out = await runPlanEditTurn('remove bedroom 2', d, nano, {}, { canHandoff: () => true });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.ask).toMatch(/There are 2 rooms called Bedroom 2/);
    expect(nano.prompts.length).toBe(1);
  });
  it('room names and her words reach the prompt without quotes or newlines', () => {
    const d = structuredClone(doc);
    d.rooms[0].name = 'Bed"room\nOne; x';
    const r = buildPlanEditRequest('add a "study"\nnow', planRooms(d));
    expect(r.user.split('\n').length).toBe(2);
    expect(r.user).toContain('Bed room One x');
    expect(r.user).toContain('She said: "add a study now"');
  });
});

describe('plan edit: walls are shared, never stacked', () => {
  it('add and resize never draw a wall on top of another', () => {
    const doc = twoBedroom();
    const base = stackedWallPairs(doc);
    for (const e of [
      { a: 'add', r: 'Bedroom 2', n: 'Study' }, { a: 'add', r: 'Bedroom 1', n: 'Hall', s: 'w' },
      { a: 'resize', r: 'Bedroom 2', s: 'n', m: 1 }, { a: 'resize', r: 'Bathroom', s: 'e', m: 1 },
    ] as const) {
      const r = applyPlanEdit(doc, e);
      if (r.ok) expect(stackedWallPairs(r.value.doc), JSON.stringify(e)).toBeLessThanOrEqual(base);
    }
  });
  it('a neighbour wall running past the new room’s corner is split and shared', () => {
    const e = new PlanEngine();
    e.apply({ op: 'add_room', x: 0, y: 0, w: 4000, h: 3000, name: 'Kitchen' });
    e.apply({ op: 'add_room', x: 4000, y: 0, w: 4000, h: 6000, name: 'Lounge' });
    const doc = structuredClone(e.getState());
    const r = applyPlanEdit(doc, { a: 'add', r: 'Kitchen', n: 'Study', s: 'n' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // (the engine's own add_room already stacked the kitchen's east wall on the lounge's; no new pair)
    expect(stackedWallPairs(r.value.doc)).toBe(stackedWallPairs(doc));
    const lounge = r.value.doc.rooms.find((x) => x.name === 'Lounge')!;
    expect(lounge.wallIds.length).toBe(5);
    expect(roomArea(lounge, r.value.doc)).toBeCloseTo(24_000_000);
    expect(roomArea(r.value.doc.rooms.find((x) => x.name === 'Study')!, r.value.doc)).toBeCloseTo(12_000_000);
    expect(planRooms(r.value.doc).find((x) => x.name === 'Lounge')).toMatchObject({ x: 4000, y: 0, w: 4000, h: 6000 });
  });
  it('keeps a room at least 1.5 m', () => {
    const doc = twoBedroom();
    expect(applyPlanEdit(doc, { a: 'add', r: 'Bedroom 2', n: 'Closet', m: 1 }).ok).toBe(false);
    expect(applyPlanEdit(doc, { a: 'resize', r: 'Bathroom', s: 'e', m: -1 }).ok).toBe(false);
  });
});
