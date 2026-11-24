// Host-side dispatch for a command the paired phone sent. Same paths the
// canvas already uses (run / undo / Talk), so a phone utterance still goes
// through review when it would change a board.
import type { RelayCommand } from '../relay/protocol';

export interface RelayCommandHandlers {
  run(text: string): boolean;
  undo(): void;
  redo?: () => void;
  nudge?: (dx: number, dy: number) => void;
  toggleMic?: () => void;
}

/** Returns whether the command was handled. Unknown kinds are ignored. */
export function dispatchRelayCommand(cmd: RelayCommand, handlers: RelayCommandHandlers): boolean {
  switch (cmd.kind) {
    case 'undo':
      handlers.undo();
      return true;
    case 'redo':
      if (!handlers.redo) return false;
      handlers.redo();
      return true;
    case 'command': {
      const text = cmd.text?.trim();
      if (!text) return false;
      handlers.run(text);
      return true;
    }
    case 'nudge': {
      const dx = cmd.dx ?? 0;
      const dy = cmd.dy ?? 0;
      if (!dx && !dy) return false;
      if (!handlers.nudge) return false;
      handlers.nudge(dx, dy);
      return true;
    }
    case 'mic':
      if (!handlers.toggleMic) return false;
      handlers.toggleMic();
      return true;
    default:
      return false;
  }
}

/** Every toolbar / phone-menu `data-cmd` the canvas click map must handle. */
export const TOOLBAR_CMDS = [
  'everything', 'new', 'save', 'undo',
  'hands', 'register', 'reregister', 'teach', 'gestures',
  'ai', 'offline',
] as const;
export type ToolbarCmd = (typeof TOOLBAR_CMDS)[number];
