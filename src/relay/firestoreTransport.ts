// Firestore-backed RelayTransport. Rooms live at rooms/{roomId} (an
// unguessable capability token — see firestore.rules); messages are an
// append-only subcollection rooms/{roomId}/messages read via onSnapshot.
// Firestore IS enabled on the mendcraft project (the (default) Native-mode
// database, firestore.rules deployed by the pipeline). probeFirestore() still
// fails soft when the build is unconfigured, the device is offline, or the probe
// times out: callers fall back to the fake transport and show an honest
// "can't reach the room" state instead of crashing.

import { getFirebaseApp, isFirebaseConfigured } from '../firebase/app';
import { codeVouchTag, codeVouchedAt, validateMessage, type RelayMessage } from './protocol';
import type { RelayTransport } from './transport';
import { createRoomFeed, type RestartClock, type RoomDoc } from './roomFeed';

export type FirestoreProbe =
  | { ok: true; transport: RelayTransport }
  | { ok: false; reason: string };

const PROBE_TIMEOUT_MS = 5000;
/** At most this many 'codeOpen' proofs of one code are read (a code is opened once or twice). */
const ALIAS_PROOF_SCAN = 12;

/**
 * Try to stand up a Firestore transport. Resolves {ok:false} (never throws)
 * when Firebase is unconfigured, the device is offline, rules deny access, or
 * the probe times out.
 */
export async function probeFirestore(): Promise<FirestoreProbe> {
  if (!isFirebaseConfigured()) return { ok: false, reason: 'Firebase is not configured (rules-only build).' };
  try {
    const app = await getFirebaseApp();
    const fs = await import('firebase/firestore');
    const db = fs.getFirestore(app);
    // One cheap read decides everything: success (even "no such doc") means the
    // database is reachable and rules allow room reads; permission-denied means
    // the sign-in/rules path is blocking; unavailable means we can't reach
    // Firestore right now (offline).
    await Promise.race([
      // Lowercase id — outside the token alphabet, so it can never collide
      // with (or reveal the existence of) a real room.
      fs.getDoc(fs.doc(db, 'rooms', 'probe')),
      new Promise((_, reject) => setTimeout(() => reject(new Error('probe timed out')), PROBE_TIMEOUT_MS)),
    ]);

    // One connection, one restart gap, however many rooms listen on it.
    const restartClock: RestartClock = { last: -Infinity };
    const transport: RelayTransport = {
      kind: 'firestore',
      async publish(roomId, msg) {
        await fs.addDoc(fs.collection(db, 'rooms', roomId, 'messages'), {
          ...msg,
          at: fs.serverTimestamp(),
        });
      },
      // The server time a message got: a session's start marker (what is
      // older than it in the room is history, see session.ts).
      async publishStamped(roomId, msg) {
        const ref = await fs.addDoc(fs.collection(db, 'rooms', roomId, 'messages'), {
          ...msg,
          at: fs.serverTimestamp(),
        });
        try {
          const at = (await fs.getDocFromServer(ref)).data()?.at as { toMillis?: () => number } | undefined;
          return { at: typeof at?.toMillis === 'function' ? at.toMillis() : null };
        } catch {
          return { at: null };
        }
      },
      subscribe(roomId, onMsg, onError, since) {
        // The live listener, backed by a slow catch-up read: onSnapshot can go
        // quiet without an error (see roomFeed.ts), which left a paired laptop
        // deaf to its phone. Both are bounded by the session's start: the
        // room's older history is never downloaded.
        const messages = fs.collection(db, 'rooms', roomId, 'messages');
        const toDoc = (d: { id: string; data(): Record<string, unknown> }): RoomDoc => {
          const data = d.data();
          const at = data.at as { toMillis?: () => number } | null | undefined;
          return { id: d.id, at: typeof at?.toMillis === 'function' ? at.toMillis() : null, data };
        };
        const from = (at: number | null) => (at === null
          ? fs.query(messages, fs.orderBy('at'))
          : fs.query(messages, fs.where('at', '>=', fs.Timestamp.fromMillis(at)), fs.orderBy('at')));
        const feed = createRoomFeed({
          since,
          restartClock,
          listen: (at, onDocs, onListenError) => fs.onSnapshot(
            from(at),
            (snap) => {
              onDocs(snap.docChanges().filter((c) => c.type === 'added').map((c) => toDoc(c.doc)));
            },
            () => {
              // Listen failed (rules denial, offline, room deleted). Tell the
              // caller so the pairing state machine can move to an explicit
              // 'disconnected' state instead of freezing silently on the last
              // one — "paired" would otherwise look connected when it isn't.
              onListenError();
            },
          ),
          fetchSince: async (at) => (await fs.getDocsFromServer(from(at))).docs.map(toDoc),
          restart: async () => { await fs.disableNetwork(db); await fs.enableNetwork(db); },
          onDoc: (data, at) => {
            const msg: RelayMessage | null = validateMessage(data);
            if (msg) onMsg(msg, { at });
          },
          onError,
        });
        return () => feed.stop();
      },
      async setAlias(code, roomId) {
        await fs.setDoc(fs.doc(db, 'rooms', code), { room: roomId });
      },
      async resolveAlias(code) {
        const snap = await fs.getDoc(fs.doc(db, 'rooms', code));
        const room = snap.exists() ? (snap.data() as { room?: unknown }).room : null;
        return typeof room === 'string' ? room : null;
      },
      async clearAlias(code) {
        await fs.deleteDoc(fs.doc(db, 'rooms', code));
      },
      // firestore.rules lets the alias doc hold only {room}, so it cannot
      // carry a createdAt: a 'codeOpen' host message naming THIS code's tag
      // (codeVouchTag) vouches for it, at its server time. Other host
      // messages (a resumed session speaking) vouch for no code. One
      // equality filter (single-field index, no composite needed).
      async aliasFreshAt(code, roomId) {
        const tag = await codeVouchTag(code, roomId);
        const found = await fs.getDocsFromServer(fs.query(
          fs.collection(db, 'rooms', roomId, 'messages'), fs.where('cmd.text', '==', tag), fs.limit(ALIAS_PROOF_SCAN),
        ));
        return codeVouchedAt(tag, found.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const at = data.at as { toMillis?: () => number } | null | undefined;
          return { data, at: typeof at?.toMillis === 'function' ? at.toMillis() : null };
        }));
      },
    };
    return { ok: true, transport };
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    const reason =
      code === 'permission-denied'
        ? "The relay room isn't reachable (check you're signed in)."
        : "Can't reach Firestore right now — check your connection.";
    return { ok: false, reason };
  }
}
