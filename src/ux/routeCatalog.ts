// Fixed route-line catalog (UX spec §6). Each user-facing line is one of
// these sentences, chosen from the real RouteInfo — never invented.

import type { RouteInfo } from '../cad/routeReason';
import { formatRouteLine } from '../cad/routeReason';
import {
  BY_DEEP,
  BY_QUICK,
  ESCALATION_ROUTE,
  WHAT_WAS_SENT,
  WHY_HERE,
  WHY_ONLINE,
  type HelperName,
  byLineFor,
} from './wording';

export const ROUTE_LINES = {
  smallEdit: 'Small edit to your plan. Done here, nothing sent.',
  planNumbers: "Answered from your plan's own numbers.",
  offline: "You're offline, so this stayed on this device.",
  keepOnDevice: 'You asked to keep work on this device.',
  lighting: 'Lighting needs more power. Sent the plan shape, not photos.',
  escalation: ESCALATION_ROUTE,
  imageIdeas: 'Image ideas need Deep. Sent the room outline and your words.',
  connector: 'Writing a device connector needs Deep.',
  kannada: 'Kannada sentence: Deep understands it better. Sent your words only.',
  browser: 'Opened Pinterest in your browser. Your search words went to Pinterest.',
} as const;

export type RouteLineId = keyof typeof ROUTE_LINES;

export type CatalogKind =
  | 'edit'
  | 'plan-data'
  | 'offline'
  | 'keep-on-device'
  | 'lighting'
  | 'escalation'
  | 'image-ideas'
  | 'connector'
  | 'kannada'
  | 'browser-search'
  | 'email'
  | 'guideline'
  | 'hard';

export interface CatalogInput {
  route: RouteInfo;
  kind?: CatalogKind;
  online?: boolean;
  keepOnDevice?: boolean;
  languageIsKannada?: boolean;
  /** Already-redacted receipt, when anything left the device. */
  sent?: string | null;
  browserTarget?: string;
}

export interface CatalogResult {
  helper: HelperName;
  byLine: string;
  routeLine: string;
  lineId: RouteLineId | 'technical' | 'custom';
  whyLabel: typeof WHY_HERE | typeof WHY_ONLINE;
  whatWasSent: string | null;
  /** Engineering line, shown only under technical details. */
  technicalLine: string;
}

function pickId(input: CatalogInput): RouteLineId {
  const { route, kind, online, keepOnDevice, languageIsKannada } = input;
  if (kind === 'browser-search') return 'browser';
  if (kind === 'keep-on-device' || keepOnDevice && route.tier !== 'gemini') return 'keepOnDevice';
  if (kind === 'offline' || route.tier === 'offline' || online === false) return 'offline';
  if (kind === 'plan-data' || route.tier === 'plan-data') return 'planNumbers';
  if (kind === 'lighting') return 'lighting';
  if (kind === 'image-ideas') return 'imageIdeas';
  if (kind === 'connector') return 'connector';
  if (kind === 'kannada' || (languageIsKannada && (route.tier === 'gemini' || route.engine === 'gemini'))) return 'kannada';
  if (kind === 'escalation' || /unsure|double-check|wasn't sure/i.test(route.reason)) return 'escalation';
  if (route.tier === 'gemini' || (route.tier === 'speculative' && route.engine !== 'nano')) {
    return 'escalation';
  }
  return 'smallEdit';
}

function whatWasSentFor(id: RouteLineId, sent?: string | null, browserTarget?: string): string | null {
  if (id === 'smallEdit' || id === 'planNumbers' || id === 'offline' || id === 'keepOnDevice') {
    return null;
  }
  if (id === 'lighting') return 'the plan shape, not photos';
  if (id === 'imageIdeas') return sent ? sent : 'the room outline and your words';
  if (id === 'connector') return sent ? sent : 'a description of the device';
  if (id === 'kannada' || id === 'escalation') return sent ? sent : 'your words only';
  if (id === 'browser') {
    const where = browserTarget?.trim() || 'Pinterest';
    return `your search words, to ${where}`;
  }
  return sent ?? null;
}

/** Map a real route onto one catalog line, plus an optional "what was sent". */
export function catalogRoute(input: CatalogInput): CatalogResult {
  const { route } = input;
  let helper: HelperName = 'Quick';
  if (input.kind === 'browser-search') helper = 'Browser';
  else if (route.tier === 'gemini' || route.engine === 'gemini' || route.tier === 'speculative') {
    helper = 'Deep';
  }

  // Speculative drafts are still Quick (a Guess); confirmed/corrected are Deep.
  if (route.tier === 'speculative' && route.engine === 'nano') helper = 'Quick';

  const id = pickId(input);
  let routeLine: string = ROUTE_LINES[id];
  if (id === 'browser' && input.browserTarget && input.browserTarget !== 'Pinterest') {
    routeLine = `Opened ${input.browserTarget} in your browser. Your search words went to ${input.browserTarget}.`;
  }
  // Deep default when we only know it went online and have no more specific kind:
  // keep a catalog sentence, don't invent a new reason.
  if (helper === 'Deep' && id === 'escalation' && input.kind && input.kind !== 'escalation' && input.kind !== 'hard' && input.kind !== 'email' && input.kind !== 'guideline') {
    // kind already selected a more specific id above
  }

  const whatWasSent = helper === 'Deep' || helper === 'Browser'
    ? whatWasSentFor(id, input.sent, input.browserTarget)
    : null;

  return {
    helper,
    byLine: byLineFor(helper),
    routeLine,
    lineId: id,
    whyLabel: helper === 'Deep' ? WHY_ONLINE : WHY_HERE,
    whatWasSent,
    technicalLine: formatRouteLine(route),
  };
}

export function formatWhatWasSent(result: CatalogResult): string | null {
  if (!result.whatWasSent) return null;
  return `${WHAT_WAS_SENT}: ${result.whatWasSent}`;
}

export { BY_DEEP, BY_QUICK };
