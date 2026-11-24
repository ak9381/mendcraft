// Open-ended canvas speech ("hi", "what can you do") that isn't a known
// command: a short conversational reply, Nano-first so the Nano vs Gemini
// badge stays honest, falling through to Gemini when Nano can't answer.
// No board, no proposal, no connectRoom — just a reply.
import type { EngineId, SurfaceEngine } from './aiTurn';

export interface OpenEndedReply { engineId: EngineId; reply: string; sim: boolean }

export function buildOpenEndedPrompt(text: string): string {
  return `Reply conversationally, in one or two short sentences, to this: "${text}"`;
}

async function streamOrFallback(engine: SurfaceEngine, prompt: string, onText?: (full: string) => void): Promise<OpenEndedReply> {
  try {
    const reply = await engine.stream(prompt, (full) => onText?.(full));
    return { engineId: engine.id, reply, sim: engine.sim };
  } catch (e) {
    if (engine.fallback) return streamOrFallback(engine.fallback, prompt, onText);
    throw e;
  }
}

/** Nano first (and its own SIM fallback, if any); only on a real failure does
 *  this reach for a fresh Gemini engine. */
export async function openEndedAsk(text: string, nano: SurfaceEngine, gemini: SurfaceEngine, onText?: (full: string) => void): Promise<OpenEndedReply> {
  const prompt = buildOpenEndedPrompt(text);
  try {
    return await streamOrFallback(nano, prompt, onText);
  } catch {
    return await streamOrFallback(gemini, prompt, onText);
  }
}
