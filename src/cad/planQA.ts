// On-device plan questions. "What's the wall thickness?", "how big is the
// kitchen?", "how wide is this door?" are answered by READING the drawing —
// the numbers come from the plan data, never from a model's guess. Works with
// no network. Nano may rephrase a question into one of these forms; the answer
// itself is always computed here.

import { dimLength, wallLength, type PlanDoc } from '../plan/doc';
import { roomSize, stairGeometry, totalWallLength } from './guidelines';

export interface PlanAnswer {
  /** The spoken / shown answer. */
  text: string;
  /** Ids to highlight on the canvas. */
  ids: string[];
  /** Which question kind matched (for the ledger / tests). */
  kind: 'wall-thickness' | 'wall-length' | 'room-size' | 'room-list' | 'door-width' | 'window-width' | 'stairs' | 'counts' | 'height';
}

const m = (mm: number) => `${(mm / 1000).toFixed(2)} m`;
const mmS = (mm: number) => `${Math.round(mm)} mm`;

function uniq(nums: number[]): number[] {
  return [...new Set(nums.map((n) => Math.round(n)))].sort((a, b) => a - b);
}

/** Is this a question about the drawing's own numbers? (cheap gate). */
export function isPlanQuestion(utterance: string): boolean {
  const t = utterance.trim().toLowerCase();
  // Edits ("make this wall 4 metres long") are never questions.
  if (/^(please )?(make|set|move|add|change|resize|rotate|delete|remove|draw|put|place|extend|shorten|widen|narrow|undo|redo|select|rename|split|join|open|close)\b/.test(t)) return false;
  const asks = /\?$/.test(t)
    || /^(what|what's|whats|how|which|is|are|tell me|do|does|can you tell|give me the|show me the)\b/.test(t)
    || /\b(wall thickness|door width|room (?:area|size)|how (?:big|wide|thick|large|tall))\b/.test(t);
  if (!asks) return false;
  return /\b(wall|walls|room|rooms|kitchen|bed ?room|bath ?room|toilet|living|hall|door|doors|window|windows|stair|stairs|staircase|plan|house|flat|area|ceiling|thick|thickness)\b/.test(t);
}

/** Answer a plan-data question, or null when this isn't one we can measure. */
export function answerPlanQuestion(doc: PlanDoc, utterance: string): PlanAnswer | null {
  const t = utterance.toLowerCase();
  const sel = doc.selectedId;

  // Wall thickness
  if (/thick/.test(t) && /wall|it|this/.test(t)) {
    const w = doc.walls.find((x) => x.id === sel);
    if (w) return { kind: 'wall-thickness', ids: [w.id], text: `This wall is ${mmS(w.thickness)} thick.` };
    if (!doc.walls.length) return { kind: 'wall-thickness', ids: [], text: 'There are no walls in the drawing yet.' };
    const ts = uniq(doc.walls.map((x) => x.thickness));
    if (ts.length === 1) return { kind: 'wall-thickness', ids: [], text: `All ${doc.walls.length} walls are ${mmS(ts[0])} thick.` };
    const outer = Math.max(...ts);
    return {
      kind: 'wall-thickness', ids: [],
      text: `Walls are ${ts.map(mmS).join(', ')} thick. The thickest (${mmS(outer)}) are usually the outer walls.`,
    };
  }

  // Ceiling / wall height
  if (/\b(height|tall|ceiling)\b/.test(t) && /wall|ceiling|room/.test(t)) {
    const hs = uniq(doc.walls.map((x) => x.height ?? 2500));
    if (!hs.length) return null;
    return { kind: 'height', ids: [], text: hs.length === 1 ? `Walls are ${m(hs[0])} high.` : `Wall heights: ${hs.map(m).join(', ')}.` };
  }

  // Doors / windows
  const opening = /\bdoor/.test(t) ? 'door' : /\bwindow/.test(t) ? 'window' : null;
  if (opening && /\b(wide|width|size|big)\b/.test(t)) {
    const list = doc.openings.filter((o) => o.kind === opening);
    const picked = list.find((o) => o.id === sel);
    if (picked) return { kind: opening === 'door' ? 'door-width' : 'window-width', ids: [picked.id], text: `This ${opening} is ${mmS(picked.width)} wide.` };
    if (!list.length) return { kind: opening === 'door' ? 'door-width' : 'window-width', ids: [], text: `There are no ${opening}s yet.` };
    const ws = uniq(list.map((o) => o.width));
    return {
      kind: opening === 'door' ? 'door-width' : 'window-width',
      ids: list.map((o) => o.id),
      text: `${list.length} ${opening}${list.length === 1 ? '' : 's'}: ${ws.map(mmS).join(', ')} wide.`,
    };
  }

  // Stairs
  if (/\bstair/.test(t)) {
    const st = doc.fixtures.filter((f) => f.kind.includes('stair'));
    if (!st.length) return { kind: 'stairs', ids: [], text: 'There are no stairs in the drawing yet.' };
    const f = st.find((x) => x.id === sel) ?? st[0];
    const g = stairGeometry(f);
    return { kind: 'stairs', ids: [f.id], text: `The stair has ${g.risers} steps of ${mmS(g.rise)}, with ${mmS(g.tread)} treads, ${m(f.d)} wide.` };
  }

  // A named room
  const room = doc.rooms.find((r) => {
    const n = r.name.toLowerCase();
    return t.includes(n) || n.split(/\s+/).some((word) => word.length > 3 && t.includes(word));
  }) ?? (/\b(this|that) room\b/.test(t) ? doc.rooms.find((r) => r.id === sel || r.wallIds.includes(sel ?? '')) : undefined);
  if (room && /\b(big|size|area|wide|long|dimension|large|small)\b|how much space/.test(t)) {
    const s = roomSize(room, doc);
    if (!s) return { kind: 'room-size', ids: [room.id], text: `I can't measure the ${room.name}: its walls don't close.` };
    return {
      kind: 'room-size', ids: [room.id, ...room.wallIds],
      text: `The ${room.name} is ${m(s.length)} by ${m(s.width)}, about ${s.area.toFixed(1)} m².`,
    };
  }

  // Wall length (selected wall)
  if (/\b(long|length)\b/.test(t) && /wall|this|it/.test(t)) {
    const w = doc.walls.find((x) => x.id === sel);
    if (w) return { kind: 'wall-length', ids: [w.id], text: `This wall is ${m(wallLength(w))} long.` };
    const dim = doc.dims.find((d) => d.id === sel);
    const len = dim ? dimLength(dim, doc) : null;
    if (dim && len !== null) return { kind: 'wall-length', ids: [dim.id], text: `That measures ${m(len)}.` };
    if (doc.walls.length) return { kind: 'wall-length', ids: [], text: `All walls add up to ${m(totalWallLength(doc))}. Point at one wall for its length.` };
  }

  // List rooms / total area
  if (/\b(rooms|area|how big)\b/.test(t)) {
    if (!doc.rooms.length) return null;
    let total = 0;
    const parts = doc.rooms.map((r) => {
      const s = roomSize(r, doc);
      total += s?.area ?? 0;
      return `${r.name} ${s ? `${s.area.toFixed(1)} m²` : '(open)'}`;
    });
    return { kind: 'room-list', ids: doc.rooms.map((r) => r.id), text: `${doc.rooms.length} rooms, ${total.toFixed(1)} m² in total: ${parts.join(', ')}.` };
  }

  if (/how many/.test(t)) {
    const n = (k: string) => doc.openings.filter((o) => o.kind === k).length;
    return {
      kind: 'counts', ids: [],
      text: `${doc.walls.length} walls, ${doc.rooms.length} rooms, ${n('door')} doors, ${n('window')} windows.`,
    };
  }
  return null;
}
