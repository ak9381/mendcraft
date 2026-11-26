// e2e-room-rebuild.mjs — "build the dashboard" on a dashboard that already
// holds the speaker, the lamps and the gimbal tile must never review (or
// apply) a board without them, even when the model's reply is ONLY a
// "Connect a device" tile. Runs canvas.html?sim=1&hands=0&fresh=1 (scripted
// engines, SIM labelled), pairs the SIM phones, builds and keeps a dashboard,
// then makes the scripted model reply with only a Connect tile and rebuilds.
//
//   npx vite --port 5173 &
//   E2E_URL=http://localhost:5173 npm run e2e:room-rebuild

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const CONNECT_ONLY = '{"kind":"room","title":"Smart Home Dashboard","tiles":[{"type":"connect","label":"Connect a device"}]}';

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
  if (!chrome) { console.error('e2e-room-rebuild: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-room-rebuild: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-room-rebuild: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'] });
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.message || e)));
    await page.goto(`${BASE}/canvas.html?sim=1&hands=0&fresh=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => !!window.__canvas && !!window.__mcScripts, { timeout: 20_000 });

    const waitFor = async (fn, ms, what) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await page.evaluate(fn).catch(() => false)) return true; await sleep(250); }
      check(false, `timed out: ${what}`);
      return false;
    };
    const reviewOpen = () => !!document.querySelector('.mc-proposal-keep');
    const dashboard = () => {
      const c = window.__canvas; const doc = c.snapshot();
      const f = doc.frames.find((x) => doc.surfaces[x.id]?.kind === 'room' && x.title !== 'Connected devices');
      return f ? { id: f.id, title: f.title, plan: doc.surfaces[f.id] } : null;
    };
    const leaves = (tiles) => (tiles || []).flatMap((t) => t.children ? leaves(t.children) : t.tabs ? t.tabs.flatMap((tab) => leaves(tab.children)) : t.first ? [...leaves(t.first), ...leaves(t.second)] : [t]);

    // 1. Pair the SIM phones (the SIM iPhone reports a stand).
    await page.evaluate(() => window.__canvas.run('connect devices and make a dashboard'));
    await waitFor(() => /iPhone/.test(document.body.innerText), 20_000, 'SIM iPhone paired');
    await sleep(1500);

    // 2. Build the dashboard and keep it: lamps + speaker + gimbal.
    await page.evaluate(() => window.__canvas.run('build the dashboard'));
    if (!(await waitFor(reviewOpen, 60_000, 'first review'))) return 1;
    await page.evaluate(() => window.__canvas.keep());
    await waitFor(() => !document.querySelector('.mc-proposal-keep'), 10_000, 'first review closed');
    await sleep(1200);
    const first = await page.evaluate(dashboard);
    const firstLeaves = leaves(first?.plan?.tiles);
    const firstDevices = firstLeaves.filter((t) => t.deviceId).map((t) => t.deviceId).sort();
    check(firstLeaves.some((t) => t.type === 'music'), `first build has the speaker (${firstDevices.join(', ')})`);
    check(firstLeaves.some((t) => t.type === 'lamp'), 'first build has a lamp');
    check(firstLeaves.some((t) => t.type === 'gimbal'), 'first build has the gimbal tile (the SIM iPhone reports a stand)');

    // 3. The model now replies with ONLY a Connect tile. Rebuild.
    await page.evaluate((reply) => { window.__mcScripts.nanoRoom = reply; window.__mcScripts.geminiRoom = reply; }, CONNECT_ONLY);
    await page.evaluate((id) => window.__canvas.focus(id), first.id);
    await sleep(800);
    await page.evaluate(() => window.__canvas.run('build the dashboard'));
    if (!(await waitFor(reviewOpen, 60_000, 'rebuild review'))) return 1;
    const review = await page.evaluate(() => {
      const dlg = document.querySelector('.mc-review, [role="dialog"]');
      return { text: (dlg ?? document.body).innerText };
    });
    check(!/(^|\n)\s*[−-]\s*(Speaker|Gimbal|Desk lamp|Ceiling light|Reading lamp|Main light)/m.test(review.text) && !/Remove\s+(Speaker|Gimbal)/i.test(review.text), 'the rebuild review removes no device tile');
    check(!/no devices found yet/i.test(review.text), 'the rebuild headline is not "no devices found"');
    await page.evaluate(() => window.__canvas.keep());
    await waitFor(() => !document.querySelector('.mc-proposal-keep'), 10_000, 'rebuild review closed');
    await sleep(1200);
    const after = await page.evaluate(dashboard);
    const afterLeaves = leaves(after?.plan?.tiles);
    const afterDevices = afterLeaves.filter((t) => t.deviceId).map((t) => t.deviceId).sort();
    check(afterLeaves.some((t) => t.type === 'music'), 'rebuild keeps the speaker tile');
    check(afterLeaves.some((t) => t.type === 'gimbal'), 'rebuild keeps the gimbal tile');
    check(afterLeaves.some((t) => t.type === 'lamp'), 'rebuild keeps the lamp tile');
    check(firstDevices.every((id) => afterDevices.includes(id)), `every device tile is still there (${afterDevices.join(', ')})`);

    // 4. She narrows it: "only the lamps" — the speaker and gimbal go, and a
    //    later plain rebuild (reply: only Connect) does not bring them back.
    const rebuild = async (utterance, reply, what) => {
      await page.evaluate((r) => { window.__mcScripts.nanoRoom = r; window.__mcScripts.geminiRoom = r; }, reply);
      await page.evaluate((u) => window.__canvas.run(u), utterance);
      if (!(await waitFor(reviewOpen, 60_000, `${what} review`))) return null;
      await page.evaluate(() => window.__canvas.keep());
      await waitFor(() => !document.querySelector('.mc-proposal-keep'), 10_000, `${what} review closed`);
      await sleep(1200);
      return leaves((await page.evaluate(dashboard))?.plan?.tiles);
    };
    const LAMPS_ONLY = JSON.stringify({ kind: 'room', title: 'Lights', tiles: [{ type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' }, { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling light' }] });
    const narrowed = await rebuild('build me a dashboard with only the lamps', LAMPS_ONLY, 'narrowed');
    if (narrowed) {
      check(!narrowed.some((t) => t.type === 'music') && !narrowed.some((t) => t.type === 'gimbal'), `"only the lamps" keeps only lamps (${narrowed.map((t) => t.type).join(', ')})`);
      // A reload in between: what she took off is remembered beside the saved boards.
      await sleep(800); // the save is debounced
      await page.goto(`${BASE}/canvas.html?sim=1&hands=0`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForFunction(() => !!window.__canvas && !!window.__mcScripts, { timeout: 20_000 });
      await sleep(1500);
      const reloaded = await page.evaluate(dashboard);
      check(!!reloaded, 'the dashboard is back after the reload');
      if (reloaded) await page.evaluate((id) => window.__canvas.focus(id), reloaded.id);
      await sleep(800);
      const again = await rebuild('build the dashboard', CONNECT_ONLY, 'plain rebuild after narrowing');
      if (again) {
        check(!again.some((t) => t.type === 'music'), 'a later plain rebuild does not re-add the speaker she took off');
        check(again.filter((t) => t.type === 'lamp').length === 2, 'the lamps she kept are still there');
      }
    }
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    if (failures.length) {
      const shot = join(tmpdir(), 'e2e-room-rebuild-failure.png');
      await page.screenshot({ path: shot }).catch(() => {});
      console.log(`     screenshot: ${shot}`);
      console.log(review.text.slice(0, 1200));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(failures.length ? `\ne2e-room-rebuild: ${failures.length} failure(s)` : `\ne2e-room-rebuild: passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return failures.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('e2e-room-rebuild — error:', e?.stack || e); process.exit(1); });
