// "Connect devices (and make a dashboard)": pair phones FIRST, then ask what to
// connect next. The lamp dashboard review (connectRoom) never jumps the queue:
// it starts only on "build the dashboard" said after pairing, or immediately
// when pairing is impossible. Pure controller + a tiny row renderer; the
// canvas supplies the effects.

import { esc } from '../core/esc';

export interface PairedPhone {
  id: string;
  label: string;
  /** Scripted join under ?sim=1 (no relay): always shown labelled SIM. */
  sim: boolean;
}

export const NEXT_PROMPT = 'What do you want to connect next? Point at it, name it, or say build the dashboard.';

/** "connect devices", "connect my devices and make a dashboard", "connect all devices". */
export function parseConnectDevices(text: string): { dashboard: boolean } | null {
  if (!/\bconnect\s+(?:(?:all|my|the|our)\s+)?devices?\b/i.test(text)) return null;
  return { dashboard: /\b(?:make|build|create|set\s*up)\b[^.]*\bdashboard\b/i.test(text) };
}

export function isBuildDashboard(text: string): boolean {
  return /\b(?:build|make|create|show)\s+(?:me\s+)?(?:the|a|my)\s+dashboard\b/i.test(text);
}

export function isContinue(text: string): boolean {
  return /^\s*(?:continue|next|done|that'?s all|go on)\s*[.!]?\s*$/i.test(text);
}

export type PairFirstPhase = 'idle' | 'pairing' | 'asking';

export interface PairFirstDeps {
  say(text: string): void;
  /** Start the real pairing (chime + typed code). Resolves false when no relay is reachable. */
  openPairing(): Promise<boolean>;
  /** Run the lamp dashboard review (connectRoom). */
  buildDashboard(): void;
  /** Called whenever the phone list or phase changes (render the row). */
  onChange?(): void;
  /** True under ?sim=1: simulate two phones, labelled SIM. */
  sim(): boolean;
  schedule?: (fn: () => void, ms: number) => unknown;
}

export interface PairFirst {
  phase(): PairFirstPhase;
  phones(): readonly PairedPhone[];
  pendingDashboard(): boolean;
  begin(o: { dashboard: boolean }): Promise<void>;
  addPhone(p: { id: string; label: string; sim?: boolean }): void;
  /** A generic "paired" with no platform info; replaced once a named phone announces. */
  addGeneric(): void;
  clearReal(): void;
  continueNext(): boolean;
  /** Returns true when the utterance belonged to this flow. */
  handleSpeech(text: string): boolean;
  cancel(): void;
}

const GENERIC_ID = 'phone-generic';

export function createPairFirst(d: PairFirstDeps): PairFirst {
  const sched = d.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  let phase: PairFirstPhase = 'idle';
  let list: PairedPhone[] = [];
  let pendingDash = false;
  let gen = 0; // invalidates scripted sim joins after cancel / a new begin

  const changed = () => d.onChange?.();

  function addPhone(p: { id: string; label: string; sim?: boolean }): void {
    if (phase !== 'pairing') return;
    if (p.id !== GENERIC_ID) list = list.filter((x) => x.id !== GENERIC_ID);
    if (list.some((x) => x.id === p.id)) return;
    list = [...list, { id: p.id, label: p.label, sim: !!p.sim }];
    d.say(`${p.sim ? 'SIM: ' : ''}${p.label} joined.`);
    changed();
  }

  function continueNext(): boolean {
    if (phase !== 'pairing') return false;
    if (list.length === 0) { d.say('No phone has joined yet. Hold one near the laptop, or type the code on it.'); return true; }
    phase = 'asking';
    changed();
    d.say(NEXT_PROMPT);
    return true;
  }

  function buildNow(): void {
    phase = 'idle';
    pendingDash = false;
    gen++;
    changed();
    d.buildDashboard();
  }

  return {
    phase: () => phase,
    phones: () => list,
    pendingDashboard: () => pendingDash,
    async begin(o) {
      gen++;
      const mine = gen;
      phase = 'pairing';
      list = [];
      pendingDash = o.dashboard;
      changed();
      if (d.sim()) {
        d.say('SIM: no relay here, so two phones join on a script. Real phones pair by chime.');
        sched(() => { if (gen === mine) addPhone({ id: 'sim-1', label: 'Nothing phone', sim: true }); }, 1200);
        sched(() => { if (gen === mine) addPhone({ id: 'sim-2', label: 'iPhone', sim: true }); }, 2600);
        // The scripted judge path should not stall on a button.
        sched(() => { if (gen === mine && phase === 'pairing' && list.length >= 2) continueNext(); }, 4000);
        return;
      }
      d.say('Pairing phones first. Playing the chime; hold a phone near the laptop.');
      const ok = await d.openPairing();
      if (gen !== mine) return;
      if (!ok) {
        d.say('No pairing possible here (the Relay is not reachable), so continuing without phones.');
        buildNow();
      }
    },
    addPhone,
    addGeneric() { if (!list.length) addPhone({ id: GENERIC_ID, label: 'Phone' }); },
    clearReal() {
      if (phase === 'idle') return;
      list = list.filter((x) => x.sim);
      changed();
    },
    continueNext,
    handleSpeech(text) {
      if (phase === 'idle') return false;
      if (isBuildDashboard(text)) { buildNow(); return true; }
      if (isContinue(text) && phase === 'pairing') return continueNext();
      return false;
    },
    cancel() { gen++; phase = 'idle'; list = []; pendingDash = false; changed(); },
  };
}

/** Pure HTML for the connected-device row: a check per joined phone, SIM labelled. */
export function pairedRowHtml(phones: readonly PairedPhone[], phase: PairFirstPhase): string {
  if (phase === 'idle') return '';
  const chips = phones.length
    ? phones.map((p) => `<span class="mc-paired-chip" data-phone="${esc(p.id)}"><span class="mc-paired-check" aria-hidden="true">✓</span> ${esc(p.label)}${p.sim ? ' <span class="mc-chip">SIM</span>' : ''}</span>`).join('')
    : '<span class="mc-paired-wait">Waiting for a phone…</span>';
  const cont = phase === 'pairing'
    ? `<button type="button" class="mc-btn primary mc-paired-continue"${phones.length ? '' : ' disabled'}>Continue</button>`
    : '';
  return `<span class="mc-arrange-label">Connected</span>${chips}${cont}`;
}
