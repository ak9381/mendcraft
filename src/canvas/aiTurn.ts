// One AI turn on the canvas, made visible: the exact prompt going in, what
// left the device, the model's text streaming back, a ghost of the board
// forming, then a Proposal. Nothing applies without her keep; every kept
// change goes on a history she can undo.
import { extractJson } from '../ai/cloudJson';
import { fillVisible } from '../privacy/directory';
import { coerceSurfacePlan, MAX_TILES, PLAN_TEMPLATES, type SurfacePlan, type TileSpec } from './surfacePlan';
import type { LanguagePack } from './languagePack';

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

const SCHEMA_LINE = `{"kind":"room"|"plan","title":string,"tiles":[{"type":"lamp","deviceId":string,"label":string}|{"type":"plan","boardId":string,"template":${PLAN_TEMPLATES.map((t) => `"${t}"`).join('|')}}]}`;

export function buildSurfacePrompt(req: SurfaceRequest, engine: EngineId, opts: { sim?: boolean } = {}): SentInfo {
  // Addresses and MACs stay on the device; models only see ids and names.
  const devices = req.devices.map((d) => `- ${d.id}: ${d.label} (${d.kind})`).join('\n') || '- none found yet';
  const current = req.current ? `\nCurrent board: ${JSON.stringify(req.current)}` : '';
  const prompt = [
    'You build one board on a smart canvas. Reply with JSON only, matching:',
    SCHEMA_LINE,
    `At most ${MAX_TILES} tiles. Only use device ids from the list. No other widget types.`,
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
  onSent?(s: SentInfo): void;
  onText?(full: string): void;
  onGhost?(p: PartialPlan): void;
  onError?(why: string): void;
}


/** Parse a model reply that may be fenced, have leading prose, or use smart quotes.
 *  Then validate it as a surface plan. Unknown widgets fail validation. */
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

export function parseModelPlan(text: string): { ok: true; value: SurfacePlan } | { ok: false; error: string } {
  const raw = extractJson(text);
  if (raw == null) return { ok: false, error: 'The reply was not a board plan.' };
  const normalized = normalizePlanRaw(raw);
  const filled = fillVisible(JSON.stringify(normalized));
  let parsed: unknown = normalized;
  if (filled.filled) {
    try { parsed = JSON.parse(filled.text); } catch { parsed = normalized; }
  }
  const plan = coerceSurfacePlan(parsed);
  if (!plan.ok) return { ok: false, error: plan.error };
  return plan;
}

/** Run one engine over one request. Returns a validated plan or null. */
export async function runSurfaceTurn(req: SurfaceRequest, engine: SurfaceEngine, ui: TurnUi = {}): Promise<SurfacePlan | null> {
  const sent = buildSurfacePrompt(req, engine.id, { sim: engine.sim });
  if (engine.routeLine) sent.routeLine = engine.routeLine;
  ui.onSent?.(sent);
  let ghostCount = -1;
  let final: string;
  const streamOne = async (eng: SurfaceEngine) => eng.stream(sent.prompt, (full) => {
    ui.onText?.(full);
    const g = parsePartialPlan(full);
    if (g.tiles.length !== ghostCount) { ghostCount = g.tiles.length; ui.onGhost?.(g); }
  });
  try {
    final = await streamOne(engine);
  } catch (e) {
    if (!engine.fallback) {
      ui.onError?.(`${engine.id === 'nano' ? 'Nano' : 'Gemini'} didn’t answer: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
    sent.sim = true;
    sent.routeLine = `SIM · ${sent.routeLine.replace(/^SIM · /, '')} — the model didn’t answer, so a prepared draft is waiting`;
    ui.onSent?.(sent);
    try {
      final = await streamOne(engine.fallback);
    } catch (e2) {
      ui.onError?.(`${engine.id === 'nano' ? 'Nano' : 'Gemini'} didn’t answer: ${e2 instanceof Error ? e2.message : String(e2)}`);
      return null;
    }
  }
  const g = parsePartialPlan(final);
  if (g.tiles.length !== ghostCount) ui.onGhost?.(g);
  const plan = parseModelPlan(final);
  if (!plan.ok) { ui.onError?.(plan.error.startsWith('The reply') ? plan.error : `Refused the plan: ${plan.error}`); return null; }
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
  kind?: 'surface' | 'lang';
  packBefore?: LanguagePack | null;
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
