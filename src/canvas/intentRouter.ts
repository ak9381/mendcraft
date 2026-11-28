// Nano picks the action when no fixed phrase matched. Before a line falls to
// chat (which may only talk, never act), the on-device model gets her words
// and a CLOSED list of actions, and must answer with one of them as JSON
// (Chrome enforces the schema). Code then runs that action exactly as if she
// had said its fixed phrase: same routes, same reviews, same checks. Nothing
// here acts on its own, and an unsure answer asks her first.
import { boardPurpose } from './hearing';

export interface IntentAction {
  id: string;
  /** What Nano reads to choose it. */
  describe: string;
  /** Shown/spoken in the "Did you mean …?" card. */
  label: string;
  /** The fixed phrase that runs it (the same route her words would take). */
  phrase(text: string): string;
}

export const INTENT_ACTIONS: readonly IntentAction[] = [
  { id: 'showDevices', label: 'build the status board', describe: 'the STATUS board: a list of her devices showing only whether each is connected / working, plus a button to connect another. Words like "keep track", "status", "what is connected", "see all my devices" mean this. It has NO controls.', phrase: () => 'show my devices' },
  { id: 'buildDashboard', label: 'build the dashboard', describe: 'the DASHBOARD: buttons and sliders to CONTROL devices (turn the lamp on, dim it, play music, move the gimbal). Words like "control", "turn on", "dim", "play" mean this.', phrase: () => 'build the dashboard' },
  { id: 'connectGimbal', label: 'connect the gimbal', describe: 'connect / add the gimbal stand the iPhone sits on', phrase: () => 'connect the gimbal' },
  { id: 'pointConnect', label: 'connect what you are pointing at', describe: 'connect the device she is pointing at with her hand (the camera takes one photo)', phrase: () => 'connect what I am pointing at' },
  { id: 'connectPhones', label: 'connect your phones', describe: 'pair / connect her phones (iPhone, Android) to this laptop', phrase: () => 'connect my phones' },
  { id: 'connectLamp', label: 'connect the lamp', describe: 'connect the lamp / smart bulb / light by name', phrase: () => 'connect the lamp' },
  { id: 'connectSpeaker', label: 'connect the speaker', describe: 'connect the speaker / music player by name', phrase: () => 'connect the speaker' },
  { id: 'floorPlan', label: 'draw a floor plan', describe: 'draw a floor plan of a house, flat or room', phrase: (t) => `floor plan ${t}` },
  { id: 'newBoard', label: 'open a new board', describe: 'open a new, empty board', phrase: () => 'new board' },
];

export const CHAT_INTENT = 'chat';
export const INTENT_IDS: readonly string[] = [...INTENT_ACTIONS.map((a) => a.id), CHAT_INTENT];

/** The JSON schema Chrome's Prompt API enforces. */
export const INTENT_CONSTRAINT: Record<string, unknown> = {
  type: 'object', additionalProperties: false, required: ['intent', 'confidence'],
  properties: {
    intent: { type: 'string', enum: [...INTENT_IDS] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

export function intentPrompt(text: string): string {
  return [
    'You route one spoken line on a smart canvas to ONE action. Speech recognition makes mistakes: "about" may be "a board", "gymbo" may be "gimbal".',
    'Actions:',
    ...INTENT_ACTIONS.map((a) => `- ${a.id}: ${a.describe}`),
    `- ${CHAT_INTENT}: a question, small talk, or anything that is none of the above`,
    'There are three different boards: the status board (showDevices), the dashboard with controls (buildDashboard), and the floor plan (floorPlan).',
    'Examples: "build me a board to keep track of my devices and their status" -> showDevices. "make a dashboard to control my lamp and speaker" -> buildDashboard. "draw my flat" -> floorPlan.',
    'A question about something (what is…, how does…) is chat, not an action.',
    'Reply with JSON only: {"intent": one id above, "confidence": 0 to 1}. Use chat when unsure what to do.',
    `She said: "${text.replace(/"/g, "'").slice(0, 300)}"`,
  ].join('\n');
}

export interface IntentPick { intent: string; confidence: number }

export function parseIntent(full: string): IntentPick | null {
  const m = /\{[\s\S]*\}/.exec(full);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const intent = typeof o.intent === 'string' ? o.intent : '';
    const confidence = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? Math.max(0, Math.min(1, o.confidence)) : NaN;
    if (!INTENT_IDS.includes(intent) || Number.isNaN(confidence)) return null;
    return { intent, confidence };
  } catch { return null; }
}

/** On-device calls open a fresh session each time: give Nano time, then chat. */
export const INTENT_WAIT_MS = 15_000;
export const INTENT_WORKING_LINE = 'Working out what you meant…';

export const RUN_AT = 0.7;
export const ASK_AT = 0.4;

export type IntentDecision =
  | { kind: 'run'; action: IntentAction }
  | { kind: 'ask'; action: IntentAction }
  | { kind: 'chat' };

export function decideIntent(p: IntentPick | null): IntentDecision {
  if (!p || p.intent === CHAT_INTENT) return { kind: 'chat' };
  const action = INTENT_ACTIONS.find((a) => a.id === p.intent);
  if (!action) return { kind: 'chat' };
  if (p.confidence >= RUN_AT) return { kind: 'run', action };
  if (p.confidence >= ASK_AT) return { kind: 'ask', action };
  return { kind: 'chat' };
}

/** Actions that send to the cloud ask first; so does a question ("what is a
 *  gimbal?"), which is never taken as an order on its own. */
const ASK_FIRST: ReadonlySet<string> = new Set(['floorPlan']);
const QUESTION_RE = /^\s*(?:what|why|how|who|when|where|which)\b|\?\s*$/i;
const REQUEST_RE = /^\s*(?:can|could|would|will)\s+you\b/i;
export function statusNotDashboard(d: IntentDecision, text: string): IntentDecision {
  if (d.kind === 'chat' || d.action.id !== 'buildDashboard') return d;
  if (boardPurpose(text) !== 'status') return d;
  const show = INTENT_ACTIONS.find((a) => a.id === 'showDevices')!;
  return { kind: d.kind, action: show };
}
export function askFirst(d0: IntentDecision, text: string): IntentDecision {
  const d = statusNotDashboard(d0, text);
  if (d.kind !== 'run') return d;
  if (ASK_FIRST.has(d.action.id)) return { kind: 'ask', action: d.action };
  if (QUESTION_RE.test(text) && !REQUEST_RE.test(text)) return { kind: 'ask', action: d.action };
  return d;
}

export const askLine = (a: IntentAction): string => `Did you mean: ${a.label}?`;
export const choicesSpoken = (cs: readonly IntentAction[]): string => `${CHOICES_LINE} ${cs.map((c) => c.label).join(', ')}, or something else?`;
export const understoodLine = (a: IntentAction): string => `Understood: ${a.label}.`;

// ---- Ask, don't guess ----
// A command Mendcraft could not map confidently never goes to chat (chat can
// only talk, so it would answer "I understand…" and do nothing). It asks
// with choices instead; "Something else" lets her say it again.

const COMMAND_RE = /^\s*(?:(?:hey|ok(?:ay)?|so|now|and|then)[,\s]+)*(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?(?!tell\s+me\b|explain\b)|i\s+(?:want|need|would\s+like|'d\s+like)\s+(?:to\s+|a\s+|an\s+|the\s+)?|let(?:'|’)?s\s+)?(?:build|belt|bolt|built|make|create|show|connect|hook|add|put|set\s+up|turn|open|play|draw|give|start|stop|remove|delete|change|move|switch|dim|pair|link|track|view|see|list|bring|get)\b/i;
/** Sounds like an instruction (not a question or small talk). */
const WANT_RE = /^\s*(?:(?:hey|ok(?:ay)?|so|now|and|then)[,\s]+)*(?:please\s+)?i\s+(?:want|need|would\s+like|'d\s+like)\b/i;
export function isCommand(text: string): boolean { return COMMAND_RE.test(text) || WANT_RE.test(text); }

export const SOMETHING_ELSE = 'Something else';
export const CHOICES_LINE = 'I didn’t catch which one. Did you mean:';
export const SAY_AGAIN_LINE = 'Okay — say it another way.';

/** Up to three actions to offer: Nano's guess first (if it had one), then
 *  the three boards people mix up. */
export function choicesFor(p: IntentPick | null): IntentAction[] {
  const byId = (id: string) => INTENT_ACTIONS.find((a) => a.id === id);
  const out: IntentAction[] = [];
  const guess = p && p.intent !== CHAT_INTENT && p.confidence >= 0.2 ? byId(p.intent) : undefined;
  if (guess) out.push(guess);
  for (const id of ['showDevices', 'buildDashboard', 'floorPlan']) {
    const a = byId(id);
    if (a && !out.includes(a)) out.push(a);
    if (out.length === 3) break;
  }
  return out;
}

/** Her spoken answer to the choices: an index, -1 for "something else", or null. */
export function pickChoice(text: string, choices: readonly IntentAction[]): number | null {
  const t = text.toLowerCase();
  if (/\b(?:something\s+else|none|neither|no(?:pe)?|other|cancel|never\s*mind)\b/.test(t)) return -1;
  const ord = [/\b(?:first|one|1st|top)\b/, /\b(?:second|two|2nd|middle)\b/, /\b(?:third|three|3rd|last)\b/];
  for (let i = 0; i < choices.length; i++) if (ord[i]?.test(t)) return i;
  const key: Record<string, RegExp> = {
    showDevices: /\b(?:status|devices?\s+board|track|connected)\b/, buildDashboard: /\b(?:dash\s*-?board|controls?)\b/,
    floorPlan: /\bfloor\s*plan|\bplan\b/, connectGimbal: /\bgimbal|stand\b/, pointConnect: /\bpoint/, connectPhones: /\bphones?\b/,
    connectLamp: /\b(?:lamp|light|bulb)\b/, connectSpeaker: /\b(?:speaker|music)\b/, newBoard: /\bnew\s+board\b/,
  };
  for (let i = 0; i < choices.length; i++) if (key[choices[i]!.id]?.test(t)) return i;
  return null;
}
