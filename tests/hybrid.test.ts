import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compileCommand,
  generatePlan,
  generateTemplate,
  getDeviceModelStatus,
  getHybridStatus,
  initDeviceModel,
  checkDeviceAvailability,
  isDesignRequest,
  isEnabled,
  prepareHybrid,
  setModelsForTest,
  verifyOp,
  type TextGenModel,
} from '../src/ai/hybrid';
import { partMode, setActiveMode } from '../src/core/modes';

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

// The hybrid wrapper is mode-agnostic (it coerces/parses via the active mode).
// These tests exercise the 3D-part op vocabulary, so pin the active mode to
// 'part'; the default is now the 'plan' hero.
beforeEach(() => setActiveMode('part'));
afterEach(() => {
  setModelsForTest(null);
  setActiveMode('plan');
});

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

  it('uses the verifier model verdict when available', async () => {
    setModelsForTest({
      enabled: true,
      verify: model('{"matchesIntent":false,"issue":"moved the wrong way"}', 'on_device'),
    });
    const r = await verifyOp(op, '{}', '{}', []);
    expect(r).toEqual({ matchesIntent: false, issue: 'moved the wrong way', source: 'on-device' });
  });

  it('does not reuse the intent (edit-op) model for verification', async () => {
    setModelsForTest({
      enabled: true,
      intent: model('{"matchesIntent":false,"issue":"should be ignored"}', 'on_device'),
    });
    const r = await verifyOp(op, '{}', '{}', []);
    expect(r).toEqual({ matchesIntent: true, issue: null, source: 'rules' });
  });

  it('falls back deterministically on malformed verdicts', async () => {
    setModelsForTest({ enabled: true, verify: model('{"matchesIntent":"maybe"}') });
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

describe('verifier and op schemas', () => {
  // The constraints now live on the active mode; assert the part mode's.
  const OP_RESPONSE_CONSTRAINT = partMode.ai.opConstraint as { properties: Record<string, never> };
  const VERIFY_RESPONSE_CONSTRAINT = partMode.ai.verifyConstraint;

  it('gives the verifier its own {matchesIntent, issue} schema', () => {
    expect(VERIFY_RESPONSE_CONSTRAINT).toEqual({
      type: 'object',
      properties: {
        matchesIntent: { type: 'boolean' },
        issue: { type: 'string' },
      },
    });
    expect(VERIFY_RESPONSE_CONSTRAINT).not.toHaveProperty('properties.op');
  });

  it('mirrors op fields in the on-device constraint and accepts numeric depth', () => {
    const props = OP_RESPONSE_CONSTRAINT.properties as Record<string, never>;
    expect(props.depth).toEqual({ anyOf: [{ type: 'number' }, { type: 'string' }] });
    expect(props.params.properties).toMatchObject({ w: { type: 'number' }, diameter: { type: 'number' } });
    expect(props.deltaMm.properties).toEqual({
      x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' },
    });
    expect(props.op).toEqual({ type: 'string' });
    expect(props.dx).toEqual({ type: 'number' });
  });
});

describe('device model init state', () => {
  it('does not treat a configured/enabled key as on-device ready', async () => {
    setModelsForTest({
      enabled: true,
      intent: {
        generateContent: async () => ({ response: { text: () => '{}' } }),
        initializeDeviceModel: async () => undefined,
      },
    });
    expect(isEnabled()).toBe(true);
    expect(getDeviceModelStatus()).toBe('idle');
    expect(getHybridStatus().deviceModel).toBe('idle');
  });

  /** Fake Chrome LanguageModel whose availability() walks a script. */
  const lm = (...seq: string[]) => {
    let i = 0;
    return { availability: async () => seq[Math.min(i++, seq.length - 1)] };
  };

  it('reports ready only after the download finishes and Chrome says available', async () => {
    const progress: number[] = [];
    setModelsForTest({
      enabled: true,
      languageModel: lm('downloadable', 'available'),
      intent: {
        generateContent: async () => ({ response: { text: () => '{}' } }),
        initializeDeviceModel: async (onProgress) => {
          onProgress?.(0.5);
          onProgress?.(1);
        },
      },
    });
    const ok = await initDeviceModel((p) => progress.push(p));
    expect(ok).toBe(true);
    expect(getDeviceModelStatus()).toBe('ready');
    expect(progress).toEqual([0.5, 1]);
  });

  it('does NOT report ready when the SDK resolves but Chrome says unavailable', async () => {
    setModelsForTest({
      enabled: true,
      languageModel: lm('downloadable', 'unavailable'),
      intent: {
        generateContent: async () => ({ response: { text: () => '{}' } }),
        initializeDeviceModel: async () => undefined,
      },
    });
    expect(await initDeviceModel()).toBe(false);
    expect(getDeviceModelStatus()).toBe('unavailable');
  });

  it('reports unsupported without the Prompt API and never calls the SDK', async () => {
    let called = false;
    setModelsForTest({
      enabled: true,
      languageModel: null,
      intent: {
        generateContent: async () => ({ response: { text: () => '{}' } }),
        initializeDeviceModel: async () => { called = true; },
      },
    });
    expect(await initDeviceModel()).toBe(false);
    expect(getDeviceModelStatus()).toBe('unsupported');
    expect(called).toBe(false);
  });

  it('maps availability() honestly on page load', async () => {
    setModelsForTest({ enabled: true, languageModel: lm('downloadable') });
    expect(await checkDeviceAvailability()).toBe('downloadable');
    setModelsForTest({ enabled: true, languageModel: lm('downloading') });
    expect(await checkDeviceAvailability()).toBe('downloading');
    setModelsForTest({ enabled: true, languageModel: lm('available') });
    expect(await checkDeviceAvailability()).toBe('ready');
    setModelsForTest({ enabled: true, languageModel: lm('unavailable') });
    expect(await checkDeviceAvailability()).toBe('unavailable');
  });

  it('reports failed when initializeDeviceModel is missing', async () => {
    setModelsForTest({
      enabled: true,
      languageModel: lm('downloadable'),
      intent: model('{"op":"undo"}'),
    });
    const ok = await initDeviceModel();
    expect(ok).toBe(false);
    expect(getDeviceModelStatus()).toBe('failed');
  });

  it('reports failed when initializeDeviceModel throws', async () => {
    setModelsForTest({
      enabled: true,
      languageModel: lm('downloadable'),
      intent: {
        generateContent: async () => ({ response: { text: () => '{}' } }),
        initializeDeviceModel: async () => {
          throw new Error('unavailable');
        },
      },
    });
    const ok = await initDeviceModel();
    expect(ok).toBe(false);
    expect(getDeviceModelStatus()).toBe('failed');
    expect(getHybridStatus().lastError).toContain('unavailable');
  });

  it('sets downloading while the device model is warming', async () => {
    let statusDuring: string | undefined;
    setModelsForTest({
      enabled: true,
      languageModel: lm('downloadable', 'available'),
      intent: {
        generateContent: async () => ({ response: { text: () => '{}' } }),
        initializeDeviceModel: async () => {
          statusDuring = getDeviceModelStatus();
        },
      },
    });
    await initDeviceModel();
    expect(statusDuring).toBe('downloading');
    expect(getDeviceModelStatus()).toBe('ready');
  });
});

describe('cloud retry when the on-device call throws', () => {
  it('retries on the cloud-only model and labels it cloud', async () => {
    setModelsForTest({
      enabled: true,
      intent: { generateContent: async () => { throw new Error('nano blew up'); } },
      intentCloud: model('{"template":"cupGrip","params":{}}', 'in_cloud'),
    });
    const r = await compileCommand('cup grip', '{}', null);
    expect(r.source).toBe('cloud');
    expect(r.result).toEqual({ template: 'cupGrip', params: {} });
    expect(getHybridStatus().lastError).toContain('nano blew up');
  });

  it('falls to rules (still loading the template) when both fail', async () => {
    const boom: TextGenModel = { generateContent: async () => { throw new Error('down'); } };
    setModelsForTest({ enabled: true, intent: boom, intentCloud: boom });
    const r = await compileCommand('cup grip', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ template: 'cupGrip', params: {} });
  });
});

describe('App Check required', () => {
  it('falls back to rules and surfaces a failed status when App Check fails', async () => {
    setModelsForTest({
      enabled: true,
      appCheck: 'failed',
      intent: model('{"op":"move","target":"selected","dx":99,"dy":0,"dz":0}', 'in_cloud'),
      verify: model('{"matchesIntent":false,"issue":"should not run"}'),
      template: model('{"template":"hook","params":{}}'),
    });
    const status = await prepareHybrid();
    expect(status.appCheck).toBe('failed');
    expect(status.message).toMatch(/App Check/i);

    const compiled = await compileCommand('move left 10', '{}', null);
    expect(compiled.source).toBe('rules');
    expect(compiled.result).toEqual({ op: 'move', target: 'selected', dx: -10, dy: 0, dz: 0 });

    const verdict = await verifyOp(
      { op: 'move', target: 'selected', dx: -10, dy: 0, dz: 0 },
      '{}',
      '{}',
      [],
    );
    expect(verdict.source).toBe('rules');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Plan-mode regressions, driven by the ACTUAL raw text the live cloud returned.
// Two production bugs: generate must expand a DOCUMENT (not emit ops that name
// unknown ids), and an under-filled edit op must be repaired from the utterance.

describe('plan generate + edit against real cloud output', () => {
  beforeEach(() => setActiveMode('plan'));
  // afterEach already resets models + restores the 'plan' default.

  const CLOUD_PLAN_DOC =
    '{"rooms":[{"x":0,"y":0,"w":4000,"h":3000,"name":"Bedroom 1"},{"x":4000,"y":0,"w":4000,"h":3000,"name":"Bedroom 2"}],"unit":"mm"}';
  const CLOUD_PLAN_NO_ROOMS =
    '{"unit":"mm","windows":[{"room":"Bedroom 1","side":"n","width":1200}]}';
  const CLOUD_SET_LENGTH_NO_NUM = '{"op":"set_length","target":"selected","unit":"m"}';

  it('generatePlan expands a cloud DOCUMENT and labels the source cloud', async () => {
    setModelsForTest({ enabled: true, template: model(CLOUD_PLAN_DOC, 'in_cloud') });
    const r = await generatePlan('two bedroom plan');
    expect(r.source).toBe('cloud');
    expect(r.ops && r.ops.length).toBeGreaterThan(0);
    // The expansion pre-selects the shared wall so the next edit lands.
    expect(r.ops?.some((o) => o.op === 'select')).toBe(true);
  });

  it('generatePlan falls back to a two-bedroom template when the cloud doc has no rooms', async () => {
    setModelsForTest({ enabled: true, template: model(CLOUD_PLAN_NO_ROOMS, 'in_cloud') });
    const r = await generatePlan('two bedroom plan');
    expect(r.source).toBe('rules');
    expect(r.ops && r.ops.length).toBeGreaterThan(0);
  });

  it('compileCommand repairs an under-filled set_length and keeps the cloud badge', async () => {
    setModelsForTest({ enabled: true, intent: model(CLOUD_SET_LENGTH_NO_NUM, 'in_cloud') });
    const r = await compileCommand('make this wall 4 meters', '{}', 'w3');
    expect(r.source).toBe('cloud');
    expect(r.result).toEqual({ op: 'set_length', target: 'selected', length: 4000 });
  });

  it('compileCommand does not repair into a different op (falls back to rules)', async () => {
    setModelsForTest({ enabled: true, intent: model(CLOUD_SET_LENGTH_NO_NUM, 'in_cloud') });
    // Rules read this as a move, not set_length → no repair → rules path.
    const r = await compileCommand('move it 500 left', '{}', 'w3');
    expect(r.source).toBe('rules');
    expect(r.result).toMatchObject({ op: 'move', nums: { dx: -500 } });
  });
});

describe('isDesignRequest', () => {
  it('routes longer design phrasing to the template model', () => {
    expect(isDesignRequest('design a stand for my phone')).toBe(true);
    expect(isDesignRequest('something to hang my bag on')).toBe(true);
    expect(isDesignRequest('I need a grip for my cup')).toBe(true);
  });

  it('leaves short edit commands on the intent / rules path', () => {
    expect(isDesignRequest('add a box')).toBe(false);
    expect(isDesignRequest('move left 10')).toBe(false);
    expect(isDesignRequest('make it taller by 5')).toBe(false);
    expect(isDesignRequest('cup grip')).toBe(false);
  });
});
