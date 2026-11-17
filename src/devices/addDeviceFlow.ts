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
//   3 connector cached → reuse offline; else cloud Gemini writes it as
//              declarative JSON, streamed live on screen, strictly validated
//              (bad drafts go back to Gemini with the exact errors)
//   4 find     LAN discovery (iOS native layer; web = WiZ bridge or a stub)
//   5 confirm  she pinches to confirm before anything is sent to the device
//   6 test     prepare → BEFORE frame → test action → AFTER frame; the real
//              device must acknowledge (and report the right state when it
//              can). On failure the error goes back to Gemini to fix, up to
//              MAX_WRITE_ATTEMPTS drafts in all. Never a silent template.
//   7 verify   Gemini Nano compares the two frames → green tick when it can SEE
//              the effect, on top of the device's own acknowledgement
//
// Unit-tested with fakes; the DOM panel (ui/addDevicePanel.ts) and main.ts
// supply the real camera, models, transports and confirm.

import type { Connector, RunResult } from './connector';
import { ackOf, expectedState, stateOf } from './ack';
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

/** Most connector drafts Gemini gets (first try + fixes). */
export const MAX_WRITE_ATTEMPTS = 3;

/** What went wrong last time, sent back to the writer. */
export interface WriteFeedback { attempt: number; errors: string[]; previous: string }

export type WriteResult =
  | { ok: true; connector: Connector; source: StepSource; ms?: number; text: string }
  | { ok: false; errors: string[]; text?: string; unsupported?: boolean; unreachable?: boolean; source?: StepSource; ms?: number };

/** The live "Gemini is writing" card. */
export interface WritingEvent {
  attempt: number;
  max: number;
  state: 'streaming' | 'invalid' | 'testing' | 'failed' | 'passed';
  text: string;
  errors?: string[];
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
  /** Stream a connector draft. `onText` gets the growing text; `feedback`
   *  carries the previous draft's errors (validation or real device). */
  writeConnector(identity: DeviceIdentity, feedback: WriteFeedback | null, onText: (text: string) => void): Promise<WriteResult>;
  onWriting?(ev: WritingEvent): void;
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
    step({ step: 'look', state: 'ok', detail: 'Got one still picture (not stored).' });

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

  // 3 connector: cache first (offline, reused), else Gemini writes a draft.
  step({ step: 'connector', state: 'active', detail: 'Looking for a saved connector…' });
  let attempts = 0;
  let lastText = '';
  const writing = (ev: Omit<WritingEvent, 'max'>) => d.onWriting?.({ ...ev, max: MAX_WRITE_ATTEMPTS });
  /** Draft until one passes validation, or the attempts run out. */
  const draft = async (feedback: WriteFeedback | null): Promise<Connector | string> => {
    let fb = feedback;
    while (attempts < MAX_WRITE_ATTEMPTS) {
      attempts += 1;
      step({ step: 'connector', state: 'active', source: 'cloud',
        detail: attempts === 1 ? 'Gemini is writing a connector…' : `Gemini is fixing the connector (try ${attempts} of ${MAX_WRITE_ATTEMPTS})…` });
      // While fixing, keep last time's problems on screen next to the new draft.
      const fixing = fb ? { errors: fb.errors } : {};
      writing({ attempt: attempts, state: 'streaming', text: '', ...fixing });
      const w = await d.writeConnector(identity, fb, (text) => { lastText = text; writing({ attempt: attempts, state: 'streaming', text, ...fixing }); });
      lastText = w.text ?? lastText;
      if (w.ok) {
        step({ step: 'connector', state: 'ok', source: w.source, ms: w.ms,
          detail: `Draft ${attempts}: ${w.connector.protocol}. ${w.connector.actions.map((a) => `${a.label} (${a.verb})`).join(', ')}. Not trusted until the device answers.` });
        return w.connector;
      }
      if (w.unreachable) return 'Gemini could not be reached, so no connector was written. Check the internet and try again.';
      if (w.unsupported) return `Gemini says ${identity.label} has no documented local control. It may need its own app.`;
      writing({ attempt: attempts, state: 'invalid', text: lastText, errors: w.errors });
      step({ step: 'connector', state: 'active', source: w.source,
        detail: `Draft ${attempts} was rejected before anything was sent: ${w.errors[0]}` });
      fb = { attempt: attempts, errors: w.errors, previous: lastText };
    }
    return `Gemini could not write a valid connector in ${MAX_WRITE_ATTEMPTS} tries. Last problem: ${fb?.errors[0] ?? 'unknown'}`;
  };

  let connector: Connector;
  let fromCache = false;
  const cached = d.cachedConnector(identity);
  if (cached) {
    connector = cached;
    fromCache = true;
    step({ step: 'connector', state: 'ok', source: 'cache', detail: `Reusing the saved ${cached.brand} connector (${cached.actions.length} actions). No cloud call.` });
  } else {
    const c = await draft(null);
    if (typeof c === 'string') return fail('connector', c);
    connector = c;
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

  // 5 pinch to confirm (once; covers the fix-and-retest loop)
  const firstTest = connector.actions.find((a) => a.id === connector.test.action)!;
  const summary = `Connect ${identity.label} at ${host} and test "${firstTest.label}"?${fromCache ? '' : ` If the test fails, Gemini fixes the connector and tests again (up to ${MAX_WRITE_ATTEMPTS} tries).`}`;
  step({ step: 'confirm', state: 'active', detail: `${summary} Pinch to confirm, open palm to cancel.` });
  if (!(await d.confirm(summary))) return fail('confirm', 'Cancelled. Nothing was sent to the device.');
  step({ step: 'confirm', state: 'ok', detail: 'Confirmed.' });

  // 6 test on the real device → fix → test again
  const runChecked = async (c: Connector, actionId: string): Promise<{ ok: true; reply: unknown } | { ok: false; error: string }> => {
    const action = c.actions.find((a) => a.id === actionId)!;
    const r = await d.run(c, actionId, host!);
    if (!r.ok) return { ok: false, error: `"${action.label}" failed: ${r.error ?? 'the device did not answer'}` };
    const ack = ackOf(r.reply, action.request.transport);
    if (!ack.ok) return { ok: false, error: `"${action.label}": ${ack.error}` };
    return { ok: true, reply: r.reply };
  };
  let before: FlowFrame | null = null;
  let after: FlowFrame | null = null;
  let test = firstTest;
  for (;;) {
    test = connector.actions.find((a) => a.id === connector.test.action)!;
    step({ step: 'test', state: 'active', detail: `Testing "${test.label}" on the device…` });
    writing({ attempt: Math.max(1, attempts), state: 'testing', text: lastText || JSON.stringify(connector, null, 1) });
    let error: string | null = null;
    if (connector.test.prepare) {
      const p = await runChecked(connector, connector.test.prepare);
      if (!p.ok) error = p.error;
      else await d.wait(SETTLE_MS);
    }
    if (!error) {
      before = camera ? await d.capture() : null;
      const r = await runChecked(connector, test.id);
      if (!r.ok) error = r.error;
      else {
        await d.wait(SETTLE_MS);
        after = camera ? await d.capture() : null;
        // When the connector can read state, the device must agree.
        const want = expectedState(test.verb);
        const status = connector.actions.find((a) => a.verb === 'status');
        const said = stateOf(r.reply);
        if (want !== null && said !== null && said !== want) error = `"${test.label}" was answered, but the device reports it is ${said ? 'on' : 'off'}.`;
        else if (want !== null && status) {
          const s2 = await runChecked(connector, status.id);
          if (!s2.ok) error = s2.error;
          else {
            const now2 = stateOf(s2.reply);
            if (now2 !== null && now2 !== want) error = `After "${test.label}", "${status.label}" says the device is ${now2 ? 'on' : 'off'}.`;
          }
        }
      }
    }
    if (!error) break;
    writing({ attempt: Math.max(1, attempts), state: 'failed', text: lastText, errors: [error] });
    if (attempts >= MAX_WRITE_ATTEMPTS) {
      return fail('test', `${error} Gemini tried ${attempts} version${attempts === 1 ? '' : 's'}; nothing was saved.`);
    }
    step({ step: 'test', state: 'active', detail: `${error} Sending the error to Gemini to fix…` });
    const c = await draft({ attempt: attempts, errors: [`On the real device: ${error}`], previous: lastText || JSON.stringify(connector) });
    if (typeof c === 'string') return fail('test', `${error} ${c}`);
    connector = c;
    fromCache = false;
  }
  writing({ attempt: Math.max(1, attempts), state: 'passed', text: lastText });
  const tested: Connector = { ...connector, testedAt: now() };
  d.saveConnector(tested);
  connector = tested;
  step({ step: 'test', state: 'ok', detail: `Sent "${test.label}". The device acknowledged${fromCache ? '' : ', so the connector is saved for offline reuse'}.` });

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
