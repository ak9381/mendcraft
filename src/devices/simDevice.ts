// SIM (?sim=1) stand-ins for the add-a-device flow: a fake WiZ lamp on a fake
// LAN, fake camera frames drawn on a canvas (room with the lamp off or on), and
// fake model answers. Nothing here calls a model or touches a network; every
// step it drives is labelled SIM in the panel.

import { builtinWizConnector, runAction, type Connector } from './connector';
import type { AddMode, FlowFrame, StepSource } from './addDeviceFlow';
import type { DeviceIdentity, EffectVerdict, IdentifyHint } from './identify';

export const SIM_LAMP_HOST = '192.168.1.42';

/** Pure fake lamp + LAN; frames are drawn by drawSimFrame (DOM). */
export function createSimWorld(draw: (lampOn: boolean, mode: AddMode) => FlowFrame | null = drawSimFrame) {
  let lampOn = false;
  const written = new Map<string, Connector>(); // sim-only cache: first run "writes", later runs reuse
  const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  return {
    get lampOn() { return lampOn; },
    capture: async (mode: AddMode): Promise<FlowFrame | null> => draw(lampOn, mode),
    identify: async (_f: FlowFrame, hint?: IdentifyHint): Promise<{ identity: DeviceIdentity; source: StepSource; ms: number }> => {
      await pause(500);
      return {
        identity: { kind: 'smart-bulb', brand: 'WiZ', model: 'A60', label: hint?.name ? `Lamp (${hint.name})` : 'Table lamp (WiZ bulb)', confidence: 0.91, box: { x: 0.56, y: 0.22, w: 0.2, h: 0.46 } },
        source: 'on-device', ms: 480,
      };
    },
    cached: (key: string): Connector | null => written.get(key) ?? null,
    write: async (): Promise<{ connector: Connector; source: StepSource; ms: number }> => {
      await pause(900);
      const c = { ...builtinWizConnector(), source: 'sim' as const };
      written.set(c.key, c);
      return { connector: c, source: 'cloud', ms: 2400 };
    },
    discover: async () => { await pause(400); return { found: [{ host: SIM_LAMP_HOST, name: 'WiZ bulb' }], source: 'native' as StepSource, note: '' }; },
    run: (c: Connector, actionId: string, host: string) => runAction(c, actionId, {}, host, {
      udp: async (_h, _p, payload) => {
        const st = (payload as { params?: { state?: unknown } }).params?.state;
        if (typeof st === 'boolean') lampOn = st;
        return { result: { success: true } };
      },
    }),
    check: async (): Promise<{ verdict: EffectVerdict; reason: string; source: StepSource; ms: number }> => {
      await pause(600);
      return lampOn
        ? { verdict: 'done', reason: 'the lamp is lit in the second picture and dark in the first', source: 'on-device', ms: 610 }
        : { verdict: 'not_done', reason: 'the lamp looks dark in both pictures', source: 'on-device', ms: 610 };
    },
  };
}

/** Fake camera frame: a dim room with a table lamp, lit or dark. */
export function drawSimFrame(lampOn: boolean, mode: AddMode = 'point'): FlowFrame | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 320; c.height = 200;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = lampOn ? '#3a3326' : '#16161a'; g.fillRect(0, 0, 320, 200);
  g.fillStyle = lampOn ? '#4a4030' : '#1e1e24'; g.fillRect(0, 140, 320, 60); // floor
  if (mode === 'room') { // wider view: sofa + window
    g.fillStyle = '#2b2f3a'; g.fillRect(24, 110, 110, 40);
    g.fillStyle = '#20263a'; g.fillRect(30, 30, 70, 55);
  }
  g.fillStyle = '#5b4a3a'; g.fillRect(170, 128, 90, 12); // table
  g.fillStyle = '#8a8a8a'; g.fillRect(212, 88, 6, 40); // stem
  if (lampOn) {
    const glow = g.createRadialGradient(215, 70, 4, 215, 70, 120);
    glow.addColorStop(0, 'rgba(255,220,140,0.85)'); glow.addColorStop(1, 'rgba(255,220,140,0)');
    g.fillStyle = glow; g.fillRect(0, 0, 320, 200);
  }
  g.fillStyle = lampOn ? '#ffe6a8' : '#5a5650';
  g.beginPath(); g.moveTo(190, 88); g.lineTo(240, 88); g.lineTo(228, 52); g.lineTo(202, 52); g.closePath(); g.fill();
  g.fillStyle = '#bbb'; g.font = '10px sans-serif'; g.fillText('SIM camera', 8, 192);
  const url = c.toDataURL('image/jpeg', 0.7);
  const i = url.indexOf(',');
  return i > 0 ? { mimeType: 'image/jpeg', dataBase64: url.slice(i + 1) } : null;
}
