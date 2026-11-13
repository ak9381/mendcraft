// Pairing sessions over an injected RelayTransport. The host (laptop) owns a
// room token and waits; the guest (phone) joins via token or short code. Both
// sides run the same pure state machine (protocol.advancePair) and only react
// to messages from the OTHER role, so echoed self-messages are harmless.

import {
  advancePair,
  cryptoRandom,
  generateRoomToken,
  shortCodeOf,
  type PairState,
  type RandomBytes,
  type RelayCommand,
  type RelayMessage,
  type RelayRole,
} from './protocol';
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
}

export interface GuestSession extends SessionBase {
  readonly roomId: string;
  sendCommand(cmd: RelayCommand): Promise<void>;
  sendFrame(frame: RelayFrame): Promise<void>;
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
      unsubscribe = transport.subscribe(roomId, (msg) => {
        if (msg.from === role) return; // own echo
        onPeer(msg);
      });
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

/** Laptop side: create a room, wait for the phone, surface commands/frames. */
export async function createHostSession(
  transport: RelayTransport,
  random: RandomBytes = cryptoRandom,
): Promise<HostSession> {
  const token = generateRoomToken(random);
  const code = shortCodeOf(token);
  const core = makeCore('host', transport, token);
  let commandCb: ((cmd: RelayCommand) => void) | null = null;
  let frameCb: ((frame: RelayFrame) => void) | null = null;

  core.listen((msg) => {
    if (msg.type === 'hello') {
      const wasPaired = core.state === 'paired';
      core.setState(advancePair(core.state, 'peer-hello'));
      // Ack so the phone flips to paired too; the short-code alias has done its
      // job once a phone is in the room. Rejoins skip the duplicate ack.
      if (!wasPaired) {
        void transport.publish(token, { v: 1, from: 'host', type: 'hello' }).catch(() => undefined);
        void transport.clearAlias(code).catch(() => undefined);
      }
    } else if (msg.type === 'bye') {
      core.setState(advancePair(core.state, 'peer-bye'));
    } else if (msg.type === 'cmd') {
      if (core.state === 'paired') commandCb?.(msg.cmd);
    } else if (msg.type === 'frame') {
      if (core.state === 'paired') frameCb?.({ mimeType: msg.mimeType, dataBase64: msg.dataBase64 });
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
    close: async () => {
      await transport.clearAlias(code).catch(() => undefined);
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

  core.listen((msg) => {
    if (msg.type === 'hello') core.setState(advancePair(core.state, 'peer-hello'));
    else if (msg.type === 'bye') core.setState(advancePair(core.state, 'peer-bye'));
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
