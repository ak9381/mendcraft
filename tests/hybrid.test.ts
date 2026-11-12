import { afterEach, describe, expect, it } from 'vitest';
import {
  compileCommand,
  generateTemplate,
  getDeviceModelStatus,
  getHybridStatus,
  initDeviceModel,
  checkDeviceAvailability,
  isDesignRequest,
  isEnabled,
  OP_RESPONSE_CONSTRAINT,
  prepareHybrid,
  setModelsForTest,
  VERIFY_RESPONSE_CONSTRAINT,
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
    const props = OP_RESPONSE_CONSTRAINT.properties;
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
