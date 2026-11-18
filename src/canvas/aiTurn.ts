// One AI turn on the canvas, made visible: the exact prompt going in, what
// left the device, the model's text streaming back, a ghost of the board
// forming, then a Proposal. Nothing applies without her keep; every kept
// change goes on a history she can undo.
import { coerceSurfacePlan, MAX_TILES, PLAN_TEMPLATES, type SurfacePlan, type TileSpec } from './surfacePlan';

export type EngineId = 'nano' | 'gemini';

export interface SurfaceEngine {
  id: EngineId;
  /** Scripted stand-in (no model on this device). Shown as SIM, never hidden. */
  sim: boolean;
  /** Stream text; call onText with the full text so far. Resolve with the final text. */
  stream(prompt: string, onText: (full: string) => void): Promise<string>;
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

/** Run one engine over one request. Returns a validated plan or null. */
export async function runSurfaceTurn(req: SurfaceRequest, engine: SurfaceEngine, ui: TurnUi = {}): Promise<SurfacePlan | null> {
  const sent = buildSurfacePrompt(req, engine.id, { sim: engine.sim });
  ui.onSent?.(sent);
  let ghostCount = -1;
  let final: string;
  try {
    final = await engine.stream(sent.prompt, (full) => {
      ui.onText?.(full);
      const g = parsePartialPlan(full);
      if (g.tiles.length !== ghostCount) { ghostCount = g.tiles.length; ui.onGhost?.(g); }
    });
  } catch (e) {
    ui.onError?.(`${engine.id === 'nano' ? 'Nano' : 'Gemini'} didn’t answer: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  const g = parsePartialPlan(final);
  if (g.tiles.length !== ghostCount) ui.onGhost?.(g);
  let raw: unknown;
  try { raw = JSON.parse(final.slice(final.indexOf('{'), final.lastIndexOf('}') + 1)); } catch { ui.onError?.('The reply was not a board plan.'); return null; }
  const plan = coerceSurfacePlan(raw);
  if (!plan.ok) { ui.onError?.(`Refused the plan: ${plan.error}`); return null; }
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

export interface HistoryEntry { frameId: string; before: SurfacePlan | null; after: SurfacePlan; by: EngineId | 'her'; summary: string; at: number; undone: boolean }

export function createCanvasHistory() {
  const entries: HistoryEntry[] = [];
  return {
    push(e: Omit<HistoryEntry, 'at' | 'undone'>): HistoryEntry { const h = { ...e, at: Date.now(), undone: false }; entries.push(h); return h; },
    undo(): HistoryEntry | null { for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].undone) { entries[i].undone = true; return entries[i]; } return null; },
    list: () => entries.map((e) => ({ ...e })),
  };
}
export type CanvasHistory = ReturnType<typeof createCanvasHistory>;
