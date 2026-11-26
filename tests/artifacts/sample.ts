// Inline sample artifacts for the artifact tests (data, not recorded replies).
import type { Artifact } from '../../src/artifacts/artifact';

export const PLAN = { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'Temperature', value: '21 °C' }] } as const;

export function board(frameId = 'f1', over: Partial<Artifact> = {}, plan: unknown = PLAN): Artifact {
  return {
    id: `board-${frameId}`, kind: 'board', v: 1, title: 'Desk', by: 'gemini', at: 1000, status: 'approved',
    data: { frame: { kind: 'room', title: 'Desk', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }, plan },
    ...over,
  };
}
