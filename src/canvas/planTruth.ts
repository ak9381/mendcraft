// Words about a plan come FROM the plan. A review title, a "tiles filled"
// line or a status tile may only say what the plan in front of her actually
// holds: no fixed "2 lamps found" headline over a board with one light and a
// speaker, no "Connected · 0" tile next to an "All connected" button.
import type { DeviceState, SurfacePlan, TileSpec } from './surfacePlan';
import { deviceClassOf, GIMBAL_DEVICE_ID } from './controlSpec';

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
  if (c.hasPlan) return 'Floor plan';
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

/** The one review of a room (Nano draft + Gemini improve shown together):
 *  no earlier draft was reviewed, so no "Better:" comparison. */
export function roomSummary(plan: SurfacePlan): string {
  return betterSummary(plan).replace(/^Better: /, 'This room: ');
}

/** The review title of a generated floor plan: how many rooms it draws. */
export function floorPlanSummary(rooms: readonly { name: string }[]): string {
  return rooms.length ? `Floor plan: ${n(rooms.length, 'room')}` : 'Floor plan';
}

/** The terminal's done line: the tiles she will actually see, counted through
 *  every group — the same tiles the review lists. */
export function tilesFilledLine(plan: SurfacePlan): string {
  const c = countTiles(plan);
  const filled = `${n(c.leaves, 'tile')} filled`;
  return c.leaves !== c.top ? `${filled} in ${n(c.top, 'group')}` : filled;
}

/** A stat tile that claims device state. No model on this canvas is given
 *  live device telemetry, so such a tile is made up — and it contradicted the
 *  real controls next to it. Three shapes: a status/connection word anywhere
 *  ("Desk Lamp Status", "Connected"), a device count ("Devices 3", "3
 *  devices"), and a bare state as the value ("on", "Off", "playing"). */
const STATUS_WORD = /\bstatus\b|\b(dis)?connected\b|\bonline\b|\boffline\b|\bconnection\b|\bpaired\b|\breachable\b/i;
const DEVICE_COUNT = /\bdevices?\s*:?\s*\d|\b\d+\s+devices?\b|\bdevices? (found|online|connected|paired|active)\b/i;
const STATE_VALUE = /^(on|off|playing|paused|stopped|idle|active|inactive|ready|standby|ok|yes|no)$/i;
/** Does this stat tile claim live device state the model was never given? */
export function isStatusClaim(label: string, value: string): boolean {
  const both = `${label} ${value}`;
  return STATUS_WORD.test(both) || DEVICE_COUNT.test(both) || STATE_VALUE.test(value.trim());
}
/** A connect BUTTON must read as the action it performs. */
const CONNECT_AS_STATUS = /\b(all|already|is|are)\b.*\bconnected\b|^connected$|\ball set\b|\bdone\b/i;
export const CONNECT_LABEL = 'Connect a device';

/** Remove what a model's plan claims but nothing backs: invented status
 *  tiles, and a Connect button labelled as a status. Returns the same plan
 *  object when nothing had to change. */
export function dropUnbackedClaims(plan: SurfacePlan): { plan: SurfacePlan; notes: string[] } {
  const notes: string[] = [];
  let renamed = false;
  const clean = (tiles: TileSpec[]): TileSpec[] => {
    const out: TileSpec[] = [];
    for (const t of tiles) {
      if (t.type === 'stat' && isStatusClaim(t.label, t.value)) {
        notes.push(`Dropped a made-up status tile (“${t.label}”).`);
        continue;
      }
      if (t.type === 'connect' && t.label && CONNECT_AS_STATUS.test(t.label)) {
        notes.push(`Renamed a Connect button that read as a status (“${t.label}”).`);
        out.push({ type: 'connect', label: CONNECT_LABEL });
        continue;
      }
      // The Connect button does one thing and has one name. A model does not
      // get to label it — the live run showed it titled with her own words
      // ("connect everything in this room").
      if (t.type === 'connect' && (t.label ?? CONNECT_LABEL) !== CONNECT_LABEL) {
        renamed = true;
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
  if (!notes.length && !renamed) return { plan, notes };
  return { plan: { ...plan, tiles: tiles.length ? tiles : [{ type: 'connect', label: CONNECT_LABEL }] }, notes };
}

// ---- the floor plan has its own board ----

export const FLOOR_PLAN_TITLE = 'Floor plan';

/** A room/dashboard board never holds a floor-plan tile (the floor plan is
 *  its own board): plan tiles are removed from a room plan, an emptied group
 *  goes with them, and a board left with nothing offers "Connect a device".
 *  Same object when there was nothing to remove (and always for plan boards). */
export function roomWithoutPlanTiles(plan: SurfacePlan): SurfacePlan {
  if (plan.kind !== 'room') return plan;
  let changed = false;
  const walk = (tiles: TileSpec[]): TileSpec[] => {
    const out: TileSpec[] = [];
    for (const t of tiles) {
      if (t.type === 'plan') { changed = true; continue; }
      if (t.type === 'row' || t.type === 'grid' || t.type === 'card') {
        const before = changed;
        const children = walk(t.children);
        if (children.length) out.push(changed === before ? t : { ...t, children });
        else changed = true;
      } else if (t.type === 'tabs') {
        const before = changed;
        const tabs = t.tabs.map((tab) => ({ ...tab, children: walk(tab.children) })).filter((tab) => tab.children.length);
        if (!tabs.length) changed = true;
        else out.push(changed === before ? t : { ...t, tabs });
      } else if (t.type === 'split') {
        const before = changed;
        const first = walk(t.first), second = walk(t.second);
        if (changed === before) out.push(t);
        else if (first.length && second.length) out.push({ ...t, first, second });
        else if (first.length + second.length) out.push({ type: 'row', children: [...first, ...second] });
      } else out.push(t);
    }
    return out;
  };
  const tiles = walk(plan.tiles);
  if (!changed) return plan;
  return { ...plan, tiles: tiles.length ? tiles : [{ type: 'connect', label: CONNECT_LABEL }] };
}

/** Where "draw the floor plan" goes: the existing floor-plan board (kind
 *  'plan'); else the board she is on when it is empty (it becomes "Floor
 *  plan"); else a new board. Never a board with tiles on it. */
export function floorPlanTarget(o: {
  frames: readonly { id: string; title: string }[];
  surfaces: Record<string, SurfacePlan | undefined>;
  from: string | null;
}): { id: string | null; existing?: boolean; reuseEmpty?: boolean; make?: boolean } {
  const plan = o.frames.find((f) => o.surfaces[f.id]?.kind === 'plan')
    ?? o.frames.find((f) => f.title === FLOOR_PLAN_TITLE && !o.surfaces[f.id]?.tiles.length);
  if (plan) return { id: plan.id, existing: true };
  if (o.from && o.frames.some((f) => f.id === o.from) && !o.surfaces[o.from]?.tiles.length) return { id: o.from, reuseEmpty: true };
  return { id: null, make: true };
}

type PlanTile = Extract<TileSpec, { type: 'plan' }>;
function firstPlanTile(tiles: readonly TileSpec[]): PlanTile | null {
  for (const t of tiles) {
    if (t.type === 'plan') return t;
    const kids = childrenOf(t);
    const hit = kids ? firstPlanTile(kids) : null;
    if (hit) return hit;
  }
  return null;
}

/** One-time load migration for boards saved before the floor plan had its
 *  own board: a room board's plan tile (and what was drawn on it) moves to a
 *  "Floor plan" board — the existing one, else a new one made by `addPlanFrame`
 *  — BEFORE roomWithoutPlanTiles strips it, so nothing she drew is lost.
 *  Mutates `surfaces` and `drawings`; returns the ids of boards it changed. */
export function liftLegacyPlanTiles(
  frames: readonly { id: string }[],
  surfaces: Record<string, SurfacePlan>,
  drawings: Record<string, Record<string, unknown>>,
  addPlanFrame: () => string | null,
): string[] {
  const changed: string[] = [];
  for (const f of [...frames]) {
    const plan = surfaces[f.id];
    if (plan?.kind !== 'room') continue;
    const tile = firstPlanTile(plan.tiles);
    if (!tile) continue;
    let target = Object.keys(surfaces).find((id) => surfaces[id]?.kind === 'plan') ?? null;
    if (!target) {
      target = addPlanFrame();
      if (!target) continue; // canvas full: leave the board as saved
      surfaces[target] = { kind: 'plan', title: FLOOR_PLAN_TITLE, tiles: [tile] };
      changed.push(target);
    }
    // The drawing follows its tile (unless the floor-plan board already has one).
    const drawn = drawings[f.id]?.[tile.boardId];
    if (drawn !== undefined) {
      drawings[target] ??= {};
      drawings[target][tile.boardId] ??= drawn;
      delete drawings[f.id][tile.boardId];
      if (!Object.keys(drawings[f.id]).length) delete drawings[f.id];
    }
    surfaces[f.id] = roomWithoutPlanTiles(plan);
    changed.push(f.id);
  }
  return changed;
}

// ---- a proposal only binds devices that are here, as what they are ----

/** The review line when a proposal named a device this canvas does not have. */
export const ABSENT_DEVICE_LINE = "Left out a control for a device that isn't connected.";
/** The review line when a tile's type is not what its device really is. */
export const WRONG_CLASS_LINE = "Left out a tile that doesn't match its device.";

/** Leave out every device tile (lamp, speaker, switch, gimbal) whose device is not
 *  in the live store, or is not the class the tile claims (a "music" tile on
 *  a WiZ bulb): a model may only bind what is really here, as what it is.
 *  The gimbal is looked up as GIMBAL_DEVICE_ID: it is here only while an
 *  iPhone is paired (with no stand docked it stays, and says so).
 *  An emptied group goes with it; a board left with nothing offers "Connect
 *  a device". Same plan object when nothing was left out. Stored boards are
 *  NOT passed through this — they load as saved, show "Not connected", and
 *  every press is checked again (bindingIntent). */
export function dropAbsentDevices(plan: SurfacePlan, deviceOf: (deviceId: string) => DeviceState | undefined): { plan: SurfacePlan; dropped: number; mismatched: number } {
  let dropped = 0, mismatched = 0;
  const walk = (tiles: TileSpec[]): TileSpec[] => {
    const out: TileSpec[] = [];
    for (const t of tiles) {
      if (t.type === 'lamp' || t.type === 'music' || t.type === 'switch') {
        const d = deviceOf(t.deviceId);
        if (!d) { dropped++; continue; }
        if (deviceClassOf(t.deviceId, d) !== t.type) { mismatched++; continue; }
        out.push(t);
        continue;
      }
      if (t.type === 'gimbal') {
        const d = deviceOf(GIMBAL_DEVICE_ID);
        if (!d) { dropped++; continue; }
        if (d.cls !== 'gimbal') { mismatched++; continue; }
        out.push(t);
        continue;
      }
      const before = dropped + mismatched;
      const same = () => dropped + mismatched === before;
      if (t.type === 'row' || t.type === 'grid' || t.type === 'card') {
        const children = walk(t.children);
        if (children.length) out.push(same() ? t : { ...t, children });
      } else if (t.type === 'tabs') {
        const tabs = t.tabs.map((tab) => ({ ...tab, children: walk(tab.children) })).filter((tab) => tab.children.length);
        if (tabs.length) out.push(same() ? t : { ...t, tabs });
      } else if (t.type === 'split') {
        const first = walk(t.first), second = walk(t.second);
        if (same()) out.push(t);
        else if (first.length && second.length) out.push({ ...t, first, second });
        else if (first.length + second.length) out.push({ type: 'row', children: [...first, ...second] });
      } else out.push(t);
    }
    return out;
  };
  const tiles = walk(plan.tiles);
  if (!dropped && !mismatched) return { plan, dropped, mismatched };
  return { plan: { ...plan, tiles: tiles.length ? tiles : [{ type: 'connect', label: CONNECT_LABEL }] }, dropped, mismatched };
}
