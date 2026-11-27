// Start phone join: creates a Relay host session for smart canvas pairing.
// Reuses createHostSession, groupCode, and chime helpers.
// Injects deps so tests use fake transports, and fails soft with { error: 'needs network' }.

import {
  createHostSession,
  type HostSession,
  type RelayFrame,
} from '../relay/session';
import {
  buildJoinUrl,
  groupCode,
  type MusicStatus,
  type PairState,
  type RelayCommand,
} from '../relay/protocol';
import type { RelayTransport } from '../relay/transport';
import type { CreateHostOptions } from '../relay/session';
import { probeFirestore, type FirestoreProbe } from '../relay/firestoreTransport';
import { playDeepChime } from '../ux/deepWait';

export interface PhoneJoinDeps {
  transport?: RelayTransport | Promise<RelayTransport | null>;
  probe?: () => Promise<FirestoreProbe>;
  createHostSession?: typeof createHostSession;
  origin?: string;
  chime?: () => void;
  /** Resume an existing room token (from pairingStore) so remembered phones stay
   *  paired across a laptop reload instead of being stranded on a stale code. */
  token?: string;
  /** Where the room's open short code is remembered beside the token
   *  (pairingStore.openCodeStore): a resumed room clears it first. */
  openCode?: CreateHostOptions['openCode'];
  onState?: (state: PairState) => void;
  onCommand?: (cmd: RelayCommand) => void;
  onFrame?: (frame: RelayFrame) => void;
  onMusic?: (music: MusicStatus) => void;
}

export type PhoneJoinSuccess = {
  code: string;
  rawCode: string;
  token: string;
  joinUrl: string;
  stop: () => Promise<void>;
  session: HostSession;
};

export type PhoneJoinFailure = {
  error: 'needs network';
};

export type PhoneJoinResult = PhoneJoinSuccess | PhoneJoinFailure;

export async function startPhoneJoin(deps: PhoneJoinDeps = {}): Promise<PhoneJoinResult> {
  try {
    let transport: RelayTransport | null = null;

    if (deps.transport) {
      transport = await deps.transport;
    } else {
      const probeFn = deps.probe ?? probeFirestore;
      const probeRes = await probeFn();
      if (probeRes.ok) {
        transport = probeRes.transport;
      }
    }

    if (!transport) {
      return { error: 'needs network' };
    }

    const hostFactory = deps.createHostSession ?? createHostSession;
    const session = await hostFactory(transport, undefined, deps.token || deps.openCode ? { token: deps.token, openCode: deps.openCode } : undefined);

    const origin =
      deps.origin ??
      (typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost:3000');

    const token = session.token;
    const rawCode = session.code;
    const code = groupCode(rawCode);
    const joinUrl = buildJoinUrl(origin, token);

    session.onState((state) => {
      deps.onState?.(state);
      if (state === 'paired') {
        if (deps.chime) {
          deps.chime();
        } else {
          try {
            playDeepChime();
          } catch {
            // Optional chime sound
          }
        }
      }
    });

    if (deps.onCommand) session.onCommand(deps.onCommand);
    if (deps.onFrame) session.onFrame(deps.onFrame);
    if (deps.onMusic) session.onMusic(deps.onMusic);

    return {
      code,
      rawCode,
      token,
      joinUrl,
      session,
      stop: async () => {
        await session.close();
      },
    };
  } catch {
    return { error: 'needs network' };
  }
}
