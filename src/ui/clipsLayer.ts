// Overlay of text/link clip cards on the studio canvas ("send to canvas").

import type { ClipsState } from '../extension/clips';
import { removeClip } from '../extension/clips';

export interface ClipsLayer {
  readonly element: HTMLElement;
  render(state: ClipsState): void;
  onChange(fn: (state: ClipsState) => void): void;
}

export function createClipsLayer(initial: ClipsState = { clips: [] }): ClipsLayer {
  let state = initial;
  let onChangeFn: ((s: ClipsState) => void) | null = null;
  const root = document.createElement('div');
  root.className = 'mc-clips';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Canvas clips');

  function render(next: ClipsState): void {
    state = next;
    root.replaceChildren();
    root.hidden = state.clips.length === 0;
    for (const clip of state.clips) {
      const card = document.createElement('article');
      card.className = 'mc-clip';
      card.dataset.id = clip.id;
      const kicker = document.createElement('p');
      kicker.className = 'mc-clip-kicker';
      kicker.textContent = clip.kind === 'link' ? 'Link' : 'Text';
      const body = document.createElement(clip.url ? 'a' : 'p');
      body.className = 'mc-clip-body';
      body.textContent = clip.title || clip.text;
      if (body instanceof HTMLAnchorElement && clip.url) {
        body.href = clip.url;
        body.target = '_blank';
        body.rel = 'noopener noreferrer';
      }
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'mc-clip-x';
      rm.setAttribute('aria-label', 'Remove clip');
      rm.textContent = '✕';
      rm.addEventListener('click', () => {
        state = removeClip(state, clip.id);
        render(state);
        onChangeFn?.(state);
      });
      card.append(kicker, body, rm);
      root.append(card);
    }
  }

  render(state);
  return {
    element: root,
    render,
    onChange(fn) { onChangeFn = fn; },
  };
}
