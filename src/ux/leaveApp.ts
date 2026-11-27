// Anything that leaves the app (email, a device connector) needs
// pinch-and-hold plus a 10 second undo window.

export const PINCH_HOLD_MS = 800;
export const LEAVE_UNDO_MS = 10_000;

export type LeaveKind = 'email' | 'connector';

export type LeavePhase = 'idle' | 'armed' | 'holding' | 'sent' | 'undone';

export interface LeaveRequest {
  kind: LeaveKind;
  title: string;
  detail: string;
}

export interface LeaveState {
  phase: LeavePhase;
  request: LeaveRequest | null;
  holdStartedAt?: number;
  sentAt?: number;
  undoUntil?: number;
}

export const IDLE_LEAVE: LeaveState = { phase: 'idle', request: null };

export function armLeave(req: LeaveRequest): LeaveState {
  return { phase: 'armed', request: req };
}

export function startHold(state: LeaveState, now: number): LeaveState {
  if (state.phase !== 'armed' && state.phase !== 'holding') return state;
  return { ...state, phase: 'holding', holdStartedAt: now };
}

export function holdProgress(state: LeaveState, now: number): number {
  if (state.phase !== 'holding' || !state.holdStartedAt) return 0;
  return Math.max(0, Math.min(1, (now - state.holdStartedAt) / PINCH_HOLD_MS));
}

export function releaseHold(state: LeaveState): LeaveState {
  if (state.phase !== 'holding') return state;
  return { phase: 'armed', request: state.request };
}

export function completeHold(state: LeaveState, now: number): LeaveState {
  if (state.phase !== 'holding' && state.phase !== 'armed') return state;
  if (state.phase === 'holding' && holdProgress(state, now) < 1) return state;
  return {
    phase: 'sent',
    request: state.request,
    sentAt: now,
    undoUntil: now + LEAVE_UNDO_MS,
  };
}

export function canUndoLeave(state: LeaveState, now: number): boolean {
  return state.phase === 'sent' && typeof state.undoUntil === 'number' && now < state.undoUntil;
}

export function undoLeave(state: LeaveState, now: number): LeaveState {
  if (!canUndoLeave(state, now)) return state;
  return { phase: 'undone', request: state.request, sentAt: state.sentAt };
}

export function leaveCardCopy(state: LeaveState, now: number): { status: string; action: string; undo?: string } {
  const kind = state.request?.kind === 'connector' ? 'connector' : 'email';
  if (state.phase === 'holding') {
    return { status: 'Hold to send', action: 'Keep holding' };
  }
  if (state.phase === 'sent') {
    const left = state.undoUntil ? Math.max(0, Math.ceil((state.undoUntil - now) / 1000)) : 0;
    return {
      status: kind === 'connector' ? 'Connector handed off' : 'Opened in your mail app',
      action: 'Done',
      undo: canUndoLeave(state, now) ? `Undo (${left} s)` : undefined,
    };
  }
  if (state.phase === 'undone') {
    return { status: 'Undone', action: 'Dropped' };
  }
  return { status: 'Waiting for you', action: 'PINCH AND HOLD  send' };
}
