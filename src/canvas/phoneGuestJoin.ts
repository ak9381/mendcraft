// First-time phone join as a GUEST. The laptop (startPhoneJoin) is the only
// side that may mint a Relay room; a phone that heard the pairing chime (or
// typed the last-resort code) resolves that short code and joins the existing
// room. Injectable transport/session so tests never hit the network.

import {
  createGuestSession,
  resolveRoomId,
  type GuestSession,
} from '../relay/session';
import { normalizeCode, parseJoinInput } from '../relay/protocol';
import type { RelayTransport } from '../relay/transport';
import { probeFirestore, type FirestoreProbe } from '../relay/firestoreTransport';
import {
  ensureDeviceId,
  savePhonePair,
  type StorageLike,
} from '../relay/pairingStore';
import type { PhonePlatform } from './screenLayout';
import type { PairState } from '../relay/protocol';

export interface PhoneGuestJoinDeps {
  /** Decoded (or last-resort typed) short code or full join URL / token. */
  code: string;
  transport?: RelayTransport | Promise<RelayTransport | null>;
  probe?: () => Promise<FirestoreProbe>;
  createGuestSession?: typeof createGuestSession;
  resolveRoomId?: typeof resolveRoomId;
  storage?: StorageLike | null;
  platform?: PhonePlatform;
  hubName?: string;
  onState?: (state: PairState) => void;
}

export type PhoneGuestJoinSuccess = {
  roomId: string;
  session: GuestSession;
  stop: () => Promise<void>;
};

export type PhoneGuestJoinFailure = {
  error: 'needs network' | 'bad code' | 'room not found';
};

export type PhoneGuestJoinResult = PhoneGuestJoinSuccess | PhoneGuestJoinFailure;

export async function joinPhoneAsGuest(deps: PhoneGuestJoinDeps): Promise<PhoneGuestJoinResult> {
  const parsed = parseJoinInput(deps.code) ?? (
    isShort(deps.code) ? { kind: 'code' as const, code: normalizeCode(deps.code) } : null
  );
  if (!parsed) return { error: 'bad code' };

  try {
    let transport: RelayTransport | null = null;
    if (deps.transport) {
      transport = await deps.transport;
    } else {
      const probeFn = deps.probe ?? probeFirestore;
      const probeRes = await probeFn();
      if (probeRes.ok) transport = probeRes.transport;
    }
    if (!transport) return { error: 'needs network' };

    const resolve = deps.resolveRoomId ?? resolveRoomId;
    const roomId = await resolve(transport, parsed);
    if (!roomId) return { error: 'room not found' };

    const guestFactory = deps.createGuestSession ?? createGuestSession;
    const session = await guestFactory(transport, roomId);
    if (deps.onState) {
      deps.onState(session.state());
      session.onState(deps.onState);
    }
    if (deps.storage) {
      const deviceId = ensureDeviceId(deps.storage);
      savePhonePair(deps.storage, {
        token: roomId,
        hubName: deps.hubName ?? 'the laptop',
        deviceId,
        platform: deps.platform,
      });
    }
    return { roomId, session, stop: () => session.close() };
  } catch {
    return { error: 'needs network' };
  }
}

function isShort(raw: string): boolean {
  return normalizeCode(raw).length === 8;
}
