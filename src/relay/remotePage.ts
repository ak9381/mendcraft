// Phone /remote page: a touch-first remote control + camera sharer for a
// paired Mendcraft laptop. Mounted by src/boot.ts BEFORE the editor shell, so
// none of the editor (camera, MediaPipe, AI) loads on the phone. getUserMedia
// stays on this phone; low-rate JPEG stills go only to the paired laptop's
// room (never to Firebase AI / any model).

import '../style.css';
import {
  groupCode,
  pairStateLabel,
  parseJoinInput,
  type PairState,
  type RelayCommand,
} from './protocol';
import { createFakeTransport, type RelayTransport } from './transport';
import { probeFirestore } from './firestoreTransport';
import { createGuestSession, resolveRoomId, type GuestSession } from './session';
import { createWizClient, resolveBridgeUrl } from '../devices/wizClient';
import { createLampControl } from '../devices/lampControl';
import { createMusicController } from '../music/musicController';
import { currentTrack, playerStatusLabel, DEFAULT_TRACKS, type Track } from '../music/player';
import { appleMusicStatus } from '../music/appleMusic';
import { getAssistBridge } from '../assist/bridge';

const FRAME_INTERVAL_MS = 900; // ~1 fps keeps room-doc traffic tiny
const FRAME_WIDTH = 320;
const FRAME_QUALITY = 0.5;

export interface RemotePageOptions {
  /**
   * 'remote' (default) is the full phone remote + camera page. 'phone' is the
   * compact iPhone-PWA variant focused on the lamp + music: it hides the camera
   * share, the nudge pad and the typed-command form via a CSS class, leaving big
   * play/pause, volume and lamp controls. Pairing (code/QR) still works so music
   * state is relayed to /control.
   */
  variant?: 'remote' | 'phone';
}

export async function mountRemotePage(root: HTMLElement, opts: RemotePageOptions = {}): Promise<void> {
  const isPhone = opts.variant === 'phone';
  document.title = isPhone ? 'Mendcraft — lamp & music' : 'Mendcraft remote';
  root.innerHTML = `
    <div class="remote-page${isPhone ? ' remote-phone' : ''}">
      <header class="remote-head">
        <span class="brand">Mendcraft</span>
        <span class="remote-sub">${isPhone ? 'lamp &amp; music' : 'phone remote'}</span>
        <span id="remote-transport" class="badge badge-rules">…</span>
      </header>
      <p id="remote-status" class="remote-status" role="status" aria-live="polite">Connecting…</p>
      <form id="remote-join" class="remote-join" hidden>
        <label for="remote-code">Enter the code on the laptop</label>
        <input id="remote-code" type="text" inputmode="text" autocapitalize="characters"
          autocomplete="off" placeholder="ABCD-EFGH" aria-label="Pairing code" />
        <button type="submit">Join</button>
      </form>
      <div id="remote-controls" class="remote-controls" hidden>
        <div class="remote-pad" role="group" aria-label="Nudge the laptop view">
          <button type="button" class="remote-key" data-nudge="0,-1" aria-label="Nudge up">▲</button>
          <div class="remote-pad-row">
            <button type="button" class="remote-key" data-nudge="-1,0" aria-label="Nudge left">◀</button>
            <button type="button" class="remote-key" data-nudge="1,0" aria-label="Nudge right">▶</button>
          </div>
          <button type="button" class="remote-key" data-nudge="0,1" aria-label="Nudge down">▼</button>
        </div>
        <div class="remote-actions">
          <button id="remote-undo" type="button" class="remote-big">Undo</button>
          <button id="remote-redo" type="button" class="remote-big">Redo</button>
          <button id="remote-mic" type="button" class="remote-big">Laptop mic on/off</button>
        </div>
        <form id="remote-cmd" class="remote-cmd">
          <input id="remote-cmd-input" type="text" placeholder="Type a command for the laptop…"
            aria-label="Type a design command" autocomplete="off" />
          <button type="submit">Send</button>
        </form>
        <div class="remote-camera">
          <button id="remote-share" type="button" class="remote-big" aria-pressed="false">Share camera</button>
          <video id="remote-preview" class="remote-preview" playsinline muted hidden></video>
          <p class="remote-privacy">Camera stays on this phone except low-rate stills sent only to your paired laptop. Never to AI models.</p>
        </div>
      </div>

      <section class="remote-devices" aria-label="Room devices">
        <div id="remote-lamp" class="remote-lamp-mount"></div>

        <div class="remote-music">
          <div class="lamp-head"><span class="lamp-title">Music</span>
            <span id="remote-music-apple" class="badge badge-rules">Apple Music?</span></div>
          <p id="remote-now" class="remote-now" role="status" aria-live="polite">No track</p>
          <div class="remote-music-controls" role="group" aria-label="Playback">
            <button id="remote-prev" type="button" aria-label="Previous track">⏮</button>
            <button id="remote-playpause" type="button" aria-label="Play or pause">▶</button>
            <button id="remote-next" type="button" aria-label="Next track">⏭</button>
          </div>
          <label class="remote-vol-label">Volume
            <input id="remote-vol" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume" />
          </label>
          <label class="remote-track-label">Track
            <select id="remote-tracks" aria-label="Choose a track"></select>
          </label>
          <label class="remote-addtracks">Add local tracks
            <input id="remote-files" type="file" accept="audio/*" multiple aria-label="Add audio files from this device" />
          </label>
          <p id="remote-music-note" class="remote-privacy"></p>
        </div>
      </section>

      <section id="remote-assist" class="remote-devices" aria-label="Phone assist" hidden>
        <div class="remote-music">
          <div class="lamp-head"><span class="lamp-title">Phone assist</span>
            <span id="assist-state" class="badge badge-rules">checking…</span></div>
          <p class="remote-privacy">Works only in Instagram, Pinterest and WhatsApp.
            WhatsApp replies are drafts — sending always needs the big ✓ Send button
            shown over WhatsApp. Never automatic.</p>
          <button id="assist-settings" type="button" class="remote-big" hidden>Enable in Android Settings</button>
          <div id="assist-controls" hidden>
            <div class="remote-music-controls" role="group" aria-label="Feed scrolling">
              <button id="assist-up" type="button" aria-label="Scroll up">▲</button>
              <button id="assist-down" type="button" aria-label="Scroll down">▼</button>
              <button id="assist-auto" type="button" aria-pressed="false">Auto-scroll: off</button>
            </div>
            <form id="assist-draft-form" class="remote-cmd">
              <input id="assist-draft" type="text" placeholder="Draft a WhatsApp reply…"
                aria-label="WhatsApp reply draft" autocomplete="off" />
              <button type="submit">Draft</button>
            </form>
            <button id="assist-cancel" type="button" class="remote-big">Cancel draft</button>
            <p id="assist-note" class="remote-privacy"></p>
          </div>
        </div>
      </section>
      <p id="remote-note" class="remote-note"></p>
    </div>
  `;

  const statusEl = root.querySelector<HTMLParagraphElement>('#remote-status')!;
  const noteEl = root.querySelector<HTMLParagraphElement>('#remote-note')!;
  const transportBadge = root.querySelector<HTMLSpanElement>('#remote-transport')!;
  const joinForm = root.querySelector<HTMLFormElement>('#remote-join')!;
  const codeInput = root.querySelector<HTMLInputElement>('#remote-code')!;
  const controls = root.querySelector<HTMLDivElement>('#remote-controls')!;
  const cmdForm = root.querySelector<HTMLFormElement>('#remote-cmd')!;
  const cmdInput = root.querySelector<HTMLInputElement>('#remote-cmd-input')!;
  const shareBtn = root.querySelector<HTMLButtonElement>('#remote-share')!;
  const previewEl = root.querySelector<HTMLVideoElement>('#remote-preview')!;

  // Transport: Firestore when the project has it; otherwise an honest local
  // fallback so the page still demonstrates its states (nothing to pair with
  // cross-device until Firestore is enabled).
  const probe = await probeFirestore();
  const transport: RelayTransport = probe.ok ? probe.transport : createFakeTransport();
  transportBadge.textContent = transport.kind === 'firestore' ? 'Firestore' : 'local demo';
  transportBadge.className = `badge ${transport.kind === 'firestore' ? 'badge-cloud' : 'badge-rules'}`;
  if (!probe.ok) noteEl.textContent = `Waiting for Firestore: ${probe.reason} Pairing cannot reach a laptop yet.`;

  let session: GuestSession | null = null;
  let shareTimer = 0;
  let shareStream: MediaStream | null = null;

  function setState(state: PairState): void {
    statusEl.textContent = pairStateLabel(state, 'phone');
    const paired = state === 'paired';
    controls.hidden = !paired && state !== 'waiting';
    for (const b of controls.querySelectorAll('button, input')) {
      (b as HTMLButtonElement).disabled = !paired;
    }
    if (!paired && shareStream) stopSharing();
    // Push current music state so a freshly paired laptop's /control populates.
    if (paired) publishMusic?.();
  }
  // Set once the music controller exists (below); lets setState relay on pairing.
  let publishMusic: (() => void) | null = null;

  function send(cmd: RelayCommand): void {
    void session?.sendCommand(cmd).catch(() => {
      statusEl.textContent = 'Could not reach the room — check your connection.';
    });
  }

  function stopSharing(): void {
    window.clearInterval(shareTimer);
    shareTimer = 0;
    shareStream?.getTracks().forEach((t) => t.stop());
    shareStream = null;
    previewEl.srcObject = null;
    previewEl.hidden = true;
    shareBtn.textContent = 'Share camera';
    shareBtn.setAttribute('aria-pressed', 'false');
  }

  async function startSharing(): Promise<void> {
    try {
      shareStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 } },
        audio: false,
      });
    } catch {
      noteEl.textContent = 'Camera permission was denied — sharing is off.';
      return;
    }
    previewEl.srcObject = shareStream;
    previewEl.hidden = false;
    void previewEl.play().catch(() => undefined);
    shareBtn.textContent = 'Stop sharing';
    shareBtn.setAttribute('aria-pressed', 'true');
    const canvas = document.createElement('canvas');
    shareTimer = window.setInterval(() => {
      if (!session || session.state() !== 'paired' || previewEl.videoWidth === 0) return;
      const scale = FRAME_WIDTH / previewEl.videoWidth;
      canvas.width = FRAME_WIDTH;
      canvas.height = Math.round(previewEl.videoHeight * scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(previewEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', FRAME_QUALITY);
      const b64 = dataUrl.split(',')[1];
      if (b64) void session.sendFrame({ mimeType: 'image/jpeg', dataBase64: b64 }).catch(() => undefined);
    }, FRAME_INTERVAL_MS);
  }

  async function join(roomId: string): Promise<void> {
    session = await createGuestSession(transport, roomId);
    session.onState(setState);
    joinForm.hidden = true;
    controls.hidden = false;
    setState(session.state());
  }

  // Wire the controls once; they are enabled/disabled by pairing state.
  for (const btn of controls.querySelectorAll<HTMLButtonElement>('[data-nudge]')) {
    btn.addEventListener('click', () => {
      const [dx, dy] = btn.dataset.nudge!.split(',').map(Number);
      send({ kind: 'nudge', dx, dy });
    });
  }
  root.querySelector('#remote-undo')!.addEventListener('click', () => send({ kind: 'undo' }));
  root.querySelector('#remote-redo')!.addEventListener('click', () => send({ kind: 'redo' }));
  root.querySelector('#remote-mic')!.addEventListener('click', () => send({ kind: 'mic' }));
  cmdForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = cmdInput.value.trim();
    if (!text) return;
    cmdInput.value = '';
    send({ kind: 'command', text });
  });
  shareBtn.addEventListener('click', () => {
    if (shareStream) stopSharing();
    else void startSharing();
  });

  // ---- WiZ lamp: talks to the local bridge, independent of laptop pairing ----
  const lampMount = root.querySelector<HTMLDivElement>('#remote-lamp')!;
  const wizClient = createWizClient(resolveBridgeUrl());
  const lamp = createLampControl(wizClient, { compact: true });
  lampMount.appendChild(lamp.element);
  void lamp.refresh();

  // ---- Music: our own HTMLAudioElement player; state relayed to /control -----
  const audio = new Audio();
  audio.preload = 'none';
  const music = createMusicController(audio, DEFAULT_TRACKS);
  const nowEl = root.querySelector<HTMLParagraphElement>('#remote-now')!;
  const playBtn = root.querySelector<HTMLButtonElement>('#remote-playpause')!;
  const volEl = root.querySelector<HTMLInputElement>('#remote-vol')!;
  const trackSel = root.querySelector<HTMLSelectElement>('#remote-tracks')!;
  const filesInput = root.querySelector<HTMLInputElement>('#remote-files')!;
  const appleBadge = root.querySelector<HTMLSpanElement>('#remote-music-apple')!;
  const musicNote = root.querySelector<HTMLParagraphElement>('#remote-music-note')!;

  // Apple Music is an honest stub: without a MusicKit developer token we say so
  // and keep our own player. (See src/music/appleMusic.ts.)
  const apple = appleMusicStatus();
  appleBadge.textContent = apple.kind === 'ready' ? 'Apple Music ready' : 'Apple Music off';
  musicNote.textContent =
    apple.kind === 'ready' ? '' : 'message' in apple ? apple.message : '';

  function fillTracks(tracks: Track[], index: number): void {
    trackSel.innerHTML = '';
    tracks.forEach((t, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = t.local ? `${t.title} (on this phone)` : t.title;
      if (i === index) opt.selected = true;
      trackSel.appendChild(opt);
    });
  }

  // Relay the player state to the paired laptop (title/playing/volume; no audio).
  function relayMusic(): void {
    if (!session || session.state() !== 'paired') return;
    const s = music.state();
    void session.sendMusic({ title: currentTrack(s)?.title ?? '', playing: s.playing, volume: s.volume })
      .catch(() => undefined);
  }
  publishMusic = relayMusic;

  music.onChange((s) => {
    nowEl.textContent = playerStatusLabel(s);
    playBtn.textContent = s.playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', s.playing ? 'Pause' : 'Play');
    if (Number(volEl.value) !== s.volume) volEl.value = String(s.volume);
    fillTracks(s.tracks, s.index);
    relayMusic();
  });

  playBtn.addEventListener('click', () => music.dispatch({ type: 'toggle' }));
  root.querySelector('#remote-prev')!.addEventListener('click', () => music.dispatch({ type: 'prev' }));
  root.querySelector('#remote-next')!.addEventListener('click', () => music.dispatch({ type: 'next' }));
  volEl.addEventListener('input', () => music.dispatch({ type: 'setVolume', volume: Number(volEl.value) }));
  trackSel.addEventListener('change', () => music.dispatch({ type: 'select', index: Number(trackSel.value) }));
  const localUrls: string[] = [];
  filesInput.addEventListener('change', () => {
    const picked: Track[] = Array.from(filesInput.files ?? []).map((f, i) => {
      const src = URL.createObjectURL(f);
      localUrls.push(src);
      return {
        id: `local-${f.name}-${i}`,
        title: f.name.replace(/\.[^.]+$/, ''),
        artist: 'On this phone',
        src,
        local: true,
      };
    });
    if (picked.length) music.dispatch({ type: 'addTracks', tracks: picked });
  });

  window.addEventListener('pagehide', () => {
    stopSharing();
    music.destroy();
    for (const url of localUrls) URL.revokeObjectURL(url);
    void session?.close();
  });

  // Phone assist (Android shell only): scroll Instagram/Pinterest and stage
  // WhatsApp reply drafts via the AccessibilityService. The web page never
  // shows this — getAssistBridge() is null outside the native app. Note there
  // is deliberately no Send control here: the single send click happens in the
  // native overlay drawn over WhatsApp, after the draft is visible.
  const assist = getAssistBridge();
  if (assist) {
    const assistSection = root.querySelector<HTMLElement>('#remote-assist')!;
    const assistState = root.querySelector<HTMLSpanElement>('#assist-state')!;
    const assistSettings = root.querySelector<HTMLButtonElement>('#assist-settings')!;
    const assistControls = root.querySelector<HTMLDivElement>('#assist-controls')!;
    const assistAuto = root.querySelector<HTMLButtonElement>('#assist-auto')!;
    const assistNote = root.querySelector<HTMLParagraphElement>('#assist-note')!;
    const draftForm = root.querySelector<HTMLFormElement>('#assist-draft-form')!;
    const draftInput = root.querySelector<HTMLInputElement>('#assist-draft')!;
    assistSection.hidden = false;
    let autoOn = false;

    function showAuto(on: boolean): void {
      autoOn = on;
      assistAuto.textContent = `Auto-scroll: ${on ? 'on (slow)' : 'off'}`;
      assistAuto.setAttribute('aria-pressed', String(on));
    }

    async function refreshAssist(): Promise<void> {
      const { enabled } = await assist!.isServiceEnabled().catch(() => ({ enabled: false }));
      assistState.textContent = enabled ? 'service on' : 'service off';
      assistState.className = `badge ${enabled ? 'badge-device' : 'badge-rules'}`;
      assistSettings.hidden = enabled;
      assistControls.hidden = !enabled;
      // The native overlay has its own pause/stop buttons — resync our toggle
      // with the overlay's actual state instead of trusting a local flag.
      const { running } = await assist!.getAutoScrollState().catch(() => ({ running: false }));
      showAuto(running);
    }
    void refreshAssist();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) void refreshAssist();
    });

    assistSettings.addEventListener('click', () => void assist!.openAccessibilitySettings());
    root.querySelector('#assist-up')!.addEventListener('click', () => void assist!.scroll({ direction: 'up' }));
    root.querySelector('#assist-down')!.addEventListener('click', () => void assist!.scroll({ direction: 'down' }));
    assistAuto.addEventListener('click', () => {
      showAuto(!autoOn);
      void assist!.setAutoScroll({ enabled: autoOn });
    });
    draftForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const text = draftInput.value.trim();
      if (!text) return;
      void assist!.stageDraft({ text }).then(({ staged }) => {
        assistNote.textContent = staged
          ? 'Draft staged. Open the WhatsApp chat — the text appears in the compose box, then confirm with the big ✓ Send overlay button (or ✕ Cancel).'
          : 'Could not stage the draft.';
      });
    });
    root.querySelector('#assist-cancel')!.addEventListener('click', () => {
      void assist!.cancelDraft();
      assistNote.textContent = 'Draft cancelled.';
    });
  }

  // Join path 1: the QR URL carries ?room=TOKEN. Path 2: type the short code.
  const fromUrl = parseJoinInput(window.location.href);
  if (fromUrl) {
    const roomId = await resolveRoomId(transport, fromUrl);
    if (roomId) {
      await join(roomId);
      return;
    }
    statusEl.textContent = 'That room was not found — it may have expired.';
  } else {
    statusEl.textContent = 'Scan the QR on the laptop, or type its code.';
  }
  joinForm.hidden = false;
  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parsed = parseJoinInput(codeInput.value);
    if (!parsed) {
      statusEl.textContent = `That doesn't look like a code (expected like ${groupCode('ABCDEFGH')}).`;
      return;
    }
    const roomId = await resolveRoomId(transport, parsed);
    if (!roomId) {
      statusEl.textContent = 'No laptop is waiting on that code.';
      return;
    }
    await join(roomId);
  });
}
