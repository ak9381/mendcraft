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

/** live: the flow is over but phones stay connected (relay alive). */
export type PairFirstPhase = 'idle' | 'pairing' | 'asking' | 'live';

export interface PairFirstDeps {
  say(text: string): void;
  /** Start the real pairing (chime + typed code). Resolves false when no relay is reachable. */
  openPairing(): Promise<boolean>;
  /** Run the lamp dashboard review (connectRoom). */
  buildDashboard(): void;
  /** True while a proposal/review is waiting (the dashboard review must queue behind it). */
  busy?(): boolean;
  /** Called whenever the phone list or phase changes (render the row). */
  onChange?(): void;
  /** True under ?sim=1: simulate two phones, labelled SIM. */
  sim(): boolean;
  schedule?: (fn: () => void, ms: number) => unknown;
  clear?: (handle: unknown) => void;
}

export interface PairFirst {
  phase(): PairFirstPhase;
  phones(): readonly PairedPhone[];
  begin(o?: { dashboard?: boolean }): Promise<void>;
  addPhone(p: { id: string; label: string; sim?: boolean }): void;
  /** A generic "paired" with no platform info; replaced once a named phone announces. */
  addGeneric(): void;
  clearReal(): void;
  continueNext(): boolean;
  /** Returns true when the utterance belonged to this flow. */
  handleSpeech(text: string): boolean;
  /** Leave the pair-first flow without dropping phones (new board, undo, unrelated command). */
  abandon(): void;
  /** Full reset: phones gone, timers cleared (Disconnect, card closed, destroy). */
  cancel(): void;
  /** Re-render the row (a phone's sub-state changed). */
  refresh(): void;
}

const GENERIC_ID = 'phone-generic';

export function createPairFirst(d: PairFirstDeps): PairFirst {
  const sched = d.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  let phase: PairFirstPhase = 'idle';
  let list: PairedPhone[] = [];
  let timers: unknown[] = [];
  let gen = 0; // invalidates scripted sim joins after cancel / a new begin

  const clearTimer = d.clear ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const later = (fn: () => void, ms: number) => { timers.push(sched(fn, ms)); };
  const clearTimers = () => { timers.forEach(clearTimer); timers = []; };
  const busy = () => !!d.busy?.();
  const changed = () => d.onChange?.();

  function addPhone(p: { id: string; label: string; sim?: boolean }): void {
    if (phase === 'idle') return;
    if (p.id !== GENERIC_ID) list = list.filter((x) => x.id !== GENERIC_ID);
    if (list.some((x) => x.id === p.id)) return;
    list = [...list, { id: p.id, label: p.label, sim: !!p.sim }];
    d.say(`${p.sim ? 'SIM: ' : ''}${p.label} joined.`);
    changed();
  }

  function continueNext(): boolean {
    if (phase !== 'pairing') return false;
    if (list.length === 0) { d.say('No phone has joined yet. Hold one near the laptop, or type the code on it.'); return true; }
    if (busy()) { d.say('Finish the waiting proposal first: keep or drop. Then continue.'); return true; }
    phase = 'asking';
    changed();
    d.say(NEXT_PROMPT);
    return true;
  }

  function buildNow(): void {
    if (busy()) { d.say('Finish the waiting proposal first: keep or drop. Then say build the dashboard.'); return; }
    phase = list.length ? 'live' : 'idle';
    gen++;
    clearTimers();
    changed();
    d.buildDashboard();
  }

  function abandon(): void {
    if (phase !== 'pairing' && phase !== 'asking') return;
    gen++;
    clearTimers();
    phase = list.length ? 'live' : 'idle';
    changed();
  }

  function cancel(): void {
    gen++;
    clearTimers();
    phase = 'idle';
    list = [];
    changed();
  }

  return {
    phase: () => phase,
    phones: () => list,
    async begin() {
      gen++;
      const mine = gen;
      phase = 'pairing';
      list = [];
      clearTimers();
      changed();
      if (d.sim()) {
        d.say('SIM: no relay here, so two phones join on a script. Real phones pair by chime.');
        later(() => { if (gen === mine) addPhone({ id: 'sim-1', label: 'Nothing phone', sim: true }); }, 1200);
        later(() => { if (gen === mine) addPhone({ id: 'sim-2', label: 'iPhone', sim: true }); }, 2600);
        // The scripted judge path should not stall on a button.
        later(() => { if (gen === mine && phase === 'pairing' && list.length >= 2) continueNext(); }, 4000);
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
      if (!list.length) { cancel(); return; }
      changed();
    },
    continueNext,
    handleSpeech(text) {
      if (phase !== 'pairing' && phase !== 'asking') return false;
      if (isBuildDashboard(text)) { buildNow(); return true; }
      if (phase === 'pairing') return isContinue(text) && list.length > 0 ? continueNext() : false;
      // asking: point / name / connect stay in the flow; anything else ends it.
      if (/\b(point|connect|add|name)\b/i.test(text)) return false;
      abandon();
      return false;
    },
    abandon,
    cancel,
    refresh: changed,
  };
}

/** Pure HTML for the connected-device row: a check per joined phone, SIM
 *  labelled, plus each phone's sub-state (`subOf`, e.g. the iPhone's
 *  "Gimbal tracking ready" / "Tracking you" — only from real status). */
export function pairedRowHtml(phones: readonly PairedPhone[], phase: PairFirstPhase, subOf?: (p: PairedPhone) => string): string {
  if (phase === 'idle') return '';
  const sub = (p: PairedPhone): string => {
    // The row's own SIM chip already says these phones are simulated: no second "SIM ·".
    const t = (subOf?.(p) ?? '').replace(/^SIM · /, '');
    return t ? ` <span class="mc-paired-sub" data-phone-sub="${esc(p.id)}">${esc(t)}</span>` : '';
  };
  if (phase === 'live' || phase === 'asking') {
    const n = phones.length;
    const sim = phones.some((p) => p.sim) ? ' <span class="mc-chip">SIM</span>' : '';
    const subs = phones.map((p) => { const t = sub(p); return t ? ` <span class="mc-paired-phone">${esc(p.label)}:${t}</span>` : ''; }).join('');
    return `<span class="mc-paired-check" aria-hidden="true">✓</span> <span class="mc-paired-count">${n} phone${n === 1 ? '' : 's'} connected</span>${sim}${subs}<button type="button" class="mc-btn mc-paired-disconnect">Disconnect</button>`;
  }
  const chips = phones.length
    ? phones.map((p) => `<span class="mc-paired-chip" data-phone="${esc(p.id)}"><span class="mc-paired-check" aria-hidden="true">✓</span> ${esc(p.label)}${p.sim ? ' <span class="mc-chip">SIM</span>' : ''}${sub(p)}</span>`).join('')
    : '<span class="mc-paired-wait">Waiting for a phone…</span>';
  const cont = phase === 'pairing'
    ? `<button type="button" class="mc-btn primary mc-paired-continue"${phones.length ? '' : ' disabled'}>Continue</button>`
    : '';
  return `<span class="mc-arrange-label">Connected</span>${chips}${cont}`;
}
