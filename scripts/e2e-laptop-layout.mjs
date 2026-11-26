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

async function openBoard(browser, vp, doc) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e?.message || e)));
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((d) => {
    try { localStorage.setItem('mc.canvas.v1', JSON.stringify(d)); } catch { /* checks fail on their own */ }
  }, doc);
  await page.goto(`${BASE}/canvas.html?sim=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
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
  const two = await page.waitForFunction(() => document.querySelectorAll('.mc-paired-row .mc-paired-chip').length >= 2 && !!document.querySelector('.mc-paired-continue:not([disabled])'), { timeout: 10_000 }).then(() => true, () => false);
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
    check(await page.evaluate(() => /2 phones connected/.test(document.querySelector('.mc-paired-row:not([hidden])')?.textContent ?? '')), `${vp.name}: a press on Disconnect right as it appears is ignored`);
  } else check(false, `${vp.name}: Continue offered once two SIM phones joined`);
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
    console.log(`     (board taller than the screen at z ${m.z}: pinned to the top, the canvas scrolls)`);
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
  check(hits.length === 0, `${vp.name}: chips never sit on a tile${hits.length ? ` — ${hits.join(', ')}` : ''}`);
  if (extra.row && !tall) check(!m.chips.some((c) => overlap(c, extra.row)), `${vp.name}: chips clear of the connected strip`);
  if (tall) {
    // Scroll the canvas down by the overhang (wheel over the board): the chips come clear.
    await page.mouse.move(m.frame.left + 40, m.frame.top + 200);
    await page.mouse.wheel({ deltaY: Math.ceil(m.frame.bottom - extra.bar.top + 16) });
    await new Promise((r) => setTimeout(r, 400));
  }
  const hitT = await page.evaluate(coveredChips);
  check(hitT.n > 0 && hitT.covered.length === 0, `${vp.name}: every chip's centre clicks the chip${tall ? ' after scrolling' : ''} (${hitT.n})${hitT.covered.length ? ` — ${hitT.covered.join('; ')}` : ''}`);
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
  }
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
      const hits = m.chips.flatMap((c) => m.tiles.filter((t) => overlap(c, t.box)).map((t) => t.tag));
      check(hits.length === 0, `${vp.name}: chips never sit on a tile${hits.length ? ` — ${hits.join(', ')}` : ''}`);
      const lastTile = Math.max(...m.tiles.map((t) => t.box.bottom));
      check(m.chips.every((c) => c.top >= lastTile - 1), `${vp.name}: chip row is below the board's content`);
      if (board.whole) {
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

      // Camera on: the face preview owns the bottom-right corner; the cluster
      // lives above it — one column unless the window is too short.
      await page.evaluate(() => { const p = document.querySelector('.mc-face-preview'); if (p) p.hidden = false; });
      await new Promise((r) => setTimeout(r, 300));
      const cam = await page.evaluate(measure);
      const colH = cam.items.reduce((s, i) => s + i.box.height, 0) + 12 * (cam.items.length - 1);
      checkCluster(cam, `${vp.name} camera on`, { allowWrap: colH > cam.vh - 64 - 260 });
      const prev = await page.evaluate(() => { const p = document.querySelector('.mc-face-preview'); const r = p?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null; });
      check(!prev || !cam.items.some((i) => overlap(i.box, prev)), `${vp.name} camera on: cluster clear of the camera preview`);
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
    for (const vp of PAIRED_VIEWPORTS) for (const board of PAIRED_BOARDS) if (!ONLY || `${vp.name}-${board.name}`.includes(ONLY)) await pairedRun(browser, { ...vp, name: `${vp.name}-${board.name}` }, board.tiles);
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `\n${failures.length} failure(s)` : '\nlaptop layout: all checks passed');
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
