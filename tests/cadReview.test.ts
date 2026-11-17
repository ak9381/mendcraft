// Reviewed-change pipeline (cad/changeLog + cad/recording) and the site
// checklist (cad/siteChecklist), plus the sync merge and /control cards.

import { describe, expect, it } from 'vitest';
import { createChangeLog, mergeEntries, sanitizeEntry, agoLabel } from '../src/cad/changeLog';
import { withChangeRecording } from '../src/cad/recording';
import { createSiteChecklist, fallbackEmail, mailtoUrl, coerceEmailDraft, isHardQuestion, mergeItems } from '../src/cad/siteChecklist';
import { mergeSiteBook } from '../src/cad/sync';
import { createPlanController } from '../src/plan/controller';
import { buildControlSnapshot, coerceSnapshot } from '../src/relay/controlSnapshot';

function memKV() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
}

describe('change log: AI proposals wait for her', () => {
  it('a proposal does not touch the plan until accepted; accept applies and records before/after', () => {
    const c = createPlanController();
    const log = createChangeLog(memKV());
    const e = log.propose({ actor: 'gemini', tool: 'add_room', title: 'Draw a room', why: 'You asked', op: { op: 'add_room', x: 0, y: 0, w: 3000, h: 3000, name: 'Study' }, before: c.summary(), source: 'cloud' });
    expect(log.pending()).toHaveLength(1);
    expect(c.listItems().length).toBe(0);
    const r = log.accept(e.id, { snapshot: () => c.snapshot(), apply: (op) => c.applyOp(op), summary: () => c.summary() });
    expect(r.ok).toBe(true);
    expect(c.listItems().length).toBeGreaterThan(0);
    const after = log.get(e.id)!;
    expect(after.status).toBe('applied');
    expect(after.after).toBeTruthy();
  });

  it('reject leaves the plan alone; accept twice is refused', () => {
    const c = createPlanController();
    const log = createChangeLog(memKV());
    const e = log.propose({ actor: 'nano', tool: 'delete', title: 'Delete', why: '', op: { op: 'undo' }, before: '', source: 'on-device' });
    expect(log.reject(e.id)).toBe(true);
    expect(log.accept(e.id, { snapshot: () => c.snapshot(), apply: (op) => c.applyOp(op), summary: () => c.summary() }).ok).toBe(false);
  });

  it('revert restores the plan from before the entry and marks later changes reverted', () => {
    const c = createPlanController();
    const log = createChangeLog(memKV());
    const deps = { snapshot: () => c.snapshot(), apply: (op: Record<string, unknown>) => c.applyOp(op), summary: () => c.summary() };
    const a = log.propose({ actor: 'rules', tool: 'add_room', title: 'A', why: '', op: { op: 'add_room', x: 0, y: 0, w: 3000, h: 3000 }, before: '', source: 'rules' });
    log.accept(a.id, deps);
    const b = log.propose({ actor: 'gemini', tool: 'add_room', title: 'B', why: '', op: { op: 'add_room', x: 5000, y: 0, w: 3000, h: 3000 }, before: '', source: 'cloud' });
    log.accept(b.id, deps);
    const roomsBoth = (c.snapshot() as { rooms: unknown[] }).rooms.length;
    expect(roomsBoth).toBe(2);
    expect(log.revertImpact(a.id).map((x) => x.id)).toEqual([b.id]);
    const r = log.revert(a.id, { restore: (d) => c.restoreSnapshot!(d), summary: () => c.summary() });
    expect(r).toMatchObject({ ok: true, count: 2 });
    expect((c.snapshot() as { rooms: unknown[] }).rooms.length).toBe(0);
    expect(log.get(b.id)!.status).toBe('reverted');
    // The revert itself is undoable.
    c.applyOp({ op: 'undo' });
    expect((c.snapshot() as { rooms: unknown[] }).rooms.length).toBe(2);
  });

  it('persists and reloads; sanitizes junk', () => {
    const kv = memKV();
    const log = createChangeLog(kv);
    log.propose({ actor: 'nano', tool: 'x', title: 'T', why: 'W', op: null as never, before: '', source: 'on-device' });
    log.flush();
    expect(createChangeLog(kv).entries()).toHaveLength(1);
    expect(sanitizeEntry({ id: 'a', actor: 'hacker', status: 'applied', at: 1 })).toBeNull();
    expect(mergeEntries([], [{ id: 'z', actor: 'her', status: 'applied', at: 5, tool: 't', title: 't', why: '', op: null, before: '', source: 'rules' }])).toHaveLength(1);
    expect(agoLabel(0, 10_000)).toBe('just now');
  });
});

describe('recording wrapper: her edits are logged', () => {
  it('records applied edits as hers, skips selection, folds a drag', () => {
    let t = 1000;
    const c = createPlanController();
    const log = createChangeLog(memKV(), () => t);
    const rec = withChangeRecording(c, { log, suppressed: () => false, why: () => 'Direct edit', source: () => 'rules', now: () => t });
    rec.applyOp({ op: 'add_room', x: 0, y: 0, w: 3000, h: 3000, name: 'Study' });
    const wall = (c.snapshot() as { walls: { id: string }[] }).walls[0].id;
    rec.applyOp({ op: 'select', target: wall });
    expect(log.entries()).toHaveLength(1);
    expect(log.entries()[0]).toMatchObject({ actor: 'her', status: 'applied', why: 'Direct edit' });
    rec.applyOp({ op: 'move', target: wall, nums: { dx: 100, dy: 0 } });
    t += 200;
    rec.applyOp({ op: 'move', target: wall, nums: { dx: 100, dy: 0 } });
    expect(log.entries()).toHaveLength(2); // drag folded into one entry
    // Her edit can be reverted.
    const r = log.revert(log.entries()[0].id, { restore: (d) => c.restoreSnapshot!(d), summary: () => c.summary() });
    expect(r.ok).toBe(true);
    expect((c.snapshot() as { walls: unknown[] }).walls.length).toBe(0);
  });

  it('does not double-record while an accepted proposal is applied', () => {
    const c = createPlanController();
    const log = createChangeLog(memKV());
    let sup = true;
    const rec = withChangeRecording(c, { log, suppressed: () => sup, why: () => '', source: () => 'rules' });
    rec.applyOp({ op: 'add_room', x: 0, y: 0, w: 3000, h: 3000 });
    expect(log.entries()).toHaveLength(0);
    sup = false;
    rec.applyOp({ op: 'undo' });
    expect(log.entries()).toHaveLength(1);
  });

  it('a new plan is logged as one revertable change', async () => {
    const c = createPlanController();
    const log = createChangeLog(memKV());
    const rec = withChangeRecording(c, { log, suppressed: () => false, why: () => 'two bedroom plan', source: () => 'rules' });
    const res = await rec.generate('two bedroom plan');
    expect(res.step.ok).toBe(true);
    const e = log.entries().at(-1)!;
    expect(e.tool).toBe('generate');
    expect(e.status).toBe('applied');
    log.revert(e.id, { restore: (d) => c.restoreSnapshot!(d), summary: () => c.summary() });
    expect((c.snapshot() as { walls: unknown[] }).walls.length).toBe(0);
  });

  it('a hook layered over the wrapper does not loop and still records', () => {
    const c = createPlanController();
    const log = createChangeLog(memKV());
    const rec = withChangeRecording(c, { log, suppressed: () => false, why: () => '', source: () => 'rules' });
    let noted = 0;
    const inner = rec.applyOp.bind(rec);
    rec.applyOp = (raw) => { const s = inner(raw); noted++; return s; };
    expect(rec.applyOp({ op: 'add_room', x: 0, y: 0, w: 3000, h: 3000 }).ok).toBe(true);
    expect(noted).toBe(1);
    expect(log.entries()).toHaveLength(1);
    // The raw controller is untouched: a direct apply is not recorded.
    c.applyOp({ op: 'undo' });
    expect(log.entries()).toHaveLength(1);
  });
});

describe('site checklist', () => {
  it('adds, dedupes open questions, answers, persists', () => {
    const kv = memKV();
    const l = createSiteChecklist(kv);
    const a = l.add('Can the east wall come down?', 'plan', true);
    expect(l.add('can the east wall come down?', 'plan', true).id).toBe(a.id);
    expect(l.answer(a.id, 'Check if it is load-bearing first.', 'gemini')).toBe(true);
    expect(createSiteChecklist(kv).get(a.id)?.status).toBe('answered');
  });

  it('email drafts open a mailto link and never send', () => {
    const l = createSiteChecklist(memKV());
    l.add('Which tiles for the bathroom?', '', true);
    const d = fallbackEmail(l.items());
    expect(d.body).toMatch(/1\. Which tiles/);
    const url = mailtoUrl({ ...d, to: 'client@example.com' });
    expect(url.startsWith('mailto:client%40example.com?subject=')).toBe(true);
    expect(coerceEmailDraft({ subject: 'Hi', body: '' })).toBeNull();
    expect(coerceEmailDraft({ subject: 'Hi', body: 'Hello' })).toMatchObject({ subject: 'Hi' });
  });

  it('spots hard questions', () => {
    expect(isHardQuestion('can this wall be removed?')).toBe(true);
    expect(isHardQuestion('check the soil report')).toBe(true);
    expect(isHardQuestion('add a door')).toBe(false);
  });

  it('merges local + remote newest-wins (sync)', () => {
    const base = { id: 'q1', question: 'Q', context: '', askedAt: 1, askedOffline: true, status: 'open' as const, updatedAt: 1 };
    expect(mergeItems([base], [{ ...base, status: 'emailed', updatedAt: 5 }])[0].status).toBe('emailed');
    const m = mergeSiteBook({ changes: [], checklist: [base] }, { checklist: [{ ...base, status: 'done', updatedAt: 9 }], changes: [{ bogus: true }] });
    expect(m.checklist[0].status).toBe('done');
    expect(m.changes).toEqual([]);
  });
});

describe('/control snapshot carries changes and the checklist', () => {
  it('builds capped, redacted cards and survives the wire', () => {
    const snap = buildControlSnapshot({
      changes: [{ id: 'c1', actor: 'gemini', title: 'Add a staircase', why: '17 steps', status: 'pending' }, { id: 'c2', actor: 'evil', title: 'x', status: 'applied' }],
      checklist: [{ id: 'q1', question: 'Can the wall go?', status: 'open', askedOffline: true }],
    });
    expect(snap.changes).toEqual([{ id: 'c1', who: 'gemini', title: 'Add a staircase', why: '17 steps', status: 'pending' }]);
    expect(snap.checklist?.[0]).toMatchObject({ question: 'Can the wall go?', offline: true });
    const back = coerceSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(back?.changes?.[0].title).toBe('Add a staircase');
    expect(back?.checklist?.[0].status).toBe('open');
    expect(buildControlSnapshot({}).changes).toBeUndefined();
  });
});

describe('plan digest', () => {
  it('reads a plan as a short human line', async () => {
    const { planDigest } = await import('../src/cad/changeLog');
    expect(planDigest({ walls: [{}, {}], rooms: [{}], openings: [{ kind: 'door' }], fixtures: [{ kind: 'stairs' }], dims: [], texts: [] }))
      .toBe('2 walls · 1 room · 1 door · 1 stair');
    expect(planDigest({ walls: [] })).toBe('empty plan');
    expect(planDigest(null)).toBe('');
  });
});

describe('3D materials proposals in the change log', () => {
  it('stores a set_materials op as a pending reviewed change and keeps it through sanitize', () => {
    const log = createChangeLog(memKV());
    const op = { op: 'set_materials', plan: { label: 'Warm home', walls: { color: '#f3e9dc', roughness: 0.9, name: 'Warm white plaster' }, floor: { color: '#a47148', roughness: 0.7, name: 'Teak wood' }, lighting: { sunIntensity: 1, sunAzimuth: 120, sunElevation: 40, sunColor: '#fff1d6', ambientIntensity: 1, skyColor: '#f6efe6' }, notes: 'preview' }, previous: null, previous3d: false };
    const e = log.propose({ actor: 'nano', tool: 'set_materials', title: '3D look: Warm home', why: 'You said: "convert 2D to 3D".', op, before: 'empty plan', source: 'cloud' });
    expect(log.pending()).toHaveLength(1);
    expect(e.actor).toBe('nano');
    expect(e.op?.op).toBe('set_materials');
    const applied: unknown[] = [];
    const r = log.accept(e.id, { snapshot: () => ({}), apply: (o) => { applied.push(o); return { ok: true }; }, summary: () => '3D dressed' });
    expect(r.ok).toBe(true);
    expect(applied).toHaveLength(1);
    expect(log.get(e.id)?.status).toBe('applied');
    expect(sanitizeEntry(JSON.parse(JSON.stringify(e)))?.op?.op).toBe('set_materials');
  });
});
