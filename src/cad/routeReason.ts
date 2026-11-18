// Visible "why it went here" for copilot answers. Pure: built only from the
// real routing decision (rules match, Nano confidence, timeout race, hedge
// winner, offline). Never invented.

export type RouteTier = 'plan-data' | 'nano' | 'gemini' | 'offline' | 'speculative';
export type RouteEngine = 'rules' | 'nano' | 'gemini';
export type RouteWonBy =
  | 'rules'
  | 'nano'
  | 'gemini'
  | 'hedge-primary'
  | 'hedge-backup'
  | 'timeout';

export type NanoRaceNote = 'timely' | 'late' | 'unsure' | 'absent' | 'ignored-judgement' | 'pending';

export interface RouteInfo {
  tier: RouteTier;
  engine: RouteEngine;
  /** Short clause after the badge, or a self-contained sentence for race wins. */
  reason: string;
  wonBy?: RouteWonBy;
  model?: string;
}

export const ROUTE_REASON_MAX = 140;

export function capRouteReason(text: string, max = ROUTE_REASON_MAX): string {
  const t = text.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  const sliced = t.slice(0, max - 1);
  const cut = sliced.lastIndexOf(' ');
  return `${(cut >= 60 ? sliced.slice(0, cut) : sliced).trimEnd()}…`;
}

export function sanitizeRoute(raw: unknown): RouteInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const tiers: RouteTier[] = ['plan-data', 'nano', 'gemini', 'offline', 'speculative'];
  const engines: RouteEngine[] = ['rules', 'nano', 'gemini'];
  const winners: RouteWonBy[] = ['rules', 'nano', 'gemini', 'hedge-primary', 'hedge-backup', 'timeout'];
  if (!tiers.includes(o.tier as RouteTier)) return undefined;
  if (!engines.includes(o.engine as RouteEngine)) return undefined;
  if (typeof o.reason !== 'string' || !o.reason.trim()) return undefined;
  const route: RouteInfo = {
    tier: o.tier as RouteTier,
    engine: o.engine as RouteEngine,
    reason: capRouteReason(o.reason),
  };
  if (winners.includes(o.wonBy as RouteWonBy)) route.wonBy = o.wonBy as RouteWonBy;
  if (typeof o.model === 'string' && o.model.trim()) route.model = o.model.trim().slice(0, 80);
  return route;
}

/** Map a returned Gemini model id to the hedge winner, when we have one. */
export function wonByFromModel(model?: string | null): RouteWonBy | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (m.includes('3.1')) return 'hedge-backup';
  if (m.includes('3.5')) return 'hedge-primary';
  if (m.includes('gemini')) return 'gemini';
  return undefined;
}

export function routePlanData(opts?: { nanoUnderstood?: boolean }): RouteInfo {
  return {
    tier: 'plan-data',
    engine: 'rules',
    reason: opts?.nanoUnderstood
      ? 'Nano understood the question; numbers came from the drawing'
      : 'answered straight from the drawing, no AI needed',
    wonBy: 'rules',
  };
}

export function routeNanoCanvas(): RouteInfo {
  return {
    tier: 'nano',
    engine: 'nano',
    reason: 'a canvas action, handled locally',
    wonBy: 'nano',
  };
}

export function routeOffline(opts?: { refineQueued?: boolean }): RouteInfo {
  return {
    tier: 'offline',
    engine: 'rules',
    reason: opts?.refineQueued
      ? "answered from the drawing; Gemini will check when you're back online"
      : 'kept on device',
    wonBy: 'rules',
  };
}

export function routeGemini(opts: {
  kind?: 'judgment' | 'email' | 'guideline' | 'hard';
  nano?: NanoRaceNote;
  nanoTimeoutMs?: number;
  model?: string;
  why?: string;
  /** Word counts when the on-device condenser shortened her ramble first. */
  condensed?: { from: number; to: number };
  /** Redaction counts when the sent payload swapped names for neutral tokens. */
  redacted?: { names: number; details: number };
}): RouteInfo {
  const wonBy = wonByFromModel(opts.model) ?? 'gemini';
  const timeoutS = Math.max(1, Math.round((opts.nanoTimeoutMs ?? 2000) / 1000));
  let reason: string;
  if (opts.nano === 'late') {
    reason = `Gemini won — Nano took over ${timeoutS} s`;
  } else if (opts.nano === 'unsure') {
    reason = 'Nano unsure, Gemini answer used';
  } else if (opts.kind === 'judgment') {
    reason = 'needs structural judgment';
  } else if (opts.kind === 'email') {
    reason = 'needs writing (client email)';
  } else if (opts.kind === 'guideline') {
    reason = 'needs a guideline explanation';
  } else if (opts.why && opts.why.trim()) {
    reason = capRouteReason(opts.why);
  } else {
    reason = 'needs a cloud answer';
  }
  // On-device pre-processing receipts ride the same line as short suffixes.
  const extras: string[] = [];
  if (opts.condensed && opts.condensed.to < opts.condensed.from) {
    extras.push(`Nano condensed ${opts.condensed.from} → ${opts.condensed.to} words on device`);
  }
  if (opts.redacted) {
    const { names, details } = opts.redacted;
    if (names > 0) extras.push(`${names} name${names === 1 ? '' : 's'} kept on device`);
    else if (details > 0) extras.push(`${details} private detail${details === 1 ? '' : 's'} kept on device`);
  }
  if (extras.length) reason = capRouteReason([reason, ...extras].join(' · '));
  return {
    tier: 'gemini',
    engine: 'gemini',
    reason,
    wonBy,
    ...(opts.model ? { model: opts.model } : {}),
  };
}

/** Keep "because …" factual; drop source badges and canned placeholders. The
 *  engine CONCATENATES canned state sentences onto the draft's why ("Nano's
 *  guess while you were still speaking. Gemini confirmed this guess."), so
 *  they are stripped wherever they appear, not only as the whole string. */
export function becauseFromSpecWhy(why?: string): string | undefined {
  if (!why) return undefined;
  let t = why.trim().replace(/\s+/g, ' ');
  if (!t) return undefined;
  if (/^Gemini · /i.test(t)) return undefined;
  t = t
    .replace(/The user is asking[^.?!]*[.?!]/gi, ' ')
    .replace(/Nano's guess while you were still speaking\.?/gi, ' ')
    .replace(/Gemini (?:confirmed|corrected|withdrew) this guess\.?/gi, ' ')
    .replace(/Gemini disagreed with Nano's guess\.?/gi, ' ')
    .replace(/Gemini updated the answer\.?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:Gemini corrected Nano's guess:|Withdrawn:)\s*/i, '')
    .trim();
  if (!t) return undefined;
  const because = t.match(/\bbecause\s+(.+)/i);
  if (because) return capRouteReason(because[1]);
  return capRouteReason(t);
}

export function routeSpeculative(opts: {
  state: 'draft' | 'confirmed' | 'corrected' | 'withdrawn';
  because?: string;
}): RouteInfo {
  const because = becauseFromSpecWhy(opts.because) ?? '';
  let reason: string;
  if (opts.state === 'draft') {
    reason = 'still speaking, pending review';
  } else if (opts.state === 'confirmed') {
    reason = because ? `Gemini confirmed because ${because}` : 'Gemini confirmed this guess';
  } else if (opts.state === 'corrected') {
    reason = because ? `Gemini corrected because ${because}` : 'Gemini corrected this guess';
  } else {
    reason = because ? `Gemini withdrew this guess because ${because}` : 'Gemini withdrew this guess';
  }
  return {
    tier: 'speculative',
    engine: opts.state === 'draft' ? 'nano' : 'gemini',
    reason,
    wonBy: opts.state === 'draft' ? 'nano' : 'gemini',
  };
}

/** One muted demo line: badge, then an em dash, then the reason. */
export function formatRouteLine(route: RouteInfo): string {
  const reason = capRouteReason(route.reason);
  if (route.tier === 'plan-data') return `Plan data · on device — ${reason}`;
  if (route.tier === 'nano') return `Nano · on device — ${reason}`;
  if (route.tier === 'offline') return `Offline — ${reason}`;
  if (route.tier === 'speculative') return `Nano's guess — ${reason}`;
  if (reason.startsWith('Gemini won') || reason.startsWith('Nano unsure')) return reason;
  return `Gemini · cloud — ${reason}`;
}
