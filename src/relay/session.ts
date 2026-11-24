// Pairing sessions over an injected RelayTransport. The host (laptop) owns a
// room token and waits; the guest (phone) joins via token or short code. Both
// sides run the same pure state machine (protocol.advancePair) and only react
// to messages from the OTHER role, so echoed self-messages are harmless.

import {
  advancePair,
  cryptoRandom,
  generateRoomToken,
  shortCodeOf,
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
import { coerceSnapshot, type ControlSnapshot } from './controlSnapshot';
import type { RelayTransport } from './transport';

export interface RelayFrame {
  mimeType: string;
  dataBase64: string;
}

interface SessionBase {
  state(): PairState;
  onState(cb: (state: PairState) => void): void;
  /** Publish 'bye' and stop listening. Safe to call twice. */
  close(): Promise<void>;
}

export interface HostSession extends SessionBase {
  readonly token: string;
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
   *  here too). Coerced before the callback — the phone treats it as untrusted. */
  onSnapshot(cb: (snapshot: ControlSnapshot) => void): void;
  /** Send a raw prompt to the desktop hub; resolves with the filled reply. */
  sendPrivacyAsk(ask: PrivacyAsk, timeoutMs?: number): Promise<PrivacyReply>;
}

function makeCore(role: RelayRole, transport: RelayTransport, roomId: string) {
  let state: PairState = 'idle';
  let stateCb: ((s: PairState) => void) | null = null;
  let unsubscribe: (() => void) | null = null;
  let closed = false;

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
    listen(onPeer: (msg: RelayMessage) => void) {
      unsubscribe = transport.subscribe(
        roomId,
        (msg) => {
          if (msg.from === role) return; // own echo
          onPeer(msg);
        },
        () => setState(advancePair(state, 'listen-error')),
      );
      setState(advancePair(state, 'create'));
    },
    async close() {
      if (closed) return;
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
      try {
        await transport.publish(roomId, { v: 1, from: role, type: 'bye' });
      } catch {
        // Transport already gone (offline, room deleted) — closing anyway.
      }
      setState(advancePair(state, 'close'));
    },
  };
}

/** How long the typable short code stays resolvable before it auto-expires,
 *  win or lose — the code is only 40 bits of entropy (brute-forceable in
 *  principle), so this bounds the window regardless of whether a phone ever
 *  joins. State-changing session actions always address the room by its
 *  full 24-char token, never the short code, once a session is established. */
export const ALIAS_TTL_MS = 5 * 60 * 1000;

export interface CreateHostOptions {
  /** Resume an EXISTING room token (e.g. one a remembered phone is still pointed
   *  at) instead of minting a fresh one. Must be a 24-char token; ignored
   *  otherwise. This is what lets a laptop reload keep remembered phones paired. */
  token?: string;
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
  const code = shortCodeOf(token);
  const core = makeCore('host', transport, token);
  let aliasCleared = false;
  async function clearAliasOnce(): Promise<void> {
    if (aliasCleared) return;
    aliasCleared = true;
    await transport.clearAlias(code).catch(() => undefined);
  }
  const aliasTimer = setTimeout(() => void clearAliasOnce(), ALIAS_TTL_MS);
  let commandCb: ((cmd: RelayCommand) => void) | null = null;
  let frameCb: ((frame: RelayFrame) => void) | null = null;
  let musicCb: ((music: MusicStatus) => void) | null = null;
  let runCb: ((run: RelayRunRequest) => void) | null = null;
  let runControlCb: ((control: RelayRunControl) => void) | null = null;
  let privacyAskCb: ((ask: PrivacyAsk) => void) | null = null;
  // The most recent snapshot, re-sent whenever a /control dashboard announces itself,
  // so a dashboard that joins late sees current state without waiting for the
  // next change. Pairing state is unaffected by control presence.
  let lastSnapshot: ControlSnapshot | null = null;

  function publishState(snapshot: ControlSnapshot): Promise<void> {
    lastSnapshot = snapshot;
    return transport.publish(token, { v: 1, from: 'host', type: 'state', snapshot });
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
      privacyAskCb?.(msg.ask);
      return;
    }
    if (msg.from === 'control') {
      // A read-only dashboard, not a remote: never changes pairing. Replay the
      // latest state so it populates immediately.
      if (msg.type === 'hello' && lastSnapshot) void publishState(lastSnapshot).catch(() => undefined);
      return;
    }
    if (msg.type === 'hello') {
      const wasPaired = core.state === 'paired';
      core.setState(advancePair(core.state, 'peer-hello'));
      // ALWAYS ack a phone hello — even when already paired — so a SECOND phone
      // joining the same room flips to paired too (two phones share one room and
      // ignore each other's messages, so only the host can confirm the newcomer).
      void transport.publish(token, { v: 1, from: 'host', type: 'hello' }).catch(() => undefined);
      // The short-code alias has done its job once any phone is in the room.
      if (!wasPaired) {
        clearTimeout(aliasTimer);
        void clearAliasOnce();
      }
      // Replay the latest state so a phone (freshly joined or reloaded) populates
      // its board/layout immediately — today this only happened for a control
      // hello, which stranded a late-joining phone until the next change.
      if (lastSnapshot) void publishState(lastSnapshot).catch(() => undefined);
    } else if (msg.type === 'bye') {
      core.setState(advancePair(core.state, 'peer-bye'));
    } else if (msg.type === 'cmd') {
      if (core.state === 'paired') commandCb?.(msg.cmd);
    } else if (msg.type === 'frame') {
      if (core.state === 'paired') frameCb?.({ mimeType: msg.mimeType, dataBase64: msg.dataBase64 });
    } else if (msg.type === 'music') {
      if (core.state === 'paired') musicCb?.(msg.music);
    }
  });
  await transport.setAlias(code, token);

  return {
    token,
    code,
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
    publishState,
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
): Promise<GuestSession> {
  const core = makeCore('phone', transport, roomId);

  let snapshotCb: ((s: ControlSnapshot) => void) | null = null;
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
    else if (msg.type === 'bye') core.setState(advancePair(core.state, 'peer-bye'));
    else if (msg.type === 'state') {
      // Untrusted wire data: rebuild through coerceSnapshot before anyone reads
      // a field (board/layout/transfer included). A host 'state' also means the
      // laptop is live, so flip 'waiting' → 'paired' like a hello.
      const snap = coerceSnapshot(msg.snapshot);
      if (!snap) return;
      core.setState(advancePair(core.state, 'peer-hello'));
      lastSnapshot = snap;
      snapshotCb?.(snap);
    } else if (msg.type === 'privacyReply') {
      const wait = pending.get(msg.reply.jobId);
      if (wait) {
        clearTimeout(wait.timer);
        pending.delete(msg.reply.jobId);
        wait.resolve(msg.reply);
      }
    }
  });
  await transport.publish(roomId, { v: 1, from: 'phone', type: 'hello' });

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
      if (lastSnapshot) cb(lastSnapshot);
    },
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
    close: async () => {
      // Reject outstanding privacyAsk waiters now — otherwise a mid-request
      // close() (e.g. remotePage's pagehide handler) leaves the caller
      // hanging for the full timeout instead of failing fast.
      for (const [jobId, wait] of pending) {
        clearTimeout(wait.timer);
        pending.delete(jobId);
        wait.reject(new Error('relay: session closed before the hub replied'));
      }
      await core.close();
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
  await transport.publish(roomId, { v: 1, from: 'control', type: 'hello' });

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

/** Resolve what the phone user provided (token or short code) to a room id. */
export async function resolveRoomId(
  transport: RelayTransport,
  input: { kind: 'token'; token: string } | { kind: 'code'; code: string },
): Promise<string | null> {
  if (input.kind === 'token') return input.token;
  return transport.resolveAlias(input.code);
}
