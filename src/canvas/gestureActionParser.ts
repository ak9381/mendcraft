// TEACH-A-GESTURE action parsing: turn "dim the lamp to 30%" into something
// the canvas already knows how to run. Deterministic rules first (reusing
// canvasCommands.ts/deviceCommands.ts — the SAME vocabulary canvasApp.ts's
// run() understands), then on-device Nano, then Gemini — each asked to
// rewrite the sentence into that same rule vocabulary, so there's one
// source of truth for "what counts as an action" and no second schema to
// keep in sync. The stored action is just that canonical command text, so
// triggering a taught gesture later is `handle.run(text)` — the exact path
// a typed command already takes.
import { parseCanvasCommand, type CanvasCommand } from './canvasCommands';
import { parseDeviceCommands, type DeviceRef } from './deviceCommands';

export type ParseEngine = 'rules' | 'nano' | 'gemini';

export interface ParsedGestureAction {
  /** Canonical command text — replay this later via the canvas's run(). */
  text: string;
  /** Human-readable summary for the Proposal card / gestures list / history. */
  summary: string;
  engine: ParseEngine;
}

function summarizeCanvasCmd(cmd: CanvasCommand): string {
  switch (cmd.type) {
    case 'save': return 'Save the canvas';
    case 'newFrame': return 'Start a new board';
    case 'undo': return 'Undo';
    case 'keep': return 'Keep';
    case 'drop': return 'Drop';
    case 'showEverything': return 'Show everything';
    case 'zoom': return cmd.dir > 0 ? 'Zoom in' : 'Zoom out';
    case 'zoomReset': return 'Reset zoom to 100%';
    case 'back': return 'Go back';
    case 'buildNext': return 'Save and start the next board';
    case 'step': return cmd.dir > 0 ? 'Next board' : 'Previous board';
    case 'pin': return cmd.on ? 'Pin this board' : 'Unpin this board';
    case 'goTo': return `Go to “${cmd.target}”`;
  }
}

/** A human summary if `text` parses via the existing rule parsers, else null. */
export function parseActionText(text: string, devices: readonly DeviceRef[]): string | null {
  const cmd = parseCanvasCommand(text);
  if (cmd) return summarizeCanvasCmd(cmd);
  const dc = parseDeviceCommands(text, devices);
  if (dc) return dc.say;
  return null;
}

export interface GestureActionEngines {
  nano?: (prompt: string) => Promise<string>;
  gemini?: (prompt: string) => Promise<string>;
}

function rewritePrompt(text: string): string {
  return [
    'Rewrite this as ONE short plain command for a smart canvas: things like',
    '"save", "undo", "new board", "dim the lamp to 30 percent", "turn off the lights".',
    'Reply with just that command — no punctuation, no explanation.',
    `Instruction: "${text}"`,
  ].join(' ');
}

/**
 * Deterministic rules first; if that fails, ask Nano then Gemini to rewrite
 * the sentence into the same rule vocabulary and re-parse the reply. Returns
 * null (never throws) when nothing — rules or either model — understood it.
 */
export async function resolveGestureAction(
  text: string,
  devices: readonly DeviceRef[],
  engines: GestureActionEngines = {},
): Promise<ParsedGestureAction | null> {
  const rules = parseActionText(text, devices);
  if (rules) return { text, summary: rules, engine: 'rules' };

  const candidates: Array<[ParseEngine, ((p: string) => Promise<string>) | undefined]> = [
    ['nano', engines.nano],
    ['gemini', engines.gemini],
  ];
  for (const [engine, ask] of candidates) {
    if (!ask) continue;
    try {
      const reply = (await ask(rewritePrompt(text))).trim();
      const summary = parseActionText(reply, devices);
      if (summary) return { text: reply, summary, engine };
    } catch {
      // try the next engine
    }
  }
  return null;
}
