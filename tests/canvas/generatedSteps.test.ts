// Next-step chips are generated: written by Nano (Gemini only with no Nano,
// online), checked by coerceNextSteps, kept as `steps-<journeyStep>` and
// labelled with their engine. A chip press only says her words to run().
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  coerceNextSteps, createNextStepChips, MAX_NEXT_STEPS, stepsEngine, stepsFactsSig, stepsPrompt, stepsStillFit, type ShownSteps,
} from '../../src/canvas/nextSteps';
import { coerceArtifact } from '../../src/artifacts/artifact';
import type { JourneyStep } from '../../src/canvas/journey';

const step = (id: string, label = `Do ${id}`, say = `do ${id}`) => ({ id, label, say });

describe('coerceNextSteps', () => {
  it('coerceNextSteps keeps 3, trims nothing silently: a label of 33 chars is dropped', () => {
    const r = coerceNextSteps({ at: 'devices', steps: [step('a'), step('b', 'x'.repeat(33)), step('c'), step('d'), step('e')] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(MAX_NEXT_STEPS).toBe(3);
    expect(r.value).toEqual({ at: 'devices', steps: [step('a'), step('c'), step('d')] });
    expect(r.notes).toEqual(['Dropped 1 suggestion that failed the check.', 'Kept the first 3 suggestions; dropped 1 more.']);
    // A 32-character label is fine; the label is never cut to fit.
    const ok32 = coerceNextSteps({ at: 'devices', steps: [step('a', 'x'.repeat(32))] });
    expect(ok32.ok && ok32.value.steps[0].label).toBe('x'.repeat(32));
  });
  it('refuses markup, bad ids, a long say, repeats, an unknown step, and an empty set', () => {
    const r = coerceNextSteps({ at: 'dashboard', steps: [step('Bad Id'), step('m', '<b>x</b>'), step('s', 'Ok', 'y'.repeat(81)), step('a'), step('a')] });
    expect(r.ok && r.value.steps).toEqual([step('a')]);
    expect(r.ok && r.notes).toEqual(['Dropped 4 suggestions that failed the check.']);
    expect(coerceNextSteps({ at: 'nowhere', steps: [step('a')] }).ok).toBe(false);
    expect(coerceNextSteps({ at: 'devices', steps: [step('Bad Id')] }).ok).toBe(false);
    expect(coerceNextSteps('{"steps":[]}').ok).toBe(false);
  });
  it('is the steps artifact validator: stored as suggested (never approved), and the id must name the step', () => {
    const art = { id: 'steps-devices', kind: 'steps', v: 1, title: 'Next steps: devices', by: 'replay', at: 1, status: 'suggested', data: { at: 'devices', steps: [step('a')], sig: 'd1-b1-p0' } };
    const ok = coerceArtifact(art);
    expect(ok.ok && ok.value.status).toBe('suggested');
    expect(ok.ok && ok.value.data.sig).toBe('d1-b1-p0');
    expect(coerceArtifact({ ...art, status: 'approved' }).ok).toBe(false);
    expect(coerceArtifact({ ...art, data: { ...art.data, sig: 'anything' } }).ok).toBe(false);
    // Every other kind is still approved only.
    const board = { id: 'board-f1', kind: 'board', v: 1, title: 'Desk', by: 'gemini', at: 1, status: 'suggested', data: { frame: { kind: 'room', title: 'Desk', rect: { x: 0, y: 0, w: 10, h: 10 }, pinned: false }, plan: { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'T', value: '1' }] } } };
    expect(coerceArtifact(board).ok).toBe(false);
    expect(coerceArtifact({ ...board, status: 'approved' }).ok).toBe(true);
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toMatch(/kind: 'steps', v: \(prev\?\.v \?\? 0\) \+ 1, title: `Next steps: \$\{at\}`, data: r\.value, by, at: Date\.now\(\), status: 'suggested' \}/);
    expect(coerceArtifact({ ...art, id: 'steps-dashboard' }).ok).toBe(false);
    expect(coerceArtifact({ ...art, data: { at: 'devices', steps: [step('a', 'x'.repeat(33))] } }).ok).toBe(false);
  });
  it('the prompt carries the step and counts only', () => {
    const p = stepsPrompt('devices', { devices: 3, boards: 2, phones: 2 });
    expect(p).toContain('"devices" step');
    expect(p).toContain('Devices here: 3. Boards: 2. Paired phones: 2.');
    expect(p).toMatch(/\{"steps":\[\{"id":string,"label":string,"say":string\}\]\}/);
  });
});

describe('when kept steps are asked for again', () => {
  it('the cache key holds a coarse view of the facts: a new phone or device re-asks, a fourth board does not', () => {
    const sig = stepsFactsSig({ devices: 1, boards: 1, phones: 0 });
    expect(sig).toBe('d1-b1-p0');
    expect(stepsFactsSig({ devices: 2, boards: 1, phones: 0 })).not.toBe(sig);
    expect(stepsFactsSig({ devices: 1, boards: 1, phones: 2 })).not.toBe(sig);
    expect(stepsFactsSig({ devices: 9, boards: 4, phones: 3 })).toBe(stepsFactsSig({ devices: 3, boards: 7, phones: 5 }));
    expect(stepsStillFit({ data: { at: 'devices', steps: [], sig } }, sig)).toBe(true);
    expect(stepsStillFit({ data: { at: 'devices', steps: [], sig } }, 'd2-b1-p0')).toBe(false);
    expect(stepsStillFit({ data: { at: 'devices', steps: [] } }, sig)).toBe(false); // older steps without facts: asked again
    expect(stepsStillFit(undefined, sig)).toBe(false);
  });
  it('a change approved while steps are being written is asked once more after; voice plan edits and morphs count', () => {
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toContain('if (stepsAsking) { stepsAgain = frameId; return; }');
    expect(app).toMatch(/stepsAsking = false;\s*const again = stepsAgain;\s*stepsAgain = null;\s*if \(again\) void requestSteps\(again\);/);
    expect(app).toContain("if (ok) { nextChips?.refresh(); approvedChange(frameId); bodyLanguage('yes'); }");
    expect(app).toContain("if (ok) { approvedChange(fid); bodyLanguage('yes'); }");
    expect(app).toContain('if (stepsStillFit(stepArtifacts.get(at), sig)) return;');
  });
});

describe('which engine writes them', () => {
  const nano = { id: 'nano' }, gemini = { id: 'gemini' }, cloudNano = { id: 'gemini' };
  it('Nano first; Gemini only with no Nano and online; none otherwise', () => {
    expect(stepsEngine(nano, gemini, true)).toBe(nano);
    expect(stepsEngine(nano, gemini, false)).toBe(nano);
    expect(stepsEngine(undefined, gemini, true)).toBe(gemini);
    expect(stepsEngine(undefined, gemini, false)).toBeUndefined();
    // A phone's "nano" step that is really Gemini in the cloud: not offline.
    expect(stepsEngine(cloudNano, gemini, false)).toBeUndefined();
    expect(stepsEngine(undefined, undefined, true)).toBeUndefined();
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

describe('the chip row', () => {
  function setup(kept: Partial<Record<JourneyStep, ShownSteps>>) {
    const root = new FakeEl(fakeDoc);
    const frame = new FakeEl(fakeDoc);
    root.append(frame);
    const ran: string[] = [];
    const calls: string[] = [];
    const chips = createNextStepChips({
      root: root as unknown as ParentNode,
      focused: () => ({ id: 'f1', el: frame as unknown as HTMLElement, at: 'devices' }),
      stepsFor: (at) => kept[at] ?? null,
      run: (s) => { ran.push(s); },
      onRender: () => calls.push('render'),
    });
    return { chips, frame, ran, calls };
  }
  const row = (frame: FakeEl) => frame.children.find((c) => c.className === 'mc-next');

  it('a chip press calls run() with its say text and nothing else', () => {
    const t = setup({ devices: { label: 'Replay · written example', steps: [step('dash', 'Build the dashboard', 'build the dashboard'), step('plan', 'Draw a floor plan', 'draw the floor plan')] } });
    t.chips.refresh();
    const r = row(t.frame)!;
    expect(r.children[0].textContent).toBe('Replay · written example');
    expect(r.children.slice(1).map((c) => c.textContent)).toEqual(['Build the dashboard', 'Draw a floor plan']);
    r.children[2].click();
    expect(t.ran).toEqual(['draw the floor plan']);
    const src = readFileSync('src/canvas/nextSteps.ts', 'utf8');
    expect(src).toContain("b.addEventListener('click', (e) => { e.stopPropagation(); host.run(s.say); });");
  });

  it('with no engine there are no chips', () => {
    const t = setup({});
    t.chips.refresh();
    expect(row(t.frame)).toBeUndefined();
    expect(t.chips.steps()).toEqual([]);
    expect(t.calls).toEqual([]);
  });
});

describe('no scripted chip lists', () => {
  it('src holds no fixed journey chip catalogue or rule picker', () => {
    const src = readFileSync('src/canvas/nextSteps.ts', 'utf8');
    expect(src).not.toMatch(/ruleSuggestions|ONE_SHOT|CATALOG|RULES|FILLERS/);
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).not.toMatch(/ruleSuggestions|pickNextStepsOnDevice|markDone/);
    const hybrid = readFileSync('src/ai/hybrid.ts', 'utf8');
    expect(hybrid).not.toMatch(/pickNextStepsOnDevice|NEXT_STEPS_CONSTRAINT/);
  });
  it('the recorded steps fixture passes the check', () => {
    const files = readdirSync('tests/fixtures/replies');
    expect(files).toContain('nano.steps.json');
    const rec = JSON.parse(readFileSync('tests/fixtures/replies/nano.steps.json', 'utf8')) as { reply: string };
    const r = coerceNextSteps({ ...JSON.parse(rec.reply), at: 'devices' });
    expect(r.ok && r.value.steps).toHaveLength(3);
  });
});
