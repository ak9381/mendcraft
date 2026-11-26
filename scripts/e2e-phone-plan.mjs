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
    if (SHOTS) await iphone.screenshot({ path: join(SHOTS, 'iphone-plan-sent.png') });

    // ---- a later laptop edit updates the phone that holds the board ----
    await laptop.evaluate(() => window.__canvas.run('add a kitchen next to the bedroom'));
    if (!(await keep('add kitchen'))) return 1;
    await waitFor(laptop, (rev) => (window.__mcLastBoardSnapshot?.rev ?? 0) > rev && Object.values(window.__mcLastBoardSnapshot?.boardDrawings ?? {}).some((d) => d.rooms.some((r) => r.name === 'Kitchen')), 5_000, 'republish after the edit', snap1.rev);
    const snap2 = await laptop.evaluate(() => window.__mcLastBoardSnapshot ?? null);
    check(snap2?.boardFor === 'ios', `the republish still targets the iPhone (${snap2?.boardFor})`);
    check(await iphone.evaluate((s) => window.__mcGuestSnapshot(s), snap2), 'the iPhone takes the update');
    await waitFor(iphone, () => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).some((r) => r.name === 'Kitchen'), 10_000, 'Kitchen on the iPhone');
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

    // Android gets the board when it is sent there.
    const sentA = await laptop.evaluate(() => window.__canvas.replay.sendBoard('android'));
    const snap3 = await laptop.evaluate(() => window.__mcLastBoardSnapshot ?? null);
    check(sentA && snap3?.boardFor === 'android', 'the board goes to the Nothing phone edge');
    check(await android.evaluate((s) => window.__mcGuestSnapshot(s), snap3), 'the Nothing phone takes it');
    await waitFor(android, () => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).some((r) => r.name === 'Kitchen'), 10_000, 'Kitchen on the Nothing phone');
    if (SHOTS) await android.screenshot({ path: join(SHOTS, 'android-plan.png') });
    check(errors.length === 0, `no page errors${errors.length ? ` — ${errors[0]}` : ''}`);
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `\n${failures.length} failure(s)` : '\nphone plan: all checks passed');
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
