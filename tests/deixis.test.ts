// Point-and-say deixis: pure payload builder (crop + prompt), untrusted-
// response parser, colour math, and resolution→op mapping. Plus the hybrid
// resolveDeixis() call path with fully mocked models — no network, no camera.

import { afterEach, describe, expect, it } from 'vitest';
import {
  BRIGHTNESS_STEP,
  DEIXIS_CONSTRAINT,
  DEIXIS_CROP_PX,
  adjustBrightness,
  buildCropRect,
  buildDeixisPrompt,
  deixisToOp,
  isDeicticAdjust,
  matchCandidateByLabel,
  parseDeixisResult,
  type DeixisResolution,
} from '../src/ai/deixis';
import { resolveDeixis, setModelsForTest, type ImagePart, type MultimodalGenModel } from '../src/ai/hybrid';

const CANDS = [
  { id: 'button-1', kind: 'button', label: 'Sign in' },
  { id: 'text-2', kind: 'text', label: 'Welcome back' },
];

describe('isDeicticAdjust gate', () => {
  it('fires on deictic word + adjustment cue', () => {
    expect(isDeicticAdjust('make this brighter')).toBe(true);
    expect(isDeicticAdjust('make that one blue')).toBe(true);
    expect(isDeicticAdjust('it should be smaller')).toBe(true);
  });
  it('stays quiet without deixis or without an adjustment', () => {
    expect(isDeicticAdjust('make the header brighter')).toBe(false); // no deictic word
    expect(isDeicticAdjust('delete this')).toBe(false); // no adjust cue
    expect(isDeicticAdjust('add a door')).toBe(false);
  });
});

describe('buildCropRect', () => {
  it('centres a tight crop on the pointer and reports crop-local pixels', () => {
    const r = buildCropRect(640, 480, { x: 0.5, y: 0.5 });
    expect(r.w).toBe(DEIXIS_CROP_PX);
    expect(r.h).toBe(DEIXIS_CROP_PX);
    expect(r.x).toBe(160);
    expect(r.y).toBe(80);
    expect(r.pointer).toEqual({ x: 160, y: 160 });
  });
  it('clamps at frame edges so the crop never leaves the frame', () => {
    const r = buildCropRect(640, 480, { x: 0.99, y: 0.01 });
    expect(r.x + r.w).toBeLessThanOrEqual(640);
    expect(r.y).toBe(0);
    expect(r.pointer!.x).toBeGreaterThan(r.w / 2); // pointer stays near the edge
  });
  it('shrinks for small frames and centres without a pointer', () => {
    const r = buildCropRect(200, 160, null);
    expect(r.w).toBe(160);
    expect(r.pointer).toBeNull();
  });
});

describe('buildDeixisPrompt', () => {
  it('embeds pointer, candidates, and the quoted transcript', () => {
    const p = buildDeixisPrompt('make this brighter', {
      hasImage: true, pointer: { x: 12, y: 34 }, candidates: CANDS, space: 'ui',
    });
    expect(p).toContain('(12, 34)');
    expect(p).toContain('"button-1"');
    expect(p).toContain(JSON.stringify('make this brighter'));
    expect(p).toContain('Never invent ids');
  });
  it('says so when no photo is attached', () => {
    const p = buildDeixisPrompt('make it red', { hasImage: false, pointer: null, candidates: CANDS, space: 'ui' });
    expect(p).toContain('No photo');
  });
  it('constraint declares the fields the parser reads', () => {
    const props = DEIXIS_CONSTRAINT.properties as Record<string, unknown>;
    for (const k of ['target', 'object', 'property', 'direction', 'color', 'confidence']) {
      expect(props[k]).toBeDefined();
    }
  });
});

describe('parseDeixisResult', () => {
  const ids = CANDS.map((c) => c.id);
  it('accepts a well-formed answer', () => {
    const r = parseDeixisResult(
      { target: 'button-1', object: 'blue button', property: 'brightness', direction: 'increase', confidence: 0.9 }, ids,
    );
    expect(r).toMatchObject({ target: 'button-1', property: 'brightness', direction: 'increase', confidence: 0.9 });
  });
  it('coerces an invented id to none, never applies it', () => {
    const r = parseDeixisResult({ target: 'wall-99', property: 'size', direction: 'up' }, ids);
    expect(r!.target).toBe('none');
    expect(r!.direction).toBe('increase');
  });
  it('maps direction words and percent confidence', () => {
    const r = parseDeixisResult({ target: 'pointed', property: 'brighter', direction: 'darker', confidence: 85 }, ids);
    expect(r).toMatchObject({ property: 'brightness', direction: 'decrease', confidence: 0.85 });
  });
  it('normalizes a named colour and rejects a colour change without one', () => {
    const ok = parseDeixisResult({ target: 'pointed', property: 'color', color: 'red' }, ids);
    expect(ok!.color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(parseDeixisResult({ target: 'pointed', property: 'color' }, ids)).toBeNull();
  });
  it('rejects junk', () => {
    expect(parseDeixisResult(null, ids)).toBeNull();
    expect(parseDeixisResult([], ids)).toBeNull();
    expect(parseDeixisResult({ target: 'pointed', property: 'teleport' }, ids)).toBeNull();
  });
});

describe('matchCandidateByLabel', () => {
  it('matches a real-object label to a canvas element by kind/label words', () => {
    expect(matchCandidateByLabel('sign in button', CANDS)).toBe('button-1');
    expect(matchCandidateByLabel('welcome text', CANDS)).toBe('text-2');
  });
  it('null when nothing matches or no label', () => {
    expect(matchCandidateByLabel('coffee mug', CANDS)).toBeNull();
    expect(matchCandidateByLabel(undefined, CANDS)).toBeNull();
  });
});

describe('adjustBrightness', () => {
  it('blends toward white / black by the step', () => {
    expect(adjustBrightness('#000000', 'increase')).toBe('#4d4d4d'); // 255*0.3
    expect(adjustBrightness('#ffffff', 'decrease')).toBe('#b3b3b3');
    expect(BRIGHTNESS_STEP).toBeGreaterThan(0);
  });
  it('accepts named colours and rejects junk', () => {
    expect(adjustBrightness('red', 'increase')).toMatch(/^#[0-9a-f]{6}$/);
    expect(adjustBrightness('not-a-colour', 'increase')).toBeNull();
  });
});

describe('deixisToOp', () => {
  const res = (over: Partial<DeixisResolution>): DeixisResolution => ({
    target: 'pointed', property: 'brightness', direction: 'increase', confidence: 0.9, ...over,
  });
  it('ui brightness: set_fill from the CURRENT fill', () => {
    const op = deixisToOp(res({}), { id: 'button-1', space: 'ui', kind: 'button', fill: '#000000' });
    expect(op).toEqual({ op: 'set_fill', target: 'button-1', fill: '#4d4d4d' });
  });
  it('ui text uses set_style colour, not fill', () => {
    const op = deixisToOp(res({ property: 'color', color: '#ff0000' }), { id: 'text-2', space: 'ui', kind: 'text', fill: '#0f172a', fontSize: 16 });
    expect(op).toEqual({ op: 'set_style', target: 'text-2', color: '#ff0000' });
  });
  it('ui size scales font or box', () => {
    expect(deixisToOp(res({ property: 'size' }), { id: 'text-2', space: 'ui', kind: 'text', fontSize: 16 }))
      .toEqual({ op: 'set_style', target: 'text-2', size: 20 });
    expect(deixisToOp(res({ property: 'size', direction: 'decrease' }), { id: 'image-3', space: 'ui', kind: 'image', w: 100, h: 50 }))
      .toEqual({ op: 'set_size', target: 'image-3', w: 80, h: 40 });
  });
  it('plan size scales wall length / opening width in mm', () => {
    expect(deixisToOp(res({ property: 'size' }), { id: 'wall-1', space: 'plan', kind: 'wall', lengthMm: 4000 }))
      .toEqual({ op: 'set_length', target: 'wall-1', nums: { length: 5000 }, unit: 'mm' });
    expect(deixisToOp(res({ property: 'size', direction: 'decrease' }), { id: 'door-1', space: 'plan', kind: 'door', widthMm: 900 }))
      .toEqual({ op: 'set_width', target: 'door-1', nums: { width: 720 }, unit: 'mm' });
  });
  it('honestly refuses what the element cannot do', () => {
    expect(deixisToOp(res({}), { id: 'wall-1', space: 'plan', kind: 'wall', lengthMm: 4000 })).toBeNull(); // plan brightness
    expect(deixisToOp(res({}), { id: 'input-1', space: 'ui', kind: 'input' })).toBeNull(); // no fill to brighten
  });
});

// ---------------------------------------------------------------------------
// hybrid.resolveDeixis with mocked models: parts, sources, fallbacks.

const mm = (text: string, inferenceSource?: string, seen?: Array<string | ImagePart>[]): MultimodalGenModel => ({
  generateContent: async (parts) => {
    seen?.push(parts);
    return { response: { text: () => text, inferenceSource } };
  },
});

afterEach(() => setModelsForTest(null));

describe('hybrid resolveDeixis', () => {
  const opts = { pointer: { x: 10, y: 20 }, candidates: CANDS, space: 'ui' as const };
  const answer = '{"target":"pointed","object":"button","property":"brightness","direction":"increase","confidence":0.8}';

  it('sends prompt + inlineData image and labels on-device', async () => {
    const seen: Array<string | ImagePart>[] = [];
    setModelsForTest({ enabled: true, deixis: mm(answer, 'on_device', seen) });
    const r = await resolveDeixis('make this brighter', { mimeType: 'image/jpeg', dataBase64: 'aGk=' }, opts);
    expect(r!.source).toBe('on-device');
    expect(r!.resolution.target).toBe('pointed');
    expect(seen[0]).toHaveLength(2);
    expect(seen[0][1]).toEqual({ inlineData: { mimeType: 'image/jpeg', data: 'aGk=' } });
    expect(String(seen[0][0])).toContain('(10, 20)');
  });

  it('omits the image part when there is none', async () => {
    const seen: Array<string | ImagePart>[] = [];
    setModelsForTest({ enabled: true, deixis: mm(answer, 'on_device', seen) });
    await resolveDeixis('make this brighter', null, opts);
    expect(seen[0]).toHaveLength(1);
  });

  it('retries on the cloud twin when the hybrid call throws', async () => {
    setModelsForTest({
      enabled: true,
      deixis: { generateContent: async () => { throw new Error('nano died'); } },
      deixisCloud: mm(answer, 'in_cloud'),
    });
    const r = await resolveDeixis('make this brighter', null, opts);
    expect(r!.source).toBe('cloud');
  });

  it('returns null (caller falls back to fusion) on junk or no model', async () => {
    setModelsForTest({ enabled: true, deixis: mm('not json at all', 'on_device') });
    expect(await resolveDeixis('make this brighter', null, opts)).toBeNull();
    setModelsForTest({ enabled: false });
    expect(await resolveDeixis('make this brighter', null, opts)).toBeNull();
  });
});
