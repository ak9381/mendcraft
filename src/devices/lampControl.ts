// Shared WiZ lamp control widget — mounted both in the laptop editor (a discreet
// float panel) and on the phone /remote page. It talks ONLY to the local bridge
// via WizClient; when the bridge is down it says so plainly and never claims the
// lamp is connected. Every control is a plain button / range input, so the pinch
// pointer drives it exactly like a mouse (no mouse-only paths).

import { BridgeOfflineError, type WizClient } from './wizClient';
import { lampStateLabel, type LampIntent, type LampState } from './wiz';

const OFFLINE_HINT = 'bridge offline — run `npm run wiz-bridge` on the laptop';

export interface LampControl {
  readonly element: HTMLElement;
  /** Re-check the bridge + current bulb state. */
  refresh(): Promise<void>;
  destroy(): void;
}

export interface LampControlOptions {
  /** Called whenever the known state changes (for the control-room snapshot). */
  onState?: (state: LampState | null, online: boolean) => void;
  /** Smaller layout for the phone page. */
  compact?: boolean;
}

export function createLampControl(client: WizClient, opts: LampControlOptions = {}): LampControl {
  const root = document.createElement('div');
  root.className = `lamp-control${opts.compact ? ' lamp-compact' : ''}`;
  root.innerHTML = `
    <div class="lamp-head">
      <span class="lamp-title">WiZ lamp</span>
      <span class="lamp-badge badge badge-rules">checking…</span>
    </div>
    <p class="lamp-status" role="status" aria-live="polite">Connecting to the bridge…</p>
    <div class="lamp-bulbrow">
      <label class="lamp-bulb-label">Bulb
        <select class="lamp-bulb" aria-label="Choose a WiZ bulb"><option value="">bridge default</option></select>
      </label>
      <button type="button" class="lamp-discover" title="Find WiZ bulbs on this network">Discover</button>
    </div>
    <div class="lamp-actions" role="group" aria-label="Lamp power">
      <button type="button" class="lamp-on">On</button>
      <button type="button" class="lamp-off">Off</button>
    </div>
    <label class="lamp-dim-label">Brightness
      <span class="lamp-dim-row">
        <button type="button" class="lamp-dim-down" aria-label="Dimmer">−</button>
        <input class="lamp-dim" type="range" min="10" max="100" step="10" value="80" aria-label="Brightness" />
        <button type="button" class="lamp-dim-up" aria-label="Brighter">＋</button>
      </span>
    </label>
    <div class="lamp-temp" role="group" aria-label="Colour">
      <button type="button" class="lamp-warm" data-temp="2700">Warm</button>
      <button type="button" class="lamp-neutral" data-temp="4000">Neutral</button>
      <button type="button" class="lamp-cool" data-temp="6500">Cool</button>
      <button type="button" class="lamp-color" data-rgb="255,60,60" style="color:#ff3c3c">● Red</button>
      <button type="button" class="lamp-color" data-rgb="60,120,255" style="color:#3c78ff">● Blue</button>
    </div>
  `;

  const $ = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const badge = $<HTMLSpanElement>('.lamp-badge');
  const statusEl = $<HTMLParagraphElement>('.lamp-status');
  const bulbSel = $<HTMLSelectElement>('.lamp-bulb');
  const dim = $<HTMLInputElement>('.lamp-dim');
  const controls = Array.from(
    root.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
      '.lamp-on,.lamp-off,.lamp-dim,.lamp-dim-up,.lamp-dim-down,.lamp-temp button',
    ),
  );

  let online = false;
  let lastState: LampState | null = null;

  function setOnline(up: boolean): void {
    online = up;
    badge.textContent = up ? 'bridge up' : 'bridge offline';
    badge.className = `lamp-badge badge ${up ? 'badge-on-device' : 'badge-rules'}`;
    for (const c of controls) c.disabled = !up;
  }

  function emit(): void {
    opts.onState?.(lastState, online);
  }

  function showState(state: LampState | null): void {
    lastState = state;
    statusEl.textContent = state ? `Lamp: ${lampStateLabel(state)}` : 'No bulb state yet.';
    if (state?.on && typeof state.dimming === 'number') dim.value = String(state.dimming);
    emit();
  }

  /** Run a bridge call, mapping a bridge-down error to the honest offline hint. */
  async function guarded(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (err) {
      if (err instanceof BridgeOfflineError) {
        setOnline(false);
        statusEl.textContent = OFFLINE_HINT;
        emit();
      } else {
        statusEl.textContent = `Bridge error: ${(err as Error).message}`;
      }
    }
  }

  async function apply(intent: LampIntent): Promise<void> {
    await guarded(async () => {
      const state = await client.setPilot(bulbSel.value, intent);
      setOnline(true);
      showState(state);
    });
  }

  async function refresh(): Promise<void> {
    const up = await client.health();
    setOnline(up);
    if (!up) {
      statusEl.textContent = OFFLINE_HINT;
      showState(null);
      return;
    }
    await guarded(async () => {
      const state = await client.getPilot(bulbSel.value);
      showState(state);
    });
  }

  // ---- wire controls (mouse + pinch pointer both dispatch click/input) -------
  $('.lamp-on').addEventListener('click', () => void apply({ kind: 'power', on: true }));
  $('.lamp-off').addEventListener('click', () => void apply({ kind: 'power', on: false }));
  $('.lamp-dim').addEventListener('change', () => void apply({ kind: 'dim', dimming: Number(dim.value) }));
  $('.lamp-dim-up').addEventListener('click', () => {
    dim.value = String(Math.min(100, Number(dim.value) + 10));
    void apply({ kind: 'dim', dimming: Number(dim.value) });
  });
  $('.lamp-dim-down').addEventListener('click', () => {
    dim.value = String(Math.max(10, Number(dim.value) - 10));
    void apply({ kind: 'dim', dimming: Number(dim.value) });
  });
  for (const b of root.querySelectorAll<HTMLButtonElement>('.lamp-temp button[data-temp]')) {
    b.addEventListener('click', () => void apply({ kind: 'temp', temp: Number(b.dataset.temp) }));
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('.lamp-color[data-rgb]')) {
    b.addEventListener('click', () => {
      const [r, g, bl] = b.dataset.rgb!.split(',').map(Number);
      void apply({ kind: 'color', rgb: { r, g, b: bl } });
    });
  }
  $('.lamp-discover').addEventListener('click', () => {
    statusEl.textContent = 'Scanning the network…';
    void guarded(async () => {
      const bulbs = await client.discover();
      setOnline(true);
      // Keep "bridge default" plus any discovered bulbs.
      bulbSel.innerHTML = '<option value="">bridge default</option>';
      for (const bulb of bulbs) {
        const opt = document.createElement('option');
        opt.value = bulb.ip;
        opt.textContent = bulb.mac ? `${bulb.ip} (${bulb.mac})` : bulb.ip;
        bulbSel.appendChild(opt);
      }
      statusEl.textContent = bulbs.length
        ? `Found ${bulbs.length} bulb(s).`
        : 'No bulbs answered — check the bulb is on the same Wi-Fi.';
    });
  });
  bulbSel.addEventListener('change', () => void refresh());

  return {
    element: root,
    refresh,
    destroy() {
      root.remove();
    },
  };
}
