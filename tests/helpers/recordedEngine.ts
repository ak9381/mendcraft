// A test engine that answers with an inline recorded reply (through the real
// replay engine), streamed in chunks like a model so ghost previews are
// exercised. Tests only: src/ holds no replies. The route line is left unset
// so the caller's own SIM labelling is what is checked.
import { createReplayEngines, replayKey, type TurnKind } from '../../src/canvas/replayEngine';
import type { EngineId, SurfaceEngine } from '../../src/canvas/aiTurn';

export function recordedEngine(id: EngineId, reply: string, o: { chunk?: number; kind?: TurnKind } = {}): SurfaceEngine {
  const kind = o.kind ?? 'board';
  const e = createReplayEngines({ [replayKey(id, kind)]: reply })[id]!(kind);
  const chunk = o.chunk ?? 18;
  return {
    ...e,
    routeLine: undefined,
    async stream(prompt, onText, so) {
      const full = await e.stream(prompt, () => {}, so);
      for (let n = chunk; ; n += chunk) {
        const part = full.slice(0, Math.min(n, full.length));
        onText(part);
        if (part.length === full.length) return full;
      }
    },
  };
}
