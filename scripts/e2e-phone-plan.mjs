// e2e-phone-plan.mjs — a floor plan edited on the laptop AFTER it was drawn
// reaches the phone as edited (the live bug: the phone showed the original
// Studio without the Bedroom). SIM phones: the laptop's would-be relay
// snapshot (window.__mcLastBoardSnapshot, JSON as on the wire) is fed to a
// phone page through the same coerceSnapshot → applyGuestSnapshot path a real
// relay message takes. Also checks a later laptop edit updates the phone that
// holds the board, and that the other phone ignores it.
//
//   npx vite --port 5173 &
//   E2E_URL=http://localhost:5173 npm run e2e:phone-plan
//   SHOTS=/some/dir … writes the phone screenshots.

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const STUDIO = JSON.stringify({ kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'board-cad', template: 'studio' }] });

async function waitFor(page, fn, ms, what, arg) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await page.evaluate(fn, arg).catch(() => false)) return true; await sleep(200); }
  check(false, `timed out: ${what}`);
  return false;
}

/** Rooms on the phone's plan board: the engine doc and the drawn labels. */
function phonePlan() {
  const host = document.querySelector('mc-plan-board .mc-plan-board');
  const doc = host?.__mcPlanDoc?.();
  return {
    rooms: (doc?.rooms ?? []).map((r) => r.name).sort(),
    labels: [...(host?.querySelectorAll('svg text') ?? [])].map((t) => t.textContent),
  };
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-phone-plan: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-phone-plan: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-phone-plan: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const browser = await puppeteer.launch({
    executablePath: chrome, headless: 'new',
    args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  });
  const errors = [];
  try {
    // ---- the laptop: pair SIM phones, draw the Studio, add a Bedroom ----
    const ctxL = await browser.createBrowserContext();
    const laptop = await ctxL.newPage();
    laptop.on('pageerror', (e) => errors.push(`laptop: ${String(e?.message || e)}`));
    await laptop.setViewport({ width: 1440, height: 900 });
    await laptop.goto(`${BASE}/canvas.html?sim=1&hands=0&fresh=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await laptop.waitForFunction(() => !!window.__canvas && !!window.__mcScripts, { timeout: 20_000 });
    await laptop.evaluate((s) => { window.__mcScripts.nanoPlan = s; }, STUDIO);
    const reviewOpen = () => !!document.querySelector('.mc-proposal-keep');
    const keep = async (what) => {
      if (!(await waitFor(laptop, reviewOpen, 60_000, `${what} review`))) return false;
      await laptop.evaluate(() => window.__canvas.keep());
      return waitFor(laptop, () => !document.querySelector('.mc-proposal-keep'), 10_000, `${what} review closed`);
    };
    await laptop.evaluate(() => window.__canvas.run('connect devices'));
    await waitFor(laptop, () => /iPhone/.test(document.body.innerText), 20_000, 'SIM iPhone paired');
    await sleep(1500);
    await laptop.evaluate(() => window.__canvas.run('draw the floor plan'));
    if (!(await keep('floor plan'))) return 1;
    await waitFor(laptop, () => !!document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc, 15_000, 'laptop plan board');
    await sleep(800);
    await laptop.evaluate(() => window.__canvas.run('add a bedroom next to the studio'));
    if (!(await keep('add bedroom'))) return 1;
    await sleep(600);
    const laptopRooms = await laptop.evaluate(() => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).map((r) => r.name).sort());
    check(laptopRooms.includes('Studio') && laptopRooms.includes('Bedroom'), `laptop shows Studio + Bedroom (${laptopRooms.join(', ')})`);

    // ---- send the Floor plan board to the iPhone edge ----
    const sent = await laptop.evaluate(() => window.__canvas.replay.sendBoard('ios'));
    check(sent, 'the Floor plan board is sent to the iPhone edge');
    const snap1 = await laptop.evaluate(() => window.__mcLastBoardSnapshot ?? null);
    const docRooms = (s) => Object.values(s?.boardDrawings ?? {}).flatMap((d) => (d.rooms ?? []).map((r) => r.name)).sort();
    check(snap1?.boardFor === 'ios', `the snapshot targets the iPhone (${snap1?.boardFor})`);
    check(docRooms(snap1).includes('Bedroom'), `the snapshot carries the edited plan (${docRooms(snap1).join(', ')})`);
    check(!JSON.stringify(snap1?.board ?? {}).includes('Bedroom'), 'the surface plan itself stays drawing-free');

    // ---- the phones ----
    const openPhone = async (vp) => {
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`${vp.name}: ${String(e?.message || e)}`));
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
      if (vp.ios) await page.evaluateOnNewDocument(() => { window.webkit = { messageHandlers: { bridge: { postMessage() {} } } }; });
      // Count each time a board starts its "Moved from laptop" glow.
      await page.evaluateOnNewDocument(() => {
        window.__mcArrivals = 0;
        const lit = new Set();
        new MutationObserver((ms) => {
          for (const m of ms) {
            const on = m.target.classList?.contains('mc-frame-arrived');
            if (on && !lit.has(m.target)) { lit.add(m.target); window.__mcArrivals++; } else if (!on) lit.delete(m.target);
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
      });
      await page.goto(`${BASE}/canvas.html?sim=1&fresh=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(() => !!window.__mcGuestSnapshot, { timeout: 20_000 });
      return page;
    };
    const iphone = await openPhone({ name: 'iphone-440x956', width: 440, height: 956, ios: true });
    const android = await openPhone({ name: 'android-412x915', width: 412, height: 915, ios: false });
    check(await iphone.evaluate((s) => window.__mcGuestSnapshot(s), snap1), 'the iPhone takes the board');
    check(!(await android.evaluate((s) => window.__mcGuestSnapshot(s), snap1)), 'the Nothing phone ignores a board sent to the iPhone');
    await waitFor(iphone, () => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).length > 0, 15_000, 'iPhone plan board');
    await sleep(500);
    const p1 = await iphone.evaluate(phonePlan);
    check(p1.rooms.includes('Studio') && p1.rooms.includes('Bedroom'), `the iPhone shows Studio + Bedroom (${p1.rooms.join(', ')})`);
    check(p1.labels.includes('Bedroom'), 'the iPhone draws the Bedroom label');
    const arrivedPill = () => {
      const p = document.querySelector('.mc-frame.mc-frame-arrived .mc-frame-pill[data-pill="arrived"]:not([hidden])');
      const r = p?.getBoundingClientRect();
      const hit = r ? document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2) : [];
      // Never over a control: nothing interactive sits under the pill's centre.
      const covers = hit.some((e) => e !== p && e.matches?.('button, [role=button], a, input') && !e.closest('.mc-frame-head'));
      const onScreen = !!r && r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      return { text: p?.textContent ?? '', onScreen, covers, count: window.__mcArrivals };
    };
    const a1 = await iphone.evaluate(arrivedPill);
    check(a1.text === 'Moved from laptop' && a1.count === 1, `the iPhone board lights up: “${a1.text}” (${a1.count})`);
    check(a1.onScreen && !a1.covers, `the “Moved from laptop” pill is on screen and covers no control (${JSON.stringify(a1)})`);
    if (SHOTS) await iphone.screenshot({ path: join(SHOTS, 'iphone-plan-sent.png') });

    // ---- a later laptop edit updates the phone that holds the board ----
    await laptop.evaluate(() => window.__canvas.run('add a kitchen next to the bedroom'));
    if (!(await keep('add kitchen'))) return 1;
    await waitFor(laptop, (rev) => (window.__mcLastBoardSnapshot?.rev ?? 0) > rev && Object.values(window.__mcLastBoardSnapshot?.boardDrawings ?? {}).some((d) => d.rooms.some((r) => r.name === 'Kitchen')), 5_000, 'republish after the edit', snap1.rev);
    const snap2 = await laptop.evaluate(() => window.__mcLastBoardSnapshot ?? null);
    check(snap2?.boardFor === 'ios', `the republish still targets the iPhone (${snap2?.boardFor})`);
    check(await iphone.evaluate((s) => window.__mcGuestSnapshot(s), snap2), 'the iPhone takes the update');
    await waitFor(iphone, () => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).some((r) => r.name === 'Kitchen'), 10_000, 'Kitchen on the iPhone');
    check(await iphone.evaluate(() => window.__mcArrivals) === 1, 'a republish after a laptop edit does not light the board again');
    const p2 = await iphone.evaluate(phonePlan);
    check(['Bedroom', 'Kitchen', 'Studio'].every((n) => p2.rooms.includes(n)), `the iPhone shows the later edit (${p2.rooms.join(', ')})`);
    if (SHOTS) await iphone.screenshot({ path: join(SHOTS, 'iphone-plan-updated.png') });

    // ---- the phone re-checks what arrives: a broken drawing → the template ----
    const junk = JSON.parse(JSON.stringify(snap2));
    junk.rev += 1;
    junk.boardDrawings['board-cad'] = { walls: [{ id: 'w', a: { x: 0, y: 0 }, b: 'x' }], openings: 'no' };
    await iphone.evaluate((s) => window.__mcGuestSnapshot(s), junk);
    await sleep(600);
    const p3 = await iphone.evaluate(phonePlan);
    check(p3.rooms.length === 1 && p3.rooms[0] === 'Studio', `a malformed drawing is refused: the template shows (${p3.rooms.join(', ')})`);
    // A drawing the laptop left out (too big for the relay) is said on the phone.
    const big = JSON.parse(JSON.stringify(snap2));
    big.rev += 2;
    delete big.boardDrawings;
    big.omitted = { ...big.omitted, drawings: 1 };
    await iphone.evaluate((s) => window.__mcGuestSnapshot(s), big);
    await sleep(800);
    const note = await iphone.evaluate(() => document.querySelector('mc-plan-board .mc-plan-extra-status')?.textContent ?? '');
    check(/too big to show on the phone/.test(note), `the phone says the plan was too big (“${note}”)`);

    // Android gets the board when it is sent there.
    const sentA = await laptop.evaluate(() => window.__canvas.replay.sendBoard('android'));
    const snap3 = await laptop.evaluate(() => window.__mcLastBoardSnapshot ?? null);
    check(sentA && snap3?.boardFor === 'android', 'the board goes to the Nothing phone edge');
    check(await android.evaluate((s) => window.__mcGuestSnapshot(s), snap3), 'the Nothing phone takes it');
    await waitFor(android, () => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).some((r) => r.name === 'Kitchen'), 10_000, 'Kitchen on the Nothing phone');
    const aA = await android.evaluate(arrivedPill);
    check(aA.text === 'Moved from laptop' && aA.count === 1 && aA.onScreen && !aA.covers, `the Nothing phone board lights up (${JSON.stringify(aA)})`);
    if (SHOTS) await android.screenshot({ path: join(SHOTS, 'android-plan.png') });

    // ---- re-pairing: the same board arrives again (replay on hello), and
    //      again after the phone reloads — it shows ONCE ----
    const shownOnce = () => ({
      frames: document.querySelectorAll('.mc-frame').length,
      plans: document.querySelectorAll('mc-plan-board').length,
      surfaces: document.querySelectorAll('.mc-surface > *').length,
      titles: (document.body.innerText.match(/Floor plan/g) || []).length,
      studio: (document.body.innerText.match(/Studio/g) || []).length,
    });
    const once0 = await android.evaluate(shownOnce);
    console.log('     android before replay', JSON.stringify(once0));
    if (process.env.DEBUG_TEXT) console.log(await android.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 600)));
    await android.evaluate((s) => window.__mcGuestSnapshot(s), snap3);
    await sleep(800);
    const replayed = { ...snap3, rev: (snap3.rev ?? 0) + 5 };
    await android.evaluate((s) => window.__mcGuestSnapshot(s), replayed);
    await sleep(800);
    const once1 = await android.evaluate(shownOnce);
    console.log('     android after replay', JSON.stringify(once1));
    check(once1.frames === 1 && once1.plans === 1, `a replayed board shows once on the Nothing phone (${JSON.stringify(once1)})`);
    check(await android.evaluate(() => window.__mcArrivals) === 1, 'a replayed send does not light the board again');
    await android.reload({ waitUntil: 'domcontentloaded' });
    await android.waitForFunction(() => !!window.__mcGuestSnapshot, { timeout: 20_000 });
    await sleep(1200);
    console.log('     android after reload', JSON.stringify(await android.evaluate(shownOnce)));
    await android.evaluate((s) => window.__mcGuestSnapshot(s), replayed);
    await sleep(1200);
    const once2 = await android.evaluate(shownOnce);
    console.log('     android after reload + replay', JSON.stringify(once2));
    check(once2.frames === 1 && once2.plans === 1 && once2.titles <= once0.titles, `after re-pairing the board still shows once (${JSON.stringify(once2)})`);
    check(await android.evaluate(() => window.__mcArrivals) === 0, 'after a reload the replayed send does not light the board');
    // A phone that saved a board from an older build (a dashboard that still
    // held the plan tile): on reload that tile is lifted to its own "Floor
    // plan" board — and the laptop's Floor plan must land THERE, not on a
    // second board.
    await android.evaluate(() => {
      const r = { x: 0, y: 0, w: 1000, h: 680 };
      localStorage.setItem('mc.canvas.v1', JSON.stringify({
        version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1',
        frames: [{ id: 'f1', kind: 'note', title: 'Dashboard', rect: r, pinned: false }],
        surfaces: { f1: { kind: 'room', title: 'Dashboard', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }, { type: 'plan', boardId: 'board-cad', template: 'studio' }] } },
      }));
    });
    await android.reload({ waitUntil: 'domcontentloaded' });
    await android.waitForFunction(() => !!window.__mcGuestSnapshot, { timeout: 20_000 });
    await sleep(1200);
    console.log('     android legacy reload', JSON.stringify(await android.evaluate(shownOnce)));
    await android.evaluate((s) => window.__mcGuestSnapshot(s), { ...replayed, rev: replayed.rev + 1 });
    await sleep(1200);
    const once3 = await android.evaluate(shownOnce);
    console.log('     android legacy reload + replay', JSON.stringify(once3));
    if (process.env.DEBUG_TEXT) console.log(await android.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').slice(0, 600)));
    check(once3.plans === 1 && once3.titles === 1, `a phone with an older saved board shows the Floor plan once (${JSON.stringify(once3)})`);
    // Her own boards are never taken for copies: two Dashboards of her own and
    // a different floor plan all stay when the laptop's Floor plan arrives.
    await android.evaluate(() => {
      const r = (x) => ({ x, y: 0, w: 1000, h: 680 });
      const dash = { kind: 'room', title: 'Dashboard', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }] };
      localStorage.setItem('mc.canvas.v1', JSON.stringify({
        version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1',
        frames: [{ id: 'f1', kind: 'note', title: 'Board 1', rect: r(0), pinned: false }, { id: 'f2', kind: 'room', title: 'Dashboard', rect: r(1200), pinned: false },
          { id: 'f3', kind: 'room', title: 'Dashboard', rect: r(2400), pinned: false }, { id: 'f4', kind: 'plan', title: 'Floor plan', rect: r(3600), pinned: false }],
        surfaces: { f2: dash, f3: dash, f4: { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'mine-cad', template: 'studio' }] } },
      }));
    });
    await android.reload({ waitUntil: 'domcontentloaded' });
    await android.waitForFunction(() => !!window.__mcGuestSnapshot, { timeout: 20_000 });
    await sleep(1000);
    await android.evaluate((s) => window.__mcGuestSnapshot(s), { ...replayed, rev: replayed.rev + 2 });
    await sleep(1200);
    const mine = await android.evaluate(() => window.__canvas.frames().map((f) => f.title));
    check(mine.length === 4 && mine.filter((t) => t === 'Dashboard').length === 2 && mine.filter((t) => t === 'Floor plan').length === 2, `her own boards all stay (${mine.join(', ')})`);
    check(errors.length === 0, `no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `\n${failures.length} failure(s)` : '\nphone plan: all checks passed');
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
