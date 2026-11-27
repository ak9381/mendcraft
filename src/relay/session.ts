// Pairing sessions over an injected RelayTransport. The host (laptop) owns a
// room token and waits; the guest (phone) joins via token or short code. Both
// sides run the same pure state machine (protocol.advancePair) and only react
// to messages from the OTHER role, so echoed self-messages are harmless.

import {
  advancePair,
  createCueLimiter,
  createModeLimiter,
  cryptoRandom,
  isSessionId,
  parsePing,
  parseAttention,
  isAttentionWho,
  ATTENTION_MIN_GAP_MS,
  type AttentionWho,
  GIMBAL_CUE_RECEIVE_GAP_MS,
  isGimbalCue,
  isGimbalMode,
  type GimbalModeKind,
  type GimbalCueKind,
  generateRoomToken,
  generatePairCode,
  type MusicStatus,
  type PairState,
  type RandomBytes,
  type RelayCommand,
  type RelayMessage,
  type RelayRole,
  type RelayRunControl,
  type RelayRunRequest,
  type RelayRunStatus,
  type PrivacyAsk,
  type PrivacyReply,
} from './protocol';
import { coerceSnapshot, markReplay, type ControlSnapshot } from './controlSnapshot';
import type { RelayMeta, RelayTransport } from './transport';

export interface RelayFrame {
  mimeType: string;
  dataBase64: string;
}

interface SessionBase {
  state(): PairState;
  onState(cb: (state: PairState) => void): void;
  /** Publish 'bye' and stop listening. Safe to call twice. */
  close(opts?: { silent?: boolean }): Promise<void>;
}

export interface HostSession extends SessionBase {
  readonly token: string;
  /** The short code of the CURRENT admission window: its own random secret
   *  (never derived from the token), new each time a window opens. */
  readonly code: string;
  onCommand(cb: (cmd: RelayCommand) => void): void;
  onFrame(cb: (frame: RelayFrame) => void): void;
  /** The phone's latest music-player state (for the /control dashboard). */
  onMusic(cb: (music: MusicStatus) => void): void;
  /** Publish the latest privacy-safe state to the room for any /control dashboard. */
  publishState(snapshot: ControlSnapshot): Promise<void>;
  /** A "run this recipe" request from a /control dashboard (or phone). */
  onRun(cb: (run: RelayRunRequest) => void): void;
  /** A confirm/cancel for a run that stopped on a send/submit step. */
  onRunControl(cb: (control: RelayRunControl) => void): void;
  /** Publish live run status back to the room (what step, awaiting-confirm…). */
  publishRunStatus(status: RelayRunStatus): Promise<void>;
  /** A phone without Nano sent a prompt for the hub to clean, then Gemini. */
  onPrivacyAsk(cb: (ask: PrivacyAsk) => void): void;
  /** Return a filled, cleaned answer (and the route line + byte count). */
  sendPrivacyReply(reply: PrivacyReply): Promise<void>;
  /** This host session's id (new on every page load). A phone echoes it in
   *  its announce, so an announce replayed from the room's history — or meant
   *  for an earlier session — can be told from a live one. */
  readonly sid: string;
  /** Ask every phone still in the room to announce itself again (carries `sid`). */
  askWhoIsThere(): Promise<void>;
  /** Which device she is facing right now (read when a pong goes out — the
   *  phones learn it from the pong they already get; no new command). */
  setAttention?(get: () => AttentionWho): void;
  /** Push who she faces to the phones now ('attention'; only on a change,
   *  ≥ ATTENTION_MIN_GAP_MS apart — the latest value always goes out). */
  sendAttention?(who: AttentionWho): void;
  /** Ask the phone of `platform` to take the point-to-connect photo. */
  askSensePoint(platform: 'ios' | 'android'): Promise<void>;
  /** Ask the phones to play a DockKit body-language move (an allow-listed word,
   *  no user content). At most one per GIMBAL_CUE_MIN_GAP_MS (a 'no' right
   *  after a 'yes' may follow at once): resolves false when dropped by the rate
   *  limit or not paired, true once published. A failed publish rejects and
   *  does not start a gap. */
  sendGimbalCue(kind: GimbalCueKind): Promise<boolean>;
  /** Open the short code again so MORE phones can join this same session
   *  (re-running "connect devices"): phones already here keep their link and
   *  this session id. The code stays open until endAdmission() or
   *  ALIAS_TTL_MS, whichever is first; a ping from a paired phone does not
   *  close it meanwhile. */
  admitMore(): Promise<void>;
  /** Close the short code now (pairing is over). */
  endAdmission(): Promise<void>;
  /** Ask the docked iPhone to switch gimbal mode (an allow-listed word, no
   *  user content). Resolves false when not paired, true once published. */
  sendGimbalMode(mode: GimbalModeKind): Promise<boolean>;
}

/** Read-only-ish /control dashboard view: it reads snapshots, and can REQUEST a run
 *  (which still needs a confirm on the target for anything that sends). */
export interface ControlSession extends SessionBase {
  readonly roomId: string;
  onSnapshot(cb: (snapshot: ControlSnapshot) => void): void;
  onRunStatus(cb: (status: RelayRunStatus) => void): void;
  /** Ask the owning device to run a recipe. */
  sendRun(run: RelayRunRequest): Promise<void>;
  /** Approve / reject a confirm-gated step on the target device. */
  sendRunControl(control: RelayRunControl): Promise<void>;
}

export interface GuestSession extends SessionBase {
  readonly roomId: string;
  sendCommand(cmd: RelayCommand): Promise<void>;
  sendFrame(frame: RelayFrame): Promise<void>;
  sendMusic(music: MusicStatus): Promise<void>;
  /** Receive the host's privacy-safe state snapshots (board/layout/transfer live
   *  here too). Coerced before the callback — the phone treats it as untrusted.
   *  `buffered`: the newest snapshot replayed to a callback wired late (not
   *  one that just arrived). */
  onSnapshot(cb: (snapshot: ControlSnapshot, meta?: { buffered?: boolean }) => void): void;
  /** Send a raw prompt to the desktop hub; resolves with the filled reply. */
  sendPrivacyAsk(ask: PrivacyAsk, timeoutMs?: number): Promise<PrivacyReply>;
  /** The host asked phones to announce themselves again ('whoIsThere'). */
  onWhoIsThere(cb: () => void): void;
  /** Round-trip proof that the laptop hears this phone: send a one-time
   *  nonce; the host's echo arrives through onPong. */
  ping(nonce: string): Promise<void>;
  onPong(cb: (nonce: string) => void): void;
  /** The host session id last learned (from a pong or a whoIsThere); null before. */
  hostSid(): string | null;
  /** The device she was facing per the host's last pong, and when it came. */
  attention?(): { who: AttentionWho; at: number } | null;
  /** The host pushed a new attention value. */
  onAttention?(cb: () => void): void;
  /** The host asked this phone to take the point-to-connect photo. */
  onSensePoint(cb: (platform: string) => void): void;
  /** The host asked for a gimbal body-language move (validated, rate-limited). */
  onGimbalCue(cb: (kind: GimbalCueKind) => void): void;
  /** The host asked for a gimbal mode switch (validated). */
  onGimbalMode(cb: (mode: GimbalModeKind) => void): void;
}

/** Messages held while a session does not yet know its own start time. */
const HELD_MAX = 500;
/** A start marker that could not be time-stamped is re-sent after this long,
 *  doubling up to the max (messages keep waiting meanwhile — never guessed). */
export const START_MARK_RETRY_MS = 3000;
export const START_MARK_RETRY_MAX_MS = 30_000;

function makeCore(role: RelayRole, transport: RelayTransport, roomId: string) {
  let state: PairState = 'idle';
  let stateCb: ((s: PairState) => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;
  // A room keeps every message ever sent and replays them all to a new
  // listener (a laptop reload, a phone rejoin). Nothing older than THIS
  // session may act: an old "turn off the lamp", an old bye, an old gimbal
  // cue. The session's start is the SERVER time of its own first message (no
  // device clock involved); until that is known, messages wait.
  //   undefined — not known yet (hold); null — the transport has no server
  //   clock (nothing to compare: deliver).
  let startAt: number | null | undefined;
  let held: Array<{ msg: RelayMessage; meta?: RelayMeta }> = [];
  let onPeerCb: ((msg: RelayMessage) => void) | null = null;
  let tellStart: (at: number | null) => void = () => undefined;
  const startKnown = new Promise<number | null>((resolve) => { tellStart = resolve; });
  const isOld = (meta?: RelayMeta): boolean => typeof startAt === 'number' && typeof meta?.at === 'number' && meta.at < startAt;

  function setState(next: PairState): void {
    if (next === state) return;
    state = next;
    stateCb?.(next);
  }

  return {
    get state() {
      return state;
    },
    setState,
    onState(cb: (s: PairState) => void) {
      stateCb = cb;
      cb(state);
    },
    /** Nothing is exempt, the join handshake included: an old hello is not a
     *  phone in the room. (Whoever IS there answers this session's own first
     *  message — the laptop's whoIsThere, a phone's hello — with a new one.) */
    listen(onPeer: (msg: RelayMessage) => void) {
      onPeerCb = onPeer;
      unsubscribe = transport.subscribe(
        roomId,
        (msg, meta) => {
          if (msg.from === role) return; // own echo
          if (startAt === undefined) {
            held.push({ msg, meta });
            if (held.length > HELD_MAX) held.shift();
            return;
          }
          if (isOld(meta)) return; // history: never acts
          onPeer(msg);
        },
        () => setState(advancePair(state, 'listen-error')),
        startKnown,
      );
      setState(advancePair(state, 'create'));
    },
    /** The session's start is known: drop what is older, deliver the rest. */
    setStart(at: number | null) {
      if (startAt !== undefined) return;
      startAt = at;
      tellStart(at);
      const waiting = held;
      held = [];
      for (const h of waiting) if (!isOld(h.meta)) onPeerCb?.(h.msg);
    },
    /** Learn the start from a stamped send; re-send while the server time
     *  could not be read (never guess: history must not act). */
    async markStart(send: () => Promise<void | RelayMeta>, first?: void | RelayMeta | Promise<void | RelayMeta>) {
      let receipt: void | RelayMeta | null = null;
      try { receipt = first === undefined ? await send() : await first; } catch { receipt = { at: null }; }
      for (let wait = START_MARK_RETRY_MS; ; wait = Math.min(wait * 2, START_MARK_RETRY_MAX_MS)) {
        if (closed || startAt !== undefined) return;
        if (!receipt) { this.setStart(null); return; }
        if (receipt.at !== null) { this.setStart(receipt.at); return; }
        await new Promise((r) => setTimeout(r, wait));
        if (closed) return;
        try { receipt = await send(); } catch { receipt = { at: null }; }
      }
    },
    isClosed: () => closed,
    /** `silent`: leave without a bye (this device stays in the room through
     *  another session, so nobody should be told it left). */
    async close(opts: { silent?: boolean } = {}) {
      if (closed) return;
      closed = true;
      held = [];
      unsubscribe?.();
      unsubscribe = null;
      if (!opts.silent) {
        try {
          await transport.publish(roomId, { v: 1, from: role, type: 'bye' });
        } catch {
          // Transport already gone (offline, room deleted) — closing anyway.
        }
      }
      setState(advancePair(state, 'close'));
    },
  };
}

/** Pings that do not name this session: at most this many answers per gap
 *  (a phone rejoining right away is answered; a replayed history is not). */
export const UNSIGNED_PING_GAP_MS = 1500;
export const UNSIGNED_PING_BURST = 3;

/** How long the typable short code stays resolvable before it auto-expires,
 *  win or lose — the code is only 40 bits of entropy (brute-forceable in
 *  principle), so this bounds the window regardless of whether a phone ever
 *  joins. State-changing session actions always address the room by its
 *  full 24-char token, never the short code, once a session is established. */
export const ALIAS_TTL_MS = 5 * 60 * 1000;

/** Phone asks the laptop runs through Gemini (each costs quota): at most this
 *  many per PRIVACY_ASK_WINDOW_MS per host session, each jobId once. */
export const PRIVACY_ASK_MAX = 6;
export const PRIVACY_ASK_WINDOW_MS = 60_000;
const PRIVACY_JOBS_KEPT = 64;

export interface CreateHostOptions {
  /** Resume an EXISTING room token (e.g. one a remembered phone is still pointed
   *  at) instead of minting a fresh one. Must be a 24-char token; ignored
   *  otherwise. This is what lets a laptop reload keep remembered phones paired. */
  token?: string;
  /** Clock for the gimbal-cue rate limit (tests). */
  now?: () => number;
}

const RESUME_TOKEN_RE = /^[0-9A-Z]{24}$/;

/** Laptop side: create a room, wait for the phone, surface commands/frames. */
export async function createHostSession(
  transport: RelayTransport,
  random: RandomBytes = cryptoRandom,
  opts: CreateHostOptions = {},
): Promise<HostSession> {
  const token = opts.token && RESUME_TOKEN_RE.test(opts.token)
    ? opts.token
    : generateRoomToken(random);
  // The short code is a separate secret (crypto random, whatever `random` is):
  // the token can't be worked out from it, and it changes with each window.
  let code = generatePairCode();
  const core = makeCore('host', transport, token);
  const sid = Array.from(random(6), (b) => (b % 36).toString(36)).join('') + Date.now().toString(36);
  const now = opts.now ?? (() => Date.now());
  // Pings that name no (or another) session are first contact — or history
  // replayed on a reload: at most UNSIGNED_PING_BURST answers per UNSIGNED_PING_GAP_MS.
  let unsignedPongs: number[] = [];
  let attentionGet: (() => AttentionWho) | null = null;
  let attentionSent: AttentionWho | null = null;
  let attentionWant: AttentionWho | null = null;
  let attentionAt = -Infinity;
  let attentionTimer: ReturnType<typeof setTimeout> | null = null;
  const flushAttention = (): void => {
    attentionTimer = null;
    const who = attentionWant;
    if (!who || who === attentionSent || core.state !== 'paired') return;
    const wait = attentionAt + ATTENTION_MIN_GAP_MS - now();
    if (wait > 0) { attentionTimer = setTimeout(flushAttention, wait); return; }
    attentionSent = who; attentionAt = now();
    void transport.publish(token, { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'attention', text: JSON.stringify({ f: who, sid }) } })
      .catch(() => { attentionSent = null; });
  };
  let aliasCleared = false;
  /** admitMore() is holding the code open for another phone. */
  let admitting = false;
  async function clearAliasOnce(): Promise<void> {
    if (aliasCleared) return;
    aliasCleared = true;
    admitting = false;
    await transport.clearAlias(code).catch(() => undefined);
  }
  /** Open a window: a code that is still open is kept (the card shows it); a
   *  retired one is replaced by a new code — an old code never comes back. */
  function openWindow(): void {
    if (aliasCleared) code = generatePairCode();
    aliasCleared = false;
  }
  let aliasTimer = setTimeout(() => void clearAliasOnce(), ALIAS_TTL_MS);
  let commandCb: ((cmd: RelayCommand) => void) | null = null;
  let frameCb: ((frame: RelayFrame) => void) | null = null;
  let musicCb: ((music: MusicStatus) => void) | null = null;
  let runCb: ((run: RelayRunRequest) => void) | null = null;
  let runControlCb: ((control: RelayRunControl) => void) | null = null;
  let privacyAskCb: ((ask: PrivacyAsk) => void) | null = null;
  let privacyAskAt: number[] = [];
  const privacyJobs = new Set<string>();
  const cueLimiter = createCueLimiter(undefined, opts.now);
  let cueInflight = false;
  const modeLimiter = createModeLimiter(undefined, undefined, opts.now);
  let modeInflight = false;
  // The most recent snapshot, re-sent whenever a /control dashboard announces itself,
  // so a dashboard that joins late sees current state without waiting for the
  // next change. Pairing state is unaffected by control presence.
  let lastSnapshot: ControlSnapshot | null = null;

  // Only a snapshot the room ACCEPTED is kept for replay: a rejected one (too
  // big, rules) would just be rejected again on every hello.
  let publishSeq = 0;
  let keptSeq = 0;
  function publishState(snapshot: ControlSnapshot): Promise<void> {
    const seq = ++publishSeq;
    return transport.publish(token, { v: 1, from: 'host', type: 'state', snapshot }).then(() => {
      if (seq > keptSeq) { keptSeq = seq; lastSnapshot = snapshot; }
    });
  }

  core.listen((msg) => {
    // Run requests + confirms may come from a /control dashboard or the phone. They
    // don't touch phone-pairing state and are handled before the control
    // early-return below.
    if (msg.type === 'run') {
      runCb?.(msg.run);
      return;
    }
    if (msg.type === 'runControl') {
      runControlCb?.(msg.runControl);
      return;
    }
    if (msg.type === 'privacyAsk') {
      // Each ask spends Gemini quota on this laptop: only a phone paired in
      // this session (history never gets here — see makeCore), each job
      // once, and at most PRIVACY_ASK_MAX a minute. A dropped ask is not
      // answered (the phone times out and says so).
      if (core.state !== 'paired' || !privacyAskCb) return;
      if (privacyJobs.has(msg.ask.jobId)) return;
      const t = now();
      privacyAskAt = privacyAskAt.filter((at) => t - at < PRIVACY_ASK_WINDOW_MS);
      if (privacyAskAt.length >= PRIVACY_ASK_MAX) return;
      privacyAskAt.push(t);
      privacyJobs.add(msg.ask.jobId);
      if (privacyJobs.size > PRIVACY_JOBS_KEPT) privacyJobs.delete(privacyJobs.values().next().value as string);
      privacyAskCb(msg.ask);
      return;
    }
    if (msg.from === 'control') {
      // A read-only dashboard, not a remote: never changes pairing. Replay the
      // latest state so it populates immediately.
      if (msg.type === 'hello' && lastSnapshot) void publishState(markReplay(lastSnapshot)).catch(() => undefined);
      return;
    }
    if (msg.type === 'hello') {
      const wasPaired = core.state === 'paired';
      core.setState(advancePair(core.state, 'peer-hello'));
      // (Only a hello newer than this session gets here: replayed ones are
      // history, so a reload never acks or "pairs" a phone that is gone.)
      // ALWAYS ack a phone hello — even when already paired — so a SECOND phone
      // joining the same room flips to paired too (two phones share one room and
      // ignore each other's messages, so only the host can confirm the newcomer).
      void transport.publish(token, { v: 1, from: 'host', type: 'hello' }).catch(() => undefined);
      // The short-code alias is NOT cleared on a hello: after a reload the
      // room replays old hellos, which would kill the code before anyone
      // typed it. It goes on live proof (a ping naming this session, below)
      // or when its 5 minutes are up.
      void wasPaired;
      // Replay the latest state so a phone (freshly joined or reloaded) populates
      // its board/layout immediately — today this only happened for a control
      // hello, which stranded a late-joining phone until the next change.
      if (lastSnapshot) void publishState(markReplay(lastSnapshot)).catch(() => undefined);
    } else if (msg.type === 'bye') {
      core.setState(advancePair(core.state, 'peer-bye'));
    } else if (msg.type === 'cmd' && msg.cmd.kind === 'ping') {
      const ping = parsePing(msg.cmd.text);
      if (!ping) return;
      if (ping.sid !== sid) {
        unsignedPongs = unsignedPongs.filter((at) => now() - at < UNSIGNED_PING_GAP_MS);
        if (unsignedPongs.length >= UNSIGNED_PING_BURST) return;
        unsignedPongs.push(now());
      } else if (!admitting) {
        // Only a phone that heard THIS session can name it: the short-code
        // alias has done its job (unless it was re-opened for another phone).
        clearTimeout(aliasTimer);
        void clearAliasOnce();
      }
      // A live ping is as good as a hello: the phone is in the room.
      core.setState(advancePair(core.state, 'peer-hello'));
      const f = attentionGet?.();
      void transport.publish(token, { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'pong', text: JSON.stringify(f ? { n: ping.n, sid, f } : { n: ping.n, sid }) } })
        .catch(() => undefined);
    } else if (msg.type === 'cmd') {
      if (msg.cmd.kind === 'pong' || msg.cmd.kind === 'attention') return; // host → phone only
      if (core.state === 'paired') commandCb?.(msg.cmd);
    } else if (msg.type === 'frame') {
      if (core.state === 'paired') frameCb?.({ mimeType: msg.mimeType, dataBase64: msg.dataBase64 });
    } else if (msg.type === 'music') {
      if (core.state === 'paired') musicCb?.(msg.music);
    }
  });
  // This session starts at the server time of its own first message (which
  // also tells phones in the room its id): everything older in the room is
  // history and never acts.
  const whoMsg: RelayMessage = { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'whoIsThere', text: sid } };
  void core.markStart(() => (transport.publishStamped ? transport.publishStamped(token, whoMsg) : transport.publish(token, whoMsg)));
  await transport.setAlias(code, token);

  return {
    token,
    get code() { return code; },
    sid,
    setAttention: (get) => { attentionGet = get; },
    sendAttention: (who) => {
      if (!isAttentionWho(who)) return;
      attentionWant = who;
      if (!attentionTimer) flushAttention();
    },
    state: () => core.state,
    onState: (cb) => core.onState(cb),
    onCommand: (cb) => {
      commandCb = cb;
    },
    onFrame: (cb) => {
      frameCb = cb;
    },
    onMusic: (cb) => {
      musicCb = cb;
    },
    onRun: (cb) => {
      runCb = cb;
    },
    onRunControl: (cb) => {
      runControlCb = cb;
    },
    publishRunStatus: (status) =>
      transport.publish(token, { v: 1, from: 'host', type: 'runStatus', runStatus: status }),
    onPrivacyAsk: (cb) => {
      privacyAskCb = cb;
    },
    sendPrivacyReply: (reply) =>
      transport.publish(token, { v: 1, from: 'host', type: 'privacyReply', reply }),
    askWhoIsThere: () => transport.publish(token, whoMsg),
    askSensePoint: (platform) =>
      transport.publish(token, { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'sensePoint', text: JSON.stringify({ platform }) } }),
    sendGimbalCue: async (kind) => {
      if (!isGimbalCue(kind) || core.state !== 'paired') return false;
      if (cueInflight || !cueLimiter.ready(kind)) return false;
      // Stamp the gap only once the cue really went out: a failed publish
      // doesn't block the next cue.
      cueInflight = true;
      try {
        await transport.publish(token, { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'gimbalCue', text: kind } });
      } finally {
        cueInflight = false;
      }
      cueLimiter.mark(kind);
      return true;
    },
    sendGimbalMode: async (mode) => {
      if (!isGimbalMode(mode) || core.state !== 'paired') return false;
      // <= 1 per second, and the same mode again is a repeat: dropped.
      if (modeInflight || !modeLimiter.ready(mode)) return false;
      modeInflight = true;
      try {
        await transport.publish(token, { v: 1, from: 'host', type: 'cmd', cmd: { kind: 'gimbalMode', text: mode } });
      } finally {
        modeInflight = false;
      }
      modeLimiter.mark(mode);
      return true;
    },
    publishState,
    admitMore: async () => {
      if (core.isClosed()) return;
      clearTimeout(aliasTimer);
      openWindow();
      admitting = true;
      aliasTimer = setTimeout(() => void clearAliasOnce(), ALIAS_TTL_MS);
      await transport.setAlias(code, token);
      // A fresh host message vouches for the reopened code (resolveRoomId
      // only honours a code whose host spoke within ALIAS_TTL_MS).
      await transport.publish(token, whoMsg).catch(() => undefined);
    },
    endAdmission: async () => {
      clearTimeout(aliasTimer);
      await clearAliasOnce();
    },
    close: async () => {
      clearTimeout(aliasTimer);
      await clearAliasOnce();
      await core.close();
    },
  };
}

/** Phone side: join a known room token and publish commands/frames. */
export async function createGuestSession(
  transport: RelayTransport,
  roomId: string,
  opts: { now?: () => number } = {},
): Promise<GuestSession> {
  const core = makeCore('phone', transport, roomId);

  let snapshotCb: ((s: ControlSnapshot) => void) | null = null;
  let whoCb: (() => void) | null = null;
  let pongCb: ((nonce: string) => void) | null = null;
  let hostSid: string | null = null;
  let attention: { who: AttentionWho; at: number } | null = null;
  let attentionCb: (() => void) | null = null;
  /** Nonces this phone pinged with → the host sid each ping named. */
  const sentPings = new Map<string, string | null>();
  let senseCb: ((platform: string) => void) | null = null;
  let cueCb: ((kind: GimbalCueKind) => void) | null = null;
  let modeCb: ((mode: GimbalModeKind) => void) | null = null;
  // The receiver enforces its own gap (1.5 s, jitter-tolerant), whatever the sender does.
  const cueLimiter = createCueLimiter(GIMBAL_CUE_RECEIVE_GAP_MS, opts.now);
  // The phone gates modes too (same 1 s gap, repeats dropped), whatever the sender does.
  const modeLimiter = createModeLimiter(undefined, undefined, opts.now);
  // Buffer the newest snapshot so an onSnapshot() wired after the host's replay
  // still sees current state (same late-join contract as ControlSession).
  let lastSnapshot: ControlSnapshot | null = null;

  const pending = new Map<string, {
    resolve: (r: PrivacyReply) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();
  core.listen((msg) => {
    if (msg.type === 'hello') core.setState(advancePair(core.state, 'peer-hello'));
    // Only the laptop leaving ends this phone's link: another phone's (or a
    // dashboard's) bye in the same room says nothing about the laptop.
    else if (msg.type === 'bye' && msg.from === 'host') core.setState(advancePair(core.state, 'peer-bye'));
    else if (msg.type === 'state') {
      // Untrusted wire data: rebuild through coerceSnapshot before anyone reads
      // a field (board/layout/transfer included). A host 'state' also means the
      // laptop is live, so flip 'waiting' → 'paired' like a hello.
      const snap = coerceSnapshot(msg.snapshot);
      if (!snap) return;
      core.setState(advancePair(core.state, 'peer-hello'));
      lastSnapshot = snap;
      snapshotCb?.(snap);
    } else if (msg.type === 'cmd' && msg.from === 'host' && msg.cmd.kind === 'pong') {
      const pong = parsePing(msg.cmd.text);
      if (!pong) return;
      // Who she faces only from an answer to a ping THIS phone sent, signed
      // with the session that ping named — never a replayed / old pong.
      const sentSid = sentPings.get(pong.n);
      sentPings.delete(pong.n);
      if (pong.f && sentSid !== undefined && sentSid !== null && pong.sid === sentSid) {
        attention = { who: pong.f, at: Date.now() };
        attentionCb?.();
      }
      if (pong.sid) hostSid = pong.sid;
      pongCb?.(pong.n);
    } else if (msg.type === 'cmd' && msg.from === 'host' && msg.cmd.kind === 'attention') {
      // Pushed on a change: only from the session this phone already knows.
      const a = parseAttention(msg.cmd.text);
      if (!a || !hostSid || a.sid !== hostSid) return;
      attention = { who: a.f, at: Date.now() };
      attentionCb?.();
    } else if (msg.type === 'cmd' && msg.from === 'host' && msg.cmd.kind === 'whoIsThere') {
      if (isSessionId(msg.cmd.text)) hostSid = msg.cmd.text;
      // Say hello first: after another phone's bye the host sits in 'gone' and
      // ignores commands until a hello, so the re-announce would be dropped.
      void transport.publish(roomId, { v: 1, from: 'phone', type: 'hello' })
        .catch(() => undefined)
        .then(() => whoCb?.());
    } else if (msg.type === 'cmd' && msg.from === 'host' && msg.cmd.kind === 'sensePoint') {
      let platform = '';
      try { const o = JSON.parse(msg.cmd.text ?? '{}') as { platform?: unknown }; if (typeof o.platform === 'string') platform = o.platform; } catch { /* malformed */ }
      if (platform) senseCb?.(platform);
    } else if (msg.type === 'cmd' && msg.from === 'host' && msg.cmd.kind === 'gimbalCue') {
      const kind = msg.cmd.text;
      if (isGimbalCue(kind) && cueCb && cueLimiter.allow(kind)) cueCb(kind);
    } else if (msg.type === 'cmd' && msg.from === 'host' && msg.cmd.kind === 'gimbalMode') {
      const mode = msg.cmd.text;
      if (isGimbalMode(mode) && modeCb && modeLimiter.allow(mode)) modeCb(mode);
    } else if (msg.type === 'privacyReply') {
      const wait = pending.get(msg.reply.jobId);
      if (wait) {
        clearTimeout(wait.timer);
        pending.delete(msg.reply.jobId);
        wait.resolve(msg.reply);
      }
    }
  });
  // The phone's session starts at the server time of its own hello: an old
  // board, an old gimbal cue or an old point request in the room never acts.
  const helloMsg: RelayMessage = { v: 1, from: 'phone', type: 'hello' };
  const hello = (): Promise<void | RelayMeta> => (transport.publishStamped ? transport.publishStamped(roomId, helloMsg) : transport.publish(roomId, helloMsg));
  const first = await hello();
  if (first) void core.markStart(hello, first); else core.setStart(null);

  return {
    roomId,
    state: () => core.state,
    onState: (cb) => core.onState(cb),
    sendCommand: (cmd) => transport.publish(roomId, { v: 1, from: 'phone', type: 'cmd', cmd }),
    sendFrame: (frame) =>
      transport.publish(roomId, {
        v: 1, from: 'phone', type: 'frame', mimeType: frame.mimeType, dataBase64: frame.dataBase64,
      }),
    sendMusic: (music) =>
      transport.publish(roomId, { v: 1, from: 'phone', type: 'music', music }),
    onSnapshot: (cb) => {
      snapshotCb = cb;
      if (lastSnapshot) cb(lastSnapshot, { buffered: true });
    },
    onSensePoint: (cb) => {
      senseCb = cb;
    },
    onGimbalCue: (cb) => {
      cueCb = cb;
    },
    onGimbalMode: (cb) => {
      modeCb = cb;
    },
    onWhoIsThere: (cb) => {
      whoCb = cb;
    },
    ping: (nonce) => {
      sentPings.set(nonce, hostSid);
      if (sentPings.size > 16) sentPings.delete(sentPings.keys().next().value as string);
      return transport.publish(roomId, {
        v: 1, from: 'phone', type: 'cmd', cmd: { kind: 'ping', text: JSON.stringify(hostSid ? { n: nonce, sid: hostSid } : { n: nonce }) },
      });
    },
    onPong: (cb) => {
      pongCb = cb;
    },
    hostSid: () => hostSid,
    attention: () => attention,
    onAttention: (cb) => { attentionCb = cb; },
    sendPrivacyAsk: (ask, timeoutMs = 20000) =>
      new Promise<PrivacyReply>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(ask.jobId);
          reject(new Error('hub did not reply'));
        }, timeoutMs);
        pending.set(ask.jobId, { resolve, reject, timer });
        void transport.publish(roomId, { v: 1, from: 'phone', type: 'privacyAsk', ask }).catch((err) => {
          clearTimeout(timer);
          pending.delete(ask.jobId);
          reject(err);
        });
      }),
    close: async (opts?: { silent?: boolean }) => {
      // Reject outstanding privacyAsk waiters now — otherwise a mid-request
      // close() (e.g. remotePage's pagehide handler) leaves the caller
      // hanging for the full timeout instead of failing fast.
      for (const [jobId, wait] of pending) {
        clearTimeout(wait.timer);
        pending.delete(jobId);
        wait.reject(new Error('relay: session closed before the hub replied'));
      }
      await core.close(opts);
    },
  };
}

/** Optional /control dashboard side: subscribe to a host room and receive state snapshots.
 *  It announces presence (so the host replays its latest state) but never sends
 *  a command or a frame, and never flips the host's phone-pairing state. */
export async function createControlSession(
  transport: RelayTransport,
  roomId: string,
): Promise<ControlSession> {
  const core = makeCore('control', transport, roomId);
  let snapshotCb: ((s: ControlSnapshot) => void) | null = null;
  let runStatusCb: ((s: RelayRunStatus) => void) | null = null;
  // Buffer the newest snapshot so a callback registered after the host's replay
  // (the hello → republish round-trip can land before onSnapshot is wired) still
  // sees current state immediately — the same contract onState has.
  let lastSnapshot: ControlSnapshot | null = null;

  core.listen((msg) => {
    if (msg.type === 'state') {
      const snap = coerceSnapshot(msg.snapshot);
      if (!snap) return;
      // First snapshot flips 'waiting' → 'paired' (the laptop is live).
      core.setState(advancePair(core.state, 'peer-hello'));
      lastSnapshot = snap;
      snapshotCb?.(snap);
    } else if (msg.type === 'runStatus') {
      runStatusCb?.(msg.runStatus);
    } else if (msg.type === 'bye' && msg.from === 'host') {
      core.setState(advancePair(core.state, 'peer-bye'));
    }
  });
  // Like a phone: the dashboard's session starts at its own hello; older
  // messages in the room (old run status, old boards) are history.
  const helloMsg: RelayMessage = { v: 1, from: 'control', type: 'hello' };
  const hello = (): Promise<void | RelayMeta> => (transport.publishStamped ? transport.publishStamped(roomId, helloMsg) : transport.publish(roomId, helloMsg));
  const first = await hello();
  if (first) void core.markStart(hello, first); else core.setStart(null);

  return {
    roomId,
    state: () => core.state,
    onState: (cb) => core.onState(cb),
    onSnapshot: (cb) => {
      snapshotCb = cb;
      if (lastSnapshot) cb(lastSnapshot);
    },
    onRunStatus: (cb) => {
      runStatusCb = cb;
    },
    sendRun: (run) => transport.publish(roomId, { v: 1, from: 'control', type: 'run', run }),
    sendRunControl: (control) =>
      transport.publish(roomId, { v: 1, from: 'control', type: 'runControl', runControl: control }),
    close: () => core.close(),
  };
}

/** Resolve what the phone user provided (token or short code) to a room id.
 *  A short code is only honoured while it is fresh: the transport's
 *  aliasFreshAt (when it has one) must be within ALIAS_TTL_MS of now, so an
 *  alias left behind by a laptop that vanished (no pagehide, crash) stops
 *  resolving on its own. */
export async function resolveRoomId(
  transport: RelayTransport,
  input: { kind: 'token'; token: string } | { kind: 'code'; code: string },
  opts: { now?: () => number } = {},
): Promise<string | null> {
  if (input.kind === 'token') return input.token;
  const room = await transport.resolveAlias(input.code);
  if (!room || !transport.aliasFreshAt) return room;
  const at = await transport.aliasFreshAt(input.code, room).catch(() => null);
  const now = (opts.now ?? Date.now)();
  return at !== null && now - at <= ALIAS_TTL_MS ? room : null;
}
