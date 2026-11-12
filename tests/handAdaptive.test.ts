// Hand-adaptive input: pure metrics (input/handMetrics), pure profile selection
// (input/handProfile), and the on-device adapt wiring with a mocked Nano model
// (ai/hybrid.adaptHandProfile). No camera, no network — numbers only.

import { afterEach, describe, expect, it } from 'vitest';
import {
  createHandMetricsSampler,
  fatigueTrend,
  meanJerk,
  pinchEffort,
  pinchRatio,
  type HandMetrics,
  type MetricsFrame,
} from '../src/input/handMetrics';
import {
  coerceProfileAdaptation,
  fallbackProfile,
  loadProfileOverride,
  PROFILES,
  resolveActiveProfile,
  summarizeAdaptation,
} from '../src/input/handProfile';
import { adaptHandProfile, setModelsForTest, type TextGenModel } from '../src/ai/hybrid';
import {
  THUMB_TIP, INDEX_TIP, WRIST, MIDDLE_MCP, DEFAULT_PINCH_ON, DEFAULT_PINCH_OFF, type Pt,
} from '../src/input/handLogic';

afterEach(() => setModelsForTest(null));

// --- fixtures -----------------------------------------------------------------

/** 21 points with wrist/middle-MCP fixed (hand size 0.2) and the thumb/index
 *  tips placed so pinchRatio(points) === ratio exactly. tipX shifts the index
 *  tip horizontally for tremor tests without changing the ratio. */
function handAt(ratio: number, tipX = 0): Pt[] {
  const pts: Pt[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0 }));
  pts[WRIST] = { x: 0, y: 0 };
  pts[MIDDLE_MCP] = { x: 0, y: 0.2 }; // handSize = 0.2
  pts[THUMB_TIP] = { x: tipX, y: 0.5 };
  pts[INDEX_TIP] = { x: tipX + ratio * 0.2, y: 0.5 };
  return pts;
}

const lowMetrics = (over: Partial<HandMetrics> = {}): HandMetrics => ({
  pinchEffort: 0.2, tremor: 0.002, pinchMs: 150, fatigue: 0.05, pinches: 8, frames: 200, sessionMs: 20000, ...over,
});

const model = (text: string, inferenceSource?: string): TextGenModel => ({
  generateContent: async () => ({ response: { text: () => text, inferenceSource } }),
});

// --- pure metric helpers ------------------------------------------------------

describe('pinchRatio', () => {
  it('is the thumb↔index gap over hand size (scale-invariant)', () => {
    expect(pinchRatio(handAt(0.3))).toBeCloseTo(0.3, 6);
    expect(pinchRatio(handAt(0.3, 0.4))).toBeCloseTo(0.3, 6); // translated hand, same ratio
  });
  it('is Infinity for a truncated landmark list', () => {
    expect(pinchRatio([{ x: 0, y: 0 }])).toBe(Infinity);
  });
});

describe('pinchEffort', () => {
  it('is minRatio / pinchOn, clamped 0..1', () => {
    expect(pinchEffort(0.1, 0.4)).toBeCloseTo(0.25, 6);
    expect(pinchEffort(0, 0.4)).toBe(0);      // snapped fully shut → no effort
    expect(pinchEffort(0.8, 0.4)).toBe(1);    // barely closed → max effort, clamped
  });
});

describe('meanJerk (tremor primitive)', () => {
  it('is ~0 for smooth constant-velocity motion', () => {
    const line = Array.from({ length: 6 }, (_, i) => ({ x: i * 0.01, y: 0 }));
    expect(meanJerk(line)).toBeCloseTo(0, 9);
  });
  it('is positive and larger for a shakier path', () => {
    const steady = [{ x: 0, y: 0 }, { x: 0.001, y: 0 }, { x: 0.002, y: 0 }, { x: 0.003, y: 0 }];
    const shaky = [{ x: 0, y: 0 }, { x: 0.02, y: 0 }, { x: 0, y: 0 }, { x: 0.02, y: 0 }];
    expect(meanJerk(shaky)).toBeGreaterThan(meanJerk(steady));
  });
  it('is 0 with fewer than 3 points', () => {
    expect(meanJerk([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);
  });
});

describe('fatigueTrend', () => {
  it('is 0 with too few samples', () => {
    expect(fatigueTrend([1, 2, 3])).toBe(0);
  });
  it('reports the clamped fractional rise from the first third to the last', () => {
    expect(fatigueTrend([1, 1, 1, 1, 2, 2, 2, 2, 2, 2])).toBeCloseTo(1, 6); // doubled → +100% → 1
    expect(fatigueTrend([1, 1, 1, 1, 1, 1])).toBe(0);                       // flat → no fatigue
    expect(fatigueTrend([100, 100, 100, 110, 110, 110])).toBeCloseTo(0.1, 6);
  });
});

// --- the sampler (state machine over frames) ----------------------------------

describe('createHandMetricsSampler', () => {
  /** One open→approach→complete→release pinch at the given times/depth. */
  function pinchFrames(t0: number, deepest: number): MetricsFrame[] {
    return [
      { t: t0, points: handAt(0.6) },        // open
      { t: t0 + 10, points: handAt(0.45) },  // approach (< pinchOff)
      { t: t0 + 20, points: handAt(0.30) },  // completes (< pinchOn)
      { t: t0 + 30, points: handAt(deepest) }, // deepest squeeze
      { t: t0 + 40, points: handAt(0.6) },   // release (> pinchOff)
    ];
  }

  it('times a pinch from approach to completion and reads its deepest squeeze', () => {
    const s = createHandMetricsSampler();
    for (const f of pinchFrames(0, 0.2)) s.push(f);
    const m = s.snapshot();
    expect(m.pinches).toBe(1);
    expect(m.pinchMs).toBe(10); // 20 (complete) − 10 (approach)
    expect(m.pinchEffort).toBeCloseTo(0.2 / DEFAULT_PINCH_ON, 4); // deepest 0.2 over pinchOn
  });

  it('counts multiple pinches and needs minPinches before it is ready', () => {
    const s = createHandMetricsSampler({ minPinches: 3 });
    expect(s.ready()).toBe(false);
    for (let i = 0; i < 3; i++) for (const f of pinchFrames(i * 100, 0.15)) s.push(f);
    expect(s.snapshot().pinches).toBe(3);
    expect(s.ready()).toBe(true);
  });

  it('ignores an aborted approach that never crosses the pinch-on threshold', () => {
    const s = createHandMetricsSampler();
    s.push({ t: 0, points: handAt(0.6) });
    s.push({ t: 10, points: handAt(0.45) }); // approach only (never < pinchOn)
    s.push({ t: 20, points: handAt(0.6) });  // release
    expect(s.snapshot().pinches).toBe(0);
  });

  it('reset clears all accumulated metrics', () => {
    const s = createHandMetricsSampler();
    for (const f of pinchFrames(0, 0.2)) s.push(f);
    s.reset();
    const m = s.snapshot();
    expect(m.pinches).toBe(0);
    expect(m.frames).toBe(0);
    expect(m.sessionMs).toBe(0);
  });

  it('uses handLogic thresholds and derives sessionMs from timestamps', () => {
    expect(DEFAULT_PINCH_ON).toBe(0.35);
    expect(DEFAULT_PINCH_OFF).toBe(0.48);
    const s = createHandMetricsSampler();
    for (const f of pinchFrames(1000, 0.2)) s.push(f);
    expect(s.snapshot().sessionMs).toBe(40);
  });
});

// --- deterministic profile selection ------------------------------------------

describe('fallbackProfile (rules pick)', () => {
  it('chooses assist for a shaky pointer', () => {
    expect(fallbackProfile(lowMetrics({ tremor: 0.02 }))).toBe('assist');
  });
  it('chooses assist for effortful or tiring pinches', () => {
    expect(fallbackProfile(lowMetrics({ pinchEffort: 0.8 }))).toBe('assist');
    expect(fallbackProfile(lowMetrics({ fatigue: 0.6 }))).toBe('assist');
  });
  it('chooses precise only when everything is low and quick', () => {
    expect(fallbackProfile(lowMetrics())).toBe('precise');
  });
  it('falls to standard in between', () => {
    expect(fallbackProfile(lowMetrics({ tremor: 0.007, pinchMs: 400 }))).toBe('standard');
  });
});

// --- validating the (untrusted) Nano answer -----------------------------------

describe('coerceProfileAdaptation', () => {
  it('accepts a valid named profile and trims the reason', () => {
    const a = coerceProfileAdaptation({ profile: 'assist', reason: '  shaky hands  ' }, lowMetrics());
    expect(a.source).toBe('nano');
    expect(a.profile.name).toBe('assist');
    expect(a.reason).toBe('shaky hands');
  });

  it('clamps out-of-range numeric overrides onto the named preset', () => {
    const a = coerceProfileAdaptation(
      { profile: 'standard', targetScale: 99, smoothing: -1, clickMode: 'nope' }, lowMetrics(),
    );
    expect(a.profile.targetScale).toBe(2);       // clamped to the max
    expect(a.profile.smoothing).toBe(0);         // clamped to the min
    expect(a.profile.clickMode).toBe('pinch');   // invalid → keep preset
  });

  it('falls back to the rules pick for a malformed or unknown answer', () => {
    const shaky = lowMetrics({ tremor: 0.02 });
    expect(coerceProfileAdaptation(null, shaky).source).toBe('rules');
    expect(coerceProfileAdaptation({ profile: 'turbo' }, shaky).source).toBe('rules');
    expect(coerceProfileAdaptation('nonsense', shaky).profile.name).toBe('assist');
  });
});

describe('summarizeAdaptation / resolveActiveProfile / override', () => {
  it('summarises the assist profile with only the applied knobs', () => {
    const s = summarizeAdaptation(PROFILES.assist);
    expect(s).toMatch(/^Adapted for your hands:/);
    expect(s).toContain('larger targets');
    expect(s).toContain('extra smoothing');
    expect(s).toContain('an easier pinch');
    expect(s).not.toContain('dwell'); // reserved knob — not claimed
  });

  it('summarises the precise profile as a crisper, firmer configuration', () => {
    const s = summarizeAdaptation(PROFILES.precise);
    expect(s).toContain('smaller targets');
    expect(s).toContain('a crisper pointer');
    expect(s).toContain('a firmer pinch');
  });

  it('a manual override wins over the adaptation', () => {
    const adaptation = coerceProfileAdaptation({ profile: 'assist' }, lowMetrics());
    const forced = resolveActiveProfile(adaptation, 'precise');
    expect(forced.source).toBe('override');
    expect(forced.profile.name).toBe('precise');
    // 'auto' leaves the adaptation untouched.
    expect(resolveActiveProfile(adaptation, 'auto').profile.name).toBe('assist');
  });

  it('defaults to auto when no override is stored (node has no localStorage)', () => {
    expect(loadProfileOverride()).toBe('auto');
  });
});

// --- on-device adapt wiring (mocked Nano) -------------------------------------

describe('adaptHandProfile (on-device only)', () => {
  it('uses Nano when it is ready and the response is on-device', async () => {
    setModelsForTest({
      handAdapt: model('{"profile":"assist","reason":"shaky and tiring"}', 'on_device'),
      deviceModel: 'ready',
    });
    const r = await adaptHandProfile(lowMetrics({ tremor: 0.02 }));
    expect(r.source).toBe('nano');
    expect(r.profile.name).toBe('assist');
    expect(r.reason).toBe('shaky and tiring');
  });

  it('keeps numbers on device: no adapt call unless Nano is actually ready', async () => {
    setModelsForTest({
      handAdapt: model('{"profile":"precise"}', 'on_device'),
      deviceModel: 'downloadable', // not ready
    });
    const r = await adaptHandProfile(lowMetrics({ tremor: 0.02 }));
    expect(r.source).toBe('rules');
    expect(r.profile.name).toBe('assist'); // rules pick from the shaky metrics
  });

  it('discards a response that resolved in the cloud', async () => {
    setModelsForTest({
      handAdapt: model('{"profile":"precise"}', 'in_cloud'),
      deviceModel: 'ready',
    });
    const r = await adaptHandProfile(lowMetrics());
    expect(r.source).toBe('rules');
  });

  it('falls back to rules when no on-device model is configured', async () => {
    setModelsForTest({ handAdapt: null, deviceModel: 'ready' });
    const r = await adaptHandProfile(lowMetrics());
    expect(r.source).toBe('rules');
    expect(r.profile.name).toBe('precise');
  });
});
