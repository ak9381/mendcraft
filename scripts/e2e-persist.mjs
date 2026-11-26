// e2e-persist.mjs — saved boards are never lost. Runs canvas.html?sim=1&
// hands=0&fresh=1 (scripted engines), builds every board kind (Connected
// devices, a kept dashboard, a kept floor plan with a reviewed plan edit,
// Kannada on), then:
//  1. ?fresh leaves the address bar, and a plain reload of the tab opens the
//     same three boards (the drawing edit and the devices board included);
//  2. a saved doc this build can't read is copied aside, said once, and the
//     copy survives the canvas saving again;
//  3. a stale devices-board key from an older build never turns the
//     dashboard into the devices list.
//
//   npx vite --port 5173 &
//   E2E_URL=http://localhost:5173 npm run e2e:persist

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-persist: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-persist: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-persist: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'] });
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.message || e)));
    const ready = () => page.waitForFunction(() => !!window.__canvas && !!window.__mcScripts, { timeout: 20_000 });
    const waitFor = async (fn, ms, what) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await page.evaluate(fn).catch(() => false)) return true; await sleep(250); }
      check(false, `timed out: ${what}`);
      return false;
    };
    const run = (u) => page.evaluate((x) => window.__canvas.run(x), u);
    const keep = async (what) => {
      if (!(await waitFor(() => !!document.querySelector('.mc-proposal-keep'), 60_000, `${what} review`))) return false;
      await page.evaluate(() => window.__canvas.keep());
      await waitFor(() => !document.querySelector('.mc-proposal-keep'), 10_000, `${what} review closed`);
      await sleep(1200);
      return true;
    };
    const boards = () => page.evaluate(() => window.__canvas.snapshot().frames.map((f) => f.title));
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('mc.canvas.v1') || 'null'));

    // Build every board kind in a ?fresh session.
    await page.goto(`${BASE}/canvas.html?sim=1&hands=0&fresh=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await ready();
    check(!(await page.evaluate(() => location.search)).includes('fresh'), '?fresh leaves the address bar once the canvas opened blank');
    await run('connect devices');
    await waitFor(() => /iPhone/.test(document.body.innerText), 20_000, 'SIM iPhone paired');
    await sleep(1500);
    await run('build the dashboard'); await keep('dashboard');
    await run('draw the floor plan'); await keep('floor plan');
    await sleep(2500);
    await run('add a study next to the kitchen'); await keep('plan edit');
    await run('add kannada'); await keep('Kannada');
    await sleep(800); // the save is debounced
    const before = await stored();
    check(before?.frames?.length === 3 && before.devicesBoard === before.frames[0].id, `three boards saved, the devices board marked in the doc (${before?.frames?.map((f) => f.title).join(', ')})`);
    check(JSON.stringify(before?.drawings ?? {}).includes('Study'), 'the reviewed plan edit is saved');

    // 1. A plain reload of the same tab (what a redeploy does).
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(); await sleep(1500);
    const after = await boards();
    check(JSON.stringify(after) === JSON.stringify(before.frames.map((f) => f.title)), `the reload opens the same boards (${after.join(', ')})`);
    const reloaded = await stored();
    check(JSON.stringify(reloaded?.drawings) === JSON.stringify(before.drawings), 'the plan drawing is the same after the reload');
    check(reloaded?.pack?.lang === 'kn', 'Kannada is still on');
    const planText = await page.evaluate(() => document.querySelector('mc-plan-board') ? 'ok' : '');
    check(planText === 'ok', 'the floor plan board renders after the reload');

    // 2. A saved doc this build can't read.
    const unreadable = JSON.stringify({ ...before, version: 99 });
    await page.evaluate((u) => { localStorage.setItem('mc.canvas.v1', u); localStorage.removeItem('mc.canvas.v1.unreadable'); }, unreadable);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready();
    await waitFor(() => /Couldn’t open your saved boards — they’re kept safe\./.test(document.body.innerText), 8000, 'the "kept safe" line');
    const said = await page.evaluate(() => (document.body.innerText.match(/Couldn’t open your saved boards/g) || []).length);
    check(said >= 1, 'says once that the saved boards are kept safe');
    await run('new board'); await sleep(1200);
    const kept = await page.evaluate(() => localStorage.getItem('mc.canvas.v1.unreadable'));
    check(kept === unreadable, 'the unreadable doc is kept, byte for byte, after the canvas saved again');

    // 3. A stale devices-board key (older build) pointing at the dashboard.
    const stale = { ...before, devicesBoard: undefined };
    delete stale.devicesBoard;
    const dashId = before.frames.find((f) => f.title !== 'Connected devices' && f.kind === 'room').id;
    stale.frames = before.frames.filter((f) => f.id !== before.devicesBoard);
    delete stale.surfaces[before.devicesBoard];
    if (stale.focusId === before.devicesBoard) stale.focusId = null;
    await page.evaluate((d, id) => { localStorage.setItem('mc.canvas.v1', JSON.stringify(d)); localStorage.setItem('mendcraft.devicesBoard', id); }, stale, dashId);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(); await sleep(1500);
    await run('connect devices'); await sleep(5500);
    const s3 = await stored();
    const dash = s3?.surfaces?.[dashId];
    check(dash && dash.title !== 'Connected devices' && JSON.stringify(dash).includes('"lamp"'), `the dashboard keeps its tiles (${dash?.title})`);
    check(s3?.frames?.some((f) => f.id === s3.devicesBoard && f.id !== dashId), 'connect devices makes its own devices board');

    // 4. A narrow laptop window (phone-sized layout, not the phone app) never
    //    takes boards for copies: two Floor plans of the same plan and two
    //    Dashboards all stay, and stay saved.
    const r = (x) => ({ x, y: 0, w: 1000, h: 680 });
    const dashP = { kind: 'room', title: 'Dashboard', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }] };
    const fp = { kind: 'plan', title: 'Floor plan', tiles: [{ type: 'plan', boardId: 'same-cad', template: 'studio' }] };
    const four = {
      version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: 'f1',
      frames: [['f1', 'room', 'Dashboard'], ['f2', 'room', 'Dashboard'], ['f3', 'plan', 'Floor plan'], ['f4', 'plan', 'Floor plan']].map(([id, kind, title], i) => ({ id, kind, title, rect: r(i * 1200), pinned: false })),
      surfaces: { f1: dashP, f2: dashP, f3: fp, f4: fp },
    };
    await page.setViewport({ width: 480, height: 900 });
    await page.evaluate((d) => localStorage.setItem('mc.canvas.v1', JSON.stringify(d)), four);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await ready(); await sleep(1500);
    await run('overview'); await sleep(1200);
    const narrow = await boards();
    const narrowSaved = (await stored())?.frames?.length;
    check(narrow.length === 4 && narrowSaved === 4, `a narrow laptop window keeps all four boards (${narrow.join(', ')}; saved ${narrowSaved})`);

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(failures.length ? `\ne2e-persist: ${failures.length} failure(s)` : `\ne2e-persist: passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return failures.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('e2e-persist — error:', e?.stack || e); process.exit(1); });
