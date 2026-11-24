// "Join laptop" for the phone-shell canvas (the page the native apps load).
// First-time pairing used to live only on /mobile.html; the apps never reach
// it, so a phone could only rejoin a pair it already had. This adds the same
// chime join here: tap Join laptop → the mic opens (only then) → the in-repo
// decoder hears the laptop's short code → joinPhoneSession() joins the room,
// saves the pair (the key the saved-pair rejoin reads), binds the AI-feed
// forwarder and starts the re-announce. A typed code is the fallback.
//
// createLaptopLink() is the DOM-free flow (unit-tested with a fake chime and a
// fake relay); mountLaptopLinkUi() is the thin phone UI on top of it.

import { createChimeListener, type ChimeListener } from '../ux/pairingChime';
import { joinPhoneSession, type PhoneGuestJoinResult, type PhoneSessionDeps } from './phoneGuestJoin';
import { loadPhonePair, type StorageLike } from '../relay/pairingStore';
import type { ControlSnapshot } from '../relay/controlSnapshot';
import type { PhoneAiForwarder } from './phoneAiFeed';
import type { PhonePlatform } from './screenLayout';

export type LinkState = 'idle' | 'listening' | 'joining' | 'connected' | 'error' | 'sim';

export const LINK_LINES = {
  idle: 'Not connected to a laptop.',
  listening: 'Listening for the laptop chime… Hold this phone near the laptop. The microphone stays on this phone.',
  heard: 'Heard the chime — joining…',
  typed: 'Joining…',
  connected: 'Connected to laptop ✓',
  needsNetwork: 'Needs the network to join the laptop room.',
  noRoom: 'Heard a code, but no laptop room is waiting. Play the chime again on the laptop.',
  badCode: 'Could not read that code. Tap Join laptop to listen again, or type the code.',
  micDenied: 'Microphone permission is off, so this phone cannot hear the chime. Type the code from the laptop instead.',
  micUnsupported: 'This phone cannot open a microphone here. Type the code from the laptop instead.',
  savedFailed: "Couldn't reach the laptop. Tap Join laptop to pair again.",
  sim: 'Pairing needs a real laptop session. Open the app without ?sim=1 and play the chime on the laptop.',
} as const;

export interface LaptopLinkDeps {
  storage: StorageLike | null;
  platform: PhonePlatform;
  native: boolean;
  sim?: boolean;
  aiForwarder?: Pick<PhoneAiForwarder, 'bind'>;
  /** A board the laptop sent to this phone. */
  onSnapshot(snap: ControlSnapshot): void;
  onChange?(s: { state: LinkState; message: string }): void;
  /** Injectables (tests): the chime listener, the join, and join extras such as a fake transport. */
  createListener?: (opts: Parameters<typeof createChimeListener>[0]) => ChimeListener;
  join?: (deps: PhoneSessionDeps) => Promise<PhoneGuestJoinResult>;
  joinExtras?: Partial<PhoneSessionDeps>;
}

export interface LaptopLink {
  state(): LinkState;
  message(): string;
  /** Tap "Join laptop": open the mic (only now) and listen for the chime. */
  startJoin(): Promise<void>;
  /** A decoded chime code, or the typed fallback. */
  joinWithCode(code: string, typed?: boolean): Promise<void>;
  /** Stop listening (the panel was closed). */
  cancel(): void;
  /** Rejoin a remembered pair without opening the mic. */
  rejoinSaved(): Promise<boolean>;
  stop(): Promise<void>;
}

export function createLaptopLink(deps: LaptopLinkDeps): LaptopLink {
  const makeListener = deps.createListener ?? createChimeListener;
  const join = deps.join ?? joinPhoneSession;
  let state: LinkState = deps.sim ? 'sim' : 'idle';
  let message: string = deps.sim ? LINK_LINES.sim : LINK_LINES.idle;
  let listener: ChimeListener | null = null;
  let current: { stop(): Promise<void> } | null = null;
  let attempt = 0;

  const set = (s: LinkState, m: string): void => {
    state = s; message = m;
    deps.onChange?.({ state, message });
  };
  const stopListening = (): void => { listener?.stop(); listener = null; };

  async function connect(code: string, joiningLine: string, failLine?: string): Promise<boolean> {
    const mine = ++attempt;
    set('joining', joiningLine);
    const prev = current;
    current = null;
    await prev?.stop();
    const res = await join({
      code,
      storage: deps.storage,
      platform: deps.platform,
      native: deps.native,
      hubName: 'the laptop',
      aiForwarder: deps.aiForwarder,
      ...deps.joinExtras,
    });
    if (mine !== attempt) { if (!('error' in res)) void res.stop(); return false; }
    if ('error' in res) {
      set('error', failLine ?? (res.error === 'needs network' ? LINK_LINES.needsNetwork
        : res.error === 'room not found' ? LINK_LINES.noRoom : LINK_LINES.badCode));
      return false;
    }
    res.session.onSnapshot((snap) => deps.onSnapshot(snap));
    current = res;
    set('connected', LINK_LINES.connected);
    return true;
  }

  return {
    state: () => state,
    message: () => message,
    async startJoin() {
      if (deps.sim) { set('sim', LINK_LINES.sim); return; }
      stopListening();
      const l = makeListener({
        onCode: (code) => { stopListening(); void connect(code, LINK_LINES.heard); },
        onError: (reason) => set('error', reason === 'denied' ? LINK_LINES.micDenied : LINK_LINES.micUnsupported),
      });
      listener = l;
      set('listening', LINK_LINES.listening);
      const r = await l.start();
      if (listener !== l) return;
      if (r === 'denied') set('error', LINK_LINES.micDenied);
      else if (r === 'unsupported') set('error', LINK_LINES.micUnsupported);
    },
    async joinWithCode(code, typed = true) {
      if (deps.sim) { set('sim', LINK_LINES.sim); return; }
      stopListening();
      await connect(code.trim(), typed ? LINK_LINES.typed : LINK_LINES.heard);
    },
    cancel() {
      stopListening();
      if (state === 'listening') set('idle', LINK_LINES.idle);
    },
    async rejoinSaved() {
      if (deps.sim) return false;
      const saved = loadPhonePair(deps.storage);
      if (!saved?.token) return false;
      return connect(saved.token, LINK_LINES.typed, LINK_LINES.savedFailed);
    },
    async stop() {
      attempt++;
      stopListening();
      const prev = current;
      current = null;
      await prev?.stop();
    },
  };
}

/** The phone UI: an empty-state "Join laptop" prompt while not connected, a
 *  small persistent Laptop pill (the phone shell hides the tools menu), and a
 *  join panel with the status line and the typed-code fallback. */
export function mountLaptopLinkUi(root: HTMLElement, link: LaptopLink, opts: { sim?: boolean } = {}): { update(): void; destroy(): void } {
  const doc = root.ownerDocument;
  const prompt = doc.createElement('div');
  prompt.className = 'mc-join-prompt';
  prompt.innerHTML = `<p class="mc-join-prompt-text">${LINK_LINES.idle}</p>
    <button type="button" class="mc-btn mc-join-btn" data-join-laptop>Join laptop</button>`;
  const pill = doc.createElement('button');
  pill.type = 'button';
  pill.className = 'mc-btn mc-join-pill';
  pill.dataset.joinLaptop = '';
  pill.textContent = 'Join laptop';
  const panel = doc.createElement('div');
  panel.className = 'mc-join-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Join laptop');
  panel.hidden = true;
  panel.innerHTML = `<p class="mc-join-status" role="status" aria-live="polite"></p>
    <details class="mc-join-code"><summary>Type the code instead</summary>
      <form class="mc-join-code-form"><input class="mc-join-code-in" aria-label="Code shown on the laptop" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" spellcheck="false">
      <button type="submit" class="mc-btn">Join</button></form></details>
    <button type="button" class="mc-btn mc-join-close">Close</button>`;
  root.append(prompt, pill, panel);
  const status = panel.querySelector<HTMLElement>('.mc-join-status')!;
  let hideTimer = 0;

  const update = (): void => {
    const s = link.state();
    status.textContent = link.message();
    prompt.hidden = opts.sim === true || !(s === 'idle' || s === 'error') || !panel.hidden;
    pill.textContent = s === 'connected' ? 'Laptop ✓' : 'Join laptop';
    if (s === 'connected' && !panel.hidden) {
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => { panel.hidden = true; update(); }, 2500);
    }
  };
  const openPanel = (): void => { clearTimeout(hideTimer); panel.hidden = false; update(); };

  const onClick = (e: Event): void => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-join-laptop]')) { openPanel(); void link.startJoin().then(update); return; }
    if (t.closest('.mc-join-close')) { link.cancel(); panel.hidden = true; update(); }
  };
  const onSubmit = (e: Event): void => {
    if (!(e.target as HTMLElement).closest('.mc-join-code-form')) return;
    e.preventDefault();
    const input = panel.querySelector<HTMLInputElement>('.mc-join-code-in');
    const code = input?.value.trim() ?? '';
    if (code) { openPanel(); void link.joinWithCode(code, true).then(update); }
  };
  prompt.addEventListener('click', onClick);
  pill.addEventListener('click', onClick);
  panel.addEventListener('click', onClick);
  panel.addEventListener('submit', onSubmit);
  update();
  return {
    update,
    destroy() {
      clearTimeout(hideTimer);
      prompt.remove(); pill.remove(); panel.remove();
    },
  };
}
