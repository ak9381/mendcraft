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

export type EngineId = 'nano' | 'gemini';

export interface SurfaceEngine {
  id: EngineId;
  /** Scripted stand-in (no model on this device). Shown as SIM, never hidden. */
  sim: boolean;
  /** Honest route-line override (e.g. a phone with no Nano: "Gemini · cloud —
   *  Nano isn't on this phone, so Deep drafted it"). Replaces the default line. */
  routeLine?: string;
  /** Stream text; call onText with the full text so far. Resolve with the final text. */
  stream(prompt: string, onText: (full: string) => void): Promise<string>;
  /** Scripted stand-in used when this engine fails or times out. Always labelled SIM. */
  fallback?: SurfaceEngine;
}

export interface DeviceHint { id: string; label: string; kind: string; host?: string }
export interface SurfaceRequest { utterance: string; frameTitle: string; devices: DeviceHint[]; current?: SurfacePlan | null }
export interface SentInfo { engine: EngineId; prompt: string; sent: string | null; routeLine: string; sim: boolean }

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
  onText?(full: string): void;
  onGhost?(p: PartialPlan): void;
  onError?(why: string): void;
  /** Soft warnings from a still-valid plan (dropped unknown tiles, etc.). */
  onNote?(note: string): void;
}

/** How long a live Gemini stream may sit without finishing before we retry. */
export const GEMINI_TIMEOUT_MS = 20_000;

/** Run `fn`, retrying once if it rejects or exceeds `timeoutMs`. */
export async function withTimeoutRetry<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; retries?: number; sleep?: (ms: number) => Promise<void> } = {},
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

/** Run one engine over one request. Returns a validated plan or null. */
export async function runSurfaceTurn(req: SurfaceRequest, engine: SurfaceEngine, ui: TurnUi = {}, opts: { deviceIdSession?: DeviceIdSession; isCancelled?: () => boolean; timeoutMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<SurfacePlan | null> {
  const sent = buildSurfacePrompt(req, engine.id, { sim: engine.sim, deviceIdSession: opts.deviceIdSession });
  if (engine.routeLine) sent.routeLine = engine.routeLine;
  ui.onSent?.(sent);
  let ghostCount = -1;
  let final: string;
  const throwIfCancelled = (): void => { if (opts.isCancelled?.()) throw new MidStreamOffline(); };
  const streamOne = async (eng: SurfaceEngine) => eng.stream(sent.prompt, (full) => {
    throwIfCancelled();
    ui.onText?.(full);
    const g = parsePartialPlan(full);
    if (g.tiles.length !== ghostCount) { ghostCount = g.tiles.length; ui.onGhost?.(g); }
  });
  const streamMaybeTimed = (eng: SurfaceEngine) => (
    eng.id === 'gemini' && !eng.sim
      ? withTimeoutRetry(() => streamOne(eng), { timeoutMs: opts.timeoutMs ?? GEMINI_TIMEOUT_MS, retries: 1, sleep: opts.sleep })
      : streamOne(eng)
  );
  try {
    final = await streamMaybeTimed(engine);
    throwIfCancelled();
  } catch (e) {
    if (e instanceof MidStreamOffline) {
      ui.onError?.(OFFLINE_MID_LINE);
      return null;
    }
    if (!engine.fallback) {
      ui.onError?.(`${engine.id === 'nano' ? 'Nano' : 'Gemini'} didn’t answer: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    sent.sim = true;
    sent.routeLine = `SIM · ${sent.routeLine.replace(/^SIM · /, '')} — the model didn’t answer, so a prepared draft is waiting`;
    ui.onFallback?.(sent);
    try {
      final = await streamOne(engine.fallback);
      throwIfCancelled();
    } catch (e2) {
      if (e2 instanceof MidStreamOffline) {
        ui.onError?.(OFFLINE_MID_LINE);
        return null;
      }
      ui.onError?.(`${engine.id === 'nano' ? 'Nano' : 'Gemini'} didn’t answer: ${e2 instanceof Error ? e2.message : String(e2)}`);
      return null;
    }
  }
  const g = parsePartialPlan(final);
  if (g.tiles.length !== ghostCount) ui.onGhost?.(g);
  const plan = parseModelPlan(final, opts.deviceIdSession);
  if (!plan.ok) { ui.onError?.(plan.error.startsWith('The reply') ? plan.error : `Refused the plan: ${plan.error}`); return null; }
  for (const note of plan.notes ?? []) ui.onNote?.(note);
  return plan.value;
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
  kind?: 'surface' | 'lang' | 'layout';
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
