import { afterEach, describe, expect, it } from 'vitest';
import {
  compileCommand,
  generateTemplate,
  isEnabled,
  setModelsForTest,
  verifyOp,
  type TextGenModel,
} from '../src/ai/hybrid';

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

afterEach(() => setModelsForTest(null));

describe('hybrid compileCommand', () => {
  it('falls back to the rule parser when disabled (no Firebase calls)', async () => {
    setModelsForTest({ enabled: false });
    expect(isEnabled()).toBe(false);
    const r = await compileCommand('move left 10', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ op: 'move', target: 'selected', dx: -10, dy: 0, dz: 0 });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('uses the mocked model and labels on-device source', async () => {
    setModelsForTest({
      enabled: true,
      intent: model('{"op":"move","target":"selected","dx":10,"dy":0,"dz":0}', 'on_device'),
    });
    const r = await compileCommand('move right 10', '{}', null);
    expect(r.source).toBe('on-device');
    expect(r.result).toEqual({ op: 'move', target: 'selected', dx: 10, dy: 0, dz: 0 });
  });

  it('labels cloud source and strips code fences', async () => {
    setModelsForTest({
      enabled: true,
      intent: model('```json\n{"op":"fillet","target":"selected","radius":2}\n```', 'in_cloud'),
    });
    const r = await compileCommand('fillet 2', '{}', 'p1');
    expect(r.source).toBe('cloud');
    expect(r.result).toMatchObject({ op: 'fillet', radius: 2 });
  });

  it('rejects invalid model JSON and falls back to rules', async () => {
    setModelsForTest({ enabled: true, intent: model('this is not json at all') });
    const r = await compileCommand('mirror x', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ op: 'mirror', target: 'selected', axis: 'x' });
  });

  it('rejects valid JSON that is not a valid op', async () => {
    setModelsForTest({ enabled: true, intent: model('{"op":"explode","target":"everything"}') });
    const r = await compileCommand('make it taller by 5', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ op: 'scale', target: 'selected', deltaMm: { z: 5 } });
  });

  it('falls back to rules when the model throws', async () => {
    setModelsForTest({
      enabled: true,
      intent: { generateContent: async () => { throw new Error('offline'); } },
    });
    const r = await compileCommand('undo', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ op: 'undo' });
  });

  it('passes through template and clarify results from the model', async () => {
    setModelsForTest({
      enabled: true,
      intent: model('{"template":"phoneStand","params":{"angleDeg":70}}', 'in_cloud'),
    });
    const r = await compileCommand('something to prop my phone', '{}', null);
    expect(r.result).toEqual({ template: 'phoneStand', params: { angleDeg: 70 } });

    setModelsForTest({ enabled: true, intent: model('{"clarify":"Which part?"}', 'on_device') });
    const r2 = await compileCommand('move it', '{}', null);
    expect(r2.result).toEqual({ clarify: 'Which part?' });
    expect(r2.source).toBe('on-device');
  });

  it('rejects a bogus template name from the model', async () => {
    setModelsForTest({ enabled: true, intent: model('{"template":"rocketLauncher","params":{}}') });
    const r = await compileCommand('cup grip', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ template: 'cupGrip', params: {} });
  });
});

describe('hybrid verifyOp', () => {
  const op = { op: 'move', target: 'selected', dx: 10, dy: 0, dz: 0 } as const;

  it('deterministic fallback when disabled: warnings decide', async () => {
    setModelsForTest({ enabled: false });
    const ok = await verifyOp(op, '{}', '{}', []);
    expect(ok).toEqual({ matchesIntent: true, issue: null, source: 'rules' });
    const bad = await verifyOp(op, '{}', '{}', ['box 1 floats 15 mm above the floor']);
    expect(bad).toEqual({
      matchesIntent: false,
      issue: 'box 1 floats 15 mm above the floor',
      source: 'rules',
    });
  });

  it('uses the model verdict when available', async () => {
    setModelsForTest({
      enabled: true,
      intent: model('{"matchesIntent":false,"issue":"moved the wrong way"}', 'on_device'),
    });
    const r = await verifyOp(op, '{}', '{}', []);
    expect(r).toEqual({ matchesIntent: false, issue: 'moved the wrong way', source: 'on-device' });
  });

  it('falls back deterministically on malformed verdicts', async () => {
    setModelsForTest({ enabled: true, intent: model('{"matchesIntent":"maybe"}') });
    const r = await verifyOp(op, '{}', '{}', []);
    expect(r).toEqual({ matchesIntent: true, issue: null, source: 'rules' });
  });
});

describe('hybrid generateTemplate', () => {
  it('uses the cloud template model and labels source', async () => {
    setModelsForTest({
      enabled: true,
      template: model('{"template":"hook","params":{"rodDiameterMm":8}}', 'in_cloud'),
    });
    const r = await generateTemplate('something to hang my bag on');
    expect(r).toEqual({ template: 'hook', params: { rodDiameterMm: 8 }, source: 'cloud' });
  });

  it('drops non-numeric params from model output', async () => {
    setModelsForTest({
      enabled: true,
      template: model('{"template":"cupGrip","params":{"cupDiameterMm":"80","color":"red"}}'),
    });
    const r = await generateTemplate('grip for my cup');
    expect(r).toEqual({ template: 'cupGrip', params: { cupDiameterMm: 80 }, source: 'cloud' });
  });

  it('falls back to rules when disabled', async () => {
    setModelsForTest({ enabled: false });
    const r = await generateTemplate('phone stand');
    expect(r).toEqual({ template: 'phoneStand', params: {}, source: 'rules' });
    const unknown = await generateTemplate('a spaceship');
    expect(unknown.source).toBe('rules');
    expect('clarify' in unknown).toBe(true);
  });
});
