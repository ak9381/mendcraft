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

const FRAME_INTERVAL_MS = 900; // ~1 fps keeps room-doc traffic tiny
const FRAME_WIDTH = 320;
const FRAME_QUALITY = 0.5;

export async function mountRemotePage(root: HTMLElement): Promise<void> {
  document.title = 'Mendcraft remote';
  root.innerHTML = `
    <div class="remote-page">
      <header class="remote-head">
        <span class="brand">Mendcraft</span>
        <span class="remote-sub">phone remote</span>
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
  }

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
  window.addEventListener('pagehide', () => {
    stopSharing();
    void session?.close();
  });

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
