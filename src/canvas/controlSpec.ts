// The action binding: what a generated device tile's controls may say, and
// how one press becomes one device intent. Three checks, at three times:
//  - coerce (generate, and every load): coerceControls drops any control the
//    class does not own, any literal that fails levelRefusal, any label with
//    markup or over CONTROL_LABEL_MAX, and anything past MAX_CONTROLS;
//  - review: planTruth leaves out tiles for devices that are not here;
//  - press: the handler reads ONLY the tile and control indexes from the
//    event, looks the control up in the APPROVED plan (controlAt), and
//    bindingIntent resolves it against the store's current state.
// Refusals never clamp. The tables live in deviceGuard.ts and are never generated.
import { CLASS_INTENTS, RANGES, lampStep, levelRefusal, type DeviceClass } from './deviceGuard';
import { LAMP_OFF_REFUSAL, lampOffRefusal, type DeviceIntent } from './deviceActions';
import { LAMP_TILE_STEP, VOLUME_TILE_STEP, tempStep } from './lampPresets';
import { tileComponentId, type DeviceState, type SurfacePlan, type TileSpec } from './surfacePlan';
import { SPOTIFY_CONNECT_LINE } from './spotifyConnector';

export type Step = { step: 1 | -1 };
export type IntentSpec =
  | { on: boolean | 'toggle' }
  | { brightness: number | '$value' | Step }
  | { temp: number | '$value' | Step }
  | { rgb: { r: number; g: number; b: number } }
  | { sceneId: number }
  | { playing: boolean | 'toggle' }
  | { volume: number | '$value' | Step }
  | { next: true } | { previous: true }
  | { gimbalMode: 'face' | 'hands' | 'hold' }
  | { gimbalCue: 'yes' | 'no' | 'wakeup' };
export type StateKey = 'state' | 'trackTitle' | 'playingOn' | 'source' | 'status';
export type SliderKey = 'brightness' | 'volume' | 'temp';
export type ControlSpec =
  | { kind: 'toggle'; label: string; intent: IntentSpec }
  | { kind: 'slider'; label: string; key: SliderKey }
  | { kind: 'button'; label: string; intent: IntentSpec }
  | { kind: 'chips'; label: string; options: { label: string; intent: IntentSpec }[] }
  | { kind: 'readout'; label?: string; show: StateKey };
export interface Binding { deviceId: string; intent: IntentSpec }

export const MAX_CONTROLS = 8;
export const MAX_CHIP_OPTIONS = 8;
export const CONTROL_LABEL_MAX = 24;

export const NOT_CONNECTED_REFUSAL = "That device isn't connected. Nothing changed.";
export const NO_LEVEL_REFUSAL = 'That control sent no level. Nothing changed.';
export const NOT_THIS_DEVICE_REFUSAL = "That control can't do that on this device. Nothing changed.";
export const UNKNOWN_CONTROL_REFUSAL = 'That control is not on this board. Nothing changed.';
/** A volume step needs the speaker's real volume; it is never guessed. */
export const VOLUME_UNREAD_REFUSAL = "Couldn't read the speaker's volume. Nothing changed.";
/** The one docked stand's id in a press (a gimbal leaf has no deviceId:
 *  there is one stand, on the paired iPhone). */
export const GIMBAL_DEVICE_ID = 'gimbal';
/** A gimbal press with no iPhone paired (nothing can report a stand). */
export const GIMBAL_NO_PHONE_REFUSAL = 'No iPhone is paired with the stand. Nothing changed.';
/** A gimbal press while the paired iPhone reports no stand. */
export const GIMBAL_NO_STAND_REFUSAL = 'No gimbal is docked. Nothing changed.';

const SLIDER_KEYS: readonly SliderKey[] = ['brightness', 'volume', 'temp'];
const STATE_KEYS: Record<DeviceClass, readonly StateKey[]> = {
  lamp: ['state'], switch: ['state'],
  music: ['state', 'trackTitle', 'playingOn', 'source'],
  gimbal: ['state', 'status'],
};
const GIMBAL_MODES = ['face', 'hands', 'hold'] as const;
const GIMBAL_CUES = ['yes', 'no', 'wakeup'] as const;

/** The prompt text: which intents each class's controls may use, and the ranges. */
export const CONTROLS_SCHEMA_LINE = [
  'A device tile may carry "controls": [Control] (at most 8; leave it out for standard controls).',
  'Control = {"kind":"toggle","label":string,"intent":Intent} | {"kind":"slider","label":string,"key":"brightness"|"volume"|"temp"}'
    + ' | {"kind":"button","label":string,"intent":Intent} | {"kind":"chips","label":string,"options":[{"label":string,"intent":Intent}]}'
    + ' | {"kind":"readout","label":string,"show":"state"|"trackTitle"|"playingOn"|"source"|"status"}',
  'Intent has exactly one key. Allowed keys: '
    + (Object.keys(CLASS_INTENTS) as DeviceClass[]).map((c) => `${c}: ${CLASS_INTENTS[c].join(', ')}`).join('; ') + '.',
  `Values: on/playing true|false|"toggle"; brightness ${RANGES.brightness[0]}-${RANGES.brightness[1]} (or 0 for off); volume ${RANGES.volume[0]}-${RANGES.volume[1]};`
    + ` temp ${RANGES.temp[0]}-${RANGES.temp[1]} K; a level may be {"step":1} or {"step":-1}; rgb {"r","g","b"} 0-255; sceneId a WiZ scene number;`
    + ' next/previous true; gimbalMode "face"|"hands"|"hold"; gimbalCue "yes"|"no"|"wakeup".',
  `Labels are plain words, at most ${CONTROL_LABEL_MAX} characters. A slider never has min or max.`,
].join('\n');

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function cleanLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > CONTROL_LABEL_MAX || /[<>]/.test(t)) return null;
  return t;
}

function coerceStep(v: unknown): Step | null {
  if (!isObj(v) || Object.keys(v).length !== 1) return null;
  return v.step === 1 || v.step === -1 ? { step: v.step } : null;
}

/** A level value: a literal (checked by levelRefusal), a step, or '$value' when allowed. */
function coerceLevel(key: SliderKey, v: unknown, allowValue: boolean): number | '$value' | Step | null {
  if (v === '$value') return allowValue ? '$value' : null;
  if (typeof v === 'number') return Number.isFinite(v) && !levelRefusal({ [key]: v }) ? v : null;
  return coerceStep(v);
}

/** One intent, exactly one key the class owns, every value checked. */
export function coerceIntent(raw: unknown, cls: DeviceClass, o: { allowValue?: boolean } = {}): IntentSpec | null {
  if (!isObj(raw)) return null;
  const keys = Object.keys(raw);
  if (keys.length !== 1) return null;
  const key = keys[0];
  if (!CLASS_INTENTS[cls].includes(key)) return null;
  const v = raw[key];
  switch (key) {
    case 'on': return v === true || v === false || v === 'toggle' ? { on: v } : null;
    case 'playing': return v === true || v === false || v === 'toggle' ? { playing: v } : null;
    case 'brightness': case 'temp': case 'volume': {
      const level = coerceLevel(key, v, !!o.allowValue);
      return level === null ? null : ({ [key]: level } as IntentSpec);
    }
    case 'rgb': {
      if (!isObj(v) || Object.keys(v).length !== 3) return null;
      const rgb = { r: v.r as number, g: v.g as number, b: v.b as number };
      return levelRefusal({ rgb }) ? null : { rgb };
    }
    case 'sceneId': return typeof v === 'number' && !levelRefusal({ sceneId: v }) ? { sceneId: v } : null;
    case 'next': return v === true ? { next: true } : null;
    case 'previous': return v === true ? { previous: true } : null;
    case 'gimbalMode': return (GIMBAL_MODES as readonly unknown[]).includes(v) ? { gimbalMode: v as 'face' } : null;
    case 'gimbalCue': return (GIMBAL_CUES as readonly unknown[]).includes(v) ? { gimbalCue: v as 'yes' } : null;
    default: return null;
  }
}

const intentKey = (i: IntentSpec): string => Object.keys(i)[0];

/** One control; `dropped` counts each bad chip option on the way. */
function coerceControl(raw: unknown, cls: DeviceClass, count: { dropped: number }): ControlSpec | null {
  if (!isObj(raw)) return null;
  const kind = raw.kind;
  if (kind === 'readout') {
    const show = raw.show as StateKey;
    if (!STATE_KEYS[cls].includes(show)) return null;
    if (raw.label === undefined) return { kind: 'readout', show };
    const label = cleanLabel(raw.label);
    return label ? { kind: 'readout', label, show } : null;
  }
  const label = cleanLabel(raw.label);
  if (!label) return null;
  if (kind === 'slider') {
    const key = raw.key as SliderKey;
    return SLIDER_KEYS.includes(key) && CLASS_INTENTS[cls].includes(key) ? { kind: 'slider', label, key } : null;
  }
  if (kind === 'toggle' || kind === 'button') {
    const intent = coerceIntent(raw.intent, cls);
    if (!intent) return null;
    // A toggle switches something on and off; anything else is a button.
    if (kind === 'toggle' && intentKey(intent) !== 'on' && intentKey(intent) !== 'playing') return null;
    return { kind, label, intent };
  }
  if (kind === 'chips') {
    if (!Array.isArray(raw.options)) return null;
    const options: { label: string; intent: IntentSpec }[] = [];
    for (const opt of raw.options) {
      if (options.length >= MAX_CHIP_OPTIONS) { count.dropped++; continue; }
      const ol = isObj(opt) ? cleanLabel(opt.label) : null;
      const oi = isObj(opt) ? coerceIntent(opt.intent, cls) : null;
      if (!ol || !oi) { count.dropped++; continue; }
      options.push({ label: ol, intent: oi });
    }
    return options.length ? { kind: 'chips', label, options } : null;
  }
  return null;
}

/** Untrusted controls for a tile of class `cls`: what passes, and how many
 *  controls (or chip options) were dropped. */
export function coerceControls(raw: unknown, cls: DeviceClass): { controls: ControlSpec[]; dropped: number } {
  if (raw === undefined) return { controls: [], dropped: 0 };
  if (!Array.isArray(raw)) return { controls: [], dropped: 1 };
  const controls: ControlSpec[] = [];
  const count = { dropped: 0 };
  for (const c of raw) {
    if (controls.length >= MAX_CONTROLS) { count.dropped++; continue; }
    const ok = coerceControl(c, cls, count);
    if (ok) controls.push(ok); else count.dropped++;
  }
  return { controls, dropped: count.dropped };
}

/** The minimal set when the model wrote none, derived from the class
 *  tables: a toggle per on/off key, a slider per ranged key, a button for
 *  next and previous. The tile says "Standard controls". */
export function standardControls(cls: DeviceClass): ControlSpec[] {
  switch (cls) {
    case 'lamp': return [
      { kind: 'toggle', label: 'Power', intent: { on: 'toggle' } },
      { kind: 'slider', label: 'Brightness', key: 'brightness' },
      { kind: 'slider', label: 'White', key: 'temp' },
    ];
    case 'music': return [
      { kind: 'toggle', label: 'Play or pause', intent: { playing: 'toggle' } },
      { kind: 'slider', label: 'Volume', key: 'volume' },
      { kind: 'button', label: 'Previous', intent: { previous: true } },
      { kind: 'button', label: 'Next', intent: { next: true } },
    ];
    case 'switch': return [{ kind: 'toggle', label: 'Power', intent: { on: 'toggle' } }];
    case 'gimbal': return [
      { kind: 'chips', label: 'Follow', options: [
        { label: 'Follow me', intent: { gimbalMode: 'face' } },
        { label: 'Follow my hands', intent: { gimbalMode: 'hands' } },
        { label: 'Hold still', intent: { gimbalMode: 'hold' } },
      ] },
      { kind: 'chips', label: 'Body language', options: [
        { label: 'Nod', intent: { gimbalCue: 'yes' } },
        { label: 'Shake', intent: { gimbalCue: 'no' } },
      ] },
    ];
  }
}

/** The device's real class: what discovery or the fixture list said; a
 *  `wiz-` device is a lamp (its only transport is the WiZ bridge).
 *  Undefined when nothing says — such a device binds no tile. */
export function deviceClassOf(id: string, s: DeviceState | undefined): DeviceClass | undefined {
  if (!s) return undefined;
  return s.cls ?? (id.startsWith('wiz-') ? 'lamp' : undefined);
}

export type BindingResult = { intent: DeviceIntent } | { gimbal: { mode: string } | { cue: string } } | { refusal: string };

/** A level from a literal, a step or '$value', against the current state. */
function resolveLevel(key: SliderKey, v: number | '$value' | Step, cur: DeviceState, value: unknown): number | { refusal: string } {
  let n: number;
  if (v === '$value') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return { refusal: NO_LEVEL_REFUSAL };
    n = value;
  } else if (typeof v === 'number') n = v;
  else if (key === 'brightness') n = lampStep(cur.brightness + v.step * LAMP_TILE_STEP);
  else if (key === 'temp') n = tempStep(cur.temp, v.step);
  else if (typeof cur.volume !== 'number' || !Number.isFinite(cur.volume)) return { refusal: VOLUME_UNREAD_REFUSAL };
  else n = Math.max(0, Math.min(100, cur.volume + v.step * VOLUME_TILE_STEP));
  const why = levelRefusal({ [key]: n });
  return why ? { refusal: why } : n;
}

/** One press → one intent for `deviceId`, resolved against `cur` (the
 *  store's state; undefined when the device is not here), or a refusal. */
export function bindingIntent(cls: DeviceClass, deviceId: string, spec: IntentSpec, cur: DeviceState | undefined, value?: unknown): BindingResult {
  const s = coerceIntent(spec, cls, { allowValue: true });
  if (!s) return { refusal: NOT_THIS_DEVICE_REFUSAL };
  if ('gimbalMode' in s || 'gimbalCue' in s) {
    // The stand is here only while the iPhone says so: `cur` is built from
    // its report (undefined = no iPhone paired; unreachable = no stand).
    if (!cur) return { refusal: GIMBAL_NO_PHONE_REFUSAL };
    if (cur.cls !== 'gimbal') return { refusal: NOT_THIS_DEVICE_REFUSAL };
    if (cur.unreachable) return { refusal: GIMBAL_NO_STAND_REFUSAL };
    return 'gimbalMode' in s ? { gimbal: { mode: s.gimbalMode } } : { gimbal: { cue: s.gimbalCue } };
  }
  if (!cur || cur.unreachable) return { refusal: NOT_CONNECTED_REFUSAL };
  // A tile's type is only what the model wrote: the device must really be that class.
  if (deviceClassOf(deviceId, cur) !== cls) return { refusal: NOT_THIS_DEVICE_REFUSAL };
  if ('on' in s) return { intent: { deviceId, on: s.on === 'toggle' ? !cur.on : s.on } };
  if ('playing' in s) return { intent: { deviceId, playing: s.playing === 'toggle' ? !cur.playing : s.playing } };
  if ('next' in s) return { intent: { deviceId, next: true } };
  if ('previous' in s) return { intent: { deviceId, previous: true } };
  if ('rgb' in s) return { intent: { deviceId, on: true, rgb: { ...s.rgb } } };
  if ('sceneId' in s) return { intent: { deviceId, on: true, sceneId: s.sceneId } };
  if ('brightness' in s) {
    const n = resolveLevel('brightness', s.brightness, cur, value);
    if (typeof n !== 'number') return n;
    const intent: DeviceIntent = { deviceId, brightness: n };
    return lampOffRefusal(cur, intent) ? { refusal: LAMP_OFF_REFUSAL } : { intent };
  }
  if ('temp' in s) {
    const n = resolveLevel('temp', s.temp, cur, value);
    return typeof n === 'number' ? { intent: { deviceId, on: true, temp: n } } : n;
  }
  const n = resolveLevel('volume', s.volume, cur, value);
  return typeof n === 'number' ? { intent: { deviceId, volume: n } } : n;
}

type DeviceLeaf = Extract<TileSpec, { type: 'lamp' | 'music' | 'switch' | 'gimbal' }>;
const isDeviceLeaf = (t: TileSpec): t is DeviceLeaf => t.type === 'lamp' || t.type === 'music' || t.type === 'switch' || t.type === 'gimbal';

/** The device leaf whose component id is `tileId`, anywhere in the plan. */
export function deviceLeafAt(plan: SurfacePlan, tileId: string): DeviceLeaf | null {
  let hit: DeviceLeaf | null = null;
  const walk = (tiles: TileSpec[], path: number[]): void => {
    tiles.forEach((t, i) => {
      if (hit) return;
      const p = [...path, i];
      if (isDeviceLeaf(t)) { if (tileComponentId(t, p) === tileId) hit = t; return; }
      if (t.type === 'row' || t.type === 'grid' || t.type === 'card') walk(t.children, p);
      else if (t.type === 'tabs') t.tabs.forEach((tab, j) => walk(tab.children, [...p, j]));
      else if (t.type === 'split') { walk(t.first, [...p, 0]); walk(t.second, [...p, 1]); }
    });
  };
  walk(plan.tiles, []);
  return hit;
}

/** The controls a device leaf shows: its own, else the standard ones. */
export const leafControls = (t: DeviceLeaf): ControlSpec[] => t.controls ?? standardControls(t.type);

const isIndex = (n: unknown, len: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < len;

/** What control `control` (and chip `option`) of tile `tileId` means in the
 *  APPROVED plan; null when the plan holds no such tile or control. */
export function controlAt(plan: SurfacePlan, tileId: string, control: number, option?: number):
  { cls: DeviceClass; deviceId: string; spec: IntentSpec | { slider: SliderKey } } | null {
  const leaf = deviceLeafAt(plan, tileId);
  if (!leaf) return null;
  const controls = leafControls(leaf);
  if (!isIndex(control, controls.length)) return null;
  const c = controls[control];
  const base = { cls: leaf.type, deviceId: leaf.type === 'gimbal' ? GIMBAL_DEVICE_ID : leaf.deviceId };
  if (c.kind === 'toggle' || c.kind === 'button') return { ...base, spec: c.intent };
  if (c.kind === 'slider') return { ...base, spec: { slider: c.key } };
  if (c.kind === 'chips') return isIndex(option, c.options.length) ? { ...base, spec: c.options[option].intent } : null;
  return null;
}

/** A slider press: option 0 is one step down, 1 one step up; a value is a level set. */
export function sliderIntent(key: SliderKey, option: unknown, value: unknown): IntentSpec | null {
  if (value !== undefined) return { [key]: '$value' } as IntentSpec;
  if (option === 0) return { [key]: { step: -1 } } as IntentSpec;
  if (option === 1) return { [key]: { step: 1 } } as IntentSpec;
  return null;
}

/** What a `device.act` press carries. Only `tile`, `control`, `option` and
 *  (for a slider) `value` are read; anything else in it is ignored. */
export interface DevicePress { tile?: unknown; control?: unknown; option?: unknown; value?: unknown; [k: string]: unknown }

/** The speaker whose real volume must be read before this press can be
 *  resolved: a volume step (− / +) on a speaker that is here but whose
 *  volume nothing has reported yet. Null for every other press. */
export function volumeReadNeeded(plan: SurfacePlan | undefined, press: DevicePress, get: (id: string) => DeviceState | undefined): string | null {
  if (!plan || typeof press.tile !== 'string' || typeof press.control !== 'number' || press.value !== undefined) return null;
  const hit = controlAt(plan, press.tile, press.control);
  if (!hit || hit.cls !== 'music' || !('slider' in hit.spec) || hit.spec.slider !== 'volume') return null;
  if (press.option !== 0 && press.option !== 1) return null;
  const cur = get(hit.deviceId);
  if (!cur || cur.unreachable) return null;
  return typeof cur.volume === 'number' && Number.isFinite(cur.volume) ? null : hit.deviceId;
}

/** One press on an approved board → what to do, or the refusal to say.
 *  `spotifyConnected`: a speaker that is not here because Spotify is not
 *  connected says so (SPOTIFY_CONNECT_LINE) instead of the plain line. */
export function pressIntent(plan: SurfacePlan | undefined, press: DevicePress, get: (id: string) => DeviceState | undefined,
  o: { spotifyConnected?: () => boolean } = {}): BindingResult & { deviceId?: string } {
  if (!plan || typeof press.tile !== 'string' || typeof press.control !== 'number') return { refusal: UNKNOWN_CONTROL_REFUSAL };
  const option = typeof press.option === 'number' ? press.option : undefined;
  const hit = controlAt(plan, press.tile, press.control, option);
  if (!hit) return { refusal: UNKNOWN_CONTROL_REFUSAL };
  const slider = 'slider' in hit.spec ? hit.spec.slider : null;
  const spec = slider ? sliderIntent(slider, option, press.value) : (hit.spec as IntentSpec);
  if (!spec) return { refusal: UNKNOWN_CONTROL_REFUSAL };
  // The gimbal's state is what the iPhone reported (the caller's getter builds it).
  const cur = get(hit.deviceId);
  const r = bindingIntent(hit.cls, hit.deviceId, spec, cur, slider ? press.value : undefined);
  if (hit.cls === 'music' && !cur && 'refusal' in r && r.refusal === NOT_CONNECTED_REFUSAL && o.spotifyConnected && !o.spotifyConnected()) {
    return { refusal: SPOTIFY_CONNECT_LINE, deviceId: hit.deviceId };
  }
  return { ...r, deviceId: hit.deviceId };
}

const BIND_ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** An untrusted binding (a visual action): a device id, and one intent its
 *  class owns with every literal checked. `clsOf` says what that device is
 *  (null: not a device here). No '$value': a visual press carries no level. */
export function coerceBinding(raw: unknown, clsOf: (deviceId: string) => DeviceClass | null): Binding | null {
  if (!isObj(raw)) return null;
  const deviceId = raw.deviceId;
  if (typeof deviceId !== 'string' || !BIND_ID_RE.test(deviceId)) return null;
  const cls = clsOf(deviceId);
  if (!cls || (deviceId === GIMBAL_DEVICE_ID) !== (cls === 'gimbal')) return null;
  const intent = coerceIntent(raw.intent, cls);
  return intent ? { deviceId, intent } : null;
}

/** The visual / form leaf whose component id is `id`, anywhere in the plan. */
function leafById<T extends 'visual' | 'form'>(plan: SurfacePlan, type: T, id: string): Extract<TileSpec, { type: T }> | null {
  let hit: Extract<TileSpec, { type: T }> | null = null;
  const walk = (tiles: TileSpec[], path: number[]): void => {
    tiles.forEach((t, i) => {
      if (hit) return;
      const p = [...path, i];
      if (t.type === type) { if (tileComponentId(t, p) === id) hit = t as Extract<TileSpec, { type: T }>; return; }
      if (t.type === 'row' || t.type === 'grid' || t.type === 'card') walk(t.children, p);
      else if (t.type === 'tabs') t.tabs.forEach((tab, j) => walk(tab.children, [...p, j]));
      else if (t.type === 'split') { walk(t.first, [...p, 0]); walk(t.second, [...p, 1]); }
    });
  };
  walk(plan.tiles, []);
  return hit;
}

/** The class a binding's device really is, from what the store holds. */
const boundClass = (deviceId: string, cur: DeviceState | undefined): DeviceClass | undefined =>
  (deviceId === GIMBAL_DEVICE_ID ? (cur ? 'gimbal' : undefined) : deviceClassOf(deviceId, cur));

/** A visual tile's data-action press: the key is looked up in the APPROVED
 *  plan's actions, then resolved like a tile press. Null when the key is not
 *  bound there (the caller only speaks its label). */
export function visualPress(plan: SurfacePlan | undefined, visualId: unknown, key: unknown, get: (id: string) => DeviceState | undefined):
  (BindingResult & { deviceId: string }) | null {
  if (!plan || typeof visualId !== 'string' || typeof key !== 'string') return null;
  const leaf = leafById(plan, 'visual', visualId);
  const b = leaf?.actions && Object.prototype.hasOwnProperty.call(leaf.actions, key) ? leaf.actions[key] : undefined;
  if (!b) return null;
  const cur = get(b.deviceId);
  const cls = boundClass(b.deviceId, cur);
  if (!cls) return { refusal: b.deviceId === GIMBAL_DEVICE_ID ? GIMBAL_NO_PHONE_REFUSAL : NOT_CONNECTED_REFUSAL, deviceId: b.deviceId };
  return { ...bindingIntent(cls, b.deviceId, b.intent, cur), deviceId: b.deviceId };
}

/** A form submit: one intent per bound field, all checked before any is
 *  sent — one refusal sends none. Null when the form binds no device (the
 *  caller only speaks). Values come from the submit; a field she did not
 *  touch has its approved value. */
export function formIntents(plan: SurfacePlan | undefined, formId: unknown, values: unknown, get: (id: string) => DeviceState | undefined):
  { intents: DeviceIntent[] } | { refusal: string; deviceId?: string } | null {
  if (!plan || typeof formId !== 'string') return null;
  const leaf = leafById(plan, 'form', formId);
  if (!leaf) return null;
  const bound = leaf.fields.filter((f): f is Extract<typeof f, { bind?: unknown }> & { bind: { deviceId: string; key: 'on' | SliderKey } } => f.kind !== 'choice' && !!f.bind);
  if (!bound.length) return null;
  const vals = isObj(values) ? values : {};
  const intents: DeviceIntent[] = [];
  // Checked in order against the state the earlier fields leave (power on,
  // then a brightness): nothing is sent until every field has passed.
  const after = new Map<string, DeviceState>();
  for (const f of bound) {
    const v = Object.prototype.hasOwnProperty.call(vals, f.id) ? vals[f.id] : f.value;
    const { deviceId, key } = f.bind;
    const cur = after.get(deviceId) ?? get(deviceId);
    const cls = boundClass(deviceId, cur);
    if (!cls) return { refusal: NOT_CONNECTED_REFUSAL, deviceId };
    if (key === 'on' && typeof v !== 'boolean') return { refusal: NO_LEVEL_REFUSAL, deviceId };
    const spec = (key === 'on' ? { on: v } : { [key]: '$value' }) as IntentSpec;
    const r = bindingIntent(cls, deviceId, spec, cur, v);
    if (!('intent' in r)) return { refusal: 'refusal' in r ? r.refusal : NOT_THIS_DEVICE_REFUSAL, deviceId };
    intents.push(r.intent);
    const { deviceId: _d, ...set } = r.intent;
    after.set(deviceId, { ...cur!, ...(set as Partial<DeviceState>) });
  }
  return { intents };
}

/** Does the plan carry a visual action or a form field bound to a device? */
export function planHasBindings(plan: SurfacePlan): boolean {
  const walk = (tiles: TileSpec[]): boolean => tiles.some((t) => (t.type === 'visual' && !!t.actions && Object.keys(t.actions).length > 0)
    || (t.type === 'form' && t.fields.some((f) => f.kind !== 'choice' && !!f.bind))
    || ((t.type === 'row' || t.type === 'grid' || t.type === 'card') && walk(t.children))
    || (t.type === 'tabs' && t.tabs.some((tab) => walk(tab.children)))
    || (t.type === 'split' && (walk(t.first) || walk(t.second))));
  return walk(plan.tiles);
}

/** The review's line on how lamp controls behave (said whenever a proposal has a lamp tile). */
export const LIGHT_ON_RULES_LINE = 'A colour, a white or a scene turns the lamp on. Changing the brightness of a lamp that is off is refused: turn it on first.';

/** Does this plan show a lamp tile anywhere? */
export function hasLampTile(plan: SurfacePlan): boolean {
  const walk = (tiles: TileSpec[]): boolean => tiles.some((t) => t.type === 'lamp'
    || ((t.type === 'row' || t.type === 'grid' || t.type === 'card') && walk(t.children))
    || (t.type === 'tabs' && t.tabs.some((tab) => walk(tab.children)))
    || (t.type === 'split' && (walk(t.first) || walk(t.second))));
  return walk(plan.tiles);
}
