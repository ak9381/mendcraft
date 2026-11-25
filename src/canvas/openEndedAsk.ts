// Open-ended canvas speech ("hi", "what can you do") that isn't a known
// command: a short conversational reply, Nano-first so the Nano vs Gemini
// badge stays honest, falling through to Gemini when Nano can't answer.
// No board, no proposal, no connectRoom — just a reply.
import type { EngineId, SurfaceEngine } from './aiTurn';

export interface OpenEndedReply { engineId: EngineId; reply: string; sim: boolean }

export function buildOpenEndedPrompt(text: string): string {
  return `Reply conversationally, in one or two short sentences, to this: "${text}"`;
}

/** Called once per engine actually tried (never for its scripted fallback),
 *  with the raw prompt; returns the prompt that really goes to that engine —
 *  the caller redacts and books a cloud engine's send here. */
export type OpenEndedPrepare = (engine: SurfaceEngine, prompt: string) => string | { prompt: string; onCloudSend?: () => void };

async function streamOrFallback(engine: SurfaceEngine, prompt: string, onText?: (full: string) => void, prepare?: OpenEndedPrepare): Promise<OpenEndedReply> {
  const prepared = prepare ? prepare(engine, prompt) : prompt;
  const p = typeof prepared === 'string' ? prepared : prepared.prompt;
  const onCloudSend = typeof prepared === 'string' ? undefined : prepared.onCloudSend;
  try {
    const reply = await engine.stream(p, (full) => onText?.(full), { shape: 'text', ...(onCloudSend ? { onCloudSend } : {}) });
    return { engineId: engine.id, reply, sim: engine.sim };
  } catch (e) {
    // The prepared (SIM) reply is not a second send: no prepare, no booking.
    if (engine.fallback) return streamOrFallback(engine.fallback, p, onText);
    throw e;
  }
}

/** Nano first (and its own SIM fallback, if any); only on a real failure does
 *  this reach for a fresh Gemini engine. */
export async function openEndedAsk(text: string, nano: SurfaceEngine, gemini: SurfaceEngine, onText?: (full: string) => void, prepare?: OpenEndedPrepare): Promise<OpenEndedReply> {
  const prompt = buildOpenEndedPrompt(text);
  try {
    return await streamOrFallback(nano, prompt, onText, prepare);
  } catch {
    return await streamOrFallback(gemini, prompt, onText, prepare);
  }
}
