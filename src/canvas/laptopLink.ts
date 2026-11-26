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
import type { PairState } from '../relay/protocol';
import type { GuestSession } from '../relay/session';

/** The bit of the guest session iPhone sensing needs. */
export type PhoneGuestSessionLike = Pick<GuestSession, 'sendCommand'> & Partial<Pick<GuestSession, 'onSensePoint' | 'onGimbalCue' | 'onGimbalMode' | 'hostSid'>>;

/** reconnecting: joined the room, but the laptop has not answered a ping. */
export type LinkState = 'idle' | 'listening' | 'joining' | 'connected' | 'reconnecting' | 'error' | 'sim';

/** "Laptop ✓" needs proof: the laptop must echo a ping within this long. */
export const PING_TIMEOUT_MS = 5000;
/** While connected, prove it again this often. */
export const PING_EVERY_MS = 15_000;

/** Stop listening for the chime after this long (mic closed, plain message). */
export const LISTEN_TIMEOUT_MS = 60_000;
/** How long a failed saved-pair rejoin's message shows before resetting. */
export const SAVED_FAIL_SHOW_MS = 8_000;

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
  timeout: "Didn't hear the laptop chime. Tap Join laptop to listen again, or type the code.",
  lost: 'Lost the laptop connection. Tap Join laptop to reconnect.',
  reconnecting: 'Laptop — reconnecting…',
  already: 'Already connected to this laptop.',
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
  /** The live guest session (null when it closes) — iPhone sensing uses it to
   *  answer the laptop's point request and to re-announce its status. */
  onSession?(session: PhoneGuestSessionLike | null): void;
  onChange?(s: { state: LinkState; message: string }): void;
  /** Injectables (tests): the chime listener, the join, join extras such as a
   *  fake transport, and timers. */
  createListener?: (opts: Parameters<typeof createChimeListener>[0]) => ChimeListener;
  join?: (deps: PhoneSessionDeps) => Promise<PhoneGuestJoinResult>;
  joinExtras?: Partial<PhoneSessionDeps>;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (id: unknown) => void;
}

export interface LaptopLink {
  state(): LinkState;
  message(): string;
  /** Tap "Join laptop": open the mic (only now) and listen for the chime. */
  startJoin(): Promise<void>;
  /** A decoded chime code, or the typed fallback. */
  joinWithCode(code: string, typed?: boolean): Promise<void>;
  /** Stop listening (panel closed / app backgrounded); a connected session stays. */
  cancel(): void;
  /** Rejoin a remembered pair without opening the mic. */
  rejoinSaved(): Promise<boolean>;
  /** Foreground again / restored from bfcache: rejoin a remembered pair if it
   *  is not connected (never opens the mic). */
  resume(): Promise<boolean>;
  stop(): Promise<void>;
}

export function createLaptopLink(deps: LaptopLinkDeps): LaptopLink {
  const makeListener = deps.createListener ?? createChimeListener;
  const join = deps.join ?? joinPhoneSession;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let state: LinkState = deps.sim ? 'sim' : 'idle';
  let message: string = deps.sim ? LINK_LINES.sim : LINK_LINES.idle;
  let listener: ChimeListener | null = null;
  let listenTimer: unknown = null;
  let resetTimer: unknown = null;
  let current: { stop(opts?: { silent?: boolean }): Promise<void> } | null = null;
  let attempt = 0;
  let stopProof: () => void = () => undefined;
  let pingSeq = 0;
  /** A new join is being tried while a working link is kept: that link goes
   *  on proving itself, but does not touch the status line meanwhile. */
  let swapping = false;
  /** What the live session's proof last showed (null: no working link). The
   *  status line can be showing something else meanwhile — listening for a
   *  chime, a mic error — without the link being any less there. */
  let linkUp: 'connected' | 'reconnecting' | null = null;
  const linkLine = (): string => (linkUp === 'reconnecting' ? LINK_LINES.reconnecting : LINK_LINES.connected);
  /** A mic/listen problem while a link is up: say it, keep showing the link. */
  const setProblem = (line: string): void => { if (linkUp) set(linkUp, line); else set('error', line); };

  const set = (s: LinkState, m: string): void => {
    if (resetTimer !== null) { clearTimer(resetTimer); resetTimer = null; }
    state = s; message = m;
    deps.onChange?.({ state, message });
  };
  const stopListening = (): void => {
    if (listenTimer !== null) { clearTimer(listenTimer); listenTimer = null; }
    listener?.stop();
    listener = null;
  };

  async function connect(code: string, joiningLine: string, failLine?: string): Promise<boolean> {
    const mine = ++attempt;
    swapping = false;
    const prev = current;
    // A link that works is kept until the new join is in: retyping the code
    // on a connected phone (or a code the laptop has already retired) must
    // never drop it.
    const keep = !!prev && linkUp !== null;
    const before = { stopProof };
    if (keep) swapping = true;
    else { stopProof(); current = null; linkUp = null; }
    // While a working link is kept the pill stays what it is (✓): only the
    // line says a join is being tried.
    if (keep && linkUp) set(linkUp, joiningLine); else set('joining', joiningLine);
    if (!keep) await prev?.stop();
    let self: object | null = null;
    // "Laptop ✓" is shown only on proof: the laptop echoed this phone's ping
    // within PING_TIMEOUT_MS. Joining the room proves nothing (the room holds
    // old messages, and a laptop whose listener went quiet still looks paired).
    let live = false;
    let proveNow: () => void = () => undefined;
    let pauseProof: () => void = () => undefined;
    const onState = (st: PairState): void => {
      if (!live || current !== self || swapping) return;
      // The laptop said bye (or the listener dropped): the link is lost, but
      // this session stays in the room, so a laptop that comes back — a new
      // host session after a reload — is followed without a new chime.
      if (st === 'gone' || st === 'disconnected') { pauseProof(); linkUp = null; set('error', LINK_LINES.lost); }
      // The laptop said hello again: ask for proof right away.
      else if (st === 'paired' && state !== 'connected') proveNow();
    };
    const res = await join({
      code,
      storage: deps.storage,
      platform: deps.platform,
      native: deps.native,
      hubName: 'the laptop',
      aiForwarder: deps.aiForwarder,
      isCurrent: () => mine === attempt,
      onState,
      ...deps.joinExtras,
    });
    if (mine !== attempt) { if (!('error' in res)) void res.stop(); return false; }
    if ('error' in res) {
      if (keep && current === prev) {
        // The working link stays. A code that no longer resolves was retired
        // because this phone already proved itself to that laptop.
        swapping = false;
        set(linkUp ?? 'connected', res.error === 'room not found' ? LINK_LINES.already
          : res.error === 'needs network' ? LINK_LINES.needsNetwork : LINK_LINES.badCode);
        return false;
      }
      set('error', failLine ?? (res.error === 'needs network' ? LINK_LINES.needsNetwork
        : res.error === 'room not found' ? LINK_LINES.noRoom : LINK_LINES.badCode));
      return false;
    }
    if (keep && prev) {
      // The new session is in: retire the old one. In the same room it leaves
      // without a bye — this phone never left, so the laptop is not told so.
      swapping = false;
      before.stopProof();
      linkUp = null;
      void prev.stop({ silent: (prev as { roomId?: string }).roomId === res.roomId });
    }
    res.session.onSnapshot((snap) => deps.onSnapshot(snap));
    current = res;
    self = res;
    deps.onSession?.(res.session);
    live = true;
    const s = res.session as Partial<Pick<GuestSession, 'ping' | 'onPong'>>;
    if (typeof s.ping !== 'function' || typeof s.onPong !== 'function') {
      // A session with no proof channel (a stand-in): trust the join.
      set('connected', LINK_LINES.connected);
      return true;
    }
    let wait: { nonce: string; timer: unknown } | null = null;
    let next: unknown = null;
    let dead = false;
    let proved = false;
    /** Lost: no pinging until the laptop is heard again (onState 'paired'). */
    let paused = false;
    const mineLive = (): boolean => !dead && current === res;
    const sendPing = (): void => {
      next = null;
      if (!mineLive() || wait || paused) return;
      const nonce = `p${Date.now().toString(36)}-${++pingSeq}`;
      const timer = setTimer(() => {
        if (wait?.nonce !== nonce) return;
        wait = null;
        if (!mineLive()) return;
        // No answer in time: say so, and keep asking.
        linkUp = 'reconnecting';
        if (state !== 'error' && state !== 'listening' && !swapping) set('reconnecting', LINK_LINES.reconnecting);
        sendPing();
      }, PING_TIMEOUT_MS);
      wait = { nonce, timer };
      void s.ping!(nonce).catch(() => undefined);
    };
    s.onPong!((nonce) => {
      if (!wait || wait.nonce !== nonce || !mineLive()) return;
      clearTimer(wait.timer);
      wait = null;
      linkUp = 'connected';
      // This session's first proof always says so (it may have taken over
      // from an older one whose line is still showing).
      if ((!proved || state !== 'connected') && state !== 'listening' && !swapping) set('connected', LINK_LINES.connected);
      proved = true;
      if (next !== null) clearTimer(next);
      next = setTimer(sendPing, PING_EVERY_MS);
    });
    proveNow = (): void => {
      paused = false;
      if (next !== null) { clearTimer(next); next = null; }
      sendPing();
    };
    pauseProof = (): void => {
      paused = true;
      if (wait) { clearTimer(wait.timer); wait = null; }
      if (next !== null) { clearTimer(next); next = null; }
    };
    stopProof = (): void => {
      dead = true;
      if (wait) { clearTimer(wait.timer); wait = null; }
      if (next !== null) { clearTimer(next); next = null; }
    };
    sendPing();
    return true;
  }

  async function rejoinSaved(): Promise<boolean> {
    if (deps.sim) return false;
    const saved = loadPhonePair(deps.storage);
    if (!saved?.token) return false;
    const ok = await connect(saved.token, LINK_LINES.typed, LINK_LINES.savedFailed);
    if (!ok && state === 'error' && message === LINK_LINES.savedFailed) {
      // Show why, then fall back to the plain "not connected" prompt.
      resetTimer = setTimer(() => {
        resetTimer = null;
        if (message === LINK_LINES.savedFailed) set('idle', LINK_LINES.idle);
      }, SAVED_FAIL_SHOW_MS);
    }
    return ok;
  }

  return {
    state: () => state,
    message: () => message,
    async startJoin() {
      if (deps.sim) { set('sim', LINK_LINES.sim); return; }
      stopListening();
      const l = makeListener({
        onCode: (code) => { stopListening(); void connect(code, LINK_LINES.heard); },
        onError: (reason) => {
          if (listener === l) setProblem(reason === 'denied' ? LINK_LINES.micDenied : LINK_LINES.micUnsupported);
        },
      });
      listener = l;
      set('listening', LINK_LINES.listening);
      listenTimer = setTimer(() => {
        listenTimer = null;
        if (listener !== l) return;
        stopListening();
        setProblem(LINK_LINES.timeout);
      }, LISTEN_TIMEOUT_MS);
      const r = await l.start();
      // Cancelled (or restarted) while the mic permission prompt was up.
      if (listener !== l) { l.stop(); return; }
      if (r === 'denied' || r === 'unsupported') {
        stopListening();
        setProblem(r === 'denied' ? LINK_LINES.micDenied : LINK_LINES.micUnsupported);
      }
    },
    async joinWithCode(code, typed = true) {
      if (deps.sim) { set('sim', LINK_LINES.sim); return; }
      stopListening();
      await connect(code.trim(), typed ? LINK_LINES.typed : LINK_LINES.heard);
    },
    cancel() {
      const wasListening = listener !== null;
      stopListening();
      // Back to what the link really is (still connected, if it was).
      if (wasListening && state === 'listening') { if (linkUp) set(linkUp, linkLine()); else set('idle', LINK_LINES.idle); }
    },
    rejoinSaved,
    async resume() {
      if (deps.sim || state === 'connected' || state === 'reconnecting' || state === 'joining' || state === 'listening') return false;
      return rejoinSaved();
    },
    async stop() {
      attempt++;
      stopProof();
      linkUp = null;
      stopListening();
      const prev = current;
      current = null;
      // Not connected any more, so a later resume() (pageshow) rejoins.
      if (!deps.sim && state !== 'idle') set('idle', LINK_LINES.idle);
      if (prev) deps.onSession?.(null);
      await prev?.stop();
    },
  };
}

/** The phone UI: an empty-state "Join laptop" prompt while not connected
 *  (dismissable, and gone once a board is on screen), a small persistent
 *  Laptop pill (the phone shell hides the tools menu), and a join panel with
 *  the status line and the typed-code fallback. */
export function mountLaptopLinkUi(
  root: HTMLElement,
  link: LaptopLink,
  opts: { sim?: boolean; hasBoard?: () => boolean } = {},
): { update(): void; destroy(): void } {
  const doc = root.ownerDocument;
  const prompt = doc.createElement('div');
  prompt.className = 'mc-join-prompt';
  prompt.innerHTML = `<p class="mc-join-prompt-text"></p>
    <button type="button" class="mc-btn mc-join-btn" data-join-laptop>Join laptop</button>
    <button type="button" class="mc-join-dismiss" aria-label="Dismiss">×</button>`;
  const promptText = prompt.querySelector<HTMLElement>('.mc-join-prompt-text')!;
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
  let dismissed = false;

  const update = (): void => {
    const s = link.state();
    status.textContent = link.message();
    promptText.textContent = link.message();
    prompt.hidden = opts.sim === true || dismissed || !(s === 'idle' || s === 'error')
      || !panel.hidden || (opts.hasBoard?.() ?? false);
    pill.textContent = s === 'connected' ? 'Laptop ✓' : s === 'reconnecting' ? LINK_LINES.reconnecting : 'Join laptop';
    pill.classList.toggle('is-reconnecting', s === 'reconnecting');
    if (s === 'connected' && !panel.hidden) {
      clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => { panel.hidden = true; update(); }, 2500);
    }
  };
  const openPanel = (): void => { clearTimeout(hideTimer); panel.hidden = false; update(); };

  const onClick = (e: Event): void => {
    const t = e.target as HTMLElement;
    if (t.closest('.mc-join-dismiss')) { dismissed = true; update(); return; }
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
  // A board appearing (a local turn or one sent from the laptop) hides the prompt.
  const world = root.querySelector('.mc-world');
  const observer = world && typeof MutationObserver !== 'undefined' ? new MutationObserver(() => update()) : null;
  if (observer && world) observer.observe(world, { childList: true });
  update();
  return {
    update,
    destroy() {
      clearTimeout(hideTimer);
      observer?.disconnect();
      prompt.remove(); pill.remove(); panel.remove();
    },
  };
}
