// Relay transport seam: the sessions (relay/session.ts) speak to an injected
// adapter, so Firestore (firestoreTransport.ts) and the in-memory fake below
// are interchangeable. The fake powers unit tests and the ?sim=1 Play demo —
// pairing works end-to-end in one page with zero network.

import { validateMessage, type RelayMessage } from './protocol';

export interface RelayTransport {
  readonly kind: 'fake' | 'firestore';
  /** Append a message to the room's channel. */
  publish(roomId: string, msg: RelayMessage): Promise<void>;
  /** Listen for messages in a room (including ones this client sent — callers
   *  filter by `from`). Returns an unsubscribe function. */
  subscribe(roomId: string, onMsg: (msg: RelayMessage) => void): () => void;
  /** Map a typable short code → full room token while the host is waiting. */
  setAlias(code: string, roomId: string): Promise<void>;
  resolveAlias(code: string): Promise<string | null>;
  clearAlias(code: string): Promise<void>;
}

/** In-memory transport: both "devices" live in the same page (tests, sim). */
export function createFakeTransport(): RelayTransport {
  const rooms = new Map<string, Set<(msg: RelayMessage) => void>>();
  const aliases = new Map<string, string>();

  return {
    kind: 'fake',
    async publish(roomId, msg) {
      // Round-trip through validation like a real wire would, and deliver on a
      // microtask so a publish inside a handler can't recurse synchronously.
      const valid = validateMessage(JSON.parse(JSON.stringify(msg)));
      if (!valid) throw new Error('relay: refused to publish a malformed message');
      const handlers = rooms.get(roomId);
      if (!handlers) return;
      await Promise.resolve();
      for (const h of [...handlers]) h(valid);
    },
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
      aliases.set(code, roomId);
    },
    async resolveAlias(code) {
      return aliases.get(code) ?? null;
    },
    async clearAlias(code) {
      aliases.delete(code);
    },
  };
}
