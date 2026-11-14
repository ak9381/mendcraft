// Firestore-backed RelayTransport. Rooms live at rooms/{roomId} (an
// unguessable capability token — see firestore.rules); messages are an
// append-only subcollection rooms/{roomId}/messages read via onSnapshot.
// Firestore IS enabled on the mendcraft project (the (default) Native-mode
// database, firestore.rules deployed by the pipeline). probeFirestore() still
// fails soft when the build is unconfigured, the device is offline, or the probe
// times out: callers fall back to the fake transport and show an honest
// "can't reach the room" state instead of crashing.

import { getFirebaseApp, isFirebaseConfigured } from '../firebase/app';
import { validateMessage, type RelayMessage } from './protocol';
import type { RelayTransport } from './transport';

export type FirestoreProbe =
  | { ok: true; transport: RelayTransport }
  | { ok: false; reason: string };

const PROBE_TIMEOUT_MS = 5000;

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

    const transport: RelayTransport = {
      kind: 'firestore',
      async publish(roomId, msg) {
        await fs.addDoc(fs.collection(db, 'rooms', roomId, 'messages'), {
          ...msg,
          at: fs.serverTimestamp(),
        });
      },
      subscribe(roomId, onMsg) {
        return fs.onSnapshot(
          fs.query(fs.collection(db, 'rooms', roomId, 'messages'), fs.orderBy('at')),
          (snap) => {
            for (const change of snap.docChanges()) {
              if (change.type !== 'added') continue;
              const msg: RelayMessage | null = validateMessage(change.doc.data());
              if (msg) onMsg(msg);
            }
          },
          () => {
            // Listen failed (rules/offline). Sessions keep their last state; the
            // UI surfaces connectivity via the pairing state, not a crash.
          },
        );
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
