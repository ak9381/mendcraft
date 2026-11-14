// iPad /control dashboard: a read-mostly control room for the demo. Mounted by
// src/boot.ts BEFORE the editor shell, so none of the editor (camera, MediaPipe,
// AI) loads here. It subscribes to the laptop's room over an injected transport
// and renders the privacy-safe ControlSnapshot the laptop publishes — never
// camera, landmarks or audio (those never reach the snapshot).
//
// Live sync needs a reachable room (Firestore is enabled) with the laptop online
// in it. When no room is given or the room can't be reached, the page falls back
// to the in-page fake transport driven by the deterministic demo
// (sim.playControlDemo) and says so honestly — it never fakes a live connection.

import '../style.css';
import { groupCode, parseJoinInput } from './protocol';
import { createFakeTransport, type RelayTransport } from './transport';
import { probeFirestore } from './firestoreTransport';
import {
  createControlSession,
  createHostSession,
  resolveRoomId,
  type ControlSession,
} from './session';
import { formatBytes } from '../core/ledger';
import { REASON_TEXT } from '../ai/router';
import {
  playControlDemo,
  snapshotBytes,
  type ApplianceState,
  type ControlSnapshot,
  type DeviceId,
  type ScenePrimitive,
} from './controlSnapshot';

const DEVICE_LABEL: Record<DeviceId, string> = {
  laptop: 'Laptop (desk)',
  phone: 'Phone remote',
  other: 'Other device',
};
const APPLIANCE_LABEL: Record<ApplianceState, string> = { on: 'On', off: 'Off', unknown: 'Unknown' };
const DEVICE_RUN_LABEL: Record<string, string> = {
  designer: '✏️ Designer', browser: '🌐 Browser', lamp: '💡 Lamp',
  music: '🎵 Music', android: '🤖 Phone', iphone: '📱 Phone',
};

export async function mountControlPage(root: HTMLElement): Promise<void> {
  document.title = 'Mendcraft control room';
  root.innerHTML = `
    <div class="control-page">
      <header class="control-head">
        <span class="brand">Mendcraft</span>
        <span class="control-sub">control room</span>
        <span id="control-conn" class="badge badge-rules">connecting…</span>
        <span id="control-bytes" class="control-bytes"></span>
      </header>
      <p id="control-banner" class="control-banner" role="status" aria-live="polite"></p>
      <form id="control-join" class="control-join" hidden>
        <label for="control-room">Join the laptop's room</label>
        <input id="control-room" type="text" inputmode="text" autocomplete="off"
          placeholder="Paste code (ABCD-EFGH) or room link" aria-label="Room code or link" />
        <button type="submit">Join</button>
      </form>

      <div class="control-grid">
        <section class="card card-device" aria-label="Active device">
          <h2>Working on</h2>
          <p id="c-device" class="c-device">—</p>
          <p class="card-note">From Relay presence.</p>
        </section>

        <section class="card card-scene" aria-label="3D review">
          <div class="card-head">
            <h2>3D review</h2>
            <button id="c-scene-full" type="button" class="c-scene-full" hidden>⛶ Fullscreen</button>
          </div>
          <div id="c-scene" class="c-scene"><p class="card-empty">No scene published yet.</p></div>
          <p id="c-scene-sum" class="card-note"></p>
        </section>

        <section class="card card-ai" aria-label="AI request feed">
          <h2>AI requests</h2>
          <ul id="c-ai" class="c-feed"><li class="card-empty">No requests yet.</li></ul>
        </section>

        <section class="card card-ledger" aria-label="What left this device">
          <h2>What left this device</h2>
          <p id="c-ledger-counts" class="c-counts"></p>
          <ul id="c-ledger" class="c-feed"><li class="card-empty">Nothing has left this device.</li></ul>
        </section>

        <section class="card card-queue" aria-label="Offline job queue">
          <h2>Cloud queue</h2>
          <ul id="c-queue" class="c-feed"><li class="card-empty">Queue empty.</li></ul>
        </section>

        <section class="card card-recipes" aria-label="Shared recipes">
          <h2>Recipe book</h2>
          <ul id="c-recipes" class="c-recipes"><li class="card-empty">No shared recipes yet.</li></ul>
          <p id="c-run-status" class="card-note" role="status" aria-live="polite"></p>
        </section>

        <section class="card card-appliances" aria-label="Lamp and music">
          <h2>Room</h2>
          <p class="c-appliance">Lamp: <span id="c-lamp" class="c-tag">unknown</span> <span id="c-lamp-detail" class="c-appliance-detail"></span></p>
          <p class="c-appliance">Music: <span id="c-music" class="c-tag">unknown</span> <span id="c-music-detail" class="c-appliance-detail"></span></p>
          <p class="card-note">Read-only mirror. Control the lamp from the editor or /remote; music plays on /remote.</p>
        </section>

        <section class="card card-caption" aria-label="Live captions">
          <h2>Captions</h2>
          <p id="c-caption-heard" class="c-caption-heard">—</p>
          <p id="c-caption-tr" class="c-caption-tr"></p>
        </section>
      </div>

      <div id="c-scene3d" class="scene3d-overlay" hidden role="dialog" aria-modal="true" aria-label="Fullscreen 3D review">
        <div class="scene3d-bar">
          <span id="c-scene3d-title" class="scene3d-title">3D review</span>
          <span class="scene3d-hint">Drag to orbit · pinch to zoom</span>
          <button id="c-scene3d-close" type="button" class="scene3d-close">Close ✕</button>
        </div>
        <div id="c-scene3d-stage" class="scene3d-stage"></div>
      </div>
    </div>
  `;

  const $ = <T extends HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;
  const connBadge = $<HTMLSpanElement>('control-conn');
  const bytesEl = $<HTMLSpanElement>('control-bytes');
  const bannerEl = $<HTMLParagraphElement>('control-banner');
  const joinForm = $<HTMLFormElement>('control-join');
  const roomInput = $<HTMLInputElement>('control-room');

  function setConn(text: string, kind: 'cloud' | 'on-device' | 'rules'): void {
    connBadge.textContent = text;
    connBadge.className = `badge badge-${kind}`;
  }

  let runSeq = 0;
  function setRunStatus(text: string): void {
    $<HTMLParagraphElement>('c-run-status').textContent = text;
  }
  const RUN_STATUS_TEXT: Record<string, string> = {
    queued: 'Queued', running: 'Running', 'awaiting-confirm': 'Waiting for a confirm on the target',
    done: 'Done', error: 'Error', rejected: 'Rejected',
  };

  // ---- fullscreen 3D review (lazy three.js; extrudes snapshot primitives) ---
  // The orbit view is built from the SAME privacy-safe primitives as the inline
  // wireframe — no PlanDoc, camera or landmarks cross the relay. three.js is
  // dynamically imported only when a judge opens fullscreen.
  let latest: ControlSnapshot | null = null;
  let scene3d: import('./sceneView3d').SceneView3d | null = null;
  const overlay = $<HTMLDivElement>('c-scene3d');
  const stage = $<HTMLDivElement>('c-scene3d-stage');
  const fullBtn = $<HTMLButtonElement>('c-scene-full');

  function feed3d(): void {
    if (scene3d && latest?.scene) scene3d.update(latest.scene.primitives);
  }
  async function openScene3d(): Promise<void> {
    if (!latest?.scene?.primitives.length) return;
    overlay.hidden = false;
    $<HTMLSpanElement>('c-scene3d-title').textContent =
      `${latest.scene.mode} · ${latest.scene.summary}`;
    if (!scene3d) {
      const { createSceneView3d } = await import('./sceneView3d');
      scene3d = createSceneView3d(stage);
    }
    feed3d();
    $<HTMLButtonElement>('c-scene3d-close').focus(); // so Escape (bubbled) closes
  }
  function closeScene3d(): void {
    overlay.hidden = true;
    scene3d?.dispose();
    scene3d = null;
  }
  fullBtn.addEventListener('click', () => void openScene3d());
  $<HTMLButtonElement>('c-scene3d-close').addEventListener('click', closeScene3d);
  overlay.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') closeScene3d();
  });

  function render(snap: ControlSnapshot): void {
    latest = snap;
    bytesEl.textContent = `${formatBytes(snapshotBytes(snap))} · rev ${snap.rev}`;

    $<HTMLParagraphElement>('c-device').textContent = DEVICE_LABEL[snap.activeDevice];

    // AI feed (newest first).
    const aiEl = $<HTMLUListElement>('c-ai');
    aiEl.innerHTML = '';
    if (!snap.ai.length) aiEl.innerHTML = '<li class="card-empty">No requests yet.</li>';
    for (const e of [...snap.ai].reverse()) {
      const li = document.createElement('li');
      li.className = `c-row src-${e.source}`;
      const badge = document.createElement('span');
      badge.className = `badge badge-${e.source}`;
      badge.textContent = e.badge;
      li.appendChild(badge);
      const txt = document.createElement('span');
      txt.className = 'c-row-text';
      // Cloud utterances already left the device; private events show no text.
      txt.textContent = e.utterance ?? `(${REASON_TEXT[e.reason] ?? e.reason} — stayed on device)`;
      li.appendChild(txt);
      if (typeof e.ms === 'number') {
        const ms = document.createElement('span');
        ms.className = 'c-row-ms';
        ms.textContent = `${e.ms} ms`;
        li.appendChild(ms);
      }
      aiEl.appendChild(li);
    }
    if (snap.omitted.aiFeed) {
      const li = document.createElement('li');
      li.className = 'card-note';
      li.textContent = `+${snap.omitted.aiFeed} older request(s) not shown`;
      aiEl.appendChild(li);
    }

    // Ledger.
    const c = snap.ledger.counts;
    $<HTMLParagraphElement>('c-ledger-counts').textContent =
      `${c.cloud} cloud · ${c.private} private (on-device ${c.onDevice} + rules ${c.rules}) · ${formatBytes(c.bytesSent)} sent`;
    const ledgerEl = $<HTMLUListElement>('c-ledger');
    ledgerEl.innerHTML = '';
    if (!snap.ledger.calls.length) {
      ledgerEl.innerHTML = '<li class="card-empty">Nothing has left this device.</li>';
    }
    for (const call of [...snap.ledger.calls].reverse()) {
      const li = document.createElement('li');
      li.className = 'c-row src-cloud';
      const head = document.createElement('div');
      head.className = 'c-row-head';
      head.innerHTML = `<span class="c-job">${esc(call.job)}</span><span class="c-reason">${esc(call.reason)}</span><span class="c-row-ms">${formatBytes(call.bytes)}</span>`;
      li.appendChild(head);
      const sent = document.createElement('div');
      sent.className = 'c-sent';
      sent.textContent = call.sent || '(empty payload)';
      li.appendChild(sent);
      if (call.redactions) {
        const r = document.createElement('div');
        r.className = 'c-redactions';
        r.textContent = `${call.redactions} device-only field(s) redacted`;
        li.appendChild(r);
      }
      ledgerEl.appendChild(li);
    }

    // Queue.
    const queueEl = $<HTMLUListElement>('c-queue');
    queueEl.innerHTML = '';
    if (!snap.queue.length) queueEl.innerHTML = '<li class="card-empty">Queue empty.</li>';
    snap.queue.forEach((job, i) => {
      const li = document.createElement('li');
      li.className = 'c-row';
      li.innerHTML = `<span class="c-ord">${i + 1}</span><span class="c-tag tag-${job.status}">${esc(job.status)}</span><span class="c-kind">${esc(job.kind)}</span><span class="c-row-text">${esc(job.label)}</span>`;
      queueEl.appendChild(li);
    });

    // Appliances (lamp from the editor/remote bridge, music from the phone).
    setAppliance($<HTMLSpanElement>('c-lamp'), snap.appliances.lamp);
    setAppliance($<HTMLSpanElement>('c-music'), snap.appliances.music);
    $<HTMLSpanElement>('c-lamp-detail').textContent = snap.appliances.lampDetail ?? '';
    $<HTMLSpanElement>('c-music-detail').textContent = snap.appliances.musicTitle ?? '';

    // Caption.
    const heardEl = $<HTMLParagraphElement>('c-caption-heard');
    const trEl = $<HTMLParagraphElement>('c-caption-tr');
    if (snap.caption) {
      heardEl.textContent = snap.caption.heard;
      heardEl.lang = snap.caption.langCode || '';
      trEl.textContent = snap.caption.translation
        ? `${snap.caption.translation}${snap.caption.langLabel ? ` · ${snap.caption.langLabel}` : ''}`
        : '';
    } else {
      heardEl.textContent = '—';
      trEl.textContent = '';
    }

    // Shared recipe book — big cards anyone in the room can tap to Run. The run
    // request goes to the laptop over the relay; anything that sends still needs
    // a confirm on the target device (shown via run status).
    const recipesEl = $<HTMLUListElement>('c-recipes');
    recipesEl.innerHTML = '';
    if (!snap.recipes.length) {
      recipesEl.innerHTML = '<li class="card-empty">No shared recipes yet.</li>';
    }
    for (const r of snap.recipes) {
      const li = document.createElement('li');
      li.className = 'c-recipe-card';
      const info = document.createElement('div');
      info.className = 'c-recipe-info';
      info.innerHTML = `<span class="c-recipe-name">${esc(r.name)}</span>`
        + `<span class="c-recipe-sum">${esc(r.summary)}</span>`
        + `<span class="c-recipe-meta"><span class="c-tag">${esc(DEVICE_RUN_LABEL[r.device] ?? r.device)}</span> · taught by ${esc(r.taughtBy || 'you')}</span>`;
      const runBtn = document.createElement('button');
      runBtn.type = 'button';
      runBtn.className = 'c-recipe-run';
      runBtn.textContent = 'Run';
      runBtn.addEventListener('click', () => {
        if (!session?.sendRun) {
          setRunStatus(`Can't run “${r.name}” — not connected to the laptop.`);
          return;
        }
        const runId = `run-${++runSeq}-${r.id.slice(0, 8)}`;
        void session.sendRun({ runId, recipeId: r.id, device: r.device, by: 'iPad' }).catch(() => undefined);
        setRunStatus(`Asked the laptop to run “${r.name}”…`);
      });
      li.append(info, runBtn);
      recipesEl.appendChild(li);
    }
    if (snap.omitted.recipes) {
      const li = document.createElement('li');
      li.className = 'card-note';
      li.textContent = `+${snap.omitted.recipes} more recipes hidden`;
      recipesEl.appendChild(li);
    }

    // 3D review (compact wireframe preview; ⛶ opens the fullscreen orbit view).
    const sceneEl = $<HTMLDivElement>('c-scene');
    sceneEl.innerHTML = renderScene(snap);
    $<HTMLParagraphElement>('c-scene-sum').textContent = snap.scene
      ? `${snap.scene.mode} · ${snap.scene.summary} · rev ${snap.scene.rev}${snap.omitted.primitives ? ` (+${snap.omitted.primitives} shapes hidden)` : ''}`
      : '';
    const has3d = !!snap.scene?.primitives.length;
    fullBtn.hidden = !has3d;
    if (!has3d) closeScene3d(); // scene cleared → drop the orbit view
    else feed3d(); // push the fresh geometry into an open fullscreen view
  }

  // ---- connection: live Firestore room, else the honest demo fallback -------
  const probe = await probeFirestore();
  const liveTransport: RelayTransport | null = probe.ok ? probe.transport : null;
  let session: ControlSession | null = null;
  let demoStopped = false;

  async function connectLive(roomId: string): Promise<void> {
    await session?.close().catch(() => undefined);
    demoStopped = true; // stop any running demo loop
    session = await createControlSession(liveTransport!, roomId);
    session.onState((s) => {
      if (s === 'paired') setConn('live', 'cloud');
      else if (s === 'gone') setConn('laptop left', 'rules');
      else setConn('waiting for laptop…', 'rules');
    });
    session.onSnapshot(render);
    session.onRunStatus((s) => {
      const label = RUN_STATUS_TEXT[s.status] ?? s.status;
      const where = s.step && s.total ? ` (step ${s.step}/${s.total})` : '';
      setRunStatus(`${label}${where}${s.detail ? ` — ${s.detail}` : ''}`);
    });
    bannerEl.textContent = '';
    joinForm.hidden = true;
  }

  async function startDemo(reason: string): Promise<void> {
    setConn('demo feed', 'rules');
    bannerEl.textContent = reason;
    joinForm.hidden = false;
    // A self-contained room: a fake host publishes the scripted snapshots and a
    // control session renders them — the real pipeline, zero network.
    const t = createFakeTransport();
    const host = await createHostSession(t);
    session = await createControlSession(t, host.token);
    session.onSnapshot(render);
    demoStopped = false;
    void playControlDemo((s) => host.publishState(s), {
      loop: true,
      delayMs: 1700,
      shouldStop: () => demoStopped,
    });
  }

  const fromUrl = parseJoinInput(window.location.href);
  if (liveTransport && fromUrl) {
    const roomId = await resolveRoomId(liveTransport, fromUrl);
    if (roomId) {
      await connectLive(roomId);
    } else {
      await startDemo('That room was not found — showing the demo feed. Paste a current code to join.');
    }
  } else if (!probe.ok) {
    await startDemo(`Live sync is waiting: ${probe.reason} Showing the demo feed.`);
  } else {
    await startDemo('No room yet — showing the demo feed. Paste the laptop\'s code or open with ?room= to go live.');
  }

  joinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parsed = parseJoinInput(roomInput.value);
    if (!parsed) {
      bannerEl.textContent = `That doesn't look like a code (expected like ${groupCode('ABCDEFGH')}) or a room link.`;
      return;
    }
    if (!liveTransport) {
      bannerEl.textContent = 'Live join needs a reachable room with the laptop online in it. Staying on the demo feed.';
      return;
    }
    const roomId = await resolveRoomId(liveTransport, parsed);
    if (!roomId) {
      bannerEl.textContent = 'No laptop is waiting on that code.';
      return;
    }
    await connectLive(roomId);
  });

  window.addEventListener('pagehide', () => {
    demoStopped = true;
    scene3d?.dispose();
    void session?.close();
  });
}

function setAppliance(el: HTMLSpanElement, state: ApplianceState): void {
  el.textContent = APPLIANCE_LABEL[state];
  el.className = `c-tag tag-appliance-${state}`;
}

/** Compact SVG wireframe of the published scene primitives (plan segments /
 *  part boxes), auto-fit to the card. A read-only stand-in for the 3D viewport
 *  that stays tiny and dependency-free; empty scenes show a placeholder. */
function renderScene(snap: ControlSnapshot): string {
  const prims = snap.scene?.primitives ?? [];
  if (!prims.length) return '<p class="card-empty">Scene snapshot is empty.</p>';
  const pts: { x: number; y: number }[] = [];
  for (const p of prims) {
    if (p.t === 'seg') pts.push({ x: p.x1, y: p.y1 }, { x: p.x2, y: p.y2 });
    else pts.push({ x: p.x, y: p.y }, { x: p.x + p.w, y: p.y + p.h });
  }
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(1, Math.max(...xs) - minX);
  const spanY = Math.max(1, Math.max(...ys) - minY);
  const W = 320;
  const H = 200;
  const pad = 12;
  const scale = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const tx = (x: number) => pad + (x - minX) * scale;
  const ty = (y: number) => pad + (y - minY) * scale;
  const body = prims
    .map((p: ScenePrimitive) =>
      p.t === 'seg'
        ? `<line x1="${tx(p.x1).toFixed(1)}" y1="${ty(p.y1).toFixed(1)}" x2="${tx(p.x2).toFixed(1)}" y2="${ty(p.y2).toFixed(1)}" />`
        : `<rect x="${tx(p.x).toFixed(1)}" y="${ty(p.y).toFixed(1)}" width="${(p.w * scale).toFixed(1)}" height="${(p.h * scale).toFixed(1)}" />`,
    )
    .join('');
  return `<svg class="c-wire" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Scene preview">${body}</svg>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
}
