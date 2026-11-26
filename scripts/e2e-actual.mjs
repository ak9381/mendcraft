// e2e-actual.mjs — the "actual demo" journey against a local dev server,
// one section per plan task. Recorded replies come only from
// tests/fixtures/replies/ (handed to the page as window.__mcFixtures before
// it loads); nothing is scripted in the app.
//
//   npx vite                     # in one terminal (http://localhost:5173)
//   node scripts/e2e-actual.mjs [--only <section>]
//
// Exit code 1 on any failed check, 2 when it cannot run (no Chrome, no server).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const FIXTURES = join(ROOT, 'tests/fixtures/replies');

const argv = process.argv.slice(2);
const onlyAt = argv.indexOf('--only');
const ONLY = onlyAt >= 0 ? argv[onlyAt + 1] : null;

function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ].filter(Boolean).find((p) => existsSync(p));
}

/** Every recorded reply: file name without .json → its `reply` text. */
function loadReplies() {
  const replies = {};
  if (!existsSync(FIXTURES)) return replies;
  for (const f of readdirSync(FIXTURES)) {
    if (!f.endsWith('.json')) continue;
    const rec = JSON.parse(readFileSync(join(FIXTURES, f), 'utf8'));
    if (typeof rec.reply !== 'string') throw new Error(`${f}: no "reply" string`);
    replies[f.slice(0, -'.json'.length)] = rec.reply;
  }
  return replies;
}

const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll fn in the page until it is truthy (or time runs out). */
async function waitFor(page, fn, ms, what, ...args) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(fn, ...args).catch(() => false)) return true;
    await sleep(200);
  }
  check(false, `timed out: ${what}`);
  return false;
}

async function open(page, query) {
  await page.goto(`${BASE}/canvas.html?${query}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  return waitFor(page, () => !!window.__mcCanvas && !!window.__mcArtifacts, 20_000, `canvas ready (${query})`);
}

const frames = (page) => page.evaluate(() => window.__mcCanvas.frames().map((f) => ({ id: f.id, title: f.title })));

// A well-formed board artifact (data only; the canvas checks it on load).
const VALID_BOARD = {
  id: 'board-f1', kind: 'board', v: 1, title: 'Desk', by: 'replay', at: Date.now(), status: 'approved',
  data: {
    frame: { kind: 'room', title: 'Desk', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false },
    plan: { kind: 'room', title: 'Desk', tiles: [{ type: 'stat', label: 'Temperature', value: '21 °C' }] },
  },
};
// A tampered row: a board whose plan is not a plan.
const CORRUPT_BOARD = { ...VALID_BOARD, id: 'board-bad', title: 'Bad', data: { frame: VALID_BOARD.data.frame, plan: { kind: 'room', tiles: 'nope' } } };
const DROPPED_LINE = '1 stored item failed its check and was not loaded.';

const SECTIONS = {
  /** Empty boot; a stored board comes back on reload; a corrupt row is dropped and said. */
  async boot(page) {
    if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
    check((await frames(page)).length === 0, 'fresh boot shows 0 frames');
    check(await page.evaluate(() => window.__mcCanvas.store && Object.keys(window.__mcCanvas.store.all()).length === 0), 'fresh boot has no devices');
    await page.evaluate((a) => window.__mcArtifacts.put(a), VALID_BOARD);

    if (!(await open(page, 'sim=1&hands=0'))) return;
    const one = await frames(page);
    check(one.length === 1 && one[0].title === 'Desk', `stored board is back after a reload (got ${JSON.stringify(one)})`);

    await page.evaluate((a) => window.__mcArtifacts.put(a), CORRUPT_BOARD);
    if (!(await open(page, 'sim=1&hands=0'))) return;
    const still = await frames(page);
    check(still.length === 1 && still[0].title === 'Desk', `a corrupt row leaves the good board alone (got ${JSON.stringify(still)})`);
    await waitFor(page, (line) => document.body.innerText.includes(line), 5_000, `the dropped line is visible: "${DROPPED_LINE}"`, DROPPED_LINE)
      .then((ok) => ok && check(true, 'the dropped line is visible'));
    await sleep(1200); // past the save debounce: the boot-time save must not remove or rewrite anything
    const stored = await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.map((a) => a.id).sort()));
    check(JSON.stringify(stored) === JSON.stringify(['board-bad', 'board-f1']), `the store is untouched by loading and the first save (got ${JSON.stringify(stored)})`);
  },
};

// ---- dashboard: a generated board drives a (simulated) lamp through the checked binding ----
const LAMP_ID = 'wiz-lamp-1';
const reviewOpen = () => { const d = document.querySelector('.mc-review-dialog'); return !!d && !d.hidden; };
const reviewText = () => document.querySelector('.mc-review-dialog')?.innerText ?? '';
/** What the device tiles show: count, controls, state line, standard note. */
const tiles = () => [...document.querySelectorAll('.mc-world mc-device-tile, [data-frame] mc-device-tile')].map((t) => {
  const r = t.shadowRoot;
  return {
    chips: [...(r?.querySelectorAll('[data-act=chip]') ?? [])].map((b) => b.textContent.trim()),
    toggles: r?.querySelectorAll('[data-act=toggle]').length ?? 0,
    state: r?.querySelector('[data-device-state]')?.textContent.trim() ?? '',
    standard: !!r?.querySelector('[data-standard]'),
    sim: !!r?.querySelector('.sim-badge'),
  };
});
const boardArtifacts = (page) => page.evaluate(() => window.__mcArtifacts.list().then((l) => l.filter((a) => a.kind === 'board')));

async function dashboard(page) {
  const notes = [];
  page.on('console', (m) => notes.push(m.text()));
  // One simulated lamp (test build + ?sim=1 only), with an id like the ones the bridge gives.
  await page.evaluateOnNewDocument((id) => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices: [{ id, cls: 'lamp', label: 'Lamp' }] }; }, LAMP_ID);
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  check(await page.evaluate((id) => !!window.__mcCanvas.store.get(id)?.sim, LAMP_ID), 'the fixture lamp is registered and marked SIM');

  // Offline first: Nano's board is reviewed on its own, Gemini's better one on reconnect.
  await page.evaluate(() => document.querySelector('[data-cmd=offline]').click());
  await page.evaluate(() => { window.__mcCanvas.run('make a dashboard for my lamp'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the first review opens'))) return;
  const first = await page.evaluate(reviewText);
  check(first.includes('Replay'), 'the review names the engine as "Replay"');
  check((await page.evaluate(tiles)).length === 0 && (await boardArtifacts(page)).length === 0, '0 boards until Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, () => document.querySelectorAll('mc-device-tile').length === 1, 10_000, 'one device tile after Approve'))) return;
  const one = (await page.evaluate(tiles))[0];
  check(one.standard && one.toggles === 1 && one.sim, `Nano's board: one SIM lamp tile with standard controls (got ${JSON.stringify(one)})`);

  // Back online: the saved Deep pass runs and opens the better board for review.
  await page.evaluate(() => document.querySelector('[data-cmd=offline]').click());
  if (!(await waitFor(page, () => { const d = document.querySelector('.mc-review-dialog'); return !!d && !d.hidden && /Better/.test(d.innerText); }, 15_000, 'the second (better) review opens'))) return;
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, () => [...document.querySelectorAll('mc-device-tile')].some((t) => t.shadowRoot?.querySelectorAll('[data-act=chip]').length >= 3), 10_000, 'chips on the better board'))) return;
  const better = await page.evaluate(tiles);
  check(better.length === 1 && better[0].chips.includes('Relax') && !better[0].standard, `the better board has the model's chips (got ${JSON.stringify(better)})`);

  // Press the power toggle: the tile follows the (simulated) lamp's answer.
  await page.evaluate(() => document.querySelector('mc-device-tile').shadowRoot.querySelector('[data-act=toggle]').click());
  await waitFor(page, () => /^On\b/.test(document.querySelector('mc-device-tile')?.shadowRoot?.querySelector('[data-device-state]')?.textContent ?? ''), 5_000, 'the tile shows on')
    .then((ok) => ok && check(true, 'power toggle: the tile shows on'));
  check(await page.evaluate((id) => window.__mcCanvas.store.get(id)?.on === true, LAMP_ID), 'the lamp is on in the store');
  // A brightness chip: the level comes from the approved plan (Full = 100 %).
  await page.evaluate(() => [...document.querySelector('mc-device-tile').shadowRoot.querySelectorAll('[data-act=chip]')].find((b) => b.textContent.trim() === 'Full').click());
  await waitFor(page, (id) => window.__mcCanvas.store.get(id)?.brightness === 100 && !window.__mcCanvas.store.get(id)?.pending, 5_000, 'the Full chip sets 100 %', LAMP_ID)
    .then((ok) => ok && check(true, 'a brightness chip sets the level from the approved plan'));

  // Tamper with the stored board: a chip asking for brightness 500.
  await sleep(1200); // past the save debounce
  const stored = await boardArtifacts(page);
  check(stored.length === 1 && stored[0].by === 'replay', `the board is stored, made by replay (got ${JSON.stringify(stored.map((a) => a.by))})`);
  const tampered = JSON.parse(JSON.stringify(stored[0]));
  const lamp = tampered.data.plan.tiles[0].children[0];
  lamp.controls.find((c) => c.kind === 'chips').options.push({ label: 'Blast', intent: { brightness: 500 } });
  await page.evaluate((a) => window.__mcArtifacts.put(a), tampered);

  notes.length = 0;
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if (!(await waitFor(page, () => document.querySelectorAll('mc-device-tile').length === 1, 10_000, 'the board is back after the reload'))) return;
  const after = (await page.evaluate(tiles))[0];
  check(!after.chips.includes('Blast') && after.chips.includes('Relax'), `the 500 % chip is left out, the rest load (got ${JSON.stringify(after.chips)})`);
  check(notes.some((n) => /Dropped 1 control/.test(n)), 'the dropped-control note is logged');

  if (!(await open(page, 'sim=1&hands=0'))) return;
  await waitFor(page, () => document.querySelectorAll('mc-device-tile').length === 1, 10_000, 'the board is back again');
  const again = await boardArtifacts(page);
  check(again.length === 1 && again[0].by === 'replay' && (await frames(page)).length === 1, 'the board is back from IndexedDB with by: replay');
}
SECTIONS.dashboard = dashboard;

async function main() {
  if (ONLY && !SECTIONS[ONLY]) { console.error(`e2e-actual: no section "${ONLY}" (have: ${Object.keys(SECTIONS).join(', ')}).`); return 2; }
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-actual: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-actual: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-actual: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  const replies = loadReplies();
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'] });
  try {
    for (const [name, run] of Object.entries(SECTIONS)) {
      if (ONLY && name !== ONLY) continue;
      console.log(`--- ${name}`);
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e?.message || e)));
      await page.evaluateOnNewDocument((r) => { window.__mcFixtures = { replies: r }; }, replies);
      await run(page);
      check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed.` : '\nAll checks passed.');
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
