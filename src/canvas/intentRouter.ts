// Nano picks the action when no fixed phrase matched. Before a line falls to
// chat (which may only talk, never act), the on-device model gets her words
// and a CLOSED list of actions, and must answer with one of them as JSON
// (Chrome enforces the schema). Code then runs that action exactly as if she
// had said its fixed phrase: same routes, same reviews, same checks. Nothing
// here acts on its own, and an unsure answer asks her first.

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
  { id: 'showDevices', label: 'build the devices board', describe: 'a board that lists every connected device and its status, with a button to connect another (NOT the dashboard)', phrase: () => 'show my devices' },
  { id: 'buildDashboard', label: 'build the dashboard', describe: 'the dashboard: one board with controls for the connected devices (lamp, speaker, gimbal)', phrase: () => 'build the dashboard' },
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

export const askLine = (a: IntentAction): string => `Did you mean: ${a.label}?`;
export const understoodLine = (a: IntentAction): string => `Understood: ${a.label}.`;
