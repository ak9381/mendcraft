// Parallel Nano routing + cloud answer for hard copilot questions.
// Rules-first simple plan questions stay out of this race (handled by the
// caller). Nano is capped at a short timeout; if it is late, the cloud wins.

import type { ToolCall } from './tools';

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
  | { kind: 'nano-tool'; pick: NanoPick }
  | { kind: 'cloud'; cloud: CloudAnswer }
  | { kind: 'offline' }
  | { kind: 'failed' };

function usefulTool(pick: NanoPick | null | undefined): pick is NanoPick {
  return !!pick && pick.call.tool !== 'ask_gemini' && pick.confidence >= 0.5;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }, () => { clearTimeout(t); resolve(null); });
  });
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
  const nanoP = opts.deviceReady && opts.pickNano
    ? withTimeout(opts.pickNano(), timeout)
    : null;
  const startCloud = opts.online && opts.hard && !!opts.askCloud;
  const cloudP = startCloud ? opts.askCloud!() : null;

  if (opts.judgement) {
    if (!opts.online || !cloudP) return { kind: 'offline' };
    const cloud = await cloudP;
    return cloud ? { kind: 'cloud', cloud } : { kind: 'failed' };
  }

  if (!startCloud) {
    if (nanoP) {
      const pick = await nanoP;
      if (usefulTool(pick)) return { kind: 'nano-tool', pick };
    }
    return opts.hard && !opts.online ? { kind: 'offline' } : { kind: 'failed' };
  }

  return new Promise<HardRaceResult>((resolve) => {
    let done = false;
    let nanoFinished = !nanoP;
    let cloudFinished = !cloudP;
    const finish = (r: HardRaceResult) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const maybeFail = () => {
      if (done) return;
      if (nanoFinished && cloudFinished) finish({ kind: 'failed' });
    };

    if (nanoP) {
      void nanoP.then((pick) => {
        nanoFinished = true;
        if (usefulTool(pick)) finish({ kind: 'nano-tool', pick });
        else maybeFail();
      });
    }
    if (cloudP) {
      void cloudP.then((cloud) => {
        cloudFinished = true;
        if (cloud) finish({ kind: 'cloud', cloud });
        else maybeFail();
      });
    }
  });
}
