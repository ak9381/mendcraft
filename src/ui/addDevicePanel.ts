// "Add a device" panel: pick how (auto-detected, offered in order: point a
// camera / camera sees the room / just say it), then watch each step with the
// honest source badge, pinch to confirm, and get a green tick only when the
// camera shows the effect. The gimbal is an optional extra line, never needed.

import {
  MODE_LABELS, STEP_ORDER, defaultMode, detectModes, runAddDevice, sourceLabel,
  type AddMode, type FlowDeps, type FlowFrame, type FlowOutcome, type ModeOption, type StepEvent, type StepId, type WritingEvent,
} from '../devices/addDeviceFlow';
import { isPrivateIPv4 } from '../devices/connector';
import { loadDevices, type PairedDevice } from '../devices/connectorCache';
import type { IdentifyHint } from '../devices/identify';
import type { NudgeDir } from '../devices/gimbalFollow';

export interface AddDeviceServices {
  sim: boolean;
  env(): Promise<{ camera: boolean; iosApp: boolean; bridge: boolean; gimbal: boolean }>;
  /** Builds the flow deps (camera, models, LAN) for a mode; the panel adds the
   *  UI hooks (confirm, askHost, onStep). */
  deps(mode: AddMode, hint: IdentifyHint & { words?: string }): Omit<FlowDeps, 'confirm' | 'askHost' | 'onStep'>;
  enableCamera(): void;
  say(text: string): void;
  onDone?(outcome: FlowOutcome): void;
  onStep?(ev: StepEvent): void;
  onOpen?(): void;
  onClose?(): void;
  /** Manual gimbal pan/tilt (only wired when a DockKit stand is docked). */
  nudge?(dir: NudgeDir): void;
}

export interface AddDevicePanel {
  readonly element: HTMLElement;
  open(opts?: { mode?: AddMode; words?: string; hint?: IdentifyHint }): Promise<void>;
  close(): void;
  isOpen(): boolean;
  awaitingConfirm(): boolean;
  confirm(): boolean;
  cancel(): boolean;
}

const STEP_TITLES: Record<StepId, string> = {
  look: 'See it', identify: 'Name it', connector: 'Connector', find: 'Find on Wi-Fi',
  confirm: 'Pinch to confirm', test: 'Test', verify: 'Check with the camera',
};

function badgeClass(ev: StepEvent): string {
  if (ev.sim) return 'badge badge-sim';
  if (ev.source === 'on-device') return 'badge badge-on-device';
  if (ev.source === 'cloud') return 'badge badge-cloud';
  return 'badge badge-rules';
}

export function createAddDevicePanel(svc: AddDeviceServices): AddDevicePanel {
  const root = document.createElement('section');
  root.className = 'mc-add-device';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Add a device');
  root.innerHTML = `
    <div class="mc-ad-head"><span class="mc-ad-title">Add a device <span lang="kn">· ಸಾಧನ ಸೇರಿಸಿ</span></span>
      ${svc.sim ? '<span class="badge badge-sim" title="Simulated: fake camera, fake lamp, no model calls">SIM</span>' : ''}
      <button type="button" class="mc-panel-x" aria-label="Close add device">✕</button></div>
    <div class="mc-ad-body"></div>
    <div class="mc-ad-devices"></div>`;
  const body = root.querySelector<HTMLElement>('.mc-ad-body')!;
  const devicesEl = root.querySelector<HTMLElement>('.mc-ad-devices')!;
  let pendingConfirm: ((ok: boolean) => void) | null = null;
  let pendingHost: ((h: string | null) => void) | null = null;
  let running = false;
  let lastGimbal = false;

  root.querySelector('.mc-panel-x')!.addEventListener('click', () => api.close());

  function renderDevices(): void {
    const list: PairedDevice[] = loadDevices();
    devicesEl.innerHTML = list.length
      ? `<div class="mc-ad-sub">Your devices</div>${list.slice(0, 5).map((d) => `<div class="mc-ad-dev"><span>${esc(d.name)}</span><span class="mc-ad-dim">${esc(d.host)}</span><span class="${d.verified === 'done' ? 'mc-ad-ok' : 'mc-ad-dim'}">${d.verified === 'done' ? '✓ seen working' : 'not seen'}</span></div>`).join('')}`
      : '';
  }

  function appendNudge(into: HTMLElement): void {
    if (!svc.nudge) return;
    const row = document.createElement('div');
    row.className = 'mc-ad-nudge';
    row.innerHTML = `<p class="mc-ad-note">Point at the device, or nudge the stand. It will stay in frame.</p>
      <div class="mc-ad-btns mc-ad-nudge-btns">
        <button type="button" class="ghost" data-nudge="left" aria-label="Nudge left">← Left</button>
        <button type="button" class="ghost" data-nudge="right" aria-label="Nudge right">Right →</button>
        <button type="button" class="ghost" data-nudge="up" aria-label="Nudge up">↑ Up</button>
        <button type="button" class="ghost" data-nudge="down" aria-label="Nudge down">↓ Down</button>
      </div>`;
    row.querySelectorAll<HTMLButtonElement>('[data-nudge]').forEach((b) => {
      b.addEventListener('click', () => svc.nudge?.(b.dataset.nudge as NudgeDir));
    });
    into.append(row);
  }

  async function renderChooser(preselect?: AddMode): Promise<AddMode> {
    const env = await svc.env();
    lastGimbal = env.gimbal;
    const options: ModeOption[] = detectModes({ ...env, sim: svc.sim });
    const best = preselect ?? defaultMode(options);
    body.innerHTML = `<p class="mc-ad-lead">How do you want to add it? I checked what works here.</p>
      <div class="mc-ad-modes">${options.map((o, i) => `
        <button type="button" class="mc-ad-mode${o.mode === best ? ' suggested' : ''}" data-mode="${o.mode}" ${o.available ? '' : 'aria-disabled="true"'}>
          <span class="mc-ad-n">${i + 1}</span>
          <span class="mc-ad-mt"><b>${MODE_LABELS[o.mode].en}</b><span lang="kn">${MODE_LABELS[o.mode].kn}</span>
          <small>${MODE_LABELS[o.mode].detail}</small></span>
          <span class="mc-ad-why ${o.available ? 'ok' : 'no'}">${o.mode === best ? 'Suggested · ' : ''}${esc(o.why)}</span>
        </button>`).join('')}</div>
      <p class="mc-ad-gimbal">Gimbal (optional extra): ${env.gimbal ? 'DockKit stand found — it will stop following you. Point at the device or nudge the stand; it stays in frame.' : 'not needed. A plain stand or your hand works.'}</p>`;
    if (env.gimbal) appendNudge(body);
    body.querySelectorAll<HTMLButtonElement>('.mc-ad-mode').forEach((b) => b.addEventListener('click', () => {
      const m = b.dataset.mode as AddMode;
      const opt = options.find((o) => o.mode === m)!;
      if (!opt.available) { if (m !== 'voice') svc.enableCamera(); svc.say(opt.why); return; }
      void start(m, {});
    }));
    return best;
  }

  function renderRun(mode: AddMode): void {
    body.innerHTML = `<div class="mc-ad-modeline">${MODE_LABELS[mode].en} <button type="button" class="ghost mc-ad-change">Change</button></div>
      <div class="mc-ad-frames"></div>
      <ol class="mc-ad-steps">${STEP_ORDER.map((s) => `<li data-step="${s}" class="pending"><span class="mc-ad-ico" aria-hidden="true">○</span><span class="mc-ad-st"><b>${STEP_TITLES[s]}</b><span class="mc-ad-detail"></span></span><span class="mc-ad-src"></span></li>`).join('')}</ol>
      <div class="mc-ad-writing" hidden></div>
      <div class="mc-ad-action"></div>
      <div class="mc-ad-result" aria-live="polite"></div>`;
    body.querySelector('.mc-ad-change')!.addEventListener('click', () => { api.cancel(); void renderChooser(mode); });
    if (lastGimbal) appendNudge(body);
  }

  /** The live "Gemini is writing" card: plain words on top, the JSON below. */
  function onWriting(ev: WritingEvent): void {
    const card = body.querySelector<HTMLElement>('.mc-ad-writing');
    if (!card) return;
    card.hidden = false;
    card.className = `mc-ad-writing ${ev.state}`;
    const head: Record<WritingEvent['state'], string> = {
      streaming: ev.attempt === 1 ? 'Gemini is writing the connector…' : `Gemini is fixing it (try ${ev.attempt} of ${ev.max})…`,
      invalid: `Draft ${ev.attempt} rejected before anything was sent`,
      testing: `Testing draft ${ev.attempt} on the real device…`,
      failed: `Draft ${ev.attempt} did not work on the device`,
      passed: `Draft ${ev.attempt} works on the device`,
    };
    const words = plainWords(ev.text);
    card.innerHTML = `<p class="mc-ad-w-head">${esc(head[ev.state])}</p>
      ${words.length ? `<ul class="mc-ad-w-words">${words.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      ${ev.errors?.length ? `${ev.state === 'streaming' ? '<p class="mc-ad-w-sub">Fixing these problems from the last draft:</p>' : ''}<ul class="mc-ad-w-errors" role="alert">${ev.errors.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
      <pre class="mc-ad-w-json" aria-label="Connector JSON">${esc(ev.text.slice(-4000))}</pre>`;
    const pre = card.querySelector('pre');
    if (pre) pre.scrollTop = pre.scrollHeight;
  }

  function onStep(ev: StepEvent): void {
    svc.onStep?.(ev);
    const li = body.querySelector<HTMLElement>(`li[data-step="${ev.step}"]`);
    if (!li) return;
    li.className = ev.state;
    li.querySelector('.mc-ad-ico')!.textContent = ev.state === 'ok' ? '✓' : ev.state === 'fail' ? '!' : ev.state === 'skip' ? '–' : '…';
    li.querySelector('.mc-ad-detail')!.textContent = ev.detail;
    const src = li.querySelector<HTMLElement>('.mc-ad-src')!;
    if (ev.source) {
      src.innerHTML = `<span class="${badgeClass(ev)}" title="${ev.sim ? 'Simulated — no model or device was used' : 'Where this answer came from'}">${esc(sourceLabel(ev.source, ev.sim))}${ev.ms ? ` · ${ev.ms} ms` : ''}</span>`;
    }
  }

  function showFrame(label: string, f: FlowFrame | null): void {
    if (!f) return;
    const frames = body.querySelector<HTMLElement>('.mc-ad-frames');
    if (!frames) return;
    const fig = document.createElement('figure');
    fig.innerHTML = `<img alt="${esc(label)} camera still" src="data:${f.mimeType};base64,${f.dataBase64}"><figcaption>${esc(label)}</figcaption>`;
    if (frames.children.length >= 3) frames.firstElementChild?.remove();
    frames.appendChild(fig);
  }

  function confirmUi(summary: string): Promise<boolean> {
    const box = body.querySelector<HTMLElement>('.mc-ad-action')!;
    box.innerHTML = `<p>${esc(summary)}</p>
      <div class="mc-ad-btns"><button type="button" class="primary mc-ad-yes">🤏 Pinch to connect</button>
      <button type="button" class="ghost mc-ad-no">✋ Cancel</button></div>`;
    svc.say(summary + ' Pinch to confirm.');
    return new Promise<boolean>((resolve) => {
      pendingConfirm = (ok) => { pendingConfirm = null; box.innerHTML = ''; resolve(ok); };
      box.querySelector('.mc-ad-yes')!.addEventListener('click', () => pendingConfirm?.(true));
      box.querySelector('.mc-ad-no')!.addEventListener('click', () => pendingConfirm?.(false));
    });
  }

  function askHostUi(note: string): Promise<string | null> {
    const box = body.querySelector<HTMLElement>('.mc-ad-action')!;
    box.innerHTML = `<p class="mc-ad-note">${esc(note)}</p>
      <div class="mc-ad-btns"><input class="mc-ad-ip" inputmode="decimal" placeholder="192.168.1.42" aria-label="Device address">
      <button type="button" class="primary mc-ad-use">Use this address</button><button type="button" class="ghost mc-ad-skip">Cancel</button></div>`;
    return new Promise((resolve) => {
      pendingHost = (h) => { pendingHost = null; box.innerHTML = ''; resolve(h); };
      const input = box.querySelector<HTMLInputElement>('.mc-ad-ip')!;
      const use = (): void => {
        const v = input.value.trim();
        if (!isPrivateIPv4(v)) { input.setAttribute('aria-invalid', 'true'); svc.say('That is not a home Wi-Fi address.'); return; }
        pendingHost?.(v);
      };
      box.querySelector('.mc-ad-use')!.addEventListener('click', use);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') use(); });
      box.querySelector('.mc-ad-skip')!.addEventListener('click', () => pendingHost?.(null));
    });
  }

  async function start(mode: AddMode, hint: IdentifyHint & { words?: string }): Promise<void> {
    if (running) return;
    running = true;
    renderRun(mode);
    const base = svc.deps(mode, hint);
    let shots = 0;
    const deps: FlowDeps = {
      ...base,
      capture: async () => {
        const f = await base.capture();
        shots += 1;
        showFrame(shots === 1 ? 'Seen' : shots === 2 ? 'Before' : 'After', f);
        return f;
      },
      confirm: confirmUi,
      askHost: askHostUi,
      onStep,
      onWriting,
    };
    try {
      const out = await runAddDevice(deps);
      const res = body.querySelector<HTMLElement>('.mc-ad-result');
      if (res) {
        if (out.ok && out.verdict === 'done') {
          res.innerHTML = `<div class="mc-ad-tick" role="img" aria-label="Verified">✓</div><div><b>${esc(out.identity.label)} is connected.</b><br>I can see it worked. Saved for next time, works offline.</div>`;
          res.className = 'mc-ad-result good';
          svc.say(`${out.identity.label} is connected. I can see it worked.`);
        } else if (out.ok) {
          res.innerHTML = `<div class="mc-ad-tick amber" aria-hidden="true">?</div><div><b>${esc(out.identity.label)} answered</b>, but I could not see the change. Did it work?</div>`;
          res.className = 'mc-ad-result unsure';
          svc.say(`${out.identity.label} answered, but I could not see it change.`);
        } else {
          res.textContent = out.reason;
          res.className = 'mc-ad-result bad';
          svc.say(out.reason);
        }
      }
      renderDevices();
      svc.onDone?.(out);
    } finally {
      running = false;
    }
  }

  const api: AddDevicePanel = {
    element: root,
    async open(opts = {}) {
      root.hidden = false;
      svc.onOpen?.();
      renderDevices();
      if (running) return;
      if (opts.mode) { await start(opts.mode, { ...(opts.hint ?? {}), ...(opts.words ? { words: opts.words } : {}) }); return; }
      await renderChooser();
    },
    close() { api.cancel(); root.hidden = true; svc.onClose?.(); },
    isOpen: () => !root.hidden,
    awaitingConfirm: () => pendingConfirm !== null,
    confirm() { if (!pendingConfirm) return false; pendingConfirm(true); return true; },
    cancel() {
      let any = false;
      if (pendingConfirm) { pendingConfirm(false); any = true; }
      if (pendingHost) { pendingHost(null); any = true; }
      return any;
    },
  };
  return api;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/** Readable lines from a (possibly half-written) connector JSON. */
export function plainWords(text: string): string[] {
  const out: string[] = [];
  const proto = /"protocol"\s*:\s*"([^"]{1,80})"/.exec(text);
  if (proto) out.push(`Talks to it with ${proto[1]}.`);
  const re = /"verb"\s*:\s*"([a-z]+)"[^{}]*?"label"\s*:\s*"([^"]{1,60})"|"label"\s*:\s*"([^"]{1,60})"[^{}]*?"verb"\s*:\s*"([a-z]+)"/g;
  for (const m of text.matchAll(re)) {
    const verb = m[1] ?? m[4];
    const label = m[2] ?? m[3];
    out.push(`${label} (${verb})`);
  }
  return out.slice(0, 10);
}
