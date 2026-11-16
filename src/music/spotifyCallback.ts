// /spotify route handler — exchanges the OAuth code, stores tokens, and
// bounces back to the page she came from. No editor chrome loads here.

import { completeSpotifyRedirect } from './spotifyAuth';

function paint(message: string): void {
  const app = document.querySelector('#app');
  if (!(app instanceof HTMLElement)) return;
  document.title = 'Mendcraft — Spotify';
  app.innerHTML = `<main style="font-family:system-ui,sans-serif;max-width:28rem;margin:15vh auto;padding:1.5rem;line-height:1.5">
    <p>${message}</p>
  </main>`;
}

export async function handleSpotifyCallback(): Promise<void> {
  paint('Connecting Spotify…');
  const result = await completeSpotifyRedirect(window.location.search);
  if (result.ok) {
    paint('Spotify connected. Returning…');
  } else {
    paint(`Could not connect Spotify: ${result.error}. Returning…`);
  }
  const dest = result.returnTo || '/studio';
  window.setTimeout(() => {
    window.location.replace(dest);
  }, result.ok ? 400 : 1600);
}
