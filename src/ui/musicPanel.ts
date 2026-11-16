// Studio music panel — same float-panel pattern as the lamp. Connect Spotify
// (Premium) or use the built-in public-domain player. Buttons work for mouse
// AND the pinch pointer.

import {
  createMusicSession,
  openWebAppToConnect,
  type MusicSession,
  type MusicSessionState,
} from '../music/musicSession';
import type { MusicIntent } from '../music/musicIntent';
import type { PlayerAction } from '../music/player';

export interface MusicPanel {
  readonly element: HTMLElement;
  readonly session: MusicSession;
  toggle(): void;
  open(): void;
  isOpen(): boolean;
  apply(intent: MusicIntent): Promise<{ ok: boolean; detail: string }>;
  applyAction(action: PlayerAction): Promise<{ ok: boolean; detail: string }>;
}

export function createMusicPanel(opts: {
  onState?: (state: MusicSessionState) => void;
  onCall?: import('../music/spotifyApi').SpotifyLedger;
}): MusicPanel {
  const root = document.createElement('section');
  root.className = 'mc-lamp-panel mc-music-panel';
  root.hidden = true;
  root.setAttribute('aria-label', 'Music');

  const head = document.createElement('div');
  head.className = 'mc-lamp-head';
  head.innerHTML = `<span class="mc-lamp-heading">Music</span>
    <span id="mc-music-badge" class="badge badge-rules">…</span>
    <button type="button" class="mc-lamp-x" aria-label="Close music panel">✕</button>`;
  root.appendChild(head);

  const now = document.createElement('p');
  now.className = 'remote-now';
  now.setAttribute('role', 'status');
  now.setAttribute('aria-live', 'polite');
  now.textContent = 'No track';
  root.appendChild(now);

  const controls = document.createElement('div');
  controls.className = 'remote-music-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', 'Playback');
  controls.innerHTML = `
    <button id="mc-music-prev" type="button" aria-label="Previous track">⏮</button>
    <button id="mc-music-play" type="button" aria-label="Play or pause">▶</button>
    <button id="mc-music-next" type="button" aria-label="Next track">⏭</button>`;
  root.appendChild(controls);

  const volLabel = document.createElement('label');
  volLabel.className = 'remote-vol-label';
  volLabel.innerHTML = `Volume <input id="mc-music-vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" />`;
  root.appendChild(volLabel);

  const trackSel = document.createElement('select');
  trackSel.id = 'mc-music-tracks';
  trackSel.setAttribute('aria-label', 'Choose a built-in track');
  const trackWrap = document.createElement('label');
  trackWrap.className = 'remote-track-label';
  trackWrap.append('Built-in tracks ', trackSel);
  root.appendChild(trackWrap);

  const actions = document.createElement('div');
  actions.className = 'remote-music-controls';
  actions.innerHTML = `
    <button id="mc-music-connect" type="button">Connect Spotify</button>
    <button id="mc-music-disconnect" type="button" hidden>Disconnect</button>`;
  root.appendChild(actions);

  const note = document.createElement('p');
  note.className = 'mc-lamp-note';
  root.appendChild(note);

  const session = createMusicSession({ onCall: opts.onCall });
  const badge = head.querySelector<HTMLSpanElement>('#mc-music-badge')!;
  const playBtn = controls.querySelector<HTMLButtonElement>('#mc-music-play')!;
  const volEl = volLabel.querySelector<HTMLInputElement>('#mc-music-vol')!;
  const connectBtn = actions.querySelector<HTMLButtonElement>('#mc-music-connect')!;
  const disconnectBtn = actions.querySelector<HTMLButtonElement>('#mc-music-disconnect')!;

  function paint(s: MusicSessionState): void {
    now.textContent = s.label;
    playBtn.textContent = s.playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    if (Math.abs(Number(volEl.value) - s.volume) > 0.001) volEl.value = String(s.volume);
    badge.textContent = s.via === 'spotify' ? 'Spotify' : s.status.kind === 'not-configured' ? 'Spotify not set up' : 'Built-in player';
    badge.className = `badge ${s.via === 'spotify' ? 'badge-device' : 'badge-rules'}`;
    note.textContent = s.note;
    const connected = s.status.kind === 'connected';
    const native = s.status.kind === 'native-shell';
    connectBtn.hidden = connected;
    disconnectBtn.hidden = !connected;
    connectBtn.textContent = native ? 'Open web app to connect' : s.status.kind === 'not-configured' ? 'Spotify not set up' : 'Connect Spotify';
    connectBtn.disabled = s.status.kind === 'not-configured';
    const loc = session.localController().state();
    trackSel.innerHTML = '';
    loc.tracks.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = t.title;
      if (i === loc.index) opt.selected = true;
      trackSel.appendChild(opt);
    });
    opts.onState?.(s);
  }

  session.onChange(paint);

  playBtn.addEventListener('click', () => void session.apply({ type: 'toggle' }));
  controls.querySelector('#mc-music-prev')!.addEventListener('click', () => void session.apply({ type: 'prev' }));
  controls.querySelector('#mc-music-next')!.addEventListener('click', () => void session.apply({ type: 'next' }));
  volEl.addEventListener('input', () => void session.apply({ type: 'volume', volume: Number(volEl.value) }));
  trackSel.addEventListener('change', () => {
    session.localController().dispatch({ type: 'select', index: Number(trackSel.value) });
  });
  connectBtn.addEventListener('click', () => {
    if (session.state().status.kind === 'native-shell') openWebAppToConnect();
    else void session.connect();
  });
  disconnectBtn.addEventListener('click', () => session.disconnect());
  head.querySelector('.mc-lamp-x')!.addEventListener('click', () => { root.hidden = true; });

  return {
    element: root,
    session,
    open() { root.hidden = false; },
    toggle() { root.hidden = !root.hidden; },
    isOpen: () => !root.hidden,
    apply(intent) {
      this.open();
      return session.apply(intent);
    },
    applyAction(action) {
      this.open();
      return session.applyAction(action);
    },
  };
}
