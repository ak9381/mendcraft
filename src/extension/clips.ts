// Studio-canvas clips: text or link nodes added by "send to canvas". Pure data,
// no DOM. The layer in main.ts / clipsLayer.ts renders them.

export type ClipKind = 'text' | 'link';

export interface CanvasClip {
  id: string;
  kind: ClipKind;
  text: string;
  url?: string;
  title?: string;
  createdAt: number;
}

export interface ClipsState {
  clips: CanvasClip[];
}

export function emptyClips(): ClipsState {
  return { clips: [] };
}

export function addClip(state: ClipsState, input: { kind?: ClipKind; text?: string; url?: string; title?: string; now?: number; id?: string }): { state: ClipsState; clip: CanvasClip | null } {
  const url = input.url?.trim() || undefined;
  const text = (input.text ?? url ?? '').trim();
  if (!text && !url) return { state, clip: null };
  const kind: ClipKind = input.kind === 'link' || (url && !input.text) ? 'link' : (input.kind ?? 'text');
  const clip: CanvasClip = {
    id: input.id ?? `clip-${(input.now ?? Date.now()).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    text: text || url || '',
    url,
    title: input.title?.trim() || undefined,
    createdAt: input.now ?? Date.now(),
  };
  return { state: { clips: [...state.clips, clip].slice(-40) }, clip };
}

export function removeClip(state: ClipsState, id: string): ClipsState {
  return { clips: state.clips.filter((c) => c.id !== id) };
}
