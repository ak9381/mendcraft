import { describe, expect, it } from 'vitest';
import {
  buildGetPilot,
  buildRegistration,
  buildSetPilot,
  clampDim,
  clampTemp,
  encodeMessage,
  lampStateLabel,
  parsePilotResult,
  parseSetPilotResult,
  pilotParamsForIntent,
  DIM_MAX,
  DIM_MIN,
  TEMP_MAX,
  TEMP_MIN,
} from '../src/devices/wiz';

describe('wiz clamps', () => {
  it('keeps dimming in 10..100 and temp in 2200..6500', () => {
    expect(clampDim(0)).toBe(DIM_MIN);
    expect(clampDim(5)).toBe(DIM_MIN);
    expect(clampDim(55.4)).toBe(55);
    expect(clampDim(999)).toBe(DIM_MAX);
    expect(clampDim(NaN)).toBe(DIM_MIN);
    expect(clampTemp(0)).toBe(TEMP_MIN);
    expect(clampTemp(3000)).toBe(3000);
    expect(clampTemp(99999)).toBe(TEMP_MAX);
  });
});

describe('pilotParamsForIntent', () => {
  it('power on/off is just state', () => {
    expect(pilotParamsForIntent({ kind: 'power', on: true })).toEqual({ state: true });
    expect(pilotParamsForIntent({ kind: 'power', on: false })).toEqual({ state: false });
  });
  it('dim/temp/color imply the light is on and clamp values', () => {
    expect(pilotParamsForIntent({ kind: 'dim', dimming: 2000 })).toEqual({ state: true, dimming: 100 });
    expect(pilotParamsForIntent({ kind: 'temp', temp: 2700 })).toEqual({ state: true, temp: 2700 });
    expect(pilotParamsForIntent({ kind: 'color', rgb: { r: 300, g: -5, b: 128 } })).toEqual({
      state: true, r: 255, g: 0, b: 128,
    });
  });
});

describe('message builders', () => {
  it('builds setPilot / getPilot / registration envelopes', () => {
    expect(buildSetPilot({ kind: 'power', on: true })).toEqual({ method: 'setPilot', params: { state: true } });
    expect(buildGetPilot()).toEqual({ method: 'getPilot', params: {} });
    const reg = buildRegistration('1.2.3.4', 'AABBCC');
    expect(reg.method).toBe('registration');
    expect(reg.params.register).toBe(false);
    expect(reg.params.phoneIp).toBe('1.2.3.4');
  });
  it('encodeMessage round-trips to JSON', () => {
    expect(JSON.parse(encodeMessage(buildGetPilot()))).toEqual({ method: 'getPilot', params: {} });
  });
});

describe('parsePilotResult', () => {
  it('parses a white-mode getPilot reply (colorTemp → temp)', () => {
    const reply = { method: 'getPilot', env: 'pro', result: { mac: 'abc', state: true, dimming: 80, colorTemp: 2700, r: 0, g: 0, b: 0, sceneId: 0 } };
    expect(parsePilotResult(reply)).toEqual({ on: true, dimming: 80, temp: 2700, sceneId: 0 });
  });
  it('parses a colour-mode reply and ignores a zero temp', () => {
    const result = { state: true, dimming: 50, temp: 0, r: 255, g: 100, b: 10 };
    expect(parsePilotResult(result)).toEqual({ on: true, dimming: 50, rgb: { r: 255, g: 100, b: 10 } });
  });
  it('returns null for malformed or error replies', () => {
    expect(parsePilotResult(null)).toBeNull();
    expect(parsePilotResult({ result: { dimming: 10 } })).toBeNull(); // no boolean state
    expect(parsePilotResult({ error: { code: -1 } })).toBeNull();
  });
});

describe('parseSetPilotResult', () => {
  it('reads success and tolerates state-echo firmware', () => {
    expect(parseSetPilotResult({ method: 'setPilot', result: { success: true } })).toBe(true);
    expect(parseSetPilotResult({ result: { state: false } })).toBe(true);
    expect(parseSetPilotResult({ result: {} })).toBe(false);
    expect(parseSetPilotResult(null)).toBe(false);
  });
});

describe('lampStateLabel', () => {
  it('summarises state honestly', () => {
    expect(lampStateLabel(null)).toBe('Unknown');
    expect(lampStateLabel({ on: false })).toBe('Off');
    expect(lampStateLabel({ on: true, dimming: 80, temp: 2700 })).toBe('On · 80% · 2700K');
    expect(lampStateLabel({ on: true, dimming: 60, rgb: { r: 255, g: 0, b: 0 } })).toBe('On · 60% · rgb(255,0,0)');
  });
});
