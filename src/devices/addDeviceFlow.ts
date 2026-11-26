// ADD-A-DEVICE FLOW (pure orchestrator; every side effect is injected).
//
// Three ways in (no gimbal needed for any of them; the gimbal is an extra):
//   point  any phone or the laptop camera pointed AT the device
//   room   a phone on a plain stand, wide camera seeing the room; Nano picks
//          the device she points at or names
//   voice  no camera: "add the lamp" → find it on Wi-Fi by name
//
//   1 look     camera frame (skipped in voice mode)
//   2 identify Gemini Nano names the device from that ONE frame (cloud fallback)
//   3 connector cached → reuse offline; else cloud Gemini writes it ONCE as
//              declarative JSON (built-in WiZ seed if the cloud is unreachable)
//   4 find     LAN discovery (iOS native layer; web = WiZ bridge or a stub)
//   5 confirm  she pinches to confirm before anything is sent to the device
//   6 test     prepare → BEFORE frame → test action → AFTER frame
//   7 verify   Gemini Nano compares the two frames → green tick when it can SEE
//              the effect (Control Anything stopped at transport acks)
//
// Unit-tested with fakes; the DOM panel (ui/addDevicePanel.ts) and main.ts
// supply the real camera, models, transports and confirm.

import type { Connector, RunResult } from './connector';
import type { DeviceIdentity, EffectVerdict, IdentifyHint } from './identify';
import type { PairedDevice } from './connectorCache';

/** Where a step's answer came from. Shown verbatim on every request. */
export type StepSource = 'on-device' | 'cloud' | 'rules' | 'cache' | 'builtin' | 'native' | 'bridge' | 'stub' | 'manual' | 'sim';

export type StepId = 'look' | 'identify' | 'connector' | 'find' | 'confirm' | 'test' | 'verify';
export const STEP_ORDER: readonly StepId[] = ['look', 'identify', 'connector', 'find', 'confirm', 'test', 'verify'];

export interface StepEvent {
  step: StepId;
  state: 'active' | 'ok' | 'fail' | 'skip';
  detail: string;
  source?: StepSource;
  /** Simulated (sim=1): no model or device was really used. */
  sim?: boolean;
  ms?: number;
}

export interface FlowFrame { mimeType: string; dataBase64: string }

export interface FoundDevice { host: string; name?: string; mac?: string }

export type AddMode = 'point' | 'room' | 'voice';

export const MODE_LABELS: Record<AddMode, { en: string; kn: string; detail: string }> = {
  point: { en: 'Point a camera at it', kn: 'ಕ್ಯಾಮೆರಾವನ್ನು ಅದರತ್ತ ತೋರಿಸಿ', detail: 'Any phone or this laptop’s camera, aimed at the device.' },
  room: { en: 'Camera sees the room', kn: 'ಕ್ಯಾಮೆರಾ ಕೋಣೆಯನ್ನು ನೋಡುತ್ತದೆ', detail: 'A phone on a plain stand. Point at the device or say its name.' },
  voice: { en: 'Just say it', kn: 'ಹೇಳಿ ಸಾಕು', detail: 'No camera. Say “add the lamp” and I find it on the Wi-Fi.' },
};

export interface ModeOption { mode: AddMode; available: boolean; why: string }

/** Setup auto-detect: offer the three ways in order, marking what works here. */
export function detectModes(env: { camera: boolean; iosApp: boolean; bridge: boolean; sim: boolean }): ModeOption[] {
  const cam = env.camera || env.sim;
  const lan = env.iosApp || env.bridge || env.sim;
  return [
    { mode: 'point', available: cam, why: cam ? (env.iosApp ? 'iPhone camera ready' : 'Camera ready') : 'Turn the camera on first' },
    { mode: 'room', available: cam, why: cam ? 'Works with the camera on a stand' : 'Needs a camera seeing the room' },
    { mode: 'voice', available: true, why: lan ? 'Finds it on Wi-Fi by itself' : 'You may need to type its address (browser can’t scan Wi-Fi)' },
  ];
}

/** First available mode, in the offered order. */
export function defaultMode(options: readonly ModeOption[]): AddMode {
  return options.find((o) => o.available)?.mode ?? 'voice';
}

export interface FlowDeps {
  sim: boolean;
  /** How she started. Default 'point'. */
  mode?: AddMode;
  /** Room mode: where she points / what she named. Voice mode: her words. */
  hint?: IdentifyHint;
  /** Voice mode: identity from her words alone (no camera). */
  identityFromWords?(): DeviceIdentity | null;
  capture(): Promise<FlowFrame | null>;
  identify(f: FlowFrame, hint?: IdentifyHint): Promise<{ identity: DeviceIdentity; source: StepSource; ms?: number } | null>;
  cachedConnector(identity: DeviceIdentity): Connector | null;
  writeConnector(identity: DeviceIdentity): Promise<{ connector: Connector; source: StepSource; ms?: number } | null>;
  saveConnector(c: Connector): void;
  discover(identity: DeviceIdentity, c: Connector): Promise<{ found: FoundDevice[]; source: StepSource; note: string }>;
  /** Ask her for an address when discovery is a stub (null = cancelled). */
  askHost?(note: string): Promise<string | null>;
  /** Point the gimbal at the device (iOS + DockKit only; false = skipped). */
  aim?(box: NonNullable<DeviceIdentity['box']>): Promise<boolean>;
  /** Pinch to confirm. Resolves false if she cancels. */
  confirm(summary: string): Promise<boolean>;
  run(c: Connector, actionId: string, host: string): Promise<RunResult>;
  check(before: FlowFrame, after: FlowFrame, cue: string): Promise<{ verdict: EffectVerdict; reason: string; source: StepSource; ms?: number }>;
  saveDevice(d: PairedDevice): void;
  wait(ms: number): Promise<void>;
  onStep(ev: StepEvent): void;
  now?(): number;
}

export type FlowOutcome =
  | { ok: true; device: PairedDevice; identity: DeviceIdentity; connector: Connector; verdict: EffectVerdict }
  | { ok: false; at: StepId; reason: string };

/** Human label for a source — the honest badge on every request. */
export function sourceLabel(src: StepSource, sim = false): string {
  const base: Record<StepSource, string> = {
    'on-device': 'Gemini Nano · on device',
    cloud: 'Gemini · cloud',
    rules: 'Rules · no AI',
    cache: 'Cached connector · offline',
    builtin: 'Built-in connector',
    native: 'iPhone app · local network',
    bridge: 'WiZ bridge · local network',
    stub: 'Stub · browser can’t scan Wi-Fi',
    manual: 'Typed address',
    sim: 'SIM',
  };
  return sim && src !== 'sim' ? `SIM · ${base[src]}` : base[src];
}

/** Settle time after an action before the AFTER frame (bulbs fade ~0.5 s). */
export const SETTLE_MS = 1200;

export async function runAddDevice(d: FlowDeps): Promise<FlowOutcome> {
  const now = d.now ?? Date.now;
  const step = (ev: StepEvent): void => d.onStep({ ...ev, ...(d.sim ? { sim: true } : {}) });
  const fail = (at: StepId, reason: string): FlowOutcome => { step({ step: at, state: 'fail', detail: reason }); return { ok: false, at, reason }; };

  const mode: AddMode = d.mode ?? 'point';
  let identity: DeviceIdentity;
  const camera = mode !== 'voice';

  if (mode === 'voice') {
    // 1–2 voice only: no picture; her words name the device.
    step({ step: 'look', state: 'skip', detail: 'No camera needed. Using your words.' });
    const id = d.identityFromWords?.() ?? null;
    if (!id) return fail('identify', 'Which device? Say “add the lamp” (or speaker, fan, TV, plug).');
    identity = id;
    step({ step: 'identify', state: 'ok', source: 'rules', detail: `${identity.label} (from what you said)` });
  } else {
    // 1 look
    step({ step: 'look', state: 'active', detail: mode === 'room' ? 'Looking at the room…' : 'Looking through the camera…' });
    const frame = await d.capture();
    if (!frame) return fail('look', mode === 'room'
      ? 'No camera picture. Put the phone on its stand facing the room, or just say “add the lamp”.'
      : 'No camera picture. Turn the camera on and point it at the device, or just say “add the lamp”.');
    step({ step: 'look', state: 'ok', detail: 'Got one still picture (used for this answer only; Mendcraft keeps no copy).' });

    // 2 identify (room mode: the device she points at or names)
    step({ step: 'identify', state: 'active', detail: mode === 'room' ? 'Asking Gemini Nano which device you mean…' : 'Asking Gemini Nano what this is…', source: 'on-device' });
    const idr = await d.identify(frame, mode === 'room' ? d.hint : d.hint?.name ? { name: d.hint.name } : undefined);
    if (!idr) return fail('identify', mode === 'room'
      ? 'I could not tell which device you mean. Point at it or say its name.'
      : 'I could not see a device I can control. Point the camera at it and try again.');
    identity = idr.identity;
    step({ step: 'identify', state: 'ok', source: idr.source, ms: idr.ms,
      detail: `${identity.label}${identity.brand && !identity.label.toLowerCase().includes(identity.brand.toLowerCase()) ? ` (${identity.brand})` : ''} · ${Math.round(identity.confidence * 100)}% sure` });
    // Optional extra: a DockKit gimbal centres the device. Never required.
    if (identity.box && d.aim) {
      try { await d.aim(identity.box); } catch { /* gimbal is optional */ }
    }
  }

  // 3 connector: cache first (offline, reused), else cloud writes it once.
  step({ step: 'connector', state: 'active', detail: 'Looking for a saved connector…' });
  let connector = d.cachedConnector(identity);
  if (connector) {
    step({ step: 'connector', state: 'ok', source: 'cache', detail: `Reusing the saved ${connector.brand} connector (${connector.actions.length} actions). No cloud call.` });
  } else {
    step({ step: 'connector', state: 'active', source: 'cloud', detail: 'Gemini is writing a connector (once)…' });
    const w = await d.writeConnector(identity);
    if (!w) return fail('connector', `No safe local connector for ${identity.label}. It may need its own app.`);
    connector = w.connector;
    d.saveConnector(connector);
    step({ step: 'connector', state: 'ok', source: w.source, ms: w.ms,
      detail: `${connector.protocol}: ${connector.actions.map((a) => a.label).join(', ')}. Saved for offline reuse.` });
  }

  // 4 find on the local network
  step({ step: 'find', state: 'active', detail: 'Finding it on your Wi-Fi…' });
  const disc = await d.discover(identity, connector);
  let host: string | null = disc.found[0]?.host ?? null;
  let findSource: StepSource = disc.source;
  if (!host && d.askHost) {
    step({ step: 'find', state: 'active', source: disc.source, detail: disc.note });
    host = await d.askHost(disc.note);
    findSource = 'manual';
  }
  if (!host) return fail('find', disc.note || 'Could not find it on the Wi-Fi.');
  step({ step: 'find', state: 'ok', source: findSource, detail: `${disc.found[0]?.name ?? identity.label} at ${host}` });

  // 5 pinch to confirm
  const test = connector.actions.find((a) => a.id === connector!.test.action)!;
  const summary = `Connect ${identity.label} at ${host} and test "${test.label}"?`;
  step({ step: 'confirm', state: 'active', detail: `${summary} Pinch to confirm, open palm to cancel.` });
  if (!(await d.confirm(summary))) return fail('confirm', 'Cancelled. Nothing was sent to the device.');
  step({ step: 'confirm', state: 'ok', detail: 'Confirmed.' });

  // 6 test: prepare → before → action → after
  step({ step: 'test', state: 'active', detail: `Testing "${test.label}"…` });
  if (connector.test.prepare) {
    const p = await d.run(connector, connector.test.prepare, host);
    if (!p.ok) return fail('test', p.error ?? 'The device did not answer.');
    await d.wait(SETTLE_MS);
  }
  const before = camera ? await d.capture() : null;
  const r = await d.run(connector, test.id, host);
  if (!r.ok) return fail('test', r.error ?? 'The device did not answer.');
  await d.wait(SETTLE_MS);
  const after = camera ? await d.capture() : null;
  step({ step: 'test', state: 'ok', detail: `Sent "${test.label}". The device acknowledged.` });

  // 7 verify with the camera
  let verdict: EffectVerdict = 'unsure';
  if (before && after) {
    step({ step: 'verify', state: 'active', source: 'on-device', detail: `Checking the camera: ${test.successCue}?` });
    const v = await d.check(before, after, test.successCue);
    verdict = v.verdict;
    const msg = verdict === 'done' ? `I can see it worked: ${v.reason || test.successCue}.`
      : verdict === 'not_done' ? `It answered, but I can't see the change: ${v.reason || 'nothing changed'}.`
        : `I can't tell from the camera. ${v.reason}`.trim();
    step({ step: 'verify', state: verdict === 'done' ? 'ok' : 'fail', source: v.source, ms: v.ms, detail: msg });
  } else {
    step({ step: 'verify', state: 'skip', detail: mode === 'voice'
      ? 'Voice only: the device answered, but with no camera I can’t see the change. Tell me if it worked.'
      : 'No camera picture, so I could not check the effect.' });
  }

  const device: PairedDevice = {
    id: `${connector.key}@${host}`, name: identity.label, connectorKey: connector.key, host, addedAt: now(), verified: verdict,
  };
  d.saveDevice(device);
  return { ok: true, device, identity, connector, verdict };
}
