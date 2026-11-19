// Privacy router — phones without Nano send a prompt to the desktop Chrome
// hub (sync room or LAN). The hub runs rules-first redaction (directory
// tokens like [Client A]), optionally a local Nano pass, then only the
// redacted prompt goes to Gemini. Real names are filled back on the hub
// before the reply returns to the phone. Pure: I/O is injected.

import { fillNames, nothingRaw, protectForCloud, type Person } from '../privacy/directory';
import { utf8ByteLength } from '../canvas/ledger';

export const ROUTE_VIA_HUB = 'routed via Mac: Nano cleaned, then Gemini';
export const ROUTE_LOCAL_CLEAN = 'cleaned on this device: Nano + rules, then Gemini';
export const ROUTE_PHONE_NANO = 'cleaned on this phone: Nano + rules, then Gemini';
export const ROUTE_DIRECT_UNCLEANED = 'Gemini (not cleaned) — no hub reachable';
export const ROUTE_ASK_FIRST = 'ask first — this looks like it has names or numbers, and no hub is here to clean them';
export const ROUTE_PHONE_NO_NANO = 'Gemini (no Nano on this phone)';

export type PrivacyAction = 'hub' | 'local' | 'direct-uncleaned' | 'ask';

export type NanoStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'unknown';

export interface PrivacyContext {
  /** This device can run Gemini Nano right now (Chrome Prompt API or ML Kit AVAILABLE). */
  hasLocalNano: boolean;
  /** Desktop Chrome hub is reachable over the sync room or LAN plugin. */
  hubReachable: boolean;
  /** When no hub and no local Nano, ask before a direct uncleaned cloud call if the text looks sensitive. Default true. */
  askIfSensitive?: boolean;
  isPhone?: boolean;
}

export interface PrivacyDecision {
  action: PrivacyAction;
  routeLine: string;
  cleaned: boolean;
}

export interface PrivacyAsk {
  jobId: string;
  text: string;
}

export interface PrivacyReply {
  jobId: string;
  text: string;
  routeLine: string;
  /** UTF-8 bytes of the redacted prompt that went to Gemini (0 if none). */
  sentBytes: number;
  cleaned: boolean;
  error?: string;
}

export const PRIVACY_TEXT_MAX = 4000;

/** True when rules-first protection would change the text, or a known person is named. */
export function looksSensitive(text: string, people: readonly Person[] = []): boolean {
  if (!text.trim()) return false;
  const protectedText = protectForCloud(text, people).text;
  return protectedText !== text;
}

export function decidePrivacyRoute(
  text: string,
  ctx: PrivacyContext,
  people: readonly Person[] = [],
): PrivacyDecision {
  if (ctx.hasLocalNano) {
    return {
      action: 'local',
      routeLine: ctx.isPhone ? ROUTE_PHONE_NANO : ROUTE_LOCAL_CLEAN,
      cleaned: true,
    };
  }
  if (ctx.hubReachable) {
    return { action: 'hub', routeLine: ROUTE_VIA_HUB, cleaned: true };
  }
  const ask = ctx.askIfSensitive !== false && looksSensitive(text, people);
  if (ask) return { action: 'ask', routeLine: ROUTE_ASK_FIRST, cleaned: false };
  return { action: 'direct-uncleaned', routeLine: ROUTE_DIRECT_UNCLEANED, cleaned: false };
}

export function labelNanoStatus(status: NanoStatus, isPhone: boolean): string {
  if (status === 'available') {
    return isPhone ? 'Nano on this phone' : 'Nano on this device';
  }
  return isPhone ? ROUTE_PHONE_NO_NANO : 'Gemini (no Nano on this device)';
}

/** ML Kit FeatureStatus: UNAVAILABLE=0, DOWNLOADABLE=1, DOWNLOADING=2, AVAILABLE=3. */
export function mapMlKitStatus(code: number): NanoStatus {
  if (code === 3) return 'available';
  if (code === 1) return 'downloadable';
  if (code === 2) return 'downloading';
  if (code === 0) return 'unavailable';
  return 'unknown';
}

export function validatePrivacyAsk(raw: unknown): PrivacyAsk | null {
  if (!raw || typeof raw !== 'object') return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.jobId !== 'string' || !a.jobId || a.jobId.length > 64) return null;
  if (typeof a.text !== 'string' || !a.text.trim() || a.text.length > PRIVACY_TEXT_MAX) return null;
  return { jobId: a.jobId, text: a.text };
}

export function validatePrivacyReply(raw: unknown): PrivacyReply | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.jobId !== 'string' || !r.jobId || r.jobId.length > 64) return null;
  if (typeof r.text !== 'string' || r.text.length > PRIVACY_TEXT_MAX * 2) return null;
  if (typeof r.routeLine !== 'string' || r.routeLine.length > 200) return null;
  if (typeof r.sentBytes !== 'number' || !Number.isFinite(r.sentBytes) || r.sentBytes < 0) return null;
  if (typeof r.cleaned !== 'boolean') return null;
  const out: PrivacyReply = {
    jobId: r.jobId,
    text: r.text,
    routeLine: r.routeLine,
    sentBytes: Math.round(r.sentBytes),
    cleaned: r.cleaned,
  };
  if (typeof r.error === 'string' && r.error.length <= 200) out.error = r.error;
  return out;
}

export function newPrivacyJobId(random: () => number = Math.random): string {
  return `pv-${Date.now().toString(36)}-${Math.floor(random() * 1e9).toString(36)}`;
}

/**
 * Hub-side job: rules-first (and optional Nano) clean, Gemini on the redacted
 * prompt only, then fill real names back. Never sends a payload that still
 * contains a known raw name.
 */
export async function runHubPrivacyJob(
  ask: PrivacyAsk,
  people: readonly Person[],
  gemini: (redacted: string) => Promise<string>,
  opts: {
    nanoClean?: (text: string) => Promise<string>;
    nanoFill?: (text: string, people: readonly Person[]) => Promise<string>;
    planNames?: string[];
  } = {},
): Promise<PrivacyReply> {
  const planNames = opts.planNames ?? [];
  let source = ask.text;
  if (opts.nanoClean) {
    try { source = await opts.nanoClean(source); } catch { /* rules still run */ }
  }
  const cleaned = protectForCloud(source, people, planNames);
  if (people.length && !nothingRaw(cleaned.text, people)) {
    return {
      jobId: ask.jobId,
      text: '',
      routeLine: ROUTE_VIA_HUB,
      sentBytes: 0,
      cleaned: false,
      error: 'refused: a name was still in the prompt',
    };
  }
  let modelText = '';
  try {
    modelText = await gemini(cleaned.text);
  } catch (e) {
    return {
      jobId: ask.jobId,
      text: '',
      routeLine: ROUTE_VIA_HUB,
      sentBytes: utf8ByteLength(cleaned.text),
      cleaned: true,
      error: e instanceof Error ? e.message.slice(0, 200) : 'gemini failed',
    };
  }
  let visible = fillNames(modelText, people).text;
  if (opts.nanoFill) {
    try { visible = fillNames(await opts.nanoFill(visible, people), people).text; } catch { /* keep rules fill */ }
  }
  return {
    jobId: ask.jobId,
    text: visible,
    routeLine: ROUTE_VIA_HUB,
    sentBytes: utf8ByteLength(cleaned.text),
    cleaned: true,
  };
}

/**
 * Local clean (this device has Nano): same rules-first path, then Gemini on
 * the redacted prompt, then fill. Used on a desktop with Prompt API or a
 * phone whose ML Kit checkStatus is AVAILABLE.
 */
export async function runLocalPrivacyJob(
  text: string,
  people: readonly Person[],
  gemini: (redacted: string) => Promise<string>,
  opts: { isPhone?: boolean; planNames?: string[] } = {},
): Promise<PrivacyReply> {
  const jobId = newPrivacyJobId();
  const cleaned = protectForCloud(text, people, opts.planNames ?? []);
  if (people.length && !nothingRaw(cleaned.text, people)) {
    return {
      jobId, text: '', routeLine: opts.isPhone ? ROUTE_PHONE_NANO : ROUTE_LOCAL_CLEAN,
      sentBytes: 0, cleaned: false, error: 'refused: a name was still in the prompt',
    };
  }
  const modelText = await gemini(cleaned.text);
  return {
    jobId,
    text: fillNames(modelText, people).text,
    routeLine: opts.isPhone ? ROUTE_PHONE_NANO : ROUTE_LOCAL_CLEAN,
    sentBytes: utf8ByteLength(cleaned.text),
    cleaned: true,
  };
}
