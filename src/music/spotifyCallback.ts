// /spotify route handler — exchanges the OAuth code, stores tokens, and
// either closes the sign-in pop-up (notifying the opener) or bounces back
// to the page she came from. No editor chrome loads here.

import {
  completeSpotifyRedirect,
  isSpotifyAuthPopup,
  notifySpotifyAuthResult,
} from './spotifyAuth';

function paint(message: string): void {
  if (typeof document === 'undefined') return;
  const app = document.querySelector('#app');
  if (!(app instanceof HTMLElement)) return;
  document.title = 'Mendcraft — Spotify';
  app.innerHTML = `<main style="font-family:system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:1.5rem;line-height:1.5">
    <p>${message}</p>
  </main>`;
}

export async function handleSpotifyCallback(opts: {
  search?: string;
  complete?: typeof completeSpotifyRedirect;
  isPopup?: boolean;
  notify?: (result: { ok: boolean; error?: string }) => void;
  replace?: (url: string) => void;
  close?: () => void;
  delay?: (fn: () => void, ms: number) => void;
} = {}): Promise<void> {
  paint('Connecting Spotify…');
  const complete = opts.complete ?? completeSpotifyRedirect;
  const result = await complete(opts.search ?? (typeof window !== 'undefined' ? window.location.search : ''));
  const notify = opts.notify ?? ((r) => { notifySpotifyAuthResult(r); });
  notify(result.ok ? { ok: true } : { ok: false, error: result.error });

  const isPopup = opts.isPopup ?? isSpotifyAuthPopup();
  const delay = opts.delay ?? ((fn, ms) => { window.setTimeout(fn, ms); });
  if (isPopup) {
    paint(result.ok
      ? 'Spotify connected. This window will close…'
      : `Could not connect Spotify: ${result.error}. This window will close…`);
    const close = opts.close ?? (() => { window.close(); });
    delay(() => { close(); }, result.ok ? 400 : 1600);
    return;
  }

  paint(result.ok
    ? 'Spotify connected. Returning…'
    : `Could not connect Spotify: ${result.error}. Returning…`);
  const dest = result.returnTo || '/studio';
  const replace = opts.replace ?? ((href: string) => { window.location.replace(href); });
  delay(() => { replace(dest); }, result.ok ? 400 : 1600);
}
