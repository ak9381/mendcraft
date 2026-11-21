// MORPH EDIT: the pure, scoped single-tile edit pipeline behind "pinch-hold
// a tile and speak a change" — prompt building, device-id redaction, reply
// coercion/scoping, path splice, meta-commands, and the scripted fallback.
import { describe, expect, it } from 'vitest';
import {
  applyMorphPatch, buildMorphPrompt, collectDeviceIds, coerceMorphTile, morphBoardLine,
  morphMeta, morphSummary, normalizeMorphRaw, parseMorphTile, scriptedMorphJson, tileAtPath,
} from '../src/ai/morphEdit';
import { createDeviceIdSession } from '../src/privacy/deviceRedact';
import type { SurfacePlan, TileSpec } from '../src/canvas/surfacePlan';

const LAMP: TileSpec = { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' };
const SWITCH: TileSpec = { type: 'switch', deviceId: 'wiz-switch', label: 'Fan switch' };
const MUSIC: TileSpec = { type: 'music', deviceId: 'wiz-speaker', label: 'Speaker' };

function flatPlan(): SurfacePlan {
  return { kind: 'room', title: 'Living room', tiles: [LAMP, SWITCH] };
}

function nestedPlan(): SurfacePlan {
  const row: TileSpec = { type: 'row', children: [LAMP, SWITCH] };
  return { kind: 'room', title: 'Dashboard', tiles: [row, MUSIC] };
}

describe('collectDeviceIds', () => {
  it('collects the device id of a leaf device tile', () => {
    expect(collectDeviceIds(LAMP)).toEqual(['wiz-desk']);
  });
  it('collects device ids from nested containers (row/card/tabs/split)', () => {
    const row: TileSpec = { type: 'row', children: [LAMP, SWITCH] };
    expect(collectDeviceIds(row)).toEqual(['wiz-desk', 'wiz-switch']);
    const card: TileSpec = { type: 'card', title: 'x', children: [MUSIC] };
    expect(collectDeviceIds(card)).toEqual(['wiz-speaker']);
    const tabs: TileSpec = { type: 'tabs', tabs: [{ label: 'a', children: [LAMP] }, { label: 'b', children: [SWITCH] }] };
    expect(collectDeviceIds(tabs)).toEqual(['wiz-desk', 'wiz-switch']);
    const split: TileSpec = { type: 'split', direction: 'row', first: [LAMP], second: [MUSIC] };
    expect(collectDeviceIds(split)).toEqual(['wiz-desk', 'wiz-speaker']);
  });
  it('returns an empty list for a non-device leaf', () => {
    expect(collectDeviceIds({ type: 'stat', label: 'x', value: '1' })).toEqual([]);
  });
});

describe('morphBoardLine', () => {
  it('formats the board title and tile count, pluralized', () => {
    expect(morphBoardLine(flatPlan())).toBe('Board: Living room · 2 tiles');
    expect(morphBoardLine({ kind: 'room', title: 'Solo', tiles: [LAMP] })).toBe('Board: Solo · 1 tile');
  });
});

describe('buildMorphPrompt', () => {
  it('contains the redacted utterance, exactly the one tile JSON, and the board line', () => {
    const boardLine = morphBoardLine(flatPlan());
    const prompt = buildMorphPrompt(LAMP, 'make it warm', boardLine);
    expect(prompt).toContain('make it warm');
    expect(prompt).toContain(JSON.stringify(LAMP));
    expect(prompt).toContain(boardLine);
    // No OTHER tile's JSON leaked into the prompt.
    expect(prompt).not.toContain(JSON.stringify(SWITCH));
  });

  it('masks the real device id with the session placeholder, and the real id never appears', () => {
    const session = createDeviceIdSession();
    const boardLine = morphBoardLine(flatPlan());
    const prompt = buildMorphPrompt(LAMP, 'make it warm', boardLine, { deviceIdSession: session });
    expect(prompt).not.toContain('wiz-desk');
    expect(prompt).toContain(session.tokenFor('wiz-desk')); // same session, so stable
    expect(prompt).toContain('Device 1');
  });

  it('without a session, the real device id appears verbatim (no redaction requested)', () => {
    const prompt = buildMorphPrompt(LAMP, 'make it warm', morphBoardLine(flatPlan()));
    expect(prompt).toContain('wiz-desk');
  });
});

describe('normalizeMorphRaw — envelope unwrapping', () => {
  it('passes through an already-flat tile object', () => {
    expect(normalizeMorphRaw(LAMP)).toEqual(LAMP);
  });
  it('unwraps a {tile: {...}} envelope', () => {
    expect(normalizeMorphRaw({ tile: LAMP })).toEqual(LAMP);
  });
  it('unwraps {revised: {...}}, {value: {...}}, {data: {...}}, {result: {...}}', () => {
    expect(normalizeMorphRaw({ revised: LAMP })).toEqual(LAMP);
    expect(normalizeMorphRaw({ value: LAMP })).toEqual(LAMP);
    expect(normalizeMorphRaw({ data: LAMP })).toEqual(LAMP);
    expect(normalizeMorphRaw({ result: LAMP })).toEqual(LAMP);
  });
  it('unwraps a {tiles: [...]} envelope, taking the first tile', () => {
    expect(normalizeMorphRaw({ tiles: [LAMP, SWITCH] })).toEqual(LAMP);
  });
  it('leaves unrecognized shapes alone', () => {
    expect(normalizeMorphRaw({ foo: 'bar' })).toEqual({ foo: 'bar' });
  });
});

describe('coerceMorphTile', () => {
  it('accepts a valid revision of the same tile', () => {
    const revised = { ...LAMP, label: 'Desk lamp · warm' };
    const res = coerceMorphTile(revised, LAMP);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual(revised);
  });

  it('rejects junk', () => {
    expect(coerceMorphTile({ nonsense: true }, LAMP).ok).toBe(false);
    expect(coerceMorphTile(null, LAMP).ok).toBe(false);
    expect(coerceMorphTile('a string', LAMP).ok).toBe(false);
  });

  it('rejects a type change (lamp -> music)', () => {
    const res = coerceMorphTile({ type: 'music', deviceId: 'wiz-desk', label: 'Desk lamp' }, LAMP);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/type/);
  });

  it('rejects a deviceId swap on a device tile', () => {
    const res = coerceMorphTile({ type: 'lamp', deviceId: 'some-other-device', label: 'Desk lamp' }, LAMP);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/device/);
  });

  it('unwraps an envelope before validating', () => {
    const revised = { ...LAMP, label: 'Desk lamp · edited' };
    const res = coerceMorphTile({ tile: revised }, LAMP);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.type).toBe('lamp');
  });

  it('accepts a non-device tile revision with no deviceId check', () => {
    const original: TileSpec = { type: 'card', title: 'Controls', children: [LAMP] };
    const revised = { type: 'card', title: 'Controls · edited', children: [LAMP] };
    const res = coerceMorphTile(revised, original);
    expect(res.ok).toBe(true);
  });
});

describe('parseMorphTile', () => {
  it('accepts fenced JSON', () => {
    const revised = { ...LAMP, label: 'Desk lamp · warm' };
    const text = '```json\n' + JSON.stringify(revised) + '\n```';
    const res = parseMorphTile(text, LAMP);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.label).toBe('Desk lamp · warm');
  });

  it('accepts prose-wrapped JSON', () => {
    const revised = { ...LAMP, label: 'Desk lamp · warm' };
    const text = `Sure, here you go:\n${JSON.stringify(revised)}\nHope that helps!`;
    const res = parseMorphTile(text, LAMP);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.label).toBe('Desk lamp · warm');
  });

  it('returns an error (not a throw) when there is no JSON at all', () => {
    const res = parseMorphTile('sorry, I cannot do that', LAMP);
    expect(res.ok).toBe(false);
  });

  it('restores real device ids via the session when the reply uses the placeholder', () => {
    const session = createDeviceIdSession();
    const token = session.tokenFor('wiz-desk'); // "Device 1" — same session the prompt used
    const revisedWithToken = { type: 'lamp', deviceId: token, label: 'Desk lamp · warm' };
    const res = parseMorphTile(JSON.stringify(revisedWithToken), LAMP, session);
    expect(res.ok).toBe(true);
    if (res.ok) expect((res.value as { deviceId: string }).deviceId).toBe('wiz-desk');
  });

  it('without a session, a placeholder left in the reply does not match the original deviceId', () => {
    const revisedWithToken = { type: 'lamp', deviceId: 'Device 1', label: 'Desk lamp · warm' };
    const res = parseMorphTile(JSON.stringify(revisedWithToken), LAMP);
    expect(res.ok).toBe(false); // "Device 1" !== "wiz-desk": scope check refuses it
  });
});

describe('tileAtPath', () => {
  it('round-trips a top-level path', () => {
    expect(tileAtPath(flatPlan(), [0])).toEqual(LAMP);
    expect(tileAtPath(flatPlan(), [1])).toEqual(SWITCH);
  });
  it('round-trips a nested row child path', () => {
    const plan = nestedPlan();
    expect(tileAtPath(plan, [0, 0])).toEqual(LAMP);
    expect(tileAtPath(plan, [0, 1])).toEqual(SWITCH);
    expect(tileAtPath(plan, [1])).toEqual(MUSIC);
  });
  it('returns null for an out-of-range or malformed path', () => {
    expect(tileAtPath(flatPlan(), [5])).toBeNull();
    expect(tileAtPath(flatPlan(), [0, 0])).toBeNull(); // lamp has no children
    expect(tileAtPath(flatPlan(), [-1])).toBeNull();
  });
});

describe('applyMorphPatch', () => {
  it('splices a tile at a top-level path, leaving the other tile reference-equal', () => {
    const plan = flatPlan();
    const revisedLamp = { ...LAMP, label: 'Desk lamp · warm' };
    const patched = applyMorphPatch(plan, [0], revisedLamp);
    expect(patched).not.toBeNull();
    expect(patched!).not.toBe(plan); // new plan object
    expect(patched!.tiles).not.toBe(plan.tiles); // new tiles array
    expect(patched!.tiles[0]).toEqual(revisedLamp);
    expect(patched!.tiles[1]).toBe(plan.tiles[1]); // reference-equal, untouched
  });

  it('splices a tile at a nested path inside a row, leaving siblings and other top-level tiles reference-equal', () => {
    const plan = nestedPlan();
    const revisedSwitch = { ...SWITCH, label: 'Fan switch · on' };
    const patched = applyMorphPatch(plan, [0, 1], revisedSwitch);
    expect(patched).not.toBeNull();
    const row = patched!.tiles[0] as { type: 'row'; children: TileSpec[] };
    expect(row.children[1]).toEqual(revisedSwitch);
    expect(row.children[0]).toBe((plan.tiles[0] as { type: 'row'; children: TileSpec[] }).children[0]); // lamp untouched, same ref
    expect(patched!.tiles[1]).toBe(plan.tiles[1]); // music tile untouched, same ref
  });

  it('returns null for a path that does not resolve', () => {
    expect(applyMorphPatch(flatPlan(), [9], LAMP)).toBeNull();
    expect(applyMorphPatch(flatPlan(), [0, 0], LAMP)).toBeNull();
  });
});

describe('morphMeta', () => {
  it('recognizes cancel phrasings', () => {
    expect(morphMeta('cancel')).toBe('cancel');
    expect(morphMeta('Cancel.')).toBe('cancel');
    expect(morphMeta('never mind')).toBe('cancel');
    expect(morphMeta('nevermind')).toBe('cancel');
    expect(morphMeta('stop')).toBe('cancel');
    expect(morphMeta('close')).toBe('cancel');
    expect(morphMeta('forget it')).toBe('cancel');
    expect(morphMeta('leave it')).toBe('cancel');
  });
  it('recognizes undo phrasings', () => {
    expect(morphMeta('undo')).toBe('undo');
    expect(morphMeta('undo that')).toBe('undo');
    expect(morphMeta('undo it')).toBe('undo');
    expect(morphMeta('Undo!')).toBe('undo');
  });
  it('returns null for an actual edit request', () => {
    expect(morphMeta('change the color')).toBeNull();
    expect(morphMeta('make it warm')).toBeNull();
    expect(morphMeta('')).toBeNull();
  });
});

describe('scriptedMorphJson', () => {
  it('is deterministic for the same inputs', () => {
    expect(scriptedMorphJson(LAMP, 'make it warm')).toBe(scriptedMorphJson(LAMP, 'make it warm'));
  });
  it('keeps the same type and deviceId', () => {
    const json = scriptedMorphJson(LAMP, 'make it warm');
    const parsed = JSON.parse(json);
    expect(parsed.type).toBe('lamp');
    expect(parsed.deviceId).toBe('wiz-desk');
  });
  it('tweaks the visible label, choosing "warm" wording for color/warm/amber requests', () => {
    const json = scriptedMorphJson(LAMP, 'make it a warm color please');
    const parsed = JSON.parse(json);
    expect(parsed.label).toContain('warm');
  });
  it('tweaks the visible label with a generic "edited" suffix otherwise', () => {
    const json = scriptedMorphJson(LAMP, 'make it bigger');
    const parsed = JSON.parse(json);
    expect(parsed.label).toContain('edited');
  });
  it('is parseable by parseMorphTile and passes the scope check', () => {
    const json = scriptedMorphJson(LAMP, 'make it warm');
    const res = parseMorphTile(json, LAMP);
    expect(res.ok).toBe(true);
  });
});

describe('morphSummary', () => {
  it('formats a one-line history summary', () => {
    expect(morphSummary('Desk lamp', 'change color')).toBe('morph: Desk lamp — change color');
  });
});
