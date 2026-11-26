// One AI turn on the canvas, made visible: the exact prompt going in, what
// left the device, the model's text streaming back, a ghost of the board
// forming, then a Proposal. Nothing applies without her keep; every kept
// change goes on a history she can undo.
import { extractJson } from '../ai/cloudJson';
import { fillVisible } from '../privacy/directory';
import { redactDeviceIds, restoreDeviceIds, type DeviceIdSession } from '../privacy/deviceRedact';
import { coerceSurfacePlan, MAX_DEPTH, MAX_NODES, MAX_TILES, PLAN_TEMPLATES, type SurfacePlan, type TileSpec } from './surfacePlan';
import type { LanguagePack } from './languagePack';
import { OFFLINE_MID_LINE } from './failLines';
import { CloudCallError, explainCloudFailure } from '../ai/cloudErrors';
import { buildNanoPlanRequest, buildNanoRepairPrompt, buildNanoRepairUser, parseNanoPlan, partialNanoPlan } from './nanoPlan';
import { dropUnbackedClaims } from './planTruth';

export type EngineId = 'nano' | 'gemini';

export interface SurfaceEngine {
  id: EngineId;
  /** Scripted stand-in (no model on this device). Shown as SIM, never hidden. */
  sim: boolean;
  /** Honest route-line override (e.g. a phone with no Nano: "Gemini · cloud —
   *  Nano isn't on this phone, so Deep drafted it"). Replaces the default line. */
  routeLine?: string;
  /** Stream text; call onText with the full text so far. Resolve with the final text. */
  stream(prompt: string, onText: (full: string) => void, opts?: StreamOptions): Promise<string>;
  /** The other REAL engine (Gemini in the cloud) that takes over when this
   *  on-device engine fails, times out or returns an invalid plan. The review
   *  then says Gemini made it, and what was sent. */
  handoff?: SurfaceEngine;
  /** Scripted stand-in, labelled SIM. Engines built for a live run never
   *  carry one (see engines.ts): a failed live call says why and offers Retry. */
  fallback?: SurfaceEngine;
}

/** Extras an on-device engine understands; the others ignore them. */
export interface StreamOptions {
  /** JSON schema the reply must match (Prompt API `responseConstraint`). */
  constraint?: Record<string, unknown>;
  /** Stops the model, not just the wait. */
  signal?: AbortSignal;
  /** The prompt split into its fixed instructions and this turn's part, for
   *  an engine that keeps a warm session holding the instructions. */
  system?: string;
  user?: string;
  /** What the reply is, so the cloud seam accepts it: a board plan (default),
   *  any JSON object (a language pack, one tile, a fix), or plain words. */
  shape?: ReplyShape;
  /** On device: the model's queue gave this call its turn (a deadline should
   *  count from here, not from the time spent waiting in line). */
  onStart?: () => void;
  /** Cloud: one model call really left this device (hedges and retries each
   *  count). Bytes are booked here, not when the turn was started. */
  onCloudSend?: () => void;
  /** Cloud: a call counted as sent turned out to have failed before its
   *  request was issued — take its bytes back. */
  onCloudRetract?: () => void;
}
export type ReplyShape = 'board' | 'json' | 'text';

export interface DeviceHint { id: string; label: string; kind: string; host?: string }
export interface SurfaceRequest { utterance: string; frameTitle: string; devices: DeviceHint[]; current?: SurfacePlan | null; /** The board being filled (names its floor-plan tile). */ frameId?: string; /** What the turn is for, when the caller knows (else her words decide). */ want?: 'room' | 'plan' }
export interface SentInfo { engine: EngineId; prompt: string; sent: string | null; routeLine: string; sim: boolean; /** Gemini took over from the on-device model, and why. */ handoffWhy?: string }

const TEMPLATE_UNION = PLAN_TEMPLATES.map((t) => `"${t}"`).join('|');
// Leaf tiles: device controls plus the general-purpose widgets. Container
// tiles nest more tiles (leaf or container) inside `children`/`tabs[].
// children`/`first`+`second` — that recursion is what lets a reply compose
// a whole dashboard instead of one flat row of device tiles.
const LEAF_SCHEMA = [
  `{"type":"lamp"|"music"|"switch","deviceId":string,"label":string}`,
  `{"type":"scene","sceneId":string,"label":string}`,
  `{"type":"connect","label":string}`,
  `{"type":"plan","boardId":string,"template":${TEMPLATE_UNION}}`,
  `{"type":"stat","label":string,"value":string,"delta":string,"trend":"up"|"down"|"neutral","spark":number[]}`,
  `{"type":"chart","title":string,"chartType":"bar"|"line"|"ring","series":[{"label":string,"value":number}]}`,
  `{"type":"table","title":string,"columns":string[],"rows":string[][],"sortable":boolean,"rowActionLabel":string}`,
  `{"type":"form","title":string,"submitLabel":string,"fields":[{"kind":"toggle","id":string,"label":string,"value":boolean}|{"kind":"slider","id":string,"label":string,"value":number,"min":number,"max":number}|{"kind":"choice","id":string,"label":string,"options":string[],"value":string}]}`,
  `{"type":"visual","title":string,"markup":string}`,
].join('|');
const CONTAINER_SCHEMA = [
  `{"type":"row","children":[Tile]}`,
  `{"type":"grid","columns":2|3|4,"children":[Tile]}`,
  `{"type":"card","title":string,"children":[Tile]}`,
  `{"type":"tabs","tabs":[{"label":string,"children":[Tile]}]}`,
  `{"type":"split","direction":"row"|"column","first":[Tile],"second":[Tile]}`,
].join('|');
/** The Tile grammar on its own — shared with the morph (single-tile) prompt. */
export const TILE_SCHEMA_LINE = `Tile = ${LEAF_SCHEMA} | ${CONTAINER_SCHEMA}`;
const SCHEMA_LINE = [
  `{"kind":"room"|"plan","title":string,"tiles":[Tile]}`,
  TILE_SCHEMA_LINE,
].join('\n');

export function buildSurfacePrompt(req: SurfaceRequest, engine: EngineId, opts: { sim?: boolean; deviceIdSession?: DeviceIdSession } = {}): SentInfo {
  // Real device ids never reach the cloud: Gemini only ever sees this
  // session's stable "Device N" placeholders (Nano, which never leaves the
  // device, keeps seeing the real ids). See parseModelPlan for the reverse.
  const session = engine === 'gemini' ? opts.deviceIdSession : undefined;
  const ids = req.devices.map((d) => d.id);
  let devices = req.devices.map((d) => `- ${d.id}: ${d.label} (${d.kind})`).join('\n') || '- none found yet';
  let current = req.current ? `\nCurrent board: ${JSON.stringify(req.current)}` : '';
  if (session) {
    devices = redactDeviceIds(devices, ids, session);
    if (current) current = `\nCurrent board: ${redactDeviceIds(JSON.stringify(req.current), ids, session)}`;
  }
  const prompt = [
    'You build one board on a smart canvas. Reply with JSON only, matching:',
    SCHEMA_LINE,
    `At most ${MAX_TILES} top-level tiles (a row/grid/card/tabs/split counts as one of those, and can nest more tiles inside — up to ${MAX_DEPTH} levels deep, ${MAX_NODES} tiles total across the whole board). Only use device ids from the list.`,
    'For a simple request, keep it simple and flat, like before. For a richer dashboard or app, compose row/grid/card/tabs/split with stat/chart/table/form/visual tiles.',
    'Never invent a device, a device count or a connection status: you are not given live device state, so no tile may claim what is connected or online.',
    'visual.markup is inline SVG/HTML that gets sanitized before it ever renders: no <script>, no event-handler attributes, no external urls. Mark a clickable region with a data-action attribute (and optionally data-label).',
    `Board: ${req.frameTitle}`,
    `Devices in the room:\n${devices}${current}`,
    `She said: "${req.utterance}"`,
  ].join('\n');
  const sent = engine === 'gemini'
    ? `your words, ${req.devices.length} device names${req.current ? ', the current board layout' : ''}. No camera frames, no device addresses.`
    : null;
  const base = engine === 'nano' ? 'Nano · on device — nothing left this device' : 'Gemini · cloud — sent your words and device names to improve the layout';
  return { engine, prompt, sent, routeLine: opts.sim ? `SIM · ${base}` : base, sim: !!opts.sim };
}

/** Scan `text` from `from` to the end of a JSON object/array; -1 if not closed yet. */
function closeOf(text: string, from: number): number {
  let depth = 0, inStr = false, escp = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (escp) escp = false; else if (c === '\\') escp = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return i; }
  }
  return -1;
}

export interface PartialPlan { kind?: SurfacePlan['kind']; title?: string; tiles: TileSpec[]; rejected: number }

/** Tiles whose JSON has fully arrived, each validated like the final plan. */
export function parsePartialPlan(text: string): PartialPlan {
  const out: PartialPlan = { tiles: [], rejected: 0 };
  const kind = /"kind"\s*:\s*"(room|plan)"/.exec(text); if (kind) out.kind = kind[1] as SurfacePlan['kind'];
  const title = /"title"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (title) { try { out.title = JSON.parse(`"${title[1]}"`); } catch { /* partial escape */ } }
  const at = text.search(/"tiles"\s*:\s*\[/);
  if (at < 0) return out;
  let i = text.indexOf('[', at) + 1;
  for (;;) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    const end = closeOf(text, open);
    if (end < 0) break;
    let tile: unknown;
    try { tile = JSON.parse(text.slice(open, end + 1)); } catch { out.rejected++; i = end + 1; continue; }
    const ok = coerceSurfacePlan({ kind: out.kind ?? 'room', title: 'x', tiles: [...out.tiles, tile] });
    if (ok.ok && ok.value.tiles.length === out.tiles.length + 1) out.tiles = ok.value.tiles; else out.rejected++;
    i = end + 1;
  }
  return out;
}

export interface TurnUi {
  /** Once per turn, before the real send: book it (ledger, receipts, feed). */
  onSent?(s: SentInfo): void;
  /** The real model failed and the scripted (SIM) draft takes over: `s` is the
   *  same SentInfo with its route line updated. Nothing new was sent — book no
   *  bytes and log no second "received". */
  onFallback?(s: SentInfo): void;
  /** The on-device model could not finish and Gemini (cloud) takes over: `s`
   *  is the NEW send — book its bytes and show it — and `why` is the reason. */
  onHandoff?(s: SentInfo, why: string): void;
  /** One cloud model call of turn `s` really left this device (a hedge or a
   *  retry is another one). Book the bytes here — `onSent` only opens the
   *  turn; a call that never left books nothing. */
  onCloudSend?(s: SentInfo): void;
  /** A call booked by onCloudSend turned out never to have left: un-book it. */
  onCloudRetract?(s: SentInfo): void;
  onText?(full: string): void;
  onGhost?(p: PartialPlan): void;
  /** `engine`: the engine whose failure ended the turn. */
  onError?(why: string, engine?: EngineId): void;
  /** Soft warnings from a still-valid plan (dropped unknown tiles, etc.). */
  onNote?(note: string): void;
}

/** How long a live Gemini stream may sit without finishing before we retry. */
export const GEMINI_TIMEOUT_MS = 20_000;

/** Run `fn`, retrying once if it rejects or exceeds `timeoutMs`. */
export async function withTimeoutRetry<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void>; shouldRetry?: (e: unknown) => boolean } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const retries = opts.retries ?? 1;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let last: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    let timer: Promise<never> | undefined;
    try {
      timer = sleep(timeoutMs).then(() => { throw new Error(`timed out after ${Math.round(timeoutMs / 1000)}s`); });
      return await Promise.race([fn(), timer]);
    } catch (e) {
      last = e;
      if (opts.shouldRetry && !opts.shouldRetry(e)) break;
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}


/** Parse a model reply that may be fenced, have leading prose, or use smart quotes.
 *  Then validate it as a surface plan. Unknown tiles are dropped with a note. */
/** Unwrap common model envelopes and default a missing kind when tiles are present. */
export function normalizePlanRaw(raw: unknown, depth = 0): unknown {
  if (!raw || typeof raw !== 'object' || depth > 3) return raw;
  const r = raw as Record<string, unknown>;
  for (const key of ['plan', 'board', 'surface', 'value', 'data']) {
    if (r[key] && typeof r[key] === 'object') return normalizePlanRaw(r[key], depth + 1);
  }
  if (r.kind !== 'room' && r.kind !== 'plan' && Array.isArray(r.tiles)) {
    const kind = r.tiles.some((t) => t && typeof t === 'object' && (t as { type?: string }).type === 'plan') ? 'plan' : 'room';
    return { ...r, kind, title: typeof r.title === 'string' ? r.title : (kind === 'room' ? 'This room' : 'Floor plan') };
  }
  return raw;
}

export function parseModelPlan(text: string, deviceIdSession?: DeviceIdSession): { ok: true; value: SurfacePlan; notes?: string[] } | { ok: false; error: string } {
  const raw = extractJson(text);
  if (raw == null) return { ok: false, error: 'The reply was not a board plan.' };
  const normalized = normalizePlanRaw(raw);
  const stringified = JSON.stringify(normalized);
  // Reverse order from the send side: real device ids back first (a "Device
  // N" placeholder in a lamp/music/switch tile's deviceId), then real names.
  const restored = deviceIdSession ? restoreDeviceIds(stringified, deviceIdSession) : stringified;
  const filled = fillVisible(restored);
  let parsed: unknown = normalized;
  if (filled.text !== stringified) {
    try { parsed = JSON.parse(filled.text); } catch { parsed = normalized; }
  }
  const plan = coerceSurfacePlan(parsed);
  if (!plan.ok) return { ok: false, error: plan.error };
  return plan;
}

class MidStreamOffline extends Error {
  constructor() { super(OFFLINE_MID_LINE); this.name = 'MidStreamOffline'; }
}

/** How long the on-device model gets for a board (first try + one repair)
 *  before Gemini takes over. */
export const NANO_TIMEOUT_MS = 20_000;
/** A live stream re-parses its ghost preview at most this often, so a long
 *  reply can never turn into a parse per token. */
export const GHOST_EVERY_MS = 120;
/** The longest an on-device call may sit in the model's queue before its
 *  20 s clock starts regardless. */
export const NANO_QUEUE_WAIT_MS = 15_000;

/** A failure a second identical call cannot fix: don't spend a retry on it. */
function worthRetry(e: unknown): boolean {
  if (e instanceof MidStreamOffline) return false;
  if (e instanceof CloudCallError) return e.kind === 'timeout' || e.kind === 'busy' || e.kind === 'bad-reply' || e.kind === 'unknown';
  return true;
}

export const NOTHING_SENT = 'Nothing was sent.';

/** One plain line for a failed Gemini call (App Check 403, offline, quota…),
 *  and — when the request never left — that nothing was sent. */
export function geminiFailLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (!(e instanceof CloudCallError) && /^timed out after/.test(msg)) return `Gemini didn’t answer in time (${msg})`;
  // Only a failure raised before the request was issued (no App Check token,
  // no cloud model) says so; a refusal by the endpoint itself does not.
  const f = e instanceof CloudCallError ? { line: e.message, nothingSent: e.nothingSent } : explainCloudFailure(e);
  return f.nothingSent ? `${f.line}. ${NOTHING_SENT}` : f.line;
}

/** Chrome refused the on-device request itself (an option or schema keyword
 *  it does not support) — as opposed to Nano trying and failing. */
export function isNanoUnsupported(e: unknown): boolean {
  const name = e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return name === 'NotSupportedError' || /NotSupportedError|request is invalid|could not be processed/i.test(msg);
}
export const NANO_COULD_NOT_RUN = 'Nano couldn’t run this request';

export interface SurfaceTurnOptions {
  deviceIdSession?: DeviceIdSession;
  isCancelled?: () => boolean;
  /** Gemini's per-attempt budget. */
  timeoutMs?: number;
  /** The on-device model's whole budget. */
  nanoTimeoutMs?: number;
  /** False when the cloud can't be reached right now (offline): no handoff. */
  canHandoff?: () => boolean;
  /** A turn that already has its receipt (connect by name / scan): used as
   *  is for the cloud and scripted paths; a live on-device engine still gets
   *  the short constrained prompt built from the request. */
  sent?: SentInfo;
  /** The longest the on-device call may wait in line before its clock starts
   *  anyway (an engine that never reports its start). */
  nanoQueueWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Run one engine over one request. Returns a validated plan or null.
 *
 *  A live on-device engine gets one short structured prompt, one repair try,
 *  and NANO_TIMEOUT_MS in all; if it can't finish, the turn hands off to its
 *  `handoff` engine (Gemini) with the cloud prompt and its redaction, and the
 *  UI is told (`onHandoff`). If that fails too the turn ends with the reason
 *  (`onError`) — never with a prepared draft. */
export async function runSurfaceTurn(req: SurfaceRequest, engine: SurfaceEngine, ui: TurnUi = {}, opts: SurfaceTurnOptions = {}): Promise<SurfacePlan | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? (() => Date.now());
  const liveNano = engine.id === 'nano' && !engine.sim;
  const nanoReq = liveNano ? buildNanoPlanRequest(req) : null;
  // A prepared receipt is only true for the engine it was written for. When
  // the step is really run by the other engine (a "Nano" step drafted by
  // Gemini on a machine without Nano), the receipt is rebuilt for the engine
  // that actually runs: what leaves, where, and the honest route line.
  const prepared = opts.sent && opts.sent.engine === engine.id ? opts.sent : null;
  const sent = prepared ?? buildSurfacePrompt(req, engine.id, { sim: engine.sim, deviceIdSession: opts.deviceIdSession });
  if (nanoReq) sent.prompt = nanoReq.prompt;
  if (!prepared && engine.routeLine) sent.routeLine = engine.sim && !engine.routeLine.startsWith('SIM') ? `SIM · ${engine.routeLine}` : engine.routeLine;
  ui.onSent?.(sent);
  let ghostCount = -1;
  const throwIfCancelled = (): void => { if (opts.isCancelled?.()) throw new MidStreamOffline(); };
  const showGhost = (full: string, partial: (text: string) => PartialPlan = parsePartialPlan): void => {
    const g = partial(full);
    if (g.tiles.length !== ghostCount) { ghostCount = g.tiles.length; ui.onGhost?.(g); }
  };
  // Nano's reply is a short decision ({"t":…,"d":[ids]}), not tile JSON: its
  // ghost is a tile per device id as each id arrives.
  const nanoPartial = (text: string): PartialPlan => partialNanoPlan(text, req);
  // Only the newest attempt may draw: a stream that timed out and was retried
  // (or handed off) can still be delivering chunks, and must stay silent.
  let attempt = 0;
  const watcher = (eng: SurfaceEngine): ((full: string) => void) => {
    const mine = ++attempt;
    let last = -Infinity;
    const onDevice = eng === engine && !!nanoReq;
    return (full) => {
      if (mine !== attempt) return;
      throwIfCancelled();
      ui.onText?.(full);
      // A tiny on-device reply is looked at on every chunk, so each tile
      // shows the moment its id lands; a long cloud reply is throttled.
      if (onDevice) { showGhost(full, nanoPartial); return; }
      if (!eng.sim) { const t = now(); if (t - last < GHOST_EVERY_MS) return; last = t; }
      showGhost(full);
    };
  };
  const streamOne = (eng: SurfaceEngine, prompt: string, so?: StreamOptions): Promise<string> => eng.stream(prompt, watcher(eng), so);

  /** Validate a real model's plan and strip what nothing backs. */
  const settle = (plan: { value: SurfacePlan; notes?: string[] }, live: boolean): SurfacePlan => {
    const truth = live ? dropUnbackedClaims(plan.value) : { plan: plan.value, notes: [] as string[] };
    for (const note of [...(plan.notes ?? []), ...truth.notes]) ui.onNote?.(note);
    return truth.plan;
  };

  /** The cloud (or scripted) path for `eng`, reporting failures as `eng.id`. */
  const runPlain = async (eng: SurfaceEngine, info: SentInfo, prefix = ''): Promise<SurfacePlan | null> => {
    const live = !eng.sim;
    const fail = (e: unknown): null => {
      if (e instanceof MidStreamOffline) { ui.onError?.(OFFLINE_MID_LINE, eng.id); return null; }
      const line = eng.id === 'gemini' ? geminiFailLine(e) : `Nano didn’t answer: ${e instanceof Error ? e.message : String(e)}`;
      ui.onError?.(`${prefix}${line}`, eng.id);
      return null;
    };
    // Each model call that really leaves is reported once (hedges, retries).
    const so: StreamOptions | undefined = eng.id === 'gemini' && live ? { onCloudSend: () => ui.onCloudSend?.(info), onCloudRetract: () => ui.onCloudRetract?.(info) } : undefined;
    let final: string;
    try {
      final = await (eng.id === 'gemini' && live
        ? withTimeoutRetry(() => streamOne(eng, info.prompt, so), { timeoutMs: opts.timeoutMs ?? GEMINI_TIMEOUT_MS, retries: 1, sleep, shouldRetry: worthRetry })
        : streamOne(eng, info.prompt));
      throwIfCancelled();
    } catch (e) {
      if (e instanceof MidStreamOffline || !eng.fallback) return fail(e);
      info.sim = true;
      info.routeLine = `SIM · ${info.routeLine.replace(/^SIM · /, '')} — the model didn’t answer, so a prepared draft is waiting`;
      ui.onFallback?.(info);
      try {
        final = await streamOne(eng.fallback, info.prompt);
        throwIfCancelled();
      } catch (e2) { return fail(e2); }
    }
    attempt++; // the reply is in: any stream still running is stale
    showGhost(final);
    const plan = parseModelPlan(final, opts.deviceIdSession);
    if (!plan.ok) {
      const why = plan.error.startsWith('The reply') ? plan.error : `Refused the plan: ${plan.error}`;
      ui.onError?.(`${prefix}${live && eng.id === 'gemini' ? why.replace(/^The reply/, 'Gemini’s reply') : why}`, eng.id);
      return null;
    }
    return settle(plan, live && !info.sim);
  };

  if (!nanoReq) return runPlain(engine, sent);

  // ---- live on-device turn: one structured call, one repair, a hard budget
  // that starts when the model's queue hands this call its turn — time spent
  // waiting in line is not Nano being slow.
  const budgetMs = opts.nanoTimeoutMs ?? NANO_TIMEOUT_MS;
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  let over = false;
  const TIMED_OUT = Symbol('nano-timeout');
  let begin!: () => void;
  const began = new Promise<void>((r) => { begin = r; });
  void sleep(opts.nanoQueueWaitMs ?? NANO_QUEUE_WAIT_MS).then(begin);
  const deadline = began.then(() => sleep(budgetMs)).then(() => { if (!over) ctl?.abort(); return TIMED_OUT; });
  const timed = async (p: Promise<string>): Promise<string> => {
    p.catch(() => undefined); // an aborted stream may reject after the deadline already won
    const got = await Promise.race([p, deadline]);
    if (got === TIMED_OUT) throw new Error(`took longer than ${Math.round(budgetMs / 1000)} s`);
    return got as string;
  };
  const so: StreamOptions = { constraint: nanoReq.constraint, signal: ctl?.signal, onStart: begin };
  let why: string;
  let unsupported = false;
  try {
    let text = await timed(streamOne(engine, nanoReq.prompt, { ...so, system: nanoReq.system, user: nanoReq.user }));
    throwIfCancelled();
    let plan = parseNanoPlan(text, req);
    if (!plan.ok) {
      // One repair retry, inside the same budget.
      ui.onNote?.(`Nano’s reply was refused (${plan.error}); asking once more.`);
      text = await timed(streamOne(engine, buildNanoRepairPrompt(nanoReq, plan.error), { ...so, system: nanoReq.system, user: buildNanoRepairUser(nanoReq, plan.error) }));
      throwIfCancelled();
      plan = parseNanoPlan(text, req);
    }
    if (plan.ok) {
      over = true;
      attempt++;
      showGhost(JSON.stringify(plan.value));
      return settle(plan, true);
    }
    why = `its reply was not a valid board: ${plan.error.replace(/^The reply was /, '').replace(/\.$/, '')}`;
  } catch (e) {
    if (e instanceof MidStreamOffline) { over = true; ui.onError?.(OFFLINE_MID_LINE, 'nano'); return null; }
    // Chrome's own refusal is said in plain words, never as its raw error text.
    unsupported = isNanoUnsupported(e);
    why = unsupported ? 'Chrome didn’t accept the request' : e instanceof Error ? e.message : String(e);
  }
  over = true;
  attempt++;
  ctl?.abort(); // stop the model: nobody is waiting for this reply any more

  const cloud = engine.handoff;
  const nanoLine = unsupported ? NANO_COULD_NOT_RUN : `Nano couldn’t finish (${why})`;
  const head = `${nanoLine}. `;
  if (!cloud) { ui.onError?.(`${head}Gemini isn’t available here to take over.`, 'nano'); return null; }
  if (opts.canHandoff && !opts.canHandoff()) { ui.onError?.(`${head}You’re offline, so Gemini can’t take over. ${NOTHING_SENT}`, 'nano'); return null; }
  const handed = buildSurfacePrompt(req, 'gemini', { sim: cloud.sim, deviceIdSession: opts.deviceIdSession });
  handed.handoffWhy = why;
  handed.routeLine = `${cloud.sim ? 'SIM · ' : ''}Gemini · cloud — ${nanoLine}, so Gemini made this`;
  ghostCount = -1;
  ui.onHandoff?.(handed, why);
  return runPlain(cloud, handed, head);
}

/** Scripted engine for the box and ?sim runs: streams fixed JSON in chunks. */
export function scriptedEngine(id: EngineId, json: string, o: { chunk?: number; delayMs?: number } = {}): SurfaceEngine {
  const chunk = o.chunk ?? 18, delay = o.delayMs ?? (id === 'nano' ? 40 : 90);
  return {
    id, sim: true,
    async stream(_prompt, onText) {
      for (let n = chunk; ; n += chunk) {
        const part = json.slice(0, Math.min(n, json.length));
        onText(part);
        if (part.length === json.length) return json;
        if (delay) await new Promise((r) => setTimeout(r, delay));
      }
    },
  };
}

export interface HistoryEntry {
  frameId: string;
  before: SurfacePlan | null;
  after: SurfacePlan | null;
  by: EngineId | 'her';
  summary: string;
  at: number;
  undone: boolean;
  /** 'surface' (default) edits a board; 'lang' swaps the UI language pack. */
  kind?: 'surface' | 'lang' | 'layout' | 'plan' | 'close' | 'resize';
  /** kind 'close': the board that was closed (`before` holds its surface). */
  closedFrame?: import('./frames').Frame;
  /** kind 'close': what was drawn on the closed board's plan(s). */
  closedDrawings?: Record<string, Record<string, unknown>>;
  /** kind 'resize': the board's size before Smaller / Bigger. */
  rectBefore?: { x: number; y: number; w: number; h: number };
  /** kind 'plan': a floor-plan drawing edit — the plan engine's own undo
   *  steps it is made of, and the board mount it belongs to. */
  planSteps?: number;
  planEpoch?: number;
  packBefore?: LanguagePack | null;
  /** kind 'layout': the board's tile layout before / after a nudged move. */
  layoutBefore?: Record<string, { left: number; top: number; width: number; height: number }>;
  layoutAfter?: Record<string, { left: number; top: number; width: number; height: number }>;
  packAfter?: LanguagePack | null;
}

/** Cap on retained history entries — a long session keeps growing entries
 *  otherwise, making the render list (and its full-list scan) ever bigger. */
const HISTORY_CAP = 200;

export function createCanvasHistory() {
  const entries: HistoryEntry[] = [];
  return {
    push(e: Omit<HistoryEntry, 'at' | 'undone'>): HistoryEntry {
      const h = { ...e, at: Date.now(), undone: false };
      entries.push(h);
      if (entries.length > HISTORY_CAP) entries.splice(0, entries.length - HISTORY_CAP);
      return h;
    },
    undo(): HistoryEntry | null { for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].undone) { entries[i].undone = true; return entries[i]; } return null; },
    list: () => entries.map((e) => ({ ...e })),
  };
}
export type CanvasHistory = ReturnType<typeof createCanvasHistory>;
