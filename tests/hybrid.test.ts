import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  askCopilot,
  compileCommand,
  detectLanguageCloud,
  fuseIntent,
  generatePlan,
  getDeviceModelStatus,
  getHybridStatus,
  initDeviceModel,
  checkDeviceAvailability,
  isDesignRequest,
  isEnabled,
  pickCadTool,
  pickRecipeHybrid,
  prepareHybrid,
  proposeMaterials,
  refineSearchQuery,
  resolveDeixis,
  warmOnDevice,
  setModelsForTest,
  verifyOp,
  generateReferenceOptions,
  type FusionContext,
  type TextGenModel,
} from '../src/ai/hybrid';
import { setActiveMode } from '../src/core/modes';
import { resetRemoteConfig, setRemoteConfigForTest } from '../src/firebase/remoteConfig';

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

// The hybrid wrapper is mode-agnostic; Mendcraft is CAD-only, so these run
// against the 2D plan op vocabulary.
beforeEach(() => setActiveMode('plan'));
afterEach(() => {
  setModelsForTest(null);
  setActiveMode('plan');
});

describe('hybrid compileCommand', () => {
  it('falls back to the rule parser when disabled (no Firebase calls)', async () => {
    setModelsForTest({ enabled: false });
    expect(isEnabled()).toBe(false);
    const r = await compileCommand('undo', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ op: 'undo' });
    expect(r.ms).toBeGreaterThanOrEqual(0);
  });

  it('uses the mocked model and labels on-device source', async () => {
    setModelsForTest({ enabled: true, intent: model('{"op":"undo"}', 'on_device') });
    const r = await compileCommand('take that back', '{}', null);
    expect(r.source).toBe('on-device');
    expect(r.result).toEqual({ op: 'undo' });
  });

  it('labels cloud source and strips code fences', async () => {
    setModelsForTest({ enabled: true, intent: model('```json\n{"op":"redo"}\n```', 'in_cloud') });
    const r = await compileCommand('redo that', '{}', null);
    expect(r.source).toBe('cloud');
    expect(r.result).toEqual({ op: 'redo' });
  });

  it('rejects invalid model JSON and falls back to rules', async () => {
    setModelsForTest({ enabled: true, intent: model('this is not json at all') });
    const r = await compileCommand('add a door', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toMatchObject({ op: 'add_door' });
  });

  it('rejects valid JSON that is not a valid op', async () => {
    setModelsForTest({ enabled: true, intent: model('{"op":"explode","target":"everything"}') });
    const r = await compileCommand('undo', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ op: 'undo' });
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

  it('passes through clarify results from the model', async () => {
    setModelsForTest({ enabled: true, intent: model('{"clarify":"Which wall?"}', 'on_device') });
    const r2 = await compileCommand('move it', '{}', null);
    expect(r2.result).toEqual({ clarify: 'Which wall?' });
    expect(r2.source).toBe('on-device');
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
      intentCloud: model('{"op":"undo"}', 'in_cloud'),
    });
    const r = await compileCommand('take it back', '{}', null);
    expect(r.source).toBe('cloud');
    expect(r.result).toEqual({ op: 'undo' });
    expect(getHybridStatus().lastError).toContain('nano blew up');
  });

  it('falls to rules when both fail', async () => {
    const boom: TextGenModel = { generateContent: async () => { throw new Error('down'); } };
    setModelsForTest({ enabled: true, intent: boom, intentCloud: boom });
    const r = await compileCommand('undo', '{}', null);
    expect(r.source).toBe('rules');
    expect(r.result).toEqual({ op: 'undo' });
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

    const compiled = await compileCommand('undo', '{}', null);
    expect(compiled.source).toBe('rules');
    expect(compiled.result).toEqual({ op: 'undo' });

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

  it('generatePlan degrades to a RULES two-bedroom plan when App Check fails (deployed init failure)', async () => {
    // The deployed path: Firebase/App Check init fails (or the network is
    // blocked), so there is no cloud model at all. A "two bedroom plan" must
    // still build — promptly, deterministically, and honestly badged RULES.
    setModelsForTest({ enabled: true, appCheck: 'failed' });
    const status = await prepareHybrid();
    expect(status.appCheck).toBe('failed');
    const r = await generatePlan('two bedroom plan');
    expect(r.source).toBe('rules');
    expect(r.ops && r.ops.length).toBeGreaterThan(0);
    // The shared wall is still pre-selected, so the demo edit lands offline too.
    expect(r.ops?.some((o) => o.op === 'select')).toBe(true);
  });

  it('generatePlan falls back to rules when the cloud call hangs (never resolves)', async () => {
    // A cloud "generate" with no timeout would leave the UI spinning forever.
    // The hung call must time out and degrade to the deterministic template.
    vi.useFakeTimers();
    try {
      setModelsForTest({
        enabled: true,
        template: { generateContent: () => new Promise(() => {}) }, // never settles
      });
      const promise = generatePlan('two bedroom plan');
      await vi.advanceTimersByTimeAsync(13000); // past CLOUD_GENERATE_TIMEOUT_MS
      const r = await promise;
      expect(r.source).toBe('rules');
      expect(r.ops && r.ops.length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
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

// ───────────────────────────────────────────────────────────────────────────
// Server prompt templates (Firebase AI Logic) are used for the big cloud jobs
// only when a template ID is configured in Remote Config; otherwise the inline
// prompt model is used. The returned text is re-validated either way.

describe('server prompt templates (Remote Config driven)', () => {
  beforeEach(() => setActiveMode('plan'));
  afterEach(() => resetRemoteConfig());

  const PLAN_DOC =
    '{"rooms":[{"x":0,"y":0,"w":4000,"h":3000,"name":"Bedroom 1"},{"x":4000,"y":0,"w":4000,"h":3000,"name":"Bedroom 2"}],"unit":"mm"}';

  it('calls the server prompt-template model when a template ID is set', async () => {
    setRemoteConfigForTest({ templateIds: { plan: 'plan_generate' } });
    const calls: { templateId: string; templateVariables: Record<string, unknown> }[] = [];
    setModelsForTest({
      enabled: true,
      // The inline model would throw if (wrongly) used instead of the template.
      template: { generateContent: async () => { throw new Error('inline must not run'); } },
      promptTemplate: {
        generateContent: async (req) => {
          calls.push(req);
          return { response: { text: () => PLAN_DOC, inferenceSource: 'in_cloud' } };
        },
      },
    });
    const r = await generatePlan('two bedroom plan');
    expect(calls).toHaveLength(1);
    expect(calls[0].templateId).toBe('plan_generate');
    expect(calls[0].templateVariables).toMatchObject({ request: 'two bedroom plan' });
    expect(r.source).toBe('cloud');
    expect(r.ops && r.ops.length).toBeGreaterThan(0);
  });

  it('falls back to the inline cloud model when the server template fails', async () => {
    setRemoteConfigForTest({ templateIds: { plan: 'plan_generate' } });
    setModelsForTest({
      enabled: true,
      template: model(PLAN_DOC, 'in_cloud'),
      promptTemplate: { generateContent: async () => { throw new Error('no such template'); } },
    });
    const r = await generatePlan('two bedroom plan');
    expect(r.source).toBe('cloud');
    expect(r.ops && r.ops.length).toBeGreaterThan(0);
  });

  it('ignores the template model and uses the inline prompt when no template ID is set', async () => {
    let templateCalled = false;
    setModelsForTest({
      enabled: true,
      template: model(PLAN_DOC, 'in_cloud'),
      promptTemplate: {
        generateContent: async () => {
          templateCalled = true;
          return { response: { text: () => PLAN_DOC } };
        },
      },
    });
    const r = await generatePlan('two bedroom plan');
    expect(templateCalled).toBe(false);
    expect(r.source).toBe('cloud');
    expect(r.ops && r.ops.length).toBeGreaterThan(0);
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

describe('generateReferenceOptions (SVG text model, no image billing)', () => {
  const svg = (n: number) => `<svg viewBox="0 0 10 10"><circle cx="${n}" cy="2" r="1"/></svg>`;
  const payload = JSON.stringify({
    options: [
      { title: 'Front view', kind: 'drawing', svg: svg(2) },
      { title: 'Side view', kind: 'drawing', svg: svg(5) + '<script>alert(1)</script>' },
      { title: 'Top view', kind: 'drawing', svg: svg(8) },
    ],
  });

  it('returns 3–4 sanitized Gemini · cloud cards from the cloud text model', async () => {
    setModelsForTest({ enabled: true, refGenerate: model(payload) });
    const r = await generateReferenceOptions('hand holding a cup', 'drawing');
    expect(r).not.toBeNull();
    expect(r!.hits).toHaveLength(3);
    expect(r!.hits.every((h) => h.credit === 'Gemini · cloud')).toBe(true);
    expect(r!.hits.every((h) => h.source === 'Gemini')).toBe(true);
    expect(r!.hits[1].thumbUrl.startsWith('data:image/svg+xml')).toBe(true);
    expect(r!.source).toBe('cloud');
    expect(r!.ms).toBeGreaterThanOrEqual(0);
  });

  it('returns null when the cloud model is missing or the reply is unusable', async () => {
    setModelsForTest({ enabled: true });
    expect(await generateReferenceOptions('hand holding a cup', 'drawing')).toBeNull();
    setModelsForTest({ enabled: true, refGenerate: model('{"options":[]}') });
    expect(await generateReferenceOptions('hand holding a cup', 'drawing')).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Privacy: every cloud request that carries the user's words must send the SAME
// redacted text the ledger records (ai/redact.redactForCloud). On-device Nano
// prompts and the rules floor keep her raw words.

describe('cloud redaction (the request matches the ledger receipt)', () => {
  const MOTHER = 'Does this bedroom work for my mother Lakshmi?';

  /** A model that records every prompt it is asked and replies `text`. */
  const spy = (text: string, inferenceSource?: string) => {
    const prompts: string[] = [];
    const m: TextGenModel = {
      generateContent: async (p: string) => {
        prompts.push(p);
        return { response: { text: () => text, inferenceSource } };
      },
    };
    return { m, prompts };
  };
  /** An on-device model that records its prompt, then throws (→ cloud retry). */
  const throwing = () => {
    const prompts: string[] = [];
    const m: TextGenModel = {
      generateContent: async (p: string) => { prompts.push(p); throw new Error('nano down'); },
    };
    return { m, prompts };
  };

  const ctx: FusionContext = {
    space: 'plan', unit: 'mm', cursor: { x: 100, y: 200 }, hoverId: null, selectedIds: [], nearby: [],
  };

  beforeEach(() => setActiveMode('plan'));

  it('fuseIntent forceCloud sends [name] to the cloud, never Lakshmi', async () => {
    const cloud = spy('{"op":"undo","confidence":0.9}');
    setModelsForTest({ enabled: true, fusionCloud: cloud.m });
    const r = await fuseIntent(MOTHER, ctx, { forceCloud: true });
    expect(r.source).toBe('cloud');
    expect(cloud.prompts).toHaveLength(1);
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });

  it('on-device fuseIntent keeps her raw words in the Nano prompt', async () => {
    const nano = spy('{"op":"undo","confidence":0.9}', 'on_device');
    setModelsForTest({ enabled: true, fusion: nano.m });
    const r = await fuseIntent(MOTHER, ctx);
    expect(r.source).toBe('on-device');
    expect(nano.prompts[0]).toContain('Lakshmi');
    expect(nano.prompts[0]).not.toContain('[name]');
  });

  it('a failed on-device fusion retries on the cloud with a REDACTED prompt', async () => {
    const nano = throwing();
    const cloud = spy('{"op":"undo","confidence":0.9}');
    setModelsForTest({ enabled: true, fusion: nano.m, fusionCloud: cloud.m });
    const r = await fuseIntent(MOTHER, ctx);
    expect(r.source).toBe('cloud');
    // The raw on-device prompt was never re-sent to the cloud.
    expect(nano.prompts[0]).toContain('Lakshmi');
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });

  it('fuseIntent redacts person-like plan labels on the cloud leg (planNames)', async () => {
    const cloud = spy('{"op":"undo","confidence":0.9}');
    setModelsForTest({ enabled: true, fusionCloud: cloud.m });
    await fuseIntent('put a bed in Lakshmi', ctx, { forceCloud: true, planNames: ['Lakshmi', 'Kitchen'] });
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });

  it('Kannada cloud fusion still works through redaction (pass-through text)', async () => {
    const cloud = spy('{"op":"add_door","target":"w2","translation":"put a door here","confidence":0.9}');
    setModelsForTest({ enabled: true, fusionCloud: cloud.m });
    const r = await fuseIntent('ಬಾಗಿಲು ಇಲ್ಲಿ ಹಾಕು', ctx, {
      forceCloud: true, lang: { code: 'kn', englishName: 'Kannada' },
    });
    expect(r.source).toBe('cloud');
    expect(r.result).toMatchObject({ op: 'add_door', target: 'w2' });
    expect(r.translation).toBe('put a door here');
    expect(cloud.prompts[0]).toContain('ಬಾಗಿಲು');
  });

  const PLAN_DOC =
    '{"rooms":[{"x":0,"y":0,"w":4000,"h":3000,"name":"Bedroom 1"},{"x":4000,"y":0,"w":4000,"h":3000,"name":"Bedroom 2"}],"unit":"mm"}';

  it('generatePlan redacts the cloud prompt and stays idempotent', async () => {
    const cloud = spy(PLAN_DOC, 'in_cloud');
    setModelsForTest({ enabled: true, template: cloud.m });
    await generatePlan('a bedroom plan for my mother Lakshmi');
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
    // A caller that already redacted sends the identical prompt (idempotent).
    await generatePlan('a bedroom plan for my mother [name]');
    expect(cloud.prompts[1]).toBe(cloud.prompts[0]);
  });

  it('generatePlan sends the redacted request to the server prompt template', async () => {
    setRemoteConfigForTest({ templateIds: { plan: 'plan_generate' } });
    try {
      const calls: { templateId: string; templateVariables: Record<string, unknown> }[] = [];
      setModelsForTest({
        enabled: true,
        template: { generateContent: async () => { throw new Error('inline must not run'); } },
        promptTemplate: {
          generateContent: async (req) => {
            calls.push(req);
            return { response: { text: () => PLAN_DOC, inferenceSource: 'in_cloud' } };
          },
        },
      });
      await generatePlan('a bedroom plan for my mother Lakshmi');
      expect(calls[0].templateVariables.request).toContain('[name]');
      expect(String(calls[0].templateVariables.request)).not.toContain('Lakshmi');
    } finally {
      resetRemoteConfig();
    }
  });

  it('askCopilot redacts a phone number and stays idempotent', async () => {
    const cloud = spy('{"answer":"Yes, it fits.","calls":[],"why":""}');
    setModelsForTest({ enabled: true, copilotAnswer: cloud.m });
    const r = await askCopilot('Call me on +91 98765 43210 about the bedroom', 'plan {}', 'India');
    expect(r?.answer).toBe('Yes, it fits.');
    expect(cloud.prompts[0]).toContain('[phone]');
    expect(cloud.prompts[0]).not.toContain('98765');
    await askCopilot('Call me on [phone] about the bedroom', 'plan {}', 'India');
    expect(cloud.prompts[1]).toBe(cloud.prompts[0]);
  });

  it('detectLanguageCloud sends the redacted transcript', async () => {
    const cloud = spy('{"lang":"en","confidence":0.9}');
    setModelsForTest({ enabled: true, langDetect: cloud.m });
    await detectLanguageCloud(MOTHER);
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });

  it('pickRecipeHybrid redacts the utterance on the cloud leg', async () => {
    const cloud = spy('{"recipeId":"r1","confidence":0.9}');
    setModelsForTest({ enabled: true, fusionCloud: cloud.m });
    const r = await pickRecipeHybrid(`morning light for my mother Lakshmi`, [
      { id: 'r1', name: 'morning light', aliases: [] },
    ], { forceCloud: true });
    expect(r?.id).toBe('r1');
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });

  it('compileCommand retries a failed on-device call with a REDACTED cloud prompt', async () => {
    const nano = throwing();
    const cloud = spy('{"op":"undo"}', 'in_cloud');
    setModelsForTest({ enabled: true, intent: nano.m, intentCloud: cloud.m });
    await compileCommand(MOTHER, '{}', null);
    expect(nano.prompts[0]).toContain('Lakshmi');
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });

  it('deixis cloud retry redacts the utterance (and person-like candidate labels)', async () => {
    const prompts: string[] = [];
    setModelsForTest({
      enabled: true,
      deixis: { generateContent: async () => { throw new Error('nano down'); } },
      deixisCloud: {
        generateContent: async (parts) => {
          prompts.push(String(parts[0]));
          return { response: { text: () => '{"target":"none","confidence":0}' } };
        },
      },
    });
    await resolveDeixis("make Lakshmi's room brighter", null, {
      pointer: null,
      candidates: [{ id: 'room-1', kind: 'room', label: 'Lakshmi' }],
      space: 'plan',
      planNames: ['Lakshmi'],
    });
    expect(prompts[0]).toContain('[name]');
    expect(prompts[0]).not.toContain('Lakshmi');
  });

  it('pickCadTool cloud retry prompt is redacted', async () => {
    const nano = throwing();
    const cloud = spy('{"tool":"zoom","args":{"to":"fit"},"confidence":1}', 'in_cloud');
    setModelsForTest({ enabled: true, cadTool: nano.m, cadToolCloud: cloud.m });
    await pickCadTool(MOTHER, 'plan {}', { allowCloud: true });
    expect(nano.prompts[0]).toContain('Lakshmi');
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });

  it('proposeMaterials redacts the request before it reaches Gemini (ONLY_IN_CLOUD, no prior redaction)', async () => {
    const cloud = spy('{"lighting":{"sunIntensity":1}}', 'in_cloud');
    setModelsForTest({ enabled: true, copilotMaterials: cloud.m });
    await proposeMaterials('warm materials for my mother Lakshmi\'s room', 'plan {}');
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });

  it('refineSearchQuery retries a failed on-device call with a REDACTED cloud prompt', async () => {
    const nano = throwing();
    const cloud = spy('{"query":"bedroom tile"}', 'in_cloud');
    setModelsForTest({ enabled: true, intent: nano.m, intentCloud: cloud.m });
    await refineSearchQuery("tile like my mother Lakshmi's kitchen");
    expect(nano.prompts[0]).toContain('Lakshmi');
    expect(cloud.prompts[0]).toContain('[name]');
    expect(cloud.prompts[0]).not.toContain('Lakshmi');
  });
});

describe('on-device warm-up', () => {
  it('no-ops under test overrides (does not call a model)', async () => {
    setModelsForTest({ enabled: true, appCheck: 'ready', cadTool: model('{"tool":"zoom","args":{"to":"fit"},"confidence":1}') });
    expect(await warmOnDevice()).toBe(false);
  });
});
