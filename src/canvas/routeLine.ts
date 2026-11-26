// Where one spoken / typed line goes — the routing half of canvasApp's run(),
// pure so it can be tested and so the next-step chips (nextSteps.ts) check
// their phrases against the very same table. run() switches on the result;
// the live flows that consume speech (morph card, pair-first) still get first
// claim in run() before this is asked.
import { parseCanvasCommand, type CanvasCommand } from './canvasCommands';
import { connectAsk } from './connectTurns';
import { parseDeviceCommands, type DeviceCommandResult, type DeviceRef } from './deviceCommands';
import { parseGimbalSpeech } from './gimbalCanvas';
import { isAddGimbal } from './gimbalTile';
import { routePackPhrase, type IntentKey, type LanguagePack } from './languagePack';
import { parseConnectDevices } from './pairedRow';
import { routePlanExtra, type PlanExtra } from './planExtras';
import { isPlanEditAsk, isPlanEditOnPlanBoard } from './planEdit';
import { spotifySearchQuery } from './spotifyConnector';
import { matchPaletteCommand } from './toolPalette';
import { parseMusicIntent } from '../music/musicIntent';
import { parseChangeVoice, type ChangeVoiceIntent } from '../ai/speechVoices';

export interface RouteWorld {
  /** A plan board that can run the CAD extras (the focused one, else any in overview). */
  hasPlanBoard: boolean;
  /** The focused board holds the floor plan (its drawing is mounted). */
  planFocused?: boolean;
  /** A floor-plan board exists anywhere on the canvas. */
  planBoardExists?: boolean;
  /** The room names on the focused plan ("Bedroom 2"): a bare edit there must name one. */
  planRooms?: readonly string[];
  devices: readonly DeviceRef[];
  /** The device the hand is pointing at, if any. */
  pointed?: DeviceRef | null;
  pack?: LanguagePack | null;
  sim?: boolean;
  /** Spotify tokens are stored (a "play <song>" search can run). */
  spotifyConnected?: boolean;
}

export type Route =
  | { name: 'paletteOpen' } | { name: 'paletteClose' }
  | { name: 'teach' } | { name: 'teachList' }
  | { name: 'voice'; intent: ChangeVoiceIntent }
  | { name: 'showAi' } | { name: 'monitor' } | { name: 'activityTab' } | { name: 'hideAi' }
  | { name: 'tool'; tool: ToolVoice }
  | { name: 'scroll'; dir: 'up' | 'down'; page: boolean }
  | { name: 'packIntent'; intent: IntentKey }
  | { name: 'pointConnect' }
  | { name: 'gimbalScan' } | { name: 'gimbal' } | { name: 'addGimbal' }
  | { name: 'kannada' }
  | { name: 'history' }
  | { name: 'planExtra'; extra: PlanExtra }
  | { name: 'canvas'; cmd: CanvasCommand }
  | { name: 'musicSearch'; query: string; deviceId: string }
  | { name: 'device'; result: DeviceCommandResult }
  | { name: 'connectDevices'; dashboard: boolean }
  | { name: 'connectRoom' }
  | { name: 'floorPlan' }
  | { name: 'planEdit' }
  | { name: 'connectSheet' } | { name: 'connectByName' }
  | { name: 'openEnded' };
export type RouteName = Route['name'];

/** Tools > More buttons by voice (the menu hides them; speech never needs to open it). */
export type ToolVoice = 'handsOn' | 'handsOff' | 'dwell' | 'register' | 'offline' | 'online' | 'swap';
export function matchToolVoice(text: string): ToolVoice | null {
  const t = text.trim().replace(/[.!?]+$/, '').toLowerCase();
  if (/^(turn )?hands on$|^turn on (the )?hands$|^start hands$/.test(t)) return 'handsOn';
  if (/^(turn )?hands off$|^turn off (the )?hands$|^stop hands$/.test(t)) return 'handsOff';
  if (/^(turn )?(on |off )?hover to click( on| off)?$/.test(t)) return 'dwell';
  if (/^(register|register again|re-?register)( me)?$/.test(t)) return 'register';
  if (/^(simulate offline|go offline)$/.test(t)) return 'offline';
  if (/^(go online|go back online|back online)$/.test(t)) return 'online';
  if (/^swap (the )?(phone )?sides$|^swap (the )?phones$/.test(t)) return 'swap';
  return null;
}

/** "scroll down" / "scroll up" / "page down" / "page up" (on the focused
 *  board or the open sheet — the same targets as the peace-and-move gesture). */
export function matchScrollVoice(text: string): { dir: 'up' | 'down'; page: boolean } | null {
  const t = text.trim().replace(/[.!?]+$/, '').toLowerCase();
  const m = /^(?:please\s+)?(scroll|page)\s+(up|down)(?:\s+please)?$/.exec(t);
  return m ? { dir: m[2] as 'up' | 'down', page: m[1] === 'page' } : null;
}

// "connect / add (to) what(ever) I'm pointing at", or a bare "connect this"
// (not "connect this room", which is connectRoom).
const POINT_CONNECT_RE = /\b(connect|add) (to )?(what|whatever) i(['’]m| am)? point(ing)? at\b|^\s*(please\s+)?connect this\s*[.!?]?\s*$/i;

/** "make a dashboard for my desk lamp", "build me a control panel", "I want a
 *  dashboard": a request to BUILD a board — a board turn with a review, never
 *  small talk. A question ("what is a dashboard?") has no build verb. */
const BUILD_BOARD_RE = /\b(make|build|create|design|generate|set\s*up|give\s+me|i\s+(?:want|need|would\s+like|['’]d\s+like))\b[^.?!]*\b(dashboards?|control\s+panels?|remote\s+controls?)\b/i;
// "show me a dashboard" builds one; "show me the control panel" / "show me
// board 2" are navigation (or chat) unless they say dashboard or a new board.
const SHOW_ME_BOARD_RE = /\bshow\s+me\b[^.?!]*\b(dashboards?|(?:a|an|new)\s+(?:\w+\s+){0,3}board)\b/i;
export function isBuildBoardAsk(text: string): boolean {
  return BUILD_BOARD_RE.test(text);
}

export function routeLine(text: string, world: RouteWorld): Route {
  const palette = matchPaletteCommand(text);
  if (palette === 'open') return { name: 'paletteOpen' };
  if (palette === 'close') return { name: 'paletteClose' };
  if (/^\s*teach a gesture\s*$/i.test(text)) return { name: 'teach' };
  if (/^\s*(custom gestures|my gestures)\s*$/i.test(text)) return { name: 'teachList' };
  // "change voice" / "use the Ava voice" / "preview voice": the spoken voice picker.
  const voice = parseChangeVoice(text);
  if (voice) return { name: 'voice', intent: voice };
  if (/^\s*(show\s+models|ai activity|show\s+ai)\s*$/i.test(text)) return { name: 'showAi' };
  // "open AI activity" (optionally "in a new tab"): the log on its own page.
  if (/^\s*open\s+(the\s+)?ai\s+activity(\s+(in|on)\s+(a\s+)?(new\s+|its\s+own\s+)?tab)?\s*[.!]?\s*$/i.test(text) || /^\s*(show\s+)?ai\s+activity\s+(in|on)\s+(a\s+)?(new\s+|its\s+own\s+)?tab\s*[.!]?\s*$/i.test(text)) return { name: 'activityTab' };
  if (/^\s*(open\s+)?(the\s+)?ai\s+monitor\s*$/i.test(text)) return { name: 'monitor' };
  if (/^\s*(hide\s+models|hide\s+ai)\s*$/i.test(text)) return { name: 'hideAi' };
  const tool = matchToolVoice(text);
  if (tool) return { name: 'tool', tool };
  const scroll = matchScrollVoice(text);
  if (scroll) return { name: 'scroll', ...scroll };
  // Active language pack: a spoken phrase routes to the same intents first.
  if (world.pack) { const intent = routePackPhrase(text, world.pack); if (intent) return { name: 'packIntent', intent }; }
  // Point-to-connect: hold a point at a real device; a frame is cropped along
  // the finger and identified. Before the gimbal routes, which also claim
  // "connect what I'm pointing at" for the iPhone gimbal's point mode.
  if (POINT_CONNECT_RE.test(text)) return { name: 'pointConnect' };
  // "add the gimbal" / "gimbal controls": the gimbal tile joins the board.
  if (isAddGimbal(text)) return { name: 'addGimbal' };
  // Gimbal phrases: follow my hands / hold still / point / scan the room.
  const gimbal = parseGimbalSpeech(text);
  if (gimbal === 'scan') return { name: 'gimbalScan' };
  if (gimbal) return { name: 'gimbal' };
  if (/\badd kannada\b/i.test(text) || /ಕನ್ನಡ/.test(text)) return { name: 'kannada' };
  if (/^\s*(show\s+)?history\s*$/i.test(text)) return { name: 'history' };
  // CAD extras only when there is a plan board to run them on.
  const extra = routePlanExtra(text, world.hasPlanBoard);
  if (extra) return { name: 'planExtra', extra };
  // "show me a dashboard for my lights" asks for a board to be built — before
  // the canvas "show …" commands, which would take it for navigation.
  if (SHOW_ME_BOARD_RE.test(text)) return { name: 'connectRoom' };
  const cmd = parseCanvasCommand(text);
  if (cmd) return { name: 'canvas', cmd };
  // "play <something>" on a speaker: a search for the speaker connector.
  const mi = parseMusicIntent(text);
  const query = mi?.type === 'searchPlay' && !world.sim ? spotifySearchQuery(mi.query, !!world.spotifyConnected) : null;
  const speaker = query ? world.devices.find((d) => d.kind === 'music') : undefined;
  if (query && speaker) return { name: 'musicSearch', query, deviceId: speaker.id };
  const result = parseDeviceCommands(text, world.devices, { pointed: world.pointed ?? null });
  if (result) return { name: 'device', result };
  const cd = parseConnectDevices(text);
  if (cd) return { name: 'connectDevices', dashboard: cd.dashboard };
  if (/\bconnect (everything|all|the room|this room|my room)\b/i.test(text)) return { name: 'connectRoom' };
  // "add a study next to bedroom 2": an edit to the plan that is already
  // there (a review of the change), never chat and never a fresh draft.
  if ((world.planBoardExists || world.planFocused) && isPlanEditAsk(text) && !isBuildBoardAsk(text)) return { name: 'planEdit' };
  if (/\bfloor\s*plans?\b/i.test(text)) return { name: 'floorPlan' };
  if (isBuildBoardAsk(text)) return { name: 'connectRoom' };
  const ask = connectAsk(text);
  if (ask === 'sheet') return { name: 'connectSheet' };
  if (ask === 'byName') return { name: 'connectByName' };
  // On the floor-plan board, an edit verb with a room of THIS plan, or with
  // "it" and a size or side ("make it bigger"), is a plan edit.
  if (world.planFocused && isPlanEditOnPlanBoard(text, world.planRooms ?? [])) return { name: 'planEdit' };
  return { name: 'openEnded' };
}
