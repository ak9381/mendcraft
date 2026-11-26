// iPhone sensing as a visible step in connect-devices: the paired row's
// sub-states (only from real status, SIM labelled), the "what next?" chips
// (each routes through routeLine), the point result that rides the relay,
// the relay kinds, and point-to-connect for speakers.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createPhoneCamera, IPHONE_CAMERA_CONSTRAINTS } from '../../src/canvas/phoneCamera';
import { pairedRowHtml, isBuildDashboard, type PairedPhone } from '../../src/canvas/pairedRow';
import {
  CAMERA_TRACKING_ROW, CAMERA_UNAVAILABLE_ROW, coercePointResult, coerceSenseStatus, encodePointResult, FOLLOWING_HANDS_ROW, GIMBAL_READY_ROW, HANDS_ON_ROW,
  NO_GIMBAL_CAN_POINT_ROW, NO_GIMBAL_ROW, phoneSubState, DIAG_AIMING_NO, DIAG_AIMING_YES, DIAG_SIGN, DIAG_TRACKING_OFF, DIAG_TRACKING_ON, TRACKING_ROW, type PhoneSenseStatus,
} from '../../src/canvas/phonePoint';
import { ruleSuggestions } from '../../src/canvas/nextSteps';
import { routeLine } from '../../src/canvas/routeLine';
import {
  LAMP_OR_SPEAKER_QUESTION, pickPointChoice, pointConnectFromIdentity, SIM_POINT_IDENTITY, SPEAKER_ADDED_GENERIC_NOTE, SPEAKER_ADDED_NOTE, SPEAKER_ON_BOARD,
} from '../../src/canvas/connectTurns';
import { validateCommand } from '../../src/relay/protocol';
import { buildIdentifyPrompt, parseIdentity, type DeviceIdentity } from '../../src/devices/identify';

const app = readFileSync(new URL('../../src/canvas/canvasApp.ts', import.meta.url), 'utf8');
const iphone: PairedPhone = { id: 'ios', label: 'iPhone', sim: false };
const nothing: PairedPhone = { id: 'android', label: 'Nothing phone', sim: false };

describe('connect-devices row: iPhone sub-states', () => {
  it('ready / tracking / hands / no gimbal — from what the phone reports, never over-claimed', () => {
    const st = (o: Partial<PhoneSenseStatus>): PhoneSenseStatus => ({ gimbal: 'ready', sensor: false, hands: false, canPoint: true, ...o });
    expect(phoneSubState(st({}), { ios: true })).toBe(GIMBAL_READY_ROW);
    // Sensing alone never claims the stand follows.
    expect(phoneSubState(st({ sensor: true }), { ios: true })).toBe(CAMERA_TRACKING_ROW);
    expect(phoneSubState(st({ gimbal: 'none', sensor: true }), { ios: true })).toBe(CAMERA_TRACKING_ROW);
    // "Tracking you" needs docked + DockKit tracking confirmed by the plugin.
    expect(phoneSubState(st({ gimbal: 'tracking' }), { ios: true })).toBe(TRACKING_ROW);
    expect(phoneSubState(st({ gimbal: 'hands', sensor: true }), { ios: true })).toBe(FOLLOWING_HANDS_ROW);
    expect(phoneSubState(st({ gimbal: 'hands', sensor: false }), { ios: true })).toBe(GIMBAL_READY_ROW);
    expect(phoneSubState(st({ gimbal: 'tracking', hands: true }), { ios: true })).toBe(`${TRACKING_ROW} · ${HANDS_ON_ROW}`);
    // Undocked: the row matches what the laptop will do when she points.
    expect(phoneSubState(st({ gimbal: 'none' }), { ios: true })).toBe(NO_GIMBAL_CAN_POINT_ROW);
    expect(phoneSubState(st({ gimbal: 'none', canPoint: false }), { ios: true })).toBe(NO_GIMBAL_ROW);
    expect(phoneSubState(st({ canPoint: false }), { ios: true })).toBe(`${GIMBAL_READY_ROW} · ${CAMERA_UNAVAILABLE_ROW}`);
    // An older iPhone build that reports nothing: say so plainly, never "tracking".
    expect(phoneSubState(null, { ios: true })).toBe(NO_GIMBAL_ROW);
    expect(phoneSubState(null, { ios: false })).toBe('');
  });

  it('the laptop asks the iPhone only when it can point; a camera denial falls back to the laptop', () => {
    expect(app).toMatch(/if \(!o\.skipIphone && iphone\?\.canPoint && hostSession\)/);
    expect(app).toMatch(/canPoint: opts\.phoneCamera\?\.status\(\) !== 'error'/);
    expect(app).toMatch(/res\.reason === 'no-camera'\) \{[\s\S]{0,120}pointTurn\(wait\.frameId, \{ skipIphone: true \}\)/);
    expect(app).toMatch(/const gimbal = !gimbalDocked \? 'none'\s*: mode === 'face' \? \(trackingOn === false \? 'ready' : 'tracking'\)/);
  });

  it('SIM: the iPhone sub-state is labelled SIM', () => {
    expect(phoneSubState(null, { sim: true, ios: true })).toBe(`SIM · ${GIMBAL_READY_ROW}`);
  });

  it('the row shows each phone with its sub-state (pairing and asking phases)', () => {
    const sub = (p: PairedPhone) => (p.id === 'ios' ? GIMBAL_READY_ROW : '');
    const pairing = pairedRowHtml([nothing, iphone], 'pairing', sub);
    expect(pairing).toContain(`data-phone-sub="ios">${GIMBAL_READY_ROW}`);
    expect(pairing).not.toContain('data-phone-sub="android"');
    const asking = pairedRowHtml([nothing, iphone], 'asking', sub);
    expect(asking.replace(/<[^>]+>/g, '')).toContain('2 phones connected');
    expect(asking).toContain(GIMBAL_READY_ROW);
    // No sub-state function: the row is unchanged.
    expect(pairedRowHtml([iphone], 'asking')).not.toContain('mc-paired-sub');
  });

  it('live-test diagnostics ride the announce: DockKit tracking on/off and aiming at hands yes/no in the row', () => {
    const s = coerceSenseStatus({ gimbal: 'hands', sensor: true, hands: false, canPoint: true, systemTracking: false, aimingAtHands: true });
    expect(s).toEqual({ gimbal: 'hands', sensor: true, hands: false, canPoint: true, systemTracking: false, aimingAtHands: true });
    expect(phoneSubState(s, { ios: true })).toBe(`${FOLLOWING_HANDS_ROW} · ${DIAG_TRACKING_OFF} · ${DIAG_AIMING_YES}`);
    const t = coerceSenseStatus({ gimbal: 'ready', sensor: true, hands: false, canPoint: true, systemTracking: true, aimingAtHands: false });
    expect(phoneSubState(t, { ios: true })).toContain(`${DIAG_TRACKING_ON} · ${DIAG_AIMING_NO}`);
    const u = coerceSenseStatus({ gimbal: 'hands', sensor: true, hands: false, canPoint: true, systemTracking: false, aimingAtHands: true, aimSign: 'yaw' });
    expect(phoneSubState(u, { ios: true })).toContain(`${DIAG_SIGN} yaw`);
    expect(coerceSenseStatus({ gimbal: 'hands', sensor: true, hands: false, canPoint: true, aimSign: '<b>' })!.aimSign).toBeUndefined();
    // Junk values are dropped; an older phone build shows no diagnostics.
    expect(coerceSenseStatus({ gimbal: 'ready', sensor: false, hands: false, canPoint: true, systemTracking: 'yes' })).toEqual({ gimbal: 'ready', sensor: false, hands: false, canPoint: true });
    expect(phoneSubState({ gimbal: 'none', sensor: false, hands: false, canPoint: true, systemTracking: true }, { ios: true })).not.toContain('DockKit');
  });

  it('the iPhone announces its gimbal diagnostics, and hands is only claimed with tracking read back off', () => {
    const app = readFileSync('src/canvas/canvasApp.ts', 'utf8');
    expect(app).toMatch(/mode === 'hands' && phoneSensor\.running\(\) && trackingOn !== true \? 'hands' : 'ready'/);
    expect(app).toMatch(/s\.aimingAtHands = diag\.aimingAtHands/);
    expect(app).toMatch(/if \(live && !sensorWasLive\) void inputs\.gimbal\.reassertOff/);
  });

  it('coerceSenseStatus: only well-formed sensing fields', () => {
    expect(coerceSenseStatus({ platform: 'ios', gimbal: 'ready', sensor: true, hands: false, canPoint: true })).toEqual({ gimbal: 'ready', sensor: true, hands: false, canPoint: true });
    expect(coerceSenseStatus({ platform: 'ios' })).toBeNull();
    expect(coerceSenseStatus({ gimbal: 'following' })).toBeNull();
    expect(coerceSenseStatus(null)).toBeNull();
  });
});

describe('"What do you want to connect next?" chips', () => {
  const world = { hasPlanBoard: false, devices: [] };
  it('after pairing: Point at a device, Name a device, Build the dashboard — each routes', () => {
    const steps = ruleSuggestions('devices', { lang: 'en', online: true, phones: 2, pairing: true, asking: true });
    expect(steps.map((s) => s.label)).toEqual(['Point at a device', 'Name a device', 'Build the dashboard']);
    expect(routeLine(steps[0]!.say, world).name).toBe('pointConnect');
    expect(routeLine(steps[1]!.say, world).name).toBe('connectSheet');
    expect(isBuildDashboard(steps[2]!.say)).toBe(true);
  });
  it('while still pairing: unchanged', () => {
    expect(ruleSuggestions('devices', { lang: 'en', online: true, phones: 0, pairing: true }).map((s) => s.id)).toEqual(['build-dashboard', 'connect-device']);
  });
});

describe('iPhone point result over the relay', () => {
  const lamp: DeviceIdentity = { kind: 'smart-bulb', brand: 'WiZ', model: '', label: 'WiZ desk lamp', confidence: 0.9 };
  it('round-trips an identity; the photo is never part of it', () => {
    const text = encodePointResult({ ok: true, identity: lamp, source: 'on-device', ms: 420, cropBytes: 31000, cloudSends: 0 });
    expect(text).not.toMatch(/base64|dataBase64|jpeg/i);
    expect(coercePointResult(text)).toEqual({ ok: true, identity: lamp, source: 'on-device', ms: 420, cropBytes: 31000, cloudSends: 0 });
  });
  it('carries the honest out-of-frame reason; rejects junk', () => {
    const r = coercePointResult(encodePointResult({ ok: false, reason: 'out-of-frame', message: 'x' }));
    expect(r).toEqual({ ok: false, reason: 'out-of-frame', message: 'x' });
    expect(coercePointResult('{"ok":true,"identity":{"label":"x","kind":"spaceship"}}')).toBeNull();
    expect(coercePointResult('nope')).toBeNull();
  });
  it('the relay accepts sensePoint / pointResult as JSON cmd kinds', () => {
    expect(validateCommand({ kind: 'sensePoint', text: '{"platform":"ios"}' })).toEqual({ kind: 'sensePoint', text: '{"platform":"ios"}' });
    expect(validateCommand({ kind: 'pointResult', text: '{"ok":false}' })?.kind).toBe('pointResult');
    expect(validateCommand({ kind: 'pointResult' })).toBeNull();
  });
  it('a result from the iPhone books nothing on the laptop and says where it ran', () => {
    const out = pointConnectFromIdentity({ identity: lamp, source: 'cloud' }, {
      viaIphone: true, cropBytes: 0, devices: [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' }],
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.extraBytes).toBe(0);
      expect(out.turn.sent.sent).toBeNull();
      expect(out.turn.sent.routeLine).toMatch(/^iPhone camera — identified via Gemini · cloud from the iPhone; nothing left this laptop$/);
      // No Gemini lane / cursors on the laptop for work the iPhone did.
      expect(out.turn.sent.engine).toBe('nano');
    }
  });
});

describe('point-to-connect: speakers are software tiles, lamps need a device', () => {
  const marshall: DeviceIdentity = { kind: 'speaker', brand: 'Marshall', model: '', label: 'Marshall speaker', confidence: 0.86 };
  const generic: DeviceIdentity = { kind: 'speaker', brand: '', model: '', label: 'Bluetooth speaker', confidence: 0.8 };
  const lamp: DeviceIdentity = { kind: 'smart-bulb', brand: 'WiZ', model: '', label: 'WiZ desk lamp', confidence: 0.9 };

  it('a Marshall with no speaker tile on the board → the music tile, labelled Marshall, with the honest Spotify note', () => {
    const out = pointConnectFromIdentity({ identity: marshall, source: 'on-device' }, { devices: [], onBoard: [] });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.turn.plan.tiles).toEqual([{ type: 'music', deviceId: 'speaker-marshall', label: 'Marshall speaker' }]);
    expect(out.note).toBe(SPEAKER_ADDED_NOTE);
    expect(out.note).not.toMatch(/connected to/i);
  });
  it('a generic speaker → "Speaker", and the note does not name a Marshall', () => {
    const out = pointConnectFromIdentity({ identity: generic, source: 'on-device' }, { devices: [] });
    expect(out.ok && out.turn.plan.tiles[0]).toEqual({ type: 'music', deviceId: 'speaker-1', label: 'Speaker' });
    expect(out.ok && out.note).toBe(SPEAKER_ADDED_GENERIC_NOTE);
  });
  it('a speaker already on the board is not added twice', () => {
    const out = pointConnectFromIdentity({ identity: marshall, source: 'on-device' }, { devices: [], onBoard: ['speaker-marshall'] });
    expect(out).toEqual({ ok: false, message: SPEAKER_ON_BOARD });
  });
  it('a lamp still requires a connected WiZ device', () => {
    const none = pointConnectFromIdentity({ identity: lamp, source: 'on-device' }, { devices: [] });
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.message).toMatch(/isn’t connected here yet/);
    const ok = pointConnectFromIdentity({ identity: lamp, source: 'on-device' }, { devices: [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' }] });
    expect(ok.ok).toBe(true);
  });
  it('lamp and speaker both near the finger → "Which one — the lamp or the speaker?", then her answer', () => {
    const both: DeviceIdentity = { ...lamp, alsoKind: 'speaker', alsoBrand: 'Marshall' };
    const q = pointConnectFromIdentity({ identity: both, source: 'on-device' }, { devices: [] });
    expect(q.ok).toBe(false);
    if (q.ok) return;
    expect(q.message).toBe(LAMP_OR_SPEAKER_QUESTION);
    const pick = pickPointChoice('the speaker', q.choices!);
    expect(pick?.id).toBe('kind:speaker');
    const after = pointConnectFromIdentity({ identity: both, source: 'on-device' }, { devices: [], chosenId: pick!.id });
    expect(after.ok && after.turn.plan.tiles[0]).toEqual({ type: 'music', deviceId: 'speaker-marshall', label: 'Marshall speaker' });
    const lampPick = pickPointChoice('lamp', q.choices!);
    const afterLamp = pointConnectFromIdentity({ identity: both, source: 'on-device' }, { devices: [{ id: 'wiz-desk', label: 'Desk lamp', kind: 'lamp' }], chosenId: lampPick!.id });
    expect(afterLamp.ok).toBe(true);
  });
  it('SIM path unchanged: the scripted identity is the WiZ lamp', () => {
    expect(SIM_POINT_IDENTITY.kind).toBe('smart-bulb');
    expect(SIM_POINT_IDENTITY.brand).toBe('WiZ');
  });
  it('identify: the prompt hints Marshall speakers (a hint, not a forced answer); alsoKind parses', () => {
    const p = buildIdentifyPrompt({ pointer: { x: 0.5, y: 0.5 } });
    expect(p).toMatch(/Marshall/);
    expect(p).toMatch(/only when you can see it/);
    expect(p).toMatch(/Do not guess a brand you cannot see/);
    expect(parseIdentity({ kind: 'lamp', label: 'Lamp', confidence: 0.7, alsoKind: 'speaker', alsoBrand: 'Marshall' })).toMatchObject({ kind: 'lamp', alsoKind: 'speaker', alsoBrand: 'Marshall' });
    expect(parseIdentity({ kind: 'lamp', label: 'Lamp', confidence: 0.7, alsoKind: 'lamp' })?.alsoKind).toBeUndefined();
  });
});

describe('canvas wiring (source checks — the canvas has no mount test)', () => {
  it('the iPhone point photo comes from the hub stream: no openCameraOnce on the phone path', () => {
    expect(app).toMatch(/if \(!video && !how\.phone\) \{ once = await openCameraOnce\(\)/);
  });
  it('an out-of-frame ray says so and never guesses', () => {
    expect(app).toMatch(/rayOutOfFrame\(landmarks, W, H, ray\)\) \{\s*\/\/[^\n]*\n\s*say\(POINT_OUT_OF_FRAME\)/);
  });
  it('the laptop asks a sensing iPhone first, else falls back to the laptop camera with an honest line', () => {
    expect(app).toMatch(/iphone\?\.canPoint && hostSession/);
    expect(app).toMatch(/askSensePoint\('ios'\)/);
    expect(app).toMatch(/say\(PHONE_POINT_FALLBACK\)/);
  });
  it('the iPhone point holds the gimbal and books its own receipt (→ its monitor tab)', () => {
    const fn = app.slice(app.indexOf('async function phoneSensorPoint'), app.indexOf('function onIphonePointResult'));
    expect(fn).toMatch(/setMode\('point'\)/);
    expect(fn).toMatch(/request\('point', true\)/);
    const cap = app.slice(app.indexOf('async function capturePoint'), app.indexOf('async function phoneSensorPoint'));
    expect(cap).toMatch(/if \(how\.remote\) \{[\s\S]*ledgerPointFailure\(r, o, idNote\)/);
  });
  it('a point sent N times books the prompt N times in the review footer too (matches the ledger)', () => {
    expect(app).toMatch(/extraBytes: pointExtraBytes\(out\.extraBytes, out\.turn\.sent\.prompt, r, o\)/);
    const fn = app.slice(app.indexOf('function pointExtraBytes'), app.indexOf('function endPointWait'));
    expect(fn).toMatch(/utf8ByteLength\(prompt\) \* Math\.max\(0, sends - 1\)/);
    const book = app.slice(app.indexOf('function bookPointSends'), app.indexOf('function pointExtraBytes'));
    expect(book).toMatch(/utf8ByteLength\(prompt\) \* \(sends - 1\)/);
  });
  it('a rules-only try-to-break logs nothing as Nano', () => {
    const fn = app.slice(app.indexOf('async function breakTurn'), app.indexOf('// ---- commands ----'));
    expect(fn).not.toMatch(/forEngine\('nano'\)\.log\('received'/);
    expect(fn).toMatch(/engine: 'rules'/);
    expect(fn).toMatch(/panel: engine \? panels\.forEngine\('nano'\) : rulesPanel/);
  });
  it('an iPhone-identified turn runs no swarm on the laptop', () => {
    expect(app).toMatch(/swarm: o\.viaIphone \? false : undefined/);
  });
  it('relay: pointResult only while pending and from an announced iPhone; sensePoint only on the iPhone from the host', () => {
    expect(app).toMatch(/if \(!res \|\| !wait \|\| !phoneSense\.has\('ios'\)\) return;/);
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    expect(main).toMatch(/phonePlatform === 'ios' && platform === 'ios' && h\.phoneSenseStatus\(\)/);
    expect(main).toMatch(/constraints: phonePlatform === 'ios' \? IPHONE_CAMERA_CONSTRAINTS : undefined/);
    const session = readFileSync(new URL('../../src/relay/session.ts', import.meta.url), 'utf8');
    expect(session).toMatch(/msg\.type === 'cmd' && msg\.from === 'host' && msg\.cmd\.kind === 'sensePoint'/);
  });
  it('the iPhone hub asks for a 1280×720 stream', async () => {
    const gum = vi.fn(async () => ({ getTracks: () => [], getVideoTracks: () => [{ readyState: 'live' }] }) as unknown as MediaStream);
    const cam = createPhoneCamera({ getUserMedia: gum, createTracker: () => ({ start: async () => undefined, stop: () => undefined }), doc: null, win: null, constraints: IPHONE_CAMERA_CONSTRAINTS });
    await cam.setUse('sense', true);
    expect(gum).toHaveBeenCalledWith(IPHONE_CAMERA_CONSTRAINTS);
    expect((IPHONE_CAMERA_CONSTRAINTS.video as MediaTrackConstraints).width).toEqual({ ideal: 1280 });
  });
});
