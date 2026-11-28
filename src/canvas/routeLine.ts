// Where one spoken / typed line goes — the routing half of canvasApp's run(),
// pure so it can be tested and so the next-step chips (nextSteps.ts) check
// their phrases against the very same table. run() switches on the result;
// the live flows that consume speech (morph card, pair-first) still get first
// claim in run() before this is asked.
import { parseCanvasCommand, type CanvasCommand } from './canvasCommands';
import { connectAsk } from './connectTurns';
import { parseDeviceCommands, type DeviceCommandResult, type DeviceRef } from './deviceCommands';
import { parseGimbalSpeech } from './gimbalCanvas';
import { deviceStateAnswer } from './deviceStateAnswer';
import { parseLanguageAsk, routePackPhrase, type IntentKey, type LanguagePack } from './languagePack';
import { LANGUAGES } from '../ai/language';
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
  /** "show artifacts": the stored artifacts sheet (list, Remove, Export, Import). */
  | { name: 'artifacts' }
  | { name: 'showAi' } | { name: 'monitor' } | { name: 'activityTab' } | { name: 'hideAi' }
  | { name: 'tool'; tool: ToolVoice }
  | { name: 'scroll'; dir: 'up' | 'down'; page: boolean }
  | { name: 'packIntent'; intent: IntentKey }
  | { name: 'pointConnect' }
  | { name: 'gimbalScan' } | { name: 'gimbal' }
  /** "add Kannada" / "switch to Hindi" / "in Tamil": a language pack for `code`
   *  (a code outside LANG_SCRIPTS is refused; 'en' goes back to English).
   *  `fresh`: "make a new Kannada pack" asks Gemini even with one stored. */
  | { name: 'language'; code: string; fresh: boolean }
  | { name: 'history' }
  | { name: 'planExtra'; extra: PlanExtra }
  | { name: 'canvas'; cmd: CanvasCommand }
  | { name: 'musicSearch'; query: string; deviceId: string }
  | { name: 'device'; result: DeviceCommandResult }
  /** "is the lamp on?": the answer, read from the device store. */
  | { name: 'deviceState'; line: string }
  | { name: 'connectDevices'; dashboard: boolean }
  /** "show my devices": a generated board around the live devices table. */
  | { name: 'showDevices' }
  | { name: 'connectRoom' }
  | { name: 'floorPlan' }
  | { name: 'planEdit' }
  | { name: 'connectSheet' } | { name: 'connectByName' }
  | { name: 'openEnded' };
export type RouteName = Route['name'];

/** Tools > More buttons by voice (the menu hides them; speech never needs to open it). */
export type ToolVoice = 'handsOn' | 'handsOff' | 'dwell' | 'handsAlways' | 'handsFollowFace' | 'register' | 'offline' | 'online' | 'swap';
export function matchToolVoice(text: string): ToolVoice | null {
  const t = text.trim().replace(/[.!?]+$/, '').toLowerCase();
  if (/^(turn )?hands on$|^turn on (the )?hands$|^start hands$/.test(t)) return 'handsOn';
  if (/^(turn )?hands off$|^turn off (the )?hands$|^stop hands$/.test(t)) return 'handsOff';
  if (/^(turn )?(on |off )?hover to click( on| off)?$/.test(t)) return 'dwell';
  if (/^(turn off|stop|disable) (the )?(my )?hands always on$|^hands always on off$|^(turn )?(off )?always on hands off$/.test(t)) return 'handsFollowFace';
  if (/^(turn on |enable )?(keep )?(my )?hands always on( on)?$|^always on hands$|^hands on always$/.test(t)) return 'handsAlways';
  if (/^(let )?(my )?hands follow my face$|^hands only when i look$/.test(t)) return 'handsFollowFace';
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
// Speech often adds "to" or drops "at": "connect to what I'm pointing",
// "connect what I am pointing to", "connect the thing I'm pointing at".
const POINT_CONNECT_RE = /\b(?:connect|add|pair|link)(?:\s+(?:to|with))?\s+(?:what|whatever|the\s+(?:thing|device|one)|this\s+thing)(?:\s+that)?\s+i(?:['’]m|\s+am)?\s+(?:point(?:ing|ed)?|showing)(?:\s+(?:at|to|towards?))?\b|^\s*(?:please\s+)?connect this\s*[.!?]?\s*$/i;
export function isPointConnectAsk(text: string): boolean { return POINT_CONNECT_RE.test(text); }

/** "make a dashboard for my desk lamp", "build me a control panel", "I want a
 *  dashboard": a request to BUILD a board — a board turn with a review, never
 *  small talk. A question ("what is a dashboard?") has no build verb. */
const BUILD_BOARD_RE = /\b(make|build|create|design|generate|set\s*up|give\s+me|i\s+(?:want|need|would\s+like|['’]d\s+like))\b[^.?!]*\b(dashboards?|control\s+panels?|remote\s+controls?)\b/i;
/** "… on the dashboard" / "… to my board": where she is, not what she asks for. */
const ON_BOARD_TAIL = /\b(?:on|to|in|onto)\s+(?:the|my|this)\s+(?:dashboards?|control\s+panels?|boards?)\b/gi;
/** "add the speaker to the dashboard": the board is rebuilt with it, through a review. */
const ADD_TO_BOARD_RE = /\badd\b[^.?!]*\b(dashboards?|control\s+panels?|remote\s+controls?)\b/i;
// "show me a dashboard" builds one; "show me the control panel" / "show me
// board 2" are navigation (or chat) unless they say dashboard or a new board.
const SHOW_ME_BOARD_RE = /\bshow\s+me\b[^.?!]*\b(dashboards?|(?:a|an|new)\s+(?:\w+\s+){0,3}board)\b/i;
/** "add the gimbal", "add gimbal controls", "show the gimbal tile", "gimbal controls". */
const ADD_GIMBAL_RE = /^\s*(?:please\s+)?(?:(?:add|show|put|give\s+me|connect|pair|link|set\s+up|hook\s+up)\s+(?:me\s+)?(?:the\s+|a\s+|my\s+|our\s+)?(?:iphone\s+(?:to|on)\s+(?:the\s+|my\s+)?)?(?:gimbal|gimble|gimbel|gimbol|gimbals|gymbal|gymbol|gymbo|gimbo|jimbo|kimbo|kimball?|gambel)(?:\s+stand)?(?:\s+(?:controls?|tile|buttons?))?(?:\s+(?:here|(?:on|to)\s+(?:the|this|my)\s+(?:board|dashboard)))?|(?:the\s+)?gimbal\s+controls?)(?:\s+please)?\s*[.!?]*\s*$/i;
/** "add the gimbal": the canvas asks two questions before the board turn. */
export function isAddGimbalAsk(text: string): boolean { return ADD_GIMBAL_RE.test(text); }
/** "show my devices", "list the connected devices", "what's connected?". */
const SHOW_DEVICES_RE = /^\s*(?:please\s+)?(?:(?:show|list)\s+(?:me\s+)?(?:all\s+)?(?:(?:my|the|our)\s+)?(?:connected\s+)?devices|what(?:'|’)?s\s+connected|what\s+is\s+connected)(?:\s+please)?\s*[.!?]*\s*$/i;
export const isShowDevices = (text: string): boolean => SHOW_DEVICES_RE.test(text);
export function isBuildBoardAsk(text: string): boolean {
  return BUILD_BOARD_RE.test(text) || ADD_TO_BOARD_RE.test(text);
}

/** Every language name she might ask for (English names), code → name. */
const ANY_LANGUAGE_NAMES: Record<string, string> = Object.fromEntries(LANGUAGES.map((l) => [l.code, l.englishName]));

/** "show artifacts", "open my artifacts", "list the stored artifacts", "artifacts". */
const ARTIFACTS_RE = /^\s*(?:please\s+)?(?:(?:show|open|list)\s+(?:me\s+)?(?:(?:my|the|all)\s+)?(?:stored\s+|saved\s+)?)?artifacts(?:\s+please)?\s*[.!?]*\s*$/i;
export const isArtifactsAsk = (text: string): boolean => ARTIFACTS_RE.test(text);

/** "play …" that is a game or a figure of speech, not music. */
const PLAY_NOT_MUSIC = /\b(?:games?|chess|cards?|carrom|football|cricket|tennis|ball|catch|tag|hide|pretend|tricks?|role|along|outside|dead|safe|fair|part|board|tile|video|demo|with\s+(?:me|you|us|him|her|them))\b/i;

/** For a Spotify search, only a clear game or activity is talk ("play chess",
 *  "play a game", "play hide and seek with me"); a title that merely holds
 *  such a word ("Safe and Sound", "Part of Your World", "Hide and Seek",
 *  "Fair Game") is still searched. */
const PLAY_GAME = /^(?:(?:a|an|some|the)\s+)?(?:(?:board|video|card)\s+)?(?:games?|chess|cards|carrom|ludo|football|cricket|tennis|catch)\b|^with\b|\bwith\s+(?:me|us|you|him|her|them)\s*[.!?]*$/i;

export function routeLine(text: string, world: RouteWorld): Route {
  const palette = matchPaletteCommand(text);
  if (palette === 'open') return { name: 'paletteOpen' };
  if (palette === 'close') return { name: 'paletteClose' };
  if (/^\s*teach a gesture\s*$/i.test(text)) return { name: 'teach' };
  if (/^\s*(custom gestures|my gestures)\s*$/i.test(text)) return { name: 'teachList' };
  // "change voice" / "use the Ava voice" / "preview voice": the spoken voice picker.
  const voice = parseChangeVoice(text);
  if (voice) return { name: 'voice', intent: voice };
  if (ARTIFACTS_RE.test(text)) return { name: 'artifacts' };
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
  // "add the gimbal" / "add gimbal controls": an ordinary board turn (the
  // model writes the tile, she reviews it), like "add the speaker to the dashboard".
  if (ADD_GIMBAL_RE.test(text)) return { name: 'connectRoom' };
  // Gimbal phrases: follow my hands / hold still / point / scan the room.
  const gimbal = parseGimbalSpeech(text);
  if (gimbal === 'scan') return { name: 'gimbalScan' };
  if (gimbal) return { name: 'gimbal' };
  const lang = parseLanguageAsk(text, ANY_LANGUAGE_NAMES);
  if (lang) return { name: 'language', ...lang };
  if (/^\s*(show\s+)?history\s*$/i.test(text)) return { name: 'history' };
  // CAD extras only when there is a plan board to run them on.
  const extra = routePlanExtra(text, world.hasPlanBoard);
  if (extra) return { name: 'planExtra', extra };
  // "show me a dashboard for my lights" asks for a board to be built — before
  // the canvas "show …" commands, which would take it for navigation.
  if (SHOW_ME_BOARD_RE.test(text)) return { name: 'connectRoom' };
  if (isShowDevices(text)) return { name: 'showDevices' };
  const cmd = parseCanvasCommand(text);
  if (cmd) return { name: 'canvas', cmd };
  // "play <something>" on a speaker: a search for the speaker connector.
  const mi = parseMusicIntent(text);
  const query = mi?.type === 'searchPlay' && !world.sim && !PLAY_GAME.test(mi.query.trim()) ? spotifySearchQuery(mi.query, !!world.spotifyConnected) : null;
  const speaker = query ? world.devices.find((d) => d.kind === 'music') : undefined;
  if (query && speaker) return { name: 'musicSearch', query, deviceId: speaker.id };
  const result = parseDeviceCommands(text, world.devices, { pointed: world.pointed ?? null });
  if (result) return { name: 'device', result };
  // "play some jazz", "play <song>", "play something relaxing" with no Spotify
  // search to run (not connected, or the sim): the speaker's play, as before
  // — never chat. Not a game: "play chess with me" is talk.
  const musics = world.devices.filter((d) => d.kind === 'music');
  const mp = mi ?? parseMusicIntent(text.replace(/^\s*(?:(?:please|hey|ok|okay|now|can\s+you|could\s+you|would\s+you)[,\s]+)+/i, ''));
  if (mp?.type === 'searchPlay' && musics.length && !PLAY_NOT_MUSIC.test(mp.query)) {
    return { name: 'device', result: { intents: musics.map((d) => ({ deviceId: d.id, playing: true })), say: 'Playing.', statusKey: 'playing' } };
  }
  const state = deviceStateAnswer(text, world.devices);
  if (state) return { name: 'deviceState', line: state };
  const cd = parseConnectDevices(text);
  if (cd) return { name: 'connectDevices', dashboard: cd.dashboard };
  if (/\bconnect (everything|all|the room|this room|my room)\b/i.test(text)) return { name: 'connectRoom' };
  // "add a study next to bedroom 2": an edit to the plan that is already
  // there (a review of the change), never chat and never a fresh draft.
  // Checked before "add … to the dashboard": "add a study next to bedroom 2
  // on the dashboard" is still a plan edit (where she said it doesn't make
  // it a device); only a real build verb makes it a new board.
  if ((world.planBoardExists || world.planFocused) && isPlanEditAsk(text.replace(ON_BOARD_TAIL, ' ')) && !BUILD_BOARD_RE.test(text)) return { name: 'planEdit' };
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
