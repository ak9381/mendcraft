// Words about a plan come FROM the plan. A review title, a "tiles filled"
// line or a status tile may only say what the plan in front of her actually
// holds: no fixed "2 lamps found" headline over a board with one light and a
// speaker, no "Connected · 0" tile next to an "All connected" button.
import type { SurfacePlan, TileSpec } from './surfacePlan';

export interface TileCounts {
  /** Tiles at the top of the board. */
  top: number;
  /** Every tile she can see and use (containers are not counted). */
  leaves: number;
  lamps: number;
  speakers: number;
  switches: number;
  /** Device tiles of any kind. */
  devices: number;
  hasPlan: boolean;
  hasConnect: boolean;
  /** Device tiles sit inside a row/grid/card/tabs/split. */
  grouped: boolean;
}

function childrenOf(t: TileSpec): TileSpec[] | null {
  switch (t.type) {
    case 'row': case 'grid': case 'card': return t.children;
    case 'tabs': return t.tabs.flatMap((tab) => tab.children);
    case 'split': return [...t.first, ...t.second];
    default: return null;
  }
}

export function countTiles(plan: SurfacePlan): TileCounts {
  const c: TileCounts = { top: plan.tiles.length, leaves: 0, lamps: 0, speakers: 0, switches: 0, devices: 0, hasPlan: false, hasConnect: false, grouped: false };
  const walk = (tiles: TileSpec[], nested: boolean): void => {
    for (const t of tiles) {
      const kids = childrenOf(t);
      if (kids) { walk(kids, true); continue; }
      c.leaves++;
      if (t.type === 'lamp') c.lamps++;
      else if (t.type === 'music') c.speakers++;
      else if (t.type === 'switch') c.switches++;
      else if (t.type === 'plan') c.hasPlan = true;
      else if (t.type === 'connect') c.hasConnect = true;
      if (nested && (t.type === 'lamp' || t.type === 'music' || t.type === 'switch')) c.grouped = true;
    }
  };
  walk(plan.tiles, false);
  c.devices = c.lamps + c.speakers + c.switches;
  return c;
}

const n = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

function joinWords(parts: string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "2 lamps", "1 lamp and 1 speaker", "" when the plan has no device tile. */
export function devicePhrase(c: TileCounts): string {
  const parts: string[] = [];
  if (c.lamps) parts.push(n(c.lamps, 'lamp'));
  if (c.speakers) parts.push(n(c.speakers, 'speaker'));
  if (c.switches) parts.push(n(c.switches, 'switch', 'switches'));
  return joinWords(parts);
}

/** The first (on-device) room draft: only what it really put on the board. */
export function draftSummary(plan: SurfacePlan): string {
  const c = countTiles(plan);
  const devices = devicePhrase(c);
  if (devices) return `Draft: ${devices} found in this room`;
  if (c.hasPlan) return floorPlanSummary(plan);
  if (c.hasConnect) return 'Draft: no devices found yet — a Connect tile is ready';
  return `Draft: ${n(c.leaves, 'tile')} for this room`;
}

/** The improved (cloud) room layout: what it holds, and only "grouped" when
 *  device tiles really sit inside a group. */
export function betterSummary(plan: SurfacePlan): string {
  const c = countTiles(plan);
  const parts: string[] = [];
  const devices = devicePhrase(c);
  if (devices) parts.push(c.grouped ? `${devices}, grouped` : devices);
  if (c.hasPlan) parts.push('a room plan');
  const rest = c.leaves - c.devices - (c.hasPlan ? 1 : 0) - (c.hasConnect ? 1 : 0);
  if (rest > 0) parts.push(n(rest, 'more tile'));
  if (!parts.length) return c.hasConnect ? 'Better: a Connect tile, no devices yet' : `Better: ${n(c.leaves, 'tile')}`;
  return `Better: ${parts.join(' + ')}`;
}

const TEMPLATE_WORDS: Record<string, string> = { studio: 'a studio', oneRoom: 'one room', twoBedroom: 'two bedrooms' };

export function floorPlanSummary(plan: SurfacePlan): string {
  let template: string | null = null;
  const walk = (tiles: TileSpec[]): void => {
    for (const t of tiles) {
      if (template) return;
      if (t.type === 'plan') template = t.template;
      else { const kids = childrenOf(t); if (kids) walk(kids); }
    }
  };
  walk(plan.tiles);
  return template ? `Floor plan: ${TEMPLATE_WORDS[template] ?? template}` : 'Floor plan';
}

/** The terminal's done line: the tiles she will actually see, counted through
 *  every group — the same tiles the review lists. */
export function tilesFilledLine(plan: SurfacePlan): string {
  const c = countTiles(plan);
  const filled = `${n(c.leaves, 'tile')} filled`;
  return c.leaves !== c.top ? `${filled} in ${n(c.top, 'group')}` : filled;
}

/** A stat tile that claims connection state. No model on this canvas is given
 *  live device telemetry, so such a tile is made up — and it contradicted the
 *  real controls next to it. */
const STATUS_CLAIM = /\b(dis)?connected\b|\bonline\b|\boffline\b|\bdevice status\b|\bdevices? (found|online|connected|paired)\b|\bconnection\b/i;
/** A connect BUTTON must read as the action it performs. */
const CONNECT_AS_STATUS = /\b(all|already|is|are)\b.*\bconnected\b|^connected$|\ball set\b|\bdone\b/i;
export const CONNECT_LABEL = 'Connect a device';

/** Remove what a model's plan claims but nothing backs: invented status
 *  tiles, and a Connect button labelled as a status. Returns the same plan
 *  object when nothing had to change. */
export function dropUnbackedClaims(plan: SurfacePlan): { plan: SurfacePlan; notes: string[] } {
  const notes: string[] = [];
  const clean = (tiles: TileSpec[]): TileSpec[] => {
    const out: TileSpec[] = [];
    for (const t of tiles) {
      if (t.type === 'stat' && STATUS_CLAIM.test(`${t.label} ${t.value}`)) {
        notes.push(`Dropped a made-up status tile (“${t.label}”).`);
        continue;
      }
      if (t.type === 'connect' && t.label && CONNECT_AS_STATUS.test(t.label)) {
        notes.push(`Renamed a Connect button that read as a status (“${t.label}”).`);
        out.push({ type: 'connect', label: CONNECT_LABEL });
        continue;
      }
      if (t.type === 'row' || t.type === 'grid' || t.type === 'card') {
        const children = clean(t.children);
        if (children.length) out.push({ ...t, children });
        continue;
      }
      if (t.type === 'tabs') {
        const tabs = t.tabs.map((tab) => ({ ...tab, children: clean(tab.children) })).filter((tab) => tab.children.length);
        if (tabs.length) out.push({ ...t, tabs });
        continue;
      }
      if (t.type === 'split') {
        const first = clean(t.first), second = clean(t.second);
        if (first.length && second.length) out.push({ ...t, first, second });
        else if (first.length + second.length) out.push({ type: 'row', children: [...first, ...second] });
        continue;
      }
      out.push(t);
    }
    return out;
  };
  const tiles = clean(plan.tiles);
  if (!notes.length) return { plan, notes };
  return { plan: { ...plan, tiles: tiles.length ? tiles : [{ type: 'connect', label: CONNECT_LABEL }] }, notes };
}
