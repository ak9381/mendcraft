// Parallel Nano routing + cloud answer for hard copilot questions.
// Rules-first simple plan questions stay out of this race (handled by the
// caller). Nano is capped at a short timeout; if it is late, the cloud wins.

import type { NanoRaceNote } from './routeReason';
import type { ToolCall } from './tools';

export type { NanoRaceNote };
export const NANO_ROUTE_TIMEOUT_MS = 2000;

export interface NanoPick {
  call: ToolCall;
  confidence: number;
  source: 'on-device' | 'cloud' | 'rules';
  ms: number;
}

export interface CloudAnswer {
  answer: string;
  calls: ToolCall[];
  why: string;
  source: 'on-device' | 'cloud' | 'rules';
  ms: number;
  model?: string;
}

export type HardRaceResult =
  | { kind: 'nano-tool'; pick: NanoPick; nano: 'timely' }
  | { kind: 'cloud'; cloud: CloudAnswer; nano: NanoRaceNote }
  | { kind: 'offline'; nano?: NanoRaceNote }
  | { kind: 'failed'; nano?: NanoRaceNote };

function usefulTool(pick: NanoPick | null | undefined): pick is NanoPick {
  return !!pick && pick.call.tool !== 'ask_gemini' && pick.confidence >= 0.5;
}

/** Timeout vs a resolved miss/throw are different facts — do not invent "late". */
function withTimeoutOutcome<T>(p: Promise<T | null>, ms: number): Promise<{ pick: T | null; late: boolean }> {
  return new Promise((resolve) => {
    let settled = false;
    const t = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ pick: null, late: true });
    }, ms);
    p.then((v) => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve({ pick: v, late: false });
    }, () => {
      if (settled) return;
      settled = true;
      clearTimeout(t);
      resolve({ pick: null, late: false });
    });
  });
}

function noteFromOutcome(outcome: { pick: NanoPick | null; late: boolean } | null, ranNano: boolean): NanoRaceNote {
  if (!ranNano) return 'absent';
  if (!outcome) return 'pending';
  if (outcome.late) return 'late';
  if (usefulTool(outcome.pick)) return 'timely';
  return 'unsure';
}

/**
 * One Nano intent call (optional, short timeout) raced with a Gemini answer
 * (started immediately when the question is hard and we are online).
 *
 * - Judgement questions ("should we take this wall down?") always wait for
 *   the cloud; a fast Nano delete/edit is ignored.
 * - Other hard questions: a timely Nano tool pick can win routing; if Nano
 *   is late or unsure, the cloud answer wins.
 * - Offline hard questions go to the site checklist, unless a timely Nano
 *   tool pick is a real canvas command (not ask_gemini).
 */
export async function raceHardQuestion(opts: {
  judgement: boolean;
  hard: boolean;
  online: boolean;
  deviceReady: boolean;
  nanoTimeoutMs?: number;
  pickNano?: () => Promise<NanoPick | null>;
  askCloud?: () => Promise<CloudAnswer | null>;
}): Promise<HardRaceResult> {
  const timeout = opts.nanoTimeoutMs ?? NANO_ROUTE_TIMEOUT_MS;
  const ranNano = !!(opts.deviceReady && opts.pickNano);
  const nanoP = ranNano ? withTimeoutOutcome(opts.pickNano!(), timeout) : null;
  const startCloud = opts.online && opts.hard && !!opts.askCloud;
  const cloudP = startCloud ? opts.askCloud!() : null;

  if (opts.judgement) {
    const nano: NanoRaceNote = 'ignored-judgement';
    if (!opts.online || !cloudP) return { kind: 'offline', nano };
    const cloud = await cloudP;
    return cloud ? { kind: 'cloud', cloud, nano } : { kind: 'failed', nano };
  }

  if (!startCloud) {
    if (nanoP) {
      const outcome = await nanoP;
      if (usefulTool(outcome.pick)) return { kind: 'nano-tool', pick: outcome.pick, nano: 'timely' };
      const nano = noteFromOutcome(outcome, ranNano);
      return opts.hard && !opts.online ? { kind: 'offline', nano } : { kind: 'failed', nano };
    }
    return opts.hard && !opts.online ? { kind: 'offline', nano: 'absent' } : { kind: 'failed', nano: 'absent' };
  }

  return new Promise<HardRaceResult>((resolve) => {
    let done = false;
    let nanoDone = !nanoP;
    let nanoNote: NanoRaceNote = nanoP ? 'pending' : 'absent';
    let cloudValue: CloudAnswer | null | undefined = cloudP ? undefined : null;

    const finish = (r: HardRaceResult) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const settle = () => {
      if (done) return;
      // A timely useful Nano tool still wins even if the cloud hop ran first.
      if (nanoDone && nanoNote === 'timely' && nanoPick) {
        finish({ kind: 'nano-tool', pick: nanoPick, nano: 'timely' });
        return;
      }
      if (cloudValue) {
        finish({ kind: 'cloud', cloud: cloudValue, nano: nanoNote });
        return;
      }
      if (nanoDone && cloudValue === null) finish({ kind: 'failed', nano: nanoNote });
    };

    let nanoPick: NanoPick | undefined;
    if (nanoP) {
      void nanoP.then((outcome) => {
        nanoDone = true;
        nanoNote = noteFromOutcome(outcome, ranNano);
        if (usefulTool(outcome.pick)) nanoPick = outcome.pick;
        settle();
      });
    }
    if (cloudP) {
      void cloudP.then(async (cloud) => {
        if (nanoP && !nanoDone) {
          const none = Symbol('none');
          const already = await Promise.race([nanoP, Promise.resolve(none)]);
          if (already !== none) {
            const outcome = already as { pick: NanoPick | null; late: boolean };
            nanoDone = true;
            nanoNote = noteFromOutcome(outcome, ranNano);
            if (usefulTool(outcome.pick)) nanoPick = outcome.pick;
          }
        }
        cloudValue = cloud;
        settle();
      });
    }
  });
}
