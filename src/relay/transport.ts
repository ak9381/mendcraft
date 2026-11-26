// Relay transport seam: the sessions (relay/session.ts) speak to an injected
// adapter, so Firestore (firestoreTransport.ts) and the in-memory fake below
// are interchangeable. The fake powers unit tests and the ?sim=1 Play demo —
// pairing works end-to-end in one page with zero network.

import { fitsRoomMessageRules, validateMessage, type RelayMessage } from './protocol';

/** When the room's server stored a message (ms). null = not known (yet). */
export interface RelayMeta { at: number | null }

export interface RelayTransport {
  readonly kind: 'fake' | 'firestore';
  /** Append a message to the room's channel. */
  publish(roomId: string, msg: RelayMessage): Promise<void>;
  /** Append a message and resolve with the server time it was stored at
   *  ({at: null} when that could not be read back). Absent on a transport
   *  with no server clock. */
  publishStamped?(roomId: string, msg: RelayMessage): Promise<RelayMeta>;
  /** Listen for messages in a room (including ones this client sent — callers
   *  filter by `from`). `onError` fires when the underlying listener drops
   *  (rules denial, offline) so the caller can surface a real disconnected
   *  state instead of silently freezing on the last-known one. Returns an
   *  unsubscribe function. */
  /** `since`: the caller's session start (server ms), once it knows it; a
   *  transport with history uses it to never listen to or read anything older. */
  subscribe(roomId: string, onMsg: (msg: RelayMessage, meta?: RelayMeta) => void, onError?: () => void, since?: Promise<number | null>): () => void;
  /** Map a typable short code → full room token while the host is waiting. */
  setAlias(code: string, roomId: string): Promise<void>;
  resolveAlias(code: string): Promise<string | null>;
  clearAlias(code: string): Promise<void>;
  /** When (ms, the transport's clock) the alias `code` → `roomId` was last
   *  vouched for: written, or — where the alias doc itself cannot carry a
   *  time — the room's newest host message. null: no proof it is live.
   *  resolveRoomId rejects a code older than ALIAS_TTL_MS. */
  aliasFreshAt?(code: string, roomId: string): Promise<number | null>;
}

/** In-memory transport: both "devices" live in the same page (tests, sim). */
export function createFakeTransport(): RelayTransport {
  const rooms = new Map<string, Set<(msg: RelayMessage, meta?: RelayMeta) => void>>();
  const aliases = new Map<string, { room: string; createdAt: number }>();
  let clock = 0; // the fake room's "server time": one tick per message

  async function deliver(roomId: string, msg: RelayMessage): Promise<RelayMeta> {
    // Round-trip through validation like a real wire would, and deliver on a
    // microtask so a publish inside a handler can't recurse synchronously.
    const valid = validateMessage(JSON.parse(JSON.stringify(msg)));
    if (!valid) throw new Error('relay: refused to publish a malformed message');
    // Mirrors firestore.rules' write-shape check, so the sim/test path fails
    // the same way a real Firestore write would.
    if (!fitsRoomMessageRules({ ...valid, at: new Date() })) {
      throw new Error('relay: refused to publish a message the room rules would reject');
    }
    const meta: RelayMeta = { at: ++clock };
    const handlers = rooms.get(roomId);
    if (!handlers) return meta;
    await Promise.resolve();
    for (const h of [...handlers]) h(valid, meta);
    return meta;
  }

  return {
    kind: 'fake',
    async publish(roomId, msg) {
      await deliver(roomId, msg);
    },
    publishStamped: (roomId, msg) => deliver(roomId, msg),
    subscribe(roomId, onMsg) {
      let handlers = rooms.get(roomId);
      if (!handlers) {
        handlers = new Set();
        rooms.set(roomId, handlers);
      }
      handlers.add(onMsg);
      return () => {
        handlers.delete(onMsg);
        if (handlers.size === 0) rooms.delete(roomId);
      };
    },
    async setAlias(code, roomId) {
      aliases.set(code, { room: roomId, createdAt: Date.now() });
    },
    async resolveAlias(code) {
      return aliases.get(code)?.room ?? null;
    },
    async aliasFreshAt(code, roomId) {
      const a = aliases.get(code);
      return a && a.room === roomId ? a.createdAt : null;
    },
    async clearAlias(code) {
      aliases.delete(code);
    },
  };
}
