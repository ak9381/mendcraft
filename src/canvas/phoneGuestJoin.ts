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
import type { PhoneAiForwarder } from './phoneAiFeed';

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
  /** True in the native Capacitor app (a narrow browser is not "the Nothing phone"). */
  native?: boolean;
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
    let deviceId: string | undefined;
    if (deps.storage) {
      deviceId = ensureDeviceId(deps.storage);
      savePhonePair(deps.storage, {
        token: roomId,
        hubName: deps.hubName ?? 'the laptop',
        deviceId,
        platform: deps.platform,
      });
    }
    if (deps.platform) announcePhone(session, deps.platform, { deviceId, native: deps.native });
    return { roomId, session, stop: () => session.close() };
  } catch {
    return { error: 'needs network' };
  }
}

/** Tell the laptop which phone this is, so it can place it (Nothing left,
 *  iPhone right by default) and send a board to THIS phone only. Best-effort. */
export function announcePhone(
  session: Pick<GuestSession, 'sendCommand'> & Partial<Pick<GuestSession, 'hostSid'>>,
  platform: PhonePlatform,
  extra: { deviceId?: string; native?: boolean; refresh?: boolean; status?: () => object | null } = {},
): void {
  try {
    // deviceId: the laptop keys this phone's AI-monitor events on it.
    // refresh: a keep-alive re-announce — the laptop only re-learns who this
    // phone is (no re-placing, no board republish).
    const body: Record<string, unknown> = { platform };
    if (extra.deviceId) body.deviceId = extra.deviceId;
    if (extra.native !== undefined) body.native = extra.native;
    if (extra.refresh) body.refresh = true;
    // sid: the laptop session this phone last heard from. The laptop only
    // takes an announce that names its CURRENT session as live (an announce
    // replayed from the room's history names an old one, or none).
    const sid = session.hostSid?.();
    if (sid) body.sid = sid;
    // iPhone sensing: gimbal / sensor / hand-control state for the laptop's
    // connect-devices row (phonePoint.ts). Only what is really on.
    const st = extra.status?.();
    if (st) Object.assign(body, st, body);
    void session.sendCommand({ kind: 'announce', text: JSON.stringify(body) }).catch(() => undefined);
  } catch {
    /* a closed session never breaks the join */
  }
}

function isShort(raw: string): boolean {
  return normalizeCode(raw).length === 8;
}

/** Every RE_ANNOUNCE_MS while a session is bound (and at once when the laptop
 *  asks 'whoIsThere'), re-announce with refresh:true — so a laptop that forgot
 *  every phone when ONE dropped re-learns the phones that stayed. */
export const RE_ANNOUNCE_MS = 20_000;

export function keepAnnouncing(
  session: Pick<GuestSession, 'sendCommand'> & Partial<Pick<GuestSession, 'onWhoIsThere' | 'hostSid'>>,
  platform: PhonePlatform,
  extra: { deviceId?: string; native?: boolean; status?: () => object | null },
  timers: { setInterval(fn: () => void, ms: number): unknown; clearInterval(id: unknown): void } = {
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
  },
): () => void {
  let stopped = false;
  const again = (): void => { if (!stopped) announcePhone(session, platform, { ...extra, refresh: true }); };
  session.onWhoIsThere?.(again);
  const id = timers.setInterval(again, RE_ANNOUNCE_MS);
  return () => { stopped = true; timers.clearInterval(id); };
}

export interface PhoneSessionDeps extends PhoneGuestJoinDeps {
  /** The phone shell's AI-feed tap; bound to the session while it is open. */
  aiForwarder?: Pick<PhoneAiForwarder, 'bind'>;
  /** Injectable re-announce timers (tests). */
  keepAliveTimers?: Parameters<typeof keepAnnouncing>[3];
  /** Extra announce fields (iPhone sensing status), read at each announce. */
  announceStatus?: () => object | null;
  /** False once a newer join has superseded this one: a join that finishes
   *  late must not take the AI-feed forwarder from the one that replaced it. */
  isCurrent?: () => boolean;
}

/** The ONE way a phone joins the laptop's room — chime first-join, typed code
 *  and saved-pair rejoin alike. On success it binds the AI-feed forwarder (if
 *  any) and starts the 20 s / whoIsThere re-announce; `stop()` tears both down
 *  and closes the session. */
export async function joinPhoneSession(deps: PhoneSessionDeps): Promise<PhoneGuestJoinResult> {
  const res = await joinPhoneAsGuest(deps);
  if ('error' in res) return res;
  const { session } = res;
  if (deps.isCurrent?.() !== false) deps.aiForwarder?.bind(session);
  const deviceId = deps.storage ? ensureDeviceId(deps.storage) : undefined;
  const stopAnnouncing = deps.platform
    ? keepAnnouncing(session, deps.platform, { deviceId, native: deps.native, status: deps.announceStatus }, deps.keepAliveTimers)
    : () => undefined;
  let stopped = false;
  return {
    ...res,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      stopAnnouncing();
      // Only if this session is still the bound one (a stale join torn down
      // late must not unbind the join that replaced it).
      deps.aiForwarder?.bind(null, session);
      await session.close();
    },
  };
}
