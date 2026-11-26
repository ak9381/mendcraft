import { describe, it, expect } from 'vitest';
import {
  computeCalibration, reachFromPoints, remapToReach, pinchFromRatios, tremorSettings,
  coerceCalibration, isFullReach, MIN_REACH_SPAN, DEFAULT_CALIBRATION,
} from '../src/setup/calibration';
import {
  defaultSetup, nextStep, prevStep, stepProgress, setBinding, bindingForPhrase, bindingForGesture,
  coerceSetup, loadSetup, saveSetup, addTemplate, removeTemplate, normalizePhrase, SETUP_STEPS, SETUP_KEY,
} from '../src/setup/setupState';
import {
  createTemplateRecorder, matchTemplate, normalizePose, poseDistance, steadiestFrame, coerceTemplate,
} from '../src/input/gestureTemplates';
import { createFaceCueDetector, faceRatios } from '../src/input/faceCues';
import { OPEN, POINT, PINCH, VSIGN, FIST, place, rotate } from './helpers/hands';

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe('calibration: reach', () => {
  it('builds a padded reach box from a small comfortable range', () => {
    const pts = [] as { x: number; y: number }[];
    for (let i = 0; i <= 20; i++) pts.push({ x: 0.4 + (i % 5) * 0.05, y: 0.3 + Math.floor(i / 5) * 0.06 });
    const r = reachFromPoints(pts);
    expect(r.x0).toBeLessThan(0.4);
    expect(r.x1).toBeGreaterThan(0.6);
    expect(r.x1 - r.x0).toBeGreaterThanOrEqual(MIN_REACH_SPAN);
    expect(isFullReach(r)).toBe(false);
  });
  it('a tiny range is widened to the minimum span so tremor is not amplified', () => {
    const pts = Array.from({ length: 10 }, (_, i) => ({ x: 0.5 + i * 0.001, y: 0.5 }));
    const r = reachFromPoints(pts);
    expect(r.x1 - r.x0).toBeCloseTo(MIN_REACH_SPAN, 5);
    expect(r.y1 - r.y0).toBeCloseTo(MIN_REACH_SPAN, 5);
  });
  it('stays inside 0..1 near the edge', () => {
    const r = reachFromPoints(Array.from({ length: 10 }, () => ({ x: 0.99, y: 0.01 })));
    expect(r.x1).toBeLessThanOrEqual(1);
    expect(r.y0).toBeGreaterThanOrEqual(0);
    expect(r.x1 - r.x0).toBeCloseTo(MIN_REACH_SPAN, 5);
  });
  it('too few samples falls back to the full frame', () => {
    expect(isFullReach(reachFromPoints([{ x: 0.5, y: 0.5 }]))).toBe(true);
  });
  it('remaps her reach box onto the whole screen and clamps outside it', () => {
    const r = { x0: 0.3, y0: 0.2, x1: 0.7, y1: 0.6 };
    const m = remapToReach({ x: 0.5, y: 0.4 }, r);
    expect(m.x).toBeCloseTo(0.5, 9);
    expect(m.y).toBeCloseTo(0.5, 9);
    expect(remapToReach({ x: 0.3, y: 0.2 }, r)).toEqual({ x: 0, y: 0 });
    expect(remapToReach({ x: 0.9, y: 0.9 }, r)).toEqual({ x: 1, y: 1 });
  });
});

describe('calibration: pinch and tremor', () => {
  it('sets the pinch threshold inside what her fingers can close', () => {
    const ratios = [...Array(20).fill(0.3), ...Array(20).fill(0.9)];
    const { pinchOn, pinchOff } = pinchFromRatios(ratios);
    expect(pinchOn).toBeGreaterThan(0.3);
    expect(pinchOn).toBeLessThan(0.6);
    expect(pinchOff).toBeGreaterThan(pinchOn);
  });
  it('falls back to defaults when she never really pinched', () => {
    expect(pinchFromRatios(Array(30).fill(0.8))).toEqual({ pinchOn: DEFAULT_CALIBRATION.pinchOn, pinchOff: DEFAULT_CALIBRATION.pinchOff });
    expect(pinchFromRatios([0.2, 0.9])).toEqual({ pinchOn: DEFAULT_CALIBRATION.pinchOn, pinchOff: DEFAULT_CALIBRATION.pinchOff });
  });
  it('more tremor means more smoothing and a longer dwell', () => {
    const steady = tremorSettings(0.002);
    const shaky = tremorSettings(0.014);
    expect(shaky.smoothing).toBeGreaterThan(steady.smoothing);
    expect(shaky.dwellMs).toBeGreaterThan(steady.dwellMs);
  });
  it('computeCalibration combines the three steps', () => {
    const reach = Array.from({ length: 20 }, (_, i) => place(POINT(), 0.35 + (i % 4) * 0.08, 0.6 + Math.floor(i / 4) * 0.03, 0.5));
    const pinch = [...Array(15).fill(0).map(() => PINCH()), ...Array(15).fill(0).map(() => OPEN())];
    const still = Array.from({ length: 30 }, (_, i) => place(POINT(), 0.5 + (i % 2 ? 0.006 : -0.006), 0.8, 0.5));
    const c = computeCalibration({ reach, pinch, still });
    expect(isFullReach(c.reach)).toBe(false);
    expect(c.tremor).toBeGreaterThan(0.01);
    expect(c.smoothing).toBeGreaterThan(0.5);
    expect(coerceCalibration(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
  it('coerceCalibration rejects junk', () => {
    expect(coerceCalibration(null)).toBeNull();
    expect(coerceCalibration({ ...DEFAULT_CALIBRATION, pinchOff: 0.01 })).toBeNull();
    expect(coerceCalibration({ ...DEFAULT_CALIBRATION, reach: { x0: 0.5, y0: 0, x1: 0.55, y1: 1 } })).toBeNull();
  });
});

describe('custom gesture templates (record in 3 tries)', () => {
  it('normalisation ignores position, size and rotation', () => {
    const a = normalizePose(VSIGN())!;
    const b = normalizePose(rotate(place(VSIGN(), 0.2, 0.7, 0.6), 25))!;
    expect(poseDistance(a, b)).toBeLessThan(1e-6);
  });
  it('different poses are far apart', () => {
    expect(poseDistance(normalizePose(VSIGN())!, normalizePose(FIST())!)).toBeGreaterThan(0.2);
  });
  it('records a template after three consistent tries', () => {
    const rec = createTemplateRecorder('my-v', 'My V', () => 42);
    expect(rec.addTry(VSIGN()).status).toBe('need-more');
    expect(rec.addTry(place(VSIGN(), 0.3, 0.8, 0.8)).status).toBe('need-more');
    const res = rec.addTry(rotate(VSIGN(), 10));
    expect(res.status).toBe('done');
    if (res.status === 'done') {
      expect(res.template.id).toBe('my-v');
      expect(res.template.vector).toHaveLength(42);
      expect(res.template.createdAt).toBe(42);
    }
  });
  it('asks to redo only the try that looked different', () => {
    const rec = createTemplateRecorder('x', 'X');
    rec.addTry(VSIGN());
    rec.addTry(FIST());
    const res = rec.addTry(VSIGN());
    expect(res.status).toBe('retry');
    if (res.status === 'retry') expect(res.badTry).toBe(1);
    expect(rec.tries()).toBe(2);
    expect(rec.addTry(VSIGN()).status).toBe('done');
  });
  it('rejects a try without a full hand', () => {
    const rec = createTemplateRecorder('x', 'X');
    expect(rec.addTry([]).status).toBe('retry');
    expect(rec.tries()).toBe(0);
  });
  it('matches a live pose to the nearest template, and nothing when far', () => {
    const rec = createTemplateRecorder('v', 'V');
    rec.addTry(VSIGN()); rec.addTry(VSIGN());
    const r = rec.addTry(VSIGN());
    const t = r.status === 'done' ? r.template : null;
    expect(t).not.toBeNull();
    expect(matchTemplate(place(VSIGN(), 0.4, 0.6, 0.7), [t!])?.id).toBe('v');
    expect(matchTemplate(FIST(), [t!])).toBeNull();
  });
  it('steadiestFrame picks the least-moving frame', () => {
    const frames = [rotate(VSIGN(), 0), VSIGN(), VSIGN(), VSIGN(), FIST()];
    expect(steadiestFrame(frames)).toBe(frames[1]);
    expect(steadiestFrame([FIST(), VSIGN(), FIST(), VSIGN(), VSIGN(), VSIGN()])).not.toBe(undefined);
    expect(steadiestFrame([])).toBeNull();
  });
  it('coerceTemplate validates stored templates', () => {
    expect(coerceTemplate({ id: 'ok', label: 'Ok', vector: Array(42).fill(0.1) })).not.toBeNull();
    expect(coerceTemplate({ id: 'BAD ID', label: 'x', vector: Array(42).fill(0) })).toBeNull();
    expect(coerceTemplate({ id: 'ok', label: 'x', vector: [1, 2] })).toBeNull();
  });
});

describe('face cues', () => {
  function face(mouth = 0.2, brow = 0.05) {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    lm[234] = { x: 0.3, y: 0.5 }; lm[454] = { x: 0.7, y: 0.5 }; // cheeks: width 0.4
    lm[10] = { x: 0.5, y: 0.2 }; lm[152] = { x: 0.5, y: 0.8 }; // forehead/chin: height 0.6
    lm[61] = { x: 0.5 - mouth / 2, y: 0.65 }; lm[291] = { x: 0.5 + mouth / 2, y: 0.65 };
    lm[159] = { x: 0.42, y: 0.4 }; lm[386] = { x: 0.58, y: 0.4 };
    lm[105] = { x: 0.42, y: 0.4 - brow }; lm[334] = { x: 0.58, y: 0.4 - brow };
    return lm;
  }
  it('computes ratios relative to face size', () => {
    const r = faceRatios(face())!;
    expect(r.smile).toBeCloseTo(0.5, 5);
    expect(r.brow).toBeCloseTo(0.05 / 0.6, 5);
    expect(faceRatios([])).toBeNull();
  });
  it('a smile held 600 ms fires once; raised eyebrows too', () => {
    const det = createFaceCueDetector();
    expect(det.update(faceRatios(face()), 0)).toBeNull(); // no baseline yet
    det.setBaseline([faceRatios(face())!]);
    expect(det.update(faceRatios(face(0.26)), 0)).toBeNull();
    expect(det.update(faceRatios(face(0.26)), 300)).toBeNull();
    expect(det.update(faceRatios(face(0.26)), 650)).toBe('smile');
    expect(det.update(faceRatios(face(0.26)), 900)).toBeNull(); // once per hold
    expect(det.update(faceRatios(face()), 1000)).toBeNull();
    expect(det.update(faceRatios(face(0.2, 0.07)), 1100)).toBeNull();
    expect(det.update(faceRatios(face(0.2, 0.07)), 1800)).toBe('eyebrows');
  });
  it('a brief smile does not fire', () => {
    const det = createFaceCueDetector();
    det.setBaseline([faceRatios(face())!]);
    det.update(faceRatios(face(0.26)), 0);
    det.update(faceRatios(face()), 300);
    expect(det.update(faceRatios(face(0.26)), 700)).toBeNull();
  });
});

describe('setup state', () => {
  it('walks the steps forward and back', () => {
    expect(nextStep('welcome')).toBe('reach');
    expect(prevStep('reach')).toBe('welcome');
    expect(prevStep('welcome')).toBe('welcome');
    expect(nextStep('done')).toBe('done');
    expect(stepProgress('done')).toEqual({ index: SETUP_STEPS.length - 1, total: SETUP_STEPS.length - 1 });
  });
  it('maps a button to a gesture and a Kannada phrase', () => {
    let d = setBinding(defaultSetup(), { target: 'btn-undo', gesture: 'v-sign', phrase: 'ಹಿಂದಕ್ಕೆ!' });
    expect(bindingForPhrase(d, '  ಹಿಂದಕ್ಕೆ ')).toBe('btn-undo');
    expect(bindingForGesture(d, 'v-sign')).toBe('btn-undo');
    // Moving the gesture to another button takes it off the first.
    d = setBinding(d, { target: 'btn-redo', gesture: 'v-sign' });
    expect(bindingForGesture(d, 'v-sign')).toBe('btn-redo');
    expect(bindingForPhrase(d, 'ಹಿಂದಕ್ಕೆ')).toBe('btn-undo');
    // Clearing both removes the binding.
    d = setBinding(d, { target: 'btn-undo' });
    expect(bindingForPhrase(d, 'ಹಿಂದಕ್ಕೆ')).toBeNull();
  });
  it('keeps Kannada vowel signs when normalising phrases', () => {
    expect(normalizePhrase('ಹೊಸ ಸಾಧನ ಸೇರಿಸು!')).toBe('ಹೊಸ ಸಾಧನ ಸೇರಿಸು');
  });
  it('rejects bad targets and gestures', () => {
    const d = setBinding(defaultSetup(), { target: '<script>', gesture: 'v-sign' });
    expect(d.bindings).toHaveLength(0);
    const e = setBinding(defaultSetup(), { target: 'btn-undo', gesture: 'Bad Gesture' });
    expect(e.bindings).toHaveLength(0);
  });
  it('removing a custom template unbinds it', () => {
    const t = { id: 'wave2', label: 'W', vector: Array(42).fill(0), createdAt: 0 };
    let d = addTemplate(defaultSetup(), t);
    d = setBinding(d, { target: 'btn-mic', gesture: 'custom:wave2' });
    d = removeTemplate(d, 'wave2');
    expect(d.templates).toHaveLength(0);
    expect(d.bindings).toHaveLength(0);
  });
  it('persists and reloads, surviving junk', () => {
    const s = memStore();
    let d = setBinding({ ...defaultSetup(), completed: true, step: 'done', faceCues: true, faceBaseline: { smile: 0.5, brow: 0.08 } }, { target: 'btn-mic', phrase: 'talk' });
    d = { ...d, calibration: { ...DEFAULT_CALIBRATION, reach: { x0: 0.2, y0: 0.2, x1: 0.8, y1: 0.8 } } };
    expect(saveSetup(d, s)).toBe(true);
    expect(loadSetup(s)).toEqual(d);
    s.setItem(SETUP_KEY, '{not json');
    expect(loadSetup(s)).toEqual(defaultSetup());
    expect(coerceSetup({ step: 'nope', templates: [{}], bindings: [1, null] })).toEqual(defaultSetup());
  });
});

import { isSetupPhrase, restPhrase } from '../src/setup/setupState';
describe('setup voice phrases', () => {
  it('opens setup in English and Kannada', () => {
    expect(isSetupPhrase('Set up')).toBe(true);
    expect(isSetupPhrase('calibrate!')).toBe(true);
    expect(isSetupPhrase('ಹೊಂದಿಸು')).toBe(true);
    expect(isSetupPhrase('set up a kitchen')).toBe(false);
  });
  it('rest and wake phrases', () => {
    expect(restPhrase('rest mode')).toBe('rest');
    expect(restPhrase('ಎದ್ದೇಳು')).toBe('wake');
    expect(restPhrase('add a wall')).toBeNull();
  });
});
