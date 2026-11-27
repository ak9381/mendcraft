// e2e-laptop-layout.mjs — the laptop canvas's focused room board at common
// laptop sizes: the board is wide enough for its tiles (no inner scroll), the
// next-step chip row never sits on a tile, the hand cluster is one tidy column
// in the order Register, Tools, Talk, Read aloud, Undo, Edit (a second column
// only when the window is too short), and the hand-hover name label never
// covers the highlighted button or its neighbours.
//
//   npx vite --port 5173 &
//   E2E_URL=http://localhost:5173 npm run e2e:laptop-layout
//   SHOTS=/some/dir … writes PNGs per viewport.
//
// Same stack as e2e-phone-layout.mjs: puppeteer-core + an installed Chrome.

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '';
/** ONLY=<text>: run just the viewports/boards whose name contains it. */
const ONLY = process.env.ONLY || '';

function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean).find((p) => existsSync(p));
}

const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };

// The room dashboards: the live run's lamp + music board (all of it, chips
// included, must be on screen above the engine bar), and a taller lamp +
// music + scene board (it may run past the screen and scroll the canvas, but
// its chips still never land on a tile).
const roomDoc = (tiles) => ({
  version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1',
  frames: [{ id: 'f1', kind: 'room', title: 'Living room', rect: { x: 0, y: 0, w: 620, h: 520 }, pinned: false }],
  surfaces: { f1: { kind: 'room', title: 'Living room', tiles } },
});
const LAMP = { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' };
const MUSIC = { type: 'music', deviceId: 'speaker-1', label: 'Speaker' };
const SCENE = { type: 'scene', sceneId: 'movie', label: 'Movie night' };
const BOARDS = [
  { name: 'lamp+music', doc: roomDoc([LAMP, MUSIC]), whole: true, extras: true },
  { name: 'lamp+music+scene', doc: roomDoc([LAMP, MUSIC, SCENE]), whole: false, extras: false },
];

const VIEWPORTS = [
  // The live window at 100 %: a short laptop window.
  { name: 'laptop-1550x656', width: 1550, height: 656 },
  { name: 'laptop-1440x900', width: 1440, height: 900 },
  { name: 'laptop-1550x700', width: 1550, height: 700 },
  { name: 'laptop-1280x800', width: 1280, height: 800 },
  // The live window: 1550×656 at 80 % browser zoom.
  { name: 'laptop-1550x656-zoom80', width: 1938, height: 820 },
  { name: 'laptop-1920x1080', width: 1920, height: 1080 },
];
// With two (SIM) phones paired the "2 phones connected · … · Disconnect"
// strip is on screen: it must never cover the focused board, and Disconnect
// stays reachable. Camera on, as in the live run.
const GIMBAL = { type: 'gimbal', label: 'Phone stand' };
const PAIRED_BOARDS = [
  { name: 'lamp+music', tiles: [LAMP, MUSIC] },
  { name: 'lamp+music+gimbal', tiles: [LAMP, MUSIC, GIMBAL] },
];
const PAIRED_VIEWPORTS = [
  { name: 'paired-1550x656', width: 1550, height: 656 },
  { name: 'paired-1440x900', width: 1440, height: 900 },
];
const CLUSTER_ORDER = ['register', 'tools', 'talk', 'read', 'undo', 'edit'];

/** In the page: board, tiles, chip row, cluster. */
function measure() {
  const TAGS = 'mc-lamp-tile, mc-music-tile, mc-switch-tile, mc-scene-tile, mc-connect-tile, mc-stat-tile, mc-chart-tile, mc-gimbal-tile';
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const shown = (el) => { if (!el || el.hidden) return false; const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0; };
  const frame = document.querySelector('.mc-frame.focused') ?? document.querySelector('.mc-frame');
  const tiles = frame ? [...frame.querySelectorAll(TAGS)].map((el) => ({ tag: el.tagName.toLowerCase(), box: box(el) })) : [];
  const bar = document.querySelector('.mc-engine-bar');
  const chips = frame ? [...frame.querySelectorAll('.mc-next')].filter(shown).map((el) => box(el)) : [];
  const surface = frame?.querySelector('.mc-surface');
  const scrollers = frame ? [...frame.querySelectorAll('*')].filter((el) => {
    const cs = getComputedStyle(el);
    return /(auto|scroll)/.test(cs.overflowY + cs.overflowX) && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2);
  }).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`) : [];
  const cluster = document.querySelector('.mc-hand-cluster');
  const kindOf = (el) => el.classList.contains('mc-register-chip') ? 'register'
    : el.classList.contains('mc-tools-chip') ? 'tools'
      : el.classList.contains('mc-talk-control') ? 'talk'
        : el.classList.contains('mc-read-aloud') ? 'read'
          : el.classList.contains('mc-cluster-undo') ? 'undo'
            : el.classList.contains('mc-edit-toggle') ? 'edit'
              : el.classList.contains('mc-edit-reset') ? 'reset' : el.className;
  const items = cluster ? [...cluster.children].filter(shown).map((el) => ({ kind: kindOf(el), box: box(el) })) : [];
  return {
    vw: innerWidth, vh: innerHeight,
    frame: frame ? box(frame) : null,
    surface: surface ? { box: box(surface), sw: surface.scrollWidth, cw: surface.clientWidth, sh: surface.scrollHeight, ch: surface.clientHeight } : null,
    tiles, chips, scrollers, items,
    bar: bar && shown(bar) ? box(bar) : null,
    z: document.querySelector('.mc-world')?.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? '?',
  };
}

/** In the page: each visible next-step chip whose centre does NOT hit-test
 *  to the chip itself (something — the engine bar, the zoom box, the phones
 *  strip — sits over it). Shadow DOM aware. */
function coveredChips() {
  const deepHit = (x, y) => {
    let el = document.elementFromPoint(x, y);
    while (el?.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; }
    return el;
  };
  const within = (hit, chip) => { for (let n = hit; n; n = n.parentNode || n.host) if (n === chip) return true; return false; };
  const frame = document.querySelector('.mc-frame.focused') ?? document.querySelector('.mc-frame');
  const chips = frame ? [...frame.querySelectorAll('.mc-next .mc-next-chip')].filter((c) => c.getClientRects().length) : [];
  const out = [];
  for (const c of chips) {
    const r = c.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = x >= 0 && y >= 0 && x < innerWidth && y < innerHeight ? deepHit(x, y) : null;
    if (!hit || !within(hit, c)) out.push(`${c.textContent.trim()} → ${hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join('.')}` : 'off screen'}`);
  }
  return { n: chips.length, covered: out };
}

const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;

function checkCluster(m, label, { allowWrap }) {
  const order = m.items.map((i) => i.kind).filter((k) => CLUSTER_ORDER.includes(k));
  const want = CLUSTER_ORDER.filter((k) => order.includes(k));
  check(order.length >= 5 && JSON.stringify(order) === JSON.stringify(want), `${label}: cluster order ${order.join(' › ')}`);
  const lefts = [...new Set(m.items.map((i) => Math.round(i.box.left)))];
  // Reading order: top-to-bottom, then the next column to the RIGHT? No — a
  // second column (if any) continues the order: each item is below the last,
  // or starts a new column.
  let ok = true;
  for (let i = 1; i < m.items.length; i++) {
    const a = m.items[i - 1].box, b = m.items[i].box;
    const below = b.top >= a.bottom - 1 && Math.abs(b.left - a.left) < 2;
    const newCol = b.top < a.top && Math.abs(b.left - a.left) >= 100;
    if (!below && !(allowWrap && newCol)) ok = false;
  }
  check(ok, `${label}: cluster is ${allowWrap ? 'columns read top-down in order' : 'one column'} (${lefts.length} column${lefts.length === 1 ? '' : 's'})`);
  if (!allowWrap) check(lefts.length === 1, `${label}: cluster stays one column`);
  const off = m.items.filter((i) => i.box.top < 0 || i.box.bottom > m.vh || i.box.right > m.vw);
  check(off.length === 0, `${label}: cluster fully on screen`);
  const overlapBoard = m.frame && m.items.some((i) => overlap(i.box, m.frame));
  check(!overlapBoard, `${label}: cluster never covers the board`);
}

/** In the page: drag the on-screen board by its title (synthetic pointer
 *  events, as the live test did), hold it at one edge, release. */
async function holdAtEdge(side) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vp = document.querySelector('.mc-viewport');
  const t = [...document.querySelectorAll('.mc-frame-title')].find((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.left > 0 && q.right < innerWidth && q.top > 0; });
  if (!t) return { error: 'no on-screen board title' };
  const frame = t.closest('.mc-frame');
  const start = frame.getBoundingClientRect().left;
  let glowed = false, edgeLine = false, flashed = false, maxGlow = 0;
  let pill = '';
  // The BOARD lights up (mc-frame-sending, intensity --mc-send-glow) with a
  // "Hold to send to …" pill; the thin edge line is secondary.
  const mo = new MutationObserver(() => {
    if (vp.classList.contains(`mc-edge-glow-${side}`)) edgeLine = true;
    if (frame.classList.contains('mc-frame-sending')) {
      glowed = true;
      maxGlow = Math.max(maxGlow, Number(frame.style.getPropertyValue('--mc-send-glow')) || 0);
      const p = frame.querySelector('.mc-frame-pill[data-pill="send"]:not([hidden])');
      if (p) pill = p.textContent;
    }
    if (frame.classList.contains('mc-frame-sent')) flashed = true;
  });
  mo.observe(vp, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
  const st = document.querySelector('.mc-canvas-status');
  const lines = [];
  const so = new MutationObserver(() => lines.push(st.textContent));
  so.observe(st, { childList: true, characterData: true, subtree: true });
  const r = t.getBoundingClientRect();
  const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
  const tx = side === 'left' ? 1 : innerWidth - 1;
  const ev = (type, x) => t.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y0, pointerId: 7, button: 0, buttons: 1, pointerType: 'mouse' }));
  ev('pointerdown', x0);
  for (let i = 1; i <= 30; i++) { ev('pointermove', x0 + ((tx - x0) * i) / 30); await sleep(16); }
  for (let i = 0; i < 40; i++) { ev('pointermove', tx + (i % 2 ? (side === 'left' ? 1 : -1) : 0)); await sleep(100); }
  ev('pointerup', tx);
  await sleep(300);
  mo.disconnect(); so.disconnect();
  const sent = lines.filter((l) => /^Sent /.test(l));
  return { glowed, edgeLine, flashed, maxGlow, pill, stillLit: frame.classList.contains('mc-frame-sending'), sent, back: Math.abs(frame.getBoundingClientRect().left - start) < 2 };
}

/** A board held at EACH paired edge glows and is sent to that side's phone,
 *  before and after swapping sides (SIM phones, the live 1550×656 window). */
async function edgeSends(browser) {
  console.log('-- edge sends 1550x656 (SIM phones)');
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.setViewport({ width: 1550, height: 656, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((doc) => {
    try { localStorage.setItem('mc.canvas.v1', JSON.stringify(doc)); localStorage.removeItem('mc.relay.layout'); } catch { /* checks fail on their own */ }
  }, roomDoc([LAMP]));
  await page.goto(`${BASE}/canvas.html?sim=1&hands=0`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => !!window.__canvas && !!document.querySelector('.mc-frame-title'), { timeout: 20_000 });
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => window.__canvas.run('connect devices and make a dashboard'));
  const paired = await page.waitForFunction(() => /2 phones( connected)?/.test(document.querySelector(".mc-paired-row")?.textContent ?? document.body.innerText), { timeout: 15_000 }).then(() => true, () => false);
  check(paired, 'edge: two SIM phones joined');
  await new Promise((r) => setTimeout(r, 2500));
  const strip = () => page.evaluate(() => [...document.querySelectorAll('.mc-arrange-slot')].map((s) => s.textContent.trim()).join(' | '));
  const name = { android: 'Nothing phone', ios: 'iPhone' };
  const sides = async () => {
    const s = await strip();
    const left = /Nothing · left/.test(s) ? 'android' : /iPhone · left/.test(s) ? 'ios' : null;
    const right = /Nothing · right/.test(s) ? 'android' : /iPhone · right/.test(s) ? 'ios' : null;
    return { left, right, s };
  };
  for (const round of ['before swap', 'after swap']) {
    if (round === 'after swap') { await page.evaluate(() => window.__canvas.run('swap phone sides')); await new Promise((r) => setTimeout(r, 800)); }
    const lay = await sides();
    check(!!lay.left && !!lay.right && lay.left !== lay.right, `edge ${round}: strip shows a phone on each side (${lay.s})`);
    for (const side of ['left', 'right']) {
      const res = await page.evaluate(holdAtEdge, side);
      if (res.error) { check(false, `edge ${round} ${side}: ${res.error}`); continue; }
      const want = name[lay[side]];
      check(res.glowed && res.maxGlow > 0.5, `edge ${round}: held at the ${side} edge the board itself lights up (glow ${res.maxGlow})`);
      check(res.pill === `Hold to send to ${want}`, `edge ${round} ${side}: the board says “${res.pill}”`);
      check(res.flashed && !res.stillLit, `edge ${round} ${side}: the board flashes on send, then the glow clears`);
      check(res.sent.length === 1 && res.sent[0].includes(want), `edge ${round}: held at the ${side} edge sends to the ${want} (${res.sent.join(' / ') || 'nothing sent'})`);
      check(res.back, `edge ${round} ${side}: the board snaps back after the send`);
    }
  }
  check(errors.length === 0, `edge: no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
  await page.close();
}

async function openBoard(browser, vp, doc, query = '?sim=1') {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((d) => {
    try { localStorage.setItem('mc.canvas.v1', JSON.stringify(d)); } catch { /* checks fail on their own */ }
  }, doc);
  await page.goto(`${BASE}/canvas.html${query}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForSelector('.mc-frame mc-lamp-tile', { timeout: 20_000 });
  await page.waitForSelector('.mc-frame .mc-next .mc-next-chip', { timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1500));
  await page.evaluate(() => { const s = document.querySelector('.mc-canvas-status'); if (s) s.textContent = ''; });
  await new Promise((r) => setTimeout(r, 50));
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await settle(page);
  return { page, errors };
}

/** The board's box must hold still for three polls in a row. */
async function settle(page) {
  for (let i = 0, last = '', same = 0; i < 40 && same < 3; i++) {
    const now = await page.evaluate(() => { const f = document.querySelector('.mc-frame.focused') ?? document.querySelector('.mc-frame'); const r = f?.getBoundingClientRect(); return r ? [r.left, r.top, r.width, r.height].map(Math.round).join(',') : ''; });
    same = now === last ? same + 1 : 0; last = now;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** Pair two SIM phones ("connect devices" under ?sim=1), camera on, Tools
 *  closed: the connected strip, the board, the chips, the cluster, the
 *  camera preview and the More button must all keep clear of each other. */
const TALL_VIEWPORTS = [
  { name: 'tall-1550x656', width: 1550, height: 656 },
  { name: 'tall-1440x900', width: 1440, height: 900 },
];

/** In the page: the tall board's state — frame, bottom tile, chip row, bar,
 *  inner scroll offsets, camera, the move-to-scroll badges. */
function tallState() {
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const frame = document.querySelector('.mc-frame.focused') ?? document.querySelector('.mc-frame');
  const tiles = [...frame.querySelectorAll('mc-lamp-tile, mc-music-tile, mc-gimbal-tile')];
  const bottomTile = tiles.reduce((a, b) => (b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a));
  const row = frame.querySelector('.mc-next');
  const bar = document.querySelector('.mc-engine-bar');
  const inner = [...frame.querySelectorAll('*')].reduce((n, el) => n + el.scrollTop, 0) + (document.scrollingElement?.scrollTop ?? 0);
  const badges = [...document.querySelectorAll('.mc-scroll-badge')].filter((b) => !b.hidden && b.getClientRects().length).map((b) => b.getBoundingClientRect()).map((r) => ({ x: r.left, y: r.top }));
  const text = (el) => ((el?.shadowRoot ?? el)?.textContent ?? '').replace(/\s+/g, ' ');
  return {
    frame: box(frame), bottomTag: bottomTile.tagName.toLowerCase(), bottomTile: box(bottomTile), row: box(row), bar: box(bar),
    inner, camY: window.__mcGestures?.state().camera.y ?? null, badges, vh: innerHeight,
    tilesText: tiles.map(text).join('|'),
  };
}

/** The bottom tile shows whole: below the top edge, above the chip row (when
 *  the row is pinned over it) and the bottom chrome. */
function tileReachable(st) {
  const t = st.bottomTile;
  const floor = Math.min(st.bar ? st.bar.top : st.vh, st.row && st.row.top > t.top ? st.row.top : st.vh);
  return t.top >= 0 && t.bottom <= floor + 1;
}

/** In the page: every button of the bottom tile hit-tests to itself. */
function bottomTileHits() {
  const frame = document.querySelector('.mc-frame.focused') ?? document.querySelector('.mc-frame');
  const tiles = [...frame.querySelectorAll('mc-lamp-tile, mc-music-tile, mc-gimbal-tile')];
  const tile = tiles.reduce((a, b) => (b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a));
  const deepHit = (x, y) => { let el = document.elementFromPoint(x, y); while (el?.shadowRoot) { const i = el.shadowRoot.elementFromPoint(x, y); if (!i || i === el) break; el = i; } return el; };
  const within = (hit, host) => { for (let n = hit; n; n = n.parentNode || n.host) if (n === host) return true; return false; };
  const btns = [...(tile.shadowRoot ?? tile).querySelectorAll('button')].filter((b) => b.getClientRects().length);
  const bad = btns.filter((b) => { const r = b.getBoundingClientRect(); const h = deepHit(r.left + r.width / 2, r.top + r.height / 2); return !h || !within(h, b); }).map((b) => b.textContent.trim());
  return { n: btns.length, bad };
}

/** A lamp + speaker + gimbal board, Hands on. At 1550x656 it is taller than
 *  the screen at the 0.8 zoom floor: its chip row is pinned above the bottom
 *  bar (clickable without scrolling), it shows the "move down to scroll"
 *  hint, and the REAL hand path (synthetic landmark frames through the camera
 *  adapter, as e2e:gestures does) scrolls it: peace + move down until the
 *  bottom tile shows whole and a held palm highlights its buttons, peace +
 *  move up returns — no click, no hold, nothing inside the board scrolled.
 *  Voice "scroll down" / "page down" and back too. */
async function tallRun(browser, vp) {
  console.log(`-- ${vp.name}`);
  const { page, errors } = await openBoard(browser, vp, roomDoc([LAMP, MUSIC, GIMBAL]), '?sim=1&hands=0');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  await page.waitForFunction(() => !!window.__mcGestures, { timeout: 10_000 });
  await page.evaluate(() => window.__mcGestures.show(true));
  await wait(1300); // the move-to-scroll badges place every second
  const s0 = await page.evaluate(tallState);
  const tall = !!(s0.bar && s0.frame.bottom > s0.bar.top);
  console.log(`     board ${Math.round(s0.frame.top)}–${Math.round(s0.frame.bottom)}, bar top ${Math.round(s0.bar?.top ?? -1)}: ${tall ? 'taller than the screen' : 'fits'}`);
  const hit0 = await page.evaluate(coveredChips);
  check(hit0.n > 0 && hit0.covered.length === 0, `${vp.name}: chips clickable without scrolling (${hit0.n})${hit0.covered.length ? ` — ${hit0.covered.join('; ')}` : ''}`);
  check(!!s0.row && s0.row.bottom <= (s0.bar?.top ?? s0.vh) + 1, `${vp.name}: chip row above the bottom bar (${Math.round(s0.row?.top ?? -1)}–${Math.round(s0.row?.bottom ?? -1)})`);
  const chipH = await page.evaluate(() => Math.min(...[...document.querySelectorAll('.mc-frame.focused .mc-next .mc-next-chip')].map((c) => c.getBoundingClientRect().height)));
  check(chipH >= 43.5, `${vp.name}: chips ≥ 44 px on screen (${chipH.toFixed(1)})`);
  const z = Number(await page.evaluate(() => document.querySelector('.mc-world')?.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? '0'));
  check(z >= 0.8 - 1e-3, `${vp.name}: never below the 0.8 zoom floor (${z})`);
  const onBoard = s0.badges.some((b) => b.x >= s0.frame.left && b.x <= s0.frame.right + 8);
  check(tall ? onBoard : !onBoard, `${vp.name}: "move down to scroll" hint ${tall ? 'shown on the tall board' : 'not shown (board fits)'}`);
  const clash = await page.evaluate(() => {
    const ov = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
    const frame = document.querySelector('.mc-frame.focused');
    const ctrls = [...frame.querySelectorAll('button, .mc-next-chip')].filter((b) => b.getClientRects().length).map((b) => ({ t: b.textContent.trim().slice(0, 20), r: b.getBoundingClientRect() }));
    const badges = [...document.querySelectorAll('.mc-scroll-badge')].filter((b) => !b.hidden && b.getClientRects().length).map((b) => b.getBoundingClientRect());
    const row = frame.querySelector('.mc-next')?.getBoundingClientRect();
    const hud = document.querySelector('.mc-zoom-hud')?.getBoundingClientRect();
    return { badge: ctrls.filter((c) => badges.some((b) => ov(b, c.r))).map((c) => c.t), hud: !!(row && hud && hud.width && ov(row, hud)) };
  });
  check(clash.badge.length === 0, `${vp.name}: the scroll hint covers no button${clash.badge.length ? ` — ${clash.badge.join(', ')}` : ''}`);
  check(!clash.hud, `${vp.name}: the zoom box never sits on the chip row`);
  if (!tall) {
    check(tileReachable(s0), `${vp.name}: every tile shows whole`);
    check(errors.length === 0, `${vp.name}: no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
    await page.close();
    return;
  }
  check(!tileReachable(s0), `${vp.name}: the bottom tile (${s0.bottomTag}) starts below the fold`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name}-start.png`) });

  // Count every click while the hand works: a scroll must never press anything.
  await page.evaluate(() => { window.__clicks = []; document.addEventListener('click', (e) => window.__clicks.push(e.composedPath()[0]?.textContent?.trim()?.slice(0, 30) ?? '?'), true); });
  const log = () => page.evaluate(() => document.querySelector('.mc-ai-live-log')?.textContent ?? '');
  const log0 = await log();
  // A spot over the board that is no button and no level control (a peace
  // there steps the level instead), with room to move 200 px down.
  const spot = await page.evaluate(() => {
    const f = (document.querySelector('.mc-frame.focused') ?? document.querySelector('.mc-frame')).getBoundingClientRect();
    const deepHit = (x, y) => { let el = document.elementFromPoint(x, y); while (el?.shadowRoot) { const i = el.shadowRoot.elementFromPoint(x, y); if (!i || i === el) break; el = i; } return el; };
    const host = (el) => { for (let n = el; n; n = n.parentNode || n.host) if (n.nodeType === 1 && n.matches('.mc-frame')) return true; return false; };
    const ok = (el) => !!el && host(el) && !(el.closest?.('button, [data-level], input, .mc-next')) && !(el.getRootNode?.().host?.closest?.('[data-level]'));
    for (let y = f.top + 120; y < Math.min(innerHeight - 260, f.bottom); y += 16) for (let x = f.right - 60; x > f.left + 40; x -= 24) if (ok(deepHit(x, y)) && ok(deepHit(x, y + 200))) return { x, y };
    return null;
  });
  check(!!spot, `${vp.name}: found a spot over the board for the hand`);
  if (!spot) { await page.close(); return; }
  let t = 20_000;
  // Peace at (x, y0) settles, then moves to y1 in 12 px steps (≈ 360 px/s),
  // sampling the chip row each step; then the hand is lost (no glide).
  const peaceMove = async (y0, y1) => {
    const r = await page.evaluate((x, y0, y1, from) => {
      const g = window.__mcGestures;
      const row = () => { const e = document.querySelector('.mc-frame.focused .mc-next'); const b = e?.getBoundingClientRect(); return b ? Math.round(b.top) : null; };
      const rows = [];
      let tt = from;
      for (let k = 0; k < 8; k++) g.presence([g.hand('peace', 'R', { at: g.palmFor(x, y0) })], (tt += 33));
      const n = Math.max(1, Math.round(Math.abs(y1 - y0) / 12));
      for (let k = 1; k <= n; k++) { g.presence([g.hand('peace', 'R', { at: g.palmFor(x, y0 + ((y1 - y0) * k) / n) })], (tt += 33)); rows.push(row()); }
      for (let k = 0; k < 4; k++) g.presence([g.hand('peace', 'R', { at: g.palmFor(x, y1) })], (tt += 33));
      for (let k = 0; k < 14; k++) g.presence([], (tt += 33));
      return { rows, end: tt };
    }, spot.x, y0, y1, t);
    t = r.end + 400;
    await wait(250);
    return r.rows;
  };
  let st = s0, strokes = 0, rows = [];
  while (!tileReachable(st) && strokes < 4) { rows = rows.concat(await peaceMove(spot.y, spot.y + 200)); st = await page.evaluate(tallState); strokes++; }
  console.log(`     hand: peace + move down, ${strokes} stroke(s): camera y ${Math.round(s0.camY)} → ${Math.round(st.camY)}, board top ${Math.round(s0.frame.top)} → ${Math.round(st.frame.top)}, ${st.bottomTag} ${Math.round(st.bottomTile.top)}–${Math.round(st.bottomTile.bottom)}`);
  check(st.camY > s0.camY + 10 && st.frame.top < s0.frame.top - 10, `${vp.name}: hand — peace + move down scrolls the board up (board top ${Math.round(s0.frame.top)} → ${Math.round(st.frame.top)})`);
  check(tileReachable(st), `${vp.name}: hand — the bottom tile (${st.bottomTag}) shows whole after the scroll (${Math.round(st.bottomTile.top)}–${Math.round(st.bottomTile.bottom)}, chips at ${Math.round(st.row.top)})`);
  const hits = await page.evaluate(bottomTileHits);
  check(hits.n > 0 && hits.bad.length === 0, `${vp.name}: hand — every ${st.bottomTag} button hit-tests to itself (${hits.n})${hits.bad.length ? ` — ${hits.bad.join(', ')}` : ''}`);
  check(st.inner === s0.inner, `${vp.name}: hand — scrolled the canvas, nothing inside the board or the page (inner scroll ${s0.inner} → ${st.inner})`);
  const pinnedRows = rows.filter((v) => v !== null);
  check(pinnedRows.length > 0 && Math.max(...pinnedRows) - Math.min(...pinnedRows) <= 1, `${vp.name}: hand — the pinned chip row holds still during the scroll (top ${Math.min(...pinnedRows)}–${Math.max(...pinnedRows)} over ${pinnedRows.length} frames)`);
  // A held open palm over the bottom tile's last button highlights it.
  const hl = await page.evaluate((from) => {
    const g = window.__mcGestures;
    const frame = document.querySelector('.mc-frame.focused');
    const tiles = [...frame.querySelectorAll('mc-lamp-tile, mc-music-tile, mc-gimbal-tile')];
    const tile = tiles.reduce((a, b) => (b.getBoundingClientRect().bottom > a.getBoundingClientRect().bottom ? b : a));
    const btns = [...(tile.shadowRoot ?? tile).querySelectorAll('button')].filter((b) => b.getClientRects().length);
    const b = btns[btns.length - 1];
    const r = b.getBoundingClientRect();
    const at = g.palmFor(r.left + r.width / 2, r.top + r.height / 2);
    for (let k = 0; k <= 30; k++) g.presence([g.hand('open', 'R', { at })], from + k * 33);
    const h = g.highlighted();
    const ok = !!h && (h === b || b.contains(h) || !!h.contains?.(b));
    for (let k = 1; k <= 14; k++) g.presence([], from + 1000 + k * 33);
    return { ok, want: b.textContent.trim(), got: h?.textContent?.trim()?.slice(0, 30) ?? null };
  }, t);
  t += 1600;
  check(hl.ok, `${vp.name}: hand — a held palm highlights the ${st.bottomTag}'s last button "${hl.want}" (got ${JSON.stringify(hl.got)})`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name}-hand-down.png`) });
  let up = st; strokes = 0;
  while (up.frame.top < s0.frame.top - 2 && strokes < 4) { await peaceMove(spot.y + 200, spot.y); up = await page.evaluate(tallState); strokes++; }
  console.log(`     hand: peace + move up, ${strokes} stroke(s): board top ${Math.round(st.frame.top)} → ${Math.round(up.frame.top)}`);
  check(Math.abs(up.frame.top - s0.frame.top) <= 2, `${vp.name}: hand — peace + move up returns the board to its framed top (${Math.round(up.frame.top)} vs ${Math.round(s0.frame.top)})`);
  const clicks = await page.evaluate(() => window.__clicks);
  const newLog = (await log()).replace(log0, '');
  check(clicks.length === 0 && !/peace →/i.test(newLog), `${vp.name}: hand — never clicked or fired a hold (${clicks.length} click(s)${clicks.length ? `: ${clicks.join(', ')}` : ''}${/peace →/i.test(newLog) ? `; log: ${newLog.slice(0, 80)}` : ''})`);
  check(up.tilesText === s0.tilesText, `${vp.name}: hand — no tile changed state`);

  // Voice / typed: "scroll down" and "page down", then back up.
  const say = async (text) => {
    await page.evaluate((text) => { const i = document.querySelector('#mc-say-in'); const f = document.querySelector('.mc-say'); i.value = text; f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }, text);
    await wait(700);
    return page.evaluate(tallState);
  };
  for (const [down, back] of [['scroll down', 'scroll up'], ['page down', 'page up']]) {
    let v = await say(down), n = 1;
    for (; n < 4 && !tileReachable(v); n++) v = await say(down);
    check(tileReachable(v) && v.inner === s0.inner, `${vp.name}: voice — "${down}" ×${n} shows the ${v.bottomTag} whole (${Math.round(v.bottomTile.top)}–${Math.round(v.bottomTile.bottom)})`);
    const vh = await page.evaluate(bottomTileHits);
    check(vh.bad.length === 0, `${vp.name}: voice — after "${down}" every ${v.bottomTag} button hit-tests${vh.bad.length ? ` — ${vh.bad.join(', ')}` : ''}`);
    const vc = await page.evaluate(coveredChips);
    check(vc.covered.length === 0, `${vp.name}: voice — after "${down}" the chips are still clickable${vc.covered.length ? ` — ${vc.covered.join('; ')}` : ''}`);
    let b = await say(back);
    for (let k = 0; k < 3 && b.frame.top < s0.frame.top - 2; k++) b = await say(back);
    check(Math.abs(b.frame.top - s0.frame.top) <= 2, `${vp.name}: voice — "${back}" returns (${Math.round(b.frame.top)} vs ${Math.round(s0.frame.top)})`);
  }
  check(errors.length === 0, `${vp.name}: no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
  await page.close();
}

/** Undo's rect (and every cluster button's) stays put while the top bar
 *  changes: Tools open, Tools closed, a status toast showing. A palm aimed
 *  at a button must never find it moved. */
async function clusterHoldsStill(page, label) {
  const rects = () => page.evaluate(() => [...document.querySelectorAll('.mc-hand-cluster > *')].filter((e) => e.getClientRects().length)
    .map((e) => { const r = e.getBoundingClientRect(); return `${e.className.split(' ').pop()}:${[r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(',')}`; }).join(' '));
  const undo = () => page.evaluate(() => { const r = document.querySelector('.mc-hand-cluster .mc-cluster-undo')?.getBoundingClientRect(); return r ? [r.left, r.top, r.width, r.height].map((v) => Math.round(v)).join(',') : 'none'; });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const toolsOpen = () => page.evaluate(() => !!document.querySelector('.mc-bar-tools:not([hidden]):not(.mc-bar-tools-peek)'));
  const base = await rects(), u0 = await undo();
  await wait(1200); // the Tools chip ignores a second press within its latch
  await page.evaluate(() => document.querySelector('.mc-hand-cluster .mc-tools-chip')?.click()); await wait(1200);
  const opened = await toolsOpen();
  const uOpen = await undo(), rOpen = await rects();
  // Every cluster button answers a hit-test at its centre: the open Tools bar
  // (and, below, a wrapped status line) never lies over it.
  const clusterHits = () => page.evaluate(() => [...document.querySelectorAll('.mc-hand-cluster > *')].filter((e) => e.getClientRects().length).filter((e) => {
    const r = e.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !h || !(h === e || e.contains(h));
  }).map((e) => `${e.textContent.trim().slice(0, 14)} → ${document.elementFromPoint(e.getBoundingClientRect().left + 20, e.getBoundingClientRect().top + 20)?.className ?? '?'}`));
  const hidOpen = await clusterHits();
  check(hidOpen.length === 0, `${label}: with Tools open every cluster button hit-tests to itself${hidOpen.length ? ` — ${hidOpen.join('; ')}` : ''}`);
  await page.evaluate(() => document.querySelector('.mc-hand-cluster .mc-tools-chip')?.click()); await wait(1200);
  const uClosed = await undo();
  await page.evaluate(() => { const s = document.querySelector('.mc-canvas-status'); if (s) s.textContent = 'Swapped: Nothing on the left, iPhone on the right. Say undo to put them back where they were before. '.repeat(4); }); await wait(400);
  const uToast = await undo(), rToast = await rects();
  const hidToast = await clusterHits();
  check(hidToast.length === 0, `${label}: with a wrapped status line every cluster button hit-tests to itself${hidToast.length ? ` — ${hidToast.join('; ')}` : ''}`);
  await page.evaluate(() => { const s = document.querySelector('.mc-canvas-status'); if (s) s.textContent = ''; }); await wait(200);
  check(opened && u0 !== 'none' && uOpen === u0 && uClosed === u0 && uToast === u0, `${label}: Undo holds still — Tools open, closed, toast (${u0} | ${uOpen} | ${uClosed} | ${uToast})`);
  check(rOpen === base && rToast === base, `${label}: no cluster button moves with the top bar`);
}

async function pairedRun(browser, vp, tiles) {
  console.log(`-- ${vp.name}`);
  const { page, errors } = await openBoard(browser, vp, roomDoc(tiles));
  await page.evaluate(() => {
    const i = document.querySelector('#mc-say-in'); const f = document.querySelector('.mc-say');
    if (i && f) { i.value = 'connect devices'; f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }
  });
  // Both SIM phones in: press Continue, then at once press again where it
  // was and Disconnect itself (a double click / a tremor's repeated fist).
  // Disconnect is elsewhere, and ignores presses for a second after it appears.
  // (Pressed as soon as Continue is live — the SIM script presses it itself
  // at 4 s; the second phone still joins after.)
  const two = await page.waitForFunction(() => document.querySelectorAll('.mc-paired-row .mc-paired-chip').length >= 1 && !!document.querySelector('.mc-paired-continue:not([disabled])'), { timeout: 10_000, polling: 50 }).then(() => true, () => false);
  if (two) {
    const tap = await page.evaluate(() => {
      const c = document.querySelector('.mc-paired-continue');
      const r = c.getBoundingClientRect();
      const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      c.click();
      const d = document.querySelector('.mc-paired-row .mc-paired-disconnect');
      const dr = d?.getBoundingClientRect();
      const under = !!dr && at.x >= dr.left && at.x <= dr.right && at.y >= dr.top && at.y <= dr.bottom;
      document.elementFromPoint(at.x, at.y)?.click();
      d?.click();
      return { shown: !!d, under };
    });
    check(tap.shown && !tap.under, `${vp.name}: Disconnect never appears under the Continue just pressed`);
    await new Promise((r) => setTimeout(r, 200));
    check(await page.evaluate(() => /phones? connected/.test(document.querySelector('.mc-paired-row:not([hidden])')?.textContent ?? '')), `${vp.name}: a press on Disconnect right as it appears is ignored`);
  } else check(false, `${vp.name}: Continue offered once a SIM phone joined`);
  const joined = await page.waitForFunction(() => /2 phones connected/.test(document.querySelector('.mc-paired-row:not([hidden])')?.textContent ?? ''), { timeout: 12_000 }).then(() => true, () => false);
  check(joined, `${vp.name}: two SIM phones paired, connected strip shown`);
  // Back on the room board, Tools closed, camera on, status line cleared, as
  // on the live screen.
  await page.evaluate(() => {
    const i = document.querySelector('#mc-say-in'); const f = document.querySelector('.mc-say');
    if (i && f) { i.value = 'go to living room'; f.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })); }
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(async () => {
    const open = () => document.querySelector('.mc-bar-tools:not([hidden]):not(.mc-bar-tools-peek)');
    if (open()) document.querySelector('.mc-tools-chip')?.click();
    await new Promise((r) => setTimeout(r, 200));
    const s = document.querySelector('.mc-canvas-status'); if (s) s.textContent = '';
  });
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await new Promise((r) => setTimeout(r, 300));
  await settle(page);
  // Camera on (headless has none: show the preview box as the live run does).
  await page.evaluate(() => { const p = document.querySelector('.mc-face-preview'); if (p) p.hidden = false; });
  await new Promise((r) => setTimeout(r, 300));
  const m = await page.evaluate(measure);
  const extra = await page.evaluate(() => {
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.width ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; };
    const row = document.querySelector('.mc-paired-row:not([hidden])');
    const dis = row?.querySelector('.mc-paired-disconnect');
    const d = box(dis);
    const hit = d ? document.elementFromPoint((d.left + d.right) / 2, (d.top + d.bottom) / 2) : null;
    const strip = document.querySelector('.mc-arrange:not(.mc-paired-row):not([hidden])');
    return {
      row: box(row), dis: d, disHit: !!(hit && dis && (hit === dis || dis.contains(hit))),
      strip: box(strip),
      cam: box(document.querySelector('.mc-face-preview:not([hidden])')),
      more: box(document.querySelector('.mc-more-btn')),
      bar: box(document.querySelector('.mc-engine-bar')),
    };
  });
  check(!!extra.row, `${vp.name}: connected strip visible`);
  check(!!m.frame && m.tiles.length === tiles.length, `${vp.name}: the room board is focused (${m.tiles.length} tiles)`);
  // Never over the board: clear of it, or docked in the bottom chrome row
  // (inside the engine bar — a board taller than the screen at its lowest
  // zoom runs under that row and the canvas scrolls; nothing floats higher).
  const docked = !!(extra.row && extra.bar && extra.row.top >= extra.bar.top - 1 && extra.row.bottom <= extra.bar.bottom + 1);
  if (extra.row && m.frame) check(docked || !overlap(extra.row, m.frame), `${vp.name}: connected strip never covers the board (strip ${Math.round(extra.row.top)}–${Math.round(extra.row.bottom)}, board bottom ${Math.round(m.frame.bottom)}, bar top ${Math.round(extra.bar?.top ?? -1)})`);
  // A board taller than the screen even at its lowest zoom is pinned to the
  // top and the canvas scrolls (by design): its foot is under the bottom row
  // until scrolled to. Everything else must show whole, clear of all chrome.
  const tall = !!(m.frame && extra.bar && m.frame.bottom > extra.bar.top);
  if (tall) {
    console.log(`     (board taller than the screen at z ${m.z}: pinned to the top, chips pinned above the bar)`);
    check(m.frame.top >= 0 && m.frame.top <= 80, `${vp.name}: a too-tall board is pinned to the top (${Math.round(m.frame.top)})`);
  }
  if (extra.row && !tall) { const under = m.tiles.filter((t) => overlap(t.box, extra.row)).map((t) => t.tag); check(under.length === 0, `${vp.name}: connected strip covers no tile${under.length ? ` — ${under.join(', ')}` : ''}`); }
  const camOver = extra.cam ? m.tiles.filter((t) => overlap(t.box, extra.cam)).map((t) => t.tag) : [];
  check(camOver.length === 0, `${vp.name}: camera preview covers no tile${camOver.length ? ` — ${camOver.join(', ')}` : ''}`);
  if (extra.row && m.items.length) check(!m.items.some((i) => overlap(i.box, extra.row)), `${vp.name}: connected strip clear of the hand cluster`);
  if (extra.row && extra.cam) check(!overlap(extra.row, extra.cam), `${vp.name}: connected strip clear of the camera preview`);
  if (extra.row && extra.bar && !docked) check(!overlap(extra.row, extra.bar), `${vp.name}: connected strip clear of the engine bar`);
  check(!!extra.dis && extra.disHit && extra.dis.bottom <= m.vh && extra.dis.top >= 0, `${vp.name}: Disconnect on screen and clickable`);
  const hits = m.chips.flatMap((c) => m.tiles.filter((t) => overlap(c, t.box)).map((t) => t.tag));
  if (!tall) check(hits.length === 0, `${vp.name}: chips never sit on a tile${hits.length ? ` — ${hits.join(', ')}` : ''}`);
  else check(m.chips.every((c) => c.bottom <= extra.bar.top + 1), `${vp.name}: tall board — chip row pinned above the bottom bar`);
  if (extra.row && !tall) check(!m.chips.some((c) => overlap(c, extra.row)), `${vp.name}: chips clear of the connected strip`);
  // No scroll needed, tall board or not: the chips are pinned above the bar.
  const hitT = await page.evaluate(coveredChips);
  check(hitT.n > 0 && hitT.covered.length === 0, `${vp.name}: every chip's centre clicks the chip, no scrolling (${hitT.n})${hitT.covered.length ? ` — ${hitT.covered.join('; ')}` : ''}`);
  checkCluster(m, `${vp.name} camera on`, { allowWrap: false });
  check(!extra.cam || !m.items.some((i) => overlap(i.box, extra.cam)), `${vp.name}: cluster clear of the camera preview`);
  check(!extra.more || !m.items.some((i) => overlap(i.box, extra.more)), `${vp.name}: cluster clear of the More button`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name}.png`) });
  // The More menu, opened, covers no cluster button and the cluster none of it.
  const menu = await page.evaluate(async () => {
    const btn = document.querySelector('.mc-more-btn');
    const tools = document.querySelector('.mc-tools-chip');
    if (!btn) return null;
    if (btn.getClientRects().length === 0 && tools) { tools.click(); await new Promise((r) => setTimeout(r, 200)); }
    if (btn.getAttribute('aria-expanded') !== 'true') btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const mm = document.querySelector('.mc-more-menu:not([hidden])');
    if (!mm) return null;
    // Every menu button paints on top: no cluster button over it.
    const covered = [...mm.querySelectorAll('button')].filter((b) => {
      const r = b.getBoundingClientRect();
      if (!r.width || r.bottom > innerHeight) return false;
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !hit || !mm.contains(hit);
    }).map((b) => b.textContent.trim());
    return { covered };
  });
  if (menu) {
    check(menu.covered.length === 0, `${vp.name}: nothing covers the open More menu${menu.covered.length ? ` — ${menu.covered.join(', ')}` : ''}`);
    if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name}-more.png`) });
    await page.evaluate(() => { const b = document.querySelector('.mc-more-btn'); if (b?.getAttribute('aria-expanded') === 'true') b.click(); });
    await new Promise((r) => setTimeout(r, 1200));
    await page.evaluate(() => { if (document.querySelector('.mc-bar-tools:not([hidden]):not(.mc-bar-tools-peek)')) document.querySelector('.mc-tools-chip')?.click(); });
    await new Promise((r) => setTimeout(r, 300));
  }
  // The docked engine cards stay readable with the phones in the bar: the
  // longest states, no clipped name or state.
  const clipped = await page.evaluate(() => {
    const bar = document.querySelector('.mc-engine-bar');
    for (const [i, c] of [...document.querySelectorAll('.mc-engine-card')].entries()) {
      c.setAttribute('data-state', i ? 'unavailable' : 'working');
      const st = c.querySelector('.mc-engine-state'); if (st) st.textContent = i ? 'Unavailable' : 'Working';
    }
    const b = bar.getBoundingClientRect();
    const out = [];
    for (const el of bar.querySelectorAll('.mc-engine-name, .mc-engine-state, .mc-paired-count, .mc-paired-disconnect')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (el.scrollWidth > el.clientWidth + 1 || r.right > b.right + 1 || r.left < b.left - 1) out.push(el.textContent.trim());
    }
    for (const c of bar.querySelectorAll('.mc-engine-card')) { const r = c.getBoundingClientRect(); const head = c.querySelector('.mc-engine-head').getBoundingClientRect(); const body = c.querySelector('.mc-engine-body').getBoundingClientRect(); if (head.right > r.right + 1 || body.right > r.right + 1) out.push(c.textContent.trim()); }
    return { out, on: b.left >= 0 && b.right <= innerWidth };
  });
  check(clipped.out.length === 0 && clipped.on, `${vp.name}: engine cards and phones read in full in the bar ("Working", "Unavailable")${clipped.out.length ? ` — clipped: ${clipped.out.join(', ')}` : ''}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name}-engines.png`) });
  // Disconnect, long armed (more than 1.1 s since it appeared), does disconnect.
  const gone = await page.evaluate(async () => {
    document.querySelector('.mc-paired-row .mc-paired-disconnect')?.click();
    await new Promise((r) => setTimeout(r, 300));
    return !/phones? connected/.test(document.querySelector('.mc-paired-row:not([hidden])')?.textContent ?? '');
  });
  check(gone, `${vp.name}: Disconnect pressed after 1.1 s disconnects the phones`);
  check(errors.length === 0, `${vp.name}: no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
  await page.close();
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-laptop-layout: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-laptop-layout: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-laptop-layout: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  });
  try {
    for (const vp0 of VIEWPORTS) for (const board of BOARDS) {
      const vp = { ...vp0, name: `${vp0.name} ${board.name}` };
      if (ONLY && !vp.name.includes(ONLY)) continue;
      console.log(`-- ${vp.name}`);
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e?.message || e)));
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      await page.evaluateOnNewDocument((doc) => {
        try { localStorage.setItem('mc.canvas.v1', JSON.stringify(doc)); } catch { /* checks fail on their own */ }
      }, board.doc);
      await page.goto(`${BASE}/canvas.html?sim=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector('.mc-frame mc-lamp-tile', { timeout: 20_000 });
      await page.waitForSelector('.mc-frame .mc-next .mc-next-chip', { timeout: 10_000 }).catch(() => undefined);
      await page.evaluate(() => document.fonts.ready);
      await new Promise((r) => setTimeout(r, 1500));
      // Headless Chrome has no camera, so a "Camera blocked" toast wraps the
      // top bar for ~8 s. Clear it now (as its fade would) and re-fit as a
      // window resize does (the board is framed at its shown size).
      await page.evaluate(() => { const s = document.querySelector('.mc-canvas-status'); if (s) s.textContent = ''; });
      await new Promise((r) => setTimeout(r, 50));
      await page.evaluate(() => window.dispatchEvent(new Event('resize')));
      // Let the camera settle (a refit after the first paint flies 420 ms):
      // the board's box must hold still for three polls in a row.
      for (let i = 0, last = '', same = 0; i < 40 && same < 3; i++) {
        const now = await page.evaluate(() => { const f = document.querySelector('.mc-frame.focused') ?? document.querySelector('.mc-frame'); const r = f?.getBoundingClientRect(); return r ? [r.left, r.top, r.width, r.height].map(Math.round).join(',') : ''; });
        same = now === last ? same + 1 : 0; last = now;
        await new Promise((r) => setTimeout(r, 150));
      }

      const m = await page.evaluate(measure);
      check(m.tiles.length === board.doc.surfaces.f1.tiles.length, `${vp.name}: tiles rendered (${m.tiles.length})`);
      check(m.chips.length === 1, `${vp.name}: one next-step chip row`);
      // A board that fits keeps its chip row under its tiles; one that runs
      // under the bottom bar (too tall even at the 0.8 zoom floor) pins the
      // row just above the bar, over the tiles, which scroll under it.
      const tallB = !!(m.frame && m.bar && m.frame.bottom > m.bar.top);
      if (!tallB) {
        const hits = m.chips.flatMap((c) => m.tiles.filter((t) => overlap(c, t.box)).map((t) => t.tag));
        check(hits.length === 0, `${vp.name}: chips never sit on a tile${hits.length ? ` — ${hits.join(', ')}` : ''}`);
        const lastTile = Math.max(...m.tiles.map((t) => t.box.bottom));
        check(m.chips.every((c) => c.top >= lastTile - 1), `${vp.name}: chip row is below the board's content`);
      } else check(m.chips.every((c) => c.bottom <= m.bar.top + 1), `${vp.name}: tall board — chip row pinned above the bottom bar`);
      if (board.whole || tallB) {
        const hitT = await page.evaluate(coveredChips);
        check(hitT.n > 0 && hitT.covered.length === 0, `${vp.name}: every chip's centre clicks the chip (${hitT.n})${hitT.covered.length ? ` — ${hitT.covered.join('; ')}` : ''}`);
      }
      check(!!m.frame && m.frame.width >= Math.min(900, m.vw * 0.55), `${vp.name}: board wide enough (${Math.round(m.frame?.width ?? 0)} px)`);
      check(m.scrollers.length === 0, `${vp.name}: no inner scroll${m.scrollers.length ? ` — ${m.scrollers.join(', ')}` : ''}`);
      if (board.whole) {
        const under = m.bar && m.chips.some((c) => overlap(c, m.bar));
        check(!!m.frame && m.frame.top >= 0 && m.chips.every((c) => c.bottom <= m.vh) && !under, `${vp.name}: whole board and its chips on screen, clear of the engine bar (board top ${Math.round(m.frame?.top ?? -1)}, chips end ${Math.round(Math.max(0, ...m.chips.map((c) => c.bottom)))}, bar top ${Math.round(m.bar?.top ?? -1)}, z ${m.z})`);
      }
      checkCluster(m, vp.name, { allowWrap: false });
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name.replace(' ', '-')}.png`) });
      if (!board.extras) { check(errors.length === 0, `${vp.name}: no page errors${errors.length ? ` — ${errors[0]}` : ''}`); await page.close(); continue; }

      await clusterHoldsStill(page, `${vp.name} camera off`);
      // Camera on: the face preview owns the bottom-right corner; the cluster
      // lives above it — one column unless the window is too short.
      await page.evaluate(() => { const p = document.querySelector('.mc-face-preview'); if (p) p.hidden = false; });
      await new Promise((r) => setTimeout(r, 300));
      const cam = await page.evaluate(measure);
      const colH = cam.items.reduce((s, i) => s + i.box.height, 0) + 12 * (cam.items.length - 1);
      checkCluster(cam, `${vp.name} camera on`, { allowWrap: colH > cam.vh - 64 - 260 });
      const prev = await page.evaluate(() => { const p = document.querySelector('.mc-face-preview'); const r = p?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; });
      check(!prev || !cam.items.some((i) => overlap(i.box, prev)), `${vp.name} camera on: cluster clear of the camera preview`);
      await clusterHoldsStill(page, `${vp.name} camera on`);
      if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name.replace(' ', '-')}-camera.png`) });

      // Hand-hover label: compact, one line, never over the button or its neighbours.
      const hover = await page.evaluate(async () => {
        const target = document.querySelector('.mc-hand-cluster .mc-tools-chip');
        const api = window.__mcPalmHighlightTest;
        if (!target || !api) return { skipped: true };
        api.show(target);
        await new Promise((r) => setTimeout(r, 120));
        const lab = document.querySelector('.mc-highlight-layer:not([hidden]) .mc-highlight-label');
        if (!lab) return { missing: true };
        const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
        const cs = getComputedStyle(lab);
        const sibs = [...document.querySelectorAll('.mc-hand-cluster > *')].map(box);
        return { label: box(lab), fontSize: parseFloat(cs.fontSize), whiteSpace: cs.whiteSpace, blur: cs.backdropFilter || cs.webkitBackdropFilter || '', sibs, vw: innerWidth, vh: innerHeight };
      });
      if (hover.skipped) check(false, `${vp.name}: hand-hover label test hook missing`);
      else if (hover.missing) check(false, `${vp.name}: hand-hover label shown`);
      else {
        check(hover.fontSize >= 15 && hover.fontSize <= 16.5, `${vp.name}: hover label ${hover.fontSize}px text`);
        check(hover.label.width <= 222 && hover.whiteSpace === 'nowrap', `${vp.name}: hover label one line, ≤ 220 px (${Math.round(hover.label.width)})`);
        check(/blur/.test(hover.blur), `${vp.name}: hover label is glass (${hover.blur || 'none'})`);
        const covers = hover.sibs.filter((b) => overlap(b, hover.label));
        check(covers.length === 0, `${vp.name}: hover label covers no cluster button`);
        const L = hover.label;
        check(L.left >= 0 && L.top >= 0 && L.right <= hover.vw && L.bottom <= hover.vh, `${vp.name}: hover label on screen`);
        if (SHOTS) await page.screenshot({ path: join(SHOTS, `${vp.name.replace(' ', '-')}-hover.png`) });
      }
      check(errors.length === 0, `${vp.name}: no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
      await page.close();
    }
    await edgeSends(browser);
    for (const vp of TALL_VIEWPORTS) if (!ONLY || vp.name.includes(ONLY)) await tallRun(browser, vp);
    for (const vp of PAIRED_VIEWPORTS) for (const board of PAIRED_BOARDS) if (!ONLY || `${vp.name}-${board.name}`.includes(ONLY)) await pairedRun(browser, { ...vp, name: `${vp.name}-${board.name}` }, board.tiles);
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `\n${failures.length} failure(s)` : '\nlaptop layout: all checks passed');
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
