// e2e-actual.mjs — the "actual demo" journey against a local dev server,
// one section per plan task, then the whole journey on one page. Model
// replies come only from tests/fixtures/ (handed to the page as
// window.__mcFixtures before it loads); nothing is scripted in the app.
// The sections replay tests/fixtures/written/ (hand-written examples their
// checks are pinned to); the journey replays tests/fixtures/replies/ (what
// `npm run record` captures from live models).
//
//   npx vite                     # in one terminal (http://localhost:5173)
//   node scripts/e2e-actual.mjs [--only <section>]   # or: npm run e2e
//
// With no --only every section runs, in journey order, then "journey".
//
// Exit code 1 on any failed check, 2 when it cannot run (no Chrome, no server).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pollUntil } from './e2eWait.lib.mjs';
import { JOURNEY_DEVICES, JOURNEY_LINES, line } from './journey.lib.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
/** The replies the journey replays (recorded by `npm run record`). */
const REPLIES = join(ROOT, 'tests/fixtures/replies');
/** The hand-written examples the per-section checks are pinned to. */
const WRITTEN = join(ROOT, 'tests/fixtures/written');

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

/** Every reply file: file name without .json → its `reply` text, and the
 *  keys whose `source` is "recorded" (every other one is a written example). */
function loadReplies(dir) {
  const replies = {};
  const recorded = [];
  const liveShape = [];
  if (!existsSync(dir)) return { replies, recorded, liveShape };
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json')) continue;
    const rec = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    if (typeof rec.reply !== 'string') throw new Error(`${f}: no "reply" string`);
    const key = f.slice(0, -'.json'.length);
    replies[key] = rec.reply;
    if (rec.source === 'recorded') recorded.push(key);
    // Written on the live path: its replay runs that path (Nano's {t,d} board turn).
    if (rec.source === 'recorded' || rec.shape === 'live') liveShape.push(key);
  }
  return { replies, recorded, liveShape };
}

const failures = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) failures.push(what); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll fn in the page until it is truthy (or time runs out). Time the host
 *  spent paused (asleep, browser stalled) is not counted (e2eWait.lib.mjs). */
async function waitFor(page, fn, ms, what, ...args) {
  const r = await pollUntil(() => page.evaluate(fn, ...args), ms);
  if (r.pausedMs) console.log(`     (the host was paused ~${Math.round(r.pausedMs / 1000)} s while waiting for: ${what})`);
  if (r.ok) return true;
  check(false, `timed out: ${what}`);
  return false;
}

/** macOS: keep the Mac from idle/display sleep while this runs (a sleep
 *  freezes the page mid-check). Ends with this process. */
function stayAwake() {
  if (process.platform !== 'darwin' || !existsSync('/usr/bin/caffeinate')) return;
  try { spawn('/usr/bin/caffeinate', ['-dim', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref(); } catch { /* best effort */ }
}

/** E2E_PAUSE_BROWSER=<ms>: stop the whole browser (SIGSTOP on its process
 *  group) for that long right after "build the dashboard" in gimbal — what a
 *  host sleep does to the page while this script's wall clock keeps running.
 *  Reproduces the "review opens" timeouts seen when the Mac slept mid-run. */
async function pauseBrowserIfAsked(page) {
  const ms = Number(process.env.E2E_PAUSE_BROWSER || 0);
  const pid = page.browser().process()?.pid;
  if (!ms || !pid || process.platform === 'win32') return;
  process.kill(-pid, 'SIGSTOP');
  setTimeout(() => process.kill(-pid, 'SIGCONT'), ms);
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

const reviewNotes = () => [...document.querySelectorAll('.mc-review-dialog:not([hidden]) .mc-review-note')].map((n) => n.textContent.trim());
const CONTROLS_NOTE = "Dropped 2 controls the lamp can't use.";

async function dashboard(page) {
  const notes = [];
  page.on('console', (m) => notes.push(m.text()));
  // One simulated lamp (test build + ?sim=1 only), with an id like the ones the bridge gives.
  await page.evaluateOnNewDocument((id) => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices: [{ id, cls: 'lamp', label: 'Lamp' }] }; }, LAMP_ID);
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  check(await page.evaluate((id) => !!window.__mcCanvas.store.get(id)?.sim, LAMP_ID), 'the fixture lamp is registered and marked SIM');

  // The main demo path, online: Nano drafts, Gemini improves, ONE review.
  // Gemini's reply holds a volume slider (foreign to a lamp) and a 500 %
  // button: both are dropped at proposal time, said in the review, and the
  // rest is proposed.
  await page.evaluate(() => { window.__mcCanvas.run('make a dashboard for my lamp'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the combined review opens'))) return;
  const combined = await page.evaluate(reviewText);
  check(combined.includes('Replay'), `online: the review names the engine as "Replay" (got ${JSON.stringify(combined.slice(0, 600))})`);
  const said = await page.evaluate(reviewNotes);
  check(said.includes(CONTROLS_NOTE), `online: the review says what was dropped (got ${JSON.stringify(said)})`);
  check(said.some((n) => /turns the lamp on/.test(n)), 'online: the review says how lamp controls behave');
  check((await page.evaluate(tiles)).length === 0 && (await boardArtifacts(page)).length === 0, 'online: 0 boards until Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, () => [...document.querySelectorAll('mc-device-tile')].some((t) => t.shadowRoot?.querySelectorAll('[data-act=chip]').length >= 3), 10_000, 'online: one tile with the model\'s chips'))) return;
  const kept = await page.evaluate(() => { const r = document.querySelector('mc-device-tile').shadowRoot; return {
    tiles: document.querySelectorAll('mc-device-tile').length, chips: r.querySelectorAll('[data-act=chip]').length,
    volume: !!r.querySelector('[data-level=volume]'), brightness: !!r.querySelector('[data-level=brightness]'),
    max: [...r.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Max'), standard: !!r.querySelector('[data-standard]') }; });
  check(kept.tiles === 1 && kept.chips === 10 && kept.brightness && !kept.volume && !kept.max && !kept.standard,
    `online: the rest is on the board, the two bad controls are not (got ${JSON.stringify(kept)})`);

  // The offline path: Nano's board is reviewed on its own, Gemini's on reconnect.
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;

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
  check((await page.evaluate(reviewNotes)).includes(CONTROLS_NOTE), 'offline → online: the better review says what was dropped');
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

// ---- phones: two SIM phones pair, the board goes to the right-hand phone, which re-checks and keeps it ----
/** A phone page: an iPhone (Capacitor sees the WebKit bridge) or the Nothing phone (a narrow web view). */
async function openPhone(page, ios) {
  await page.setViewport({ width: ios ? 440 : 412, height: ios ? 956 : 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  if (ios) await page.evaluateOnNewDocument(() => { window.webkit = { messageHandlers: { bridge: { postMessage() {} } } }; });
  return open(page, 'sim=1&fresh=1&hands=0').then((ok) => ok && waitFor(page, () => !!window.__mcGuestSnapshot, 20_000, 'the phone takes relay snapshots'));
}
const phoneTileText = () => [...document.querySelectorAll('mc-device-tile')].map((t) => t.shadowRoot?.textContent ?? '').join(' ');

async function phones(page) {
  await page.evaluateOnNewDocument((id) => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices: [{ id, cls: 'lamp', label: 'Lamp' }] }; }, LAMP_ID);
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;

  // Pair: the SIM branch stands in for the chime (no sound, no relay).
  await page.evaluate(() => window.__mcCanvas.run('connect devices'));
  const rows = () => [...document.querySelectorAll('.mc-paired-chip')].map((c) => ({ text: c.textContent.trim(), tick: !!c.querySelector('.mc-paired-check'), sim: !!c.querySelector('.mc-chip') }));
  if (!(await waitFor(page, () => document.querySelectorAll('.mc-paired-chip').length === 2, 10_000, 'two phones join'))) return;
  const paired = await page.evaluate(rows);
  check(paired.length === 2 && paired.every((r) => r.tick && r.sim), `two paired rows, each with a tick and SIM (got ${JSON.stringify(paired)})`);
  check(paired.some((r) => /iPhone/.test(r.text)) && paired.some((r) => /Nothing phone/.test(r.text)), 'the rows name the iPhone and the Nothing phone');

  // "build the dashboard" is a normal generation turn with the devices present.
  await waitFor(page, () => !document.querySelector('.mc-paired-continue'), 8_000, 'pairing moves on');
  const buildMark = await page.evaluate(() => window.__mcCanvas.statusMark());
  const buildAt = Date.now();
  await page.evaluate(() => window.__mcCanvas.run('build the dashboard'));
  if (!(await waitFor(page, reviewOpen, 15_000, 'the dashboard review opens'))) {
    console.log(`     said since "build the dashboard": ${JSON.stringify(await page.evaluate((m) => window.__mcCanvas.statusSince(m), buildMark))}`);
    console.log(`     frames: ${JSON.stringify(await frames(page))}`);
    return;
  }
  if (process.env.E2E_TIMING) console.log(`     review opened ${Date.now() - buildAt} ms after "build the dashboard"`);
  check((await page.evaluate(reviewText)).includes('Replay'), 'the dashboard review names "Replay"');
  // Pairing makes no fixed devices table: the devices board is generated ("show my devices").
  check(!(await frames(page)).some((f) => f.title === 'Connected devices'), 'pairing makes no fixed devices table');
  await sleep(1200); // past the save debounce
  const early = await boardArtifacts(page);
  check(early.length === 0, `nothing is stored until Approve (got ${JSON.stringify(early.map((a) => a.title))})`);
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, () => [...document.querySelectorAll('mc-device-tile')].some((t) => t.shadowRoot?.querySelectorAll('[data-act=chip]').length >= 3), 10_000, 'the dashboard is on the laptop'))) return;
  await sleep(1200); // past the save debounce: the board is stored with its maker
  const laptopBoards = await boardArtifacts(page);
  check(laptopBoards.length === 1 && laptopBoards[0].by === 'replay', `the laptop stores only the dashboard, made by replay (got ${JSON.stringify(laptopBoards.map((a) => [a.title, a.by]))})`);

  // Send it to the right-hand phone.
  const right = await page.evaluate(() => window.__mcCanvas.edgeLayout().right);
  check(right === 'ios' || right === 'android', `a phone is on the right edge (got ${right})`);
  const mark = await page.evaluate(() => window.__mcCanvas.statusMark());
  const sent = await page.evaluate((to) => window.__mcCanvas.sendBoard(to), right);
  check(sent, 'the board is sent at the right edge');
  const name = right === 'ios' ? 'iPhone' : 'Nothing phone';
  const lines = await page.evaluate((m) => window.__mcCanvas.statusSince(m), mark);
  check(lines.includes(`Sent to ${name} (SIM).`), `__mcCanvas reports the send line (got ${JSON.stringify(lines)})`);
  const snap = await page.evaluate(() => window.__mcLastBoardSnapshot ?? null);
  check(snap?.boardFor === right && snap?.boardBy === 'replay' && !!snap?.board, `the snapshot targets that phone and names the maker (got ${JSON.stringify({ boardFor: snap?.boardFor, boardBy: snap?.boardBy })})`);
  if (!snap) return;
  const laptopControls = JSON.stringify(snap.board.tiles[0].children?.[0]?.controls ?? snap.board.tiles[0].controls ?? []);

  // The phones (own browser contexts, so their stores are their own).
  const ctx = page.browserContext();
  const browser = ctx.browser();
  const mk = async (ios) => { const c = await browser.createBrowserContext(); const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e?.message || e))); return { c, p, errs, ok: await openPhone(p, ios) }; };
  const target = await mk(right === 'ios');
  const other = await mk(right !== 'ios');
  try {
    if (!target.ok || !other.ok) return;
    check(await target.p.evaluate((s) => window.__mcGuestSnapshot(s), snap), `the ${name} takes the board`);
    check(!(await other.p.evaluate((s) => window.__mcGuestSnapshot(s), snap)), 'the other phone ignores a board sent to the first');
    await waitFor(target.p, () => /Not connected/.test([...document.querySelectorAll('mc-device-tile')].map((t) => t.shadowRoot?.textContent ?? '').join(' ')), 10_000, 'the lamp it cannot reach shows "Not connected"')
      .then((ok) => ok && check(true, 'on the phone the lamp shows "Not connected"'));
    await sleep(1200);
    const kept = await boardArtifacts(target.p);
    check(kept.length === 1 && kept[0].by === 'replay', `the phone keeps it as a board made by replay (got ${JSON.stringify(kept.map((a) => a.by))})`);
    const keptControls = JSON.stringify(kept[0]?.data.plan.tiles[0].children?.[0]?.controls ?? kept[0]?.data.plan.tiles[0].controls ?? []);
    check(keptControls === laptopControls, 'the kept board has the controls the laptop approved');
    check((await boardArtifacts(other.p)).length === 0, 'the other phone keeps nothing');

    // A forged control on the wire is dropped by the phone's own check.
    const forged = JSON.parse(JSON.stringify(snap));
    forged.rev += 1;
    const lamp = forged.board.tiles[0].children?.[0] ?? forged.board.tiles[0];
    lamp.controls.find((c) => c.kind === 'chips').options.push({ label: 'Blast', intent: { brightness: 500 } });
    check(await target.p.evaluate((s) => window.__mcGuestSnapshot(s), forged), 'the phone takes the forged board');
    await sleep(1200);
    const afterForged = await boardArtifacts(target.p);
    check(afterForged.length === 1 && !JSON.stringify(afterForged[0].data).includes('Blast') && !(await target.p.evaluate(phoneTileText)).includes('Blast'), 'the 500 % chip is not shown or kept');

    // A board that does not say who made it is refused, and the phone says so.
    const nameless = JSON.parse(JSON.stringify(snap));
    nameless.rev += 3;
    delete nameless.boardBy;
    nameless.board.title = 'Nameless';
    check(!(await target.p.evaluate((s) => window.__mcGuestSnapshot(s), nameless)), 'a board with no maker is refused');
    check(await target.p.evaluate(() => document.body.innerText.includes("Couldn't take the board — it doesn't say who made it. Nothing changed.")), 'the phone says why');

    // A payload that is not a plan stores nothing.
    const junk = { ...JSON.parse(JSON.stringify(snap)), rev: snap.rev + 2, board: { kind: 'room', tiles: 'nope' } };
    check(!(await target.p.evaluate((s) => window.__mcGuestSnapshot(s), junk)), 'a payload that is not a plan is refused');
    await sleep(800);
    const afterJunk = await boardArtifacts(target.p);
    check(afterJunk.length === 1 && afterJunk[0].v === afterForged[0].v && afterJunk[0].title !== 'Nameless', 'and nothing new is stored');

    // The phone opens with what it kept.
    if (!(await open(target.p, 'sim=1&hands=0'))) return;
    await waitFor(target.p, () => document.querySelectorAll('mc-device-tile').length === 1, 10_000, 'the kept board is back on the phone after a reload')
      .then((ok) => ok && check(true, 'the phone opens with the board it kept'));
    const again = await boardArtifacts(target.p);
    check(again.length === 1 && again[0].by === 'replay', 'still made by replay after the reload');
    // Pinning it after the reload (a change that is not its content) keeps its maker.
    await target.p.evaluate(() => window.__mcCanvas.run('pin this'));
    await sleep(1200);
    const pinned = await boardArtifacts(target.p);
    check(pinned.length === 1 && pinned[0].v > again[0].v && pinned[0].data.frame.pinned && pinned[0].by === 'replay', `pinned after a reload: written again, still by replay (got ${JSON.stringify(pinned.map((a) => [a.v, a.data.frame.pinned, a.by]))})`);
    check(target.errs.length === 0 && other.errs.length === 0, `no page errors on the phones${[...target.errs, ...other.errs].length ? `: ${[...target.errs, ...other.errs].slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await target.c.close();
    await other.c.close();
  }
  // The laptop too: after a reload, pinning the engine's board keeps its maker.
  if (!(await open(page, 'sim=1&hands=0'))) return;
  const dash = (await boardArtifacts(page))[0];
  await page.evaluate((id) => window.__mcCanvas.focus(id), dash.id.replace(/^board-/, ''));
  await page.evaluate(() => window.__mcCanvas.run('pin this'));
  await sleep(1200);
  const pinnedL = (await boardArtifacts(page)).find((a) => a.id === dash.id);
  check(!!pinnedL && pinnedL.v > dash.v && pinnedL.data.frame.pinned && pinnedL.by === 'replay', `laptop: pinned after a reload, still by replay (got ${JSON.stringify(pinnedL && [pinnedL.v, pinnedL.data.frame.pinned, pinnedL.by])})`);
}
SECTIONS.phones = phones;

// ---- devices: the devices board is generated around a live table; the next-step chips are generated ----
/** The live table's rows on the laptop, one string per row ("cell | cell"). */
const liveTableRows = () => [...document.querySelectorAll('mc-table-tile')]
  .filter((t) => t.shadowRoot?.querySelector('[data-live]'))
  .flatMap((t) => [...t.shadowRoot.querySelectorAll('tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim()).join(' | ')));
const chipRow = () => {
  const r = document.querySelector('.mc-next');
  return r ? { label: r.querySelector('.mc-next-src')?.textContent.trim() ?? '', chips: [...r.querySelectorAll('.mc-next-chip')].map((c) => c.textContent.trim()) } : null;
};
const SPEAKER_SIM = { cls: 'music', on: false, brightness: 0, playing: false, volume: 50, sim: true };

async function devices(page) {
  await page.evaluateOnNewDocument((id) => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices: [{ id, cls: 'lamp', label: 'Lamp' }] }; }, LAMP_ID);
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  await page.evaluate(() => window.__mcCanvas.run('connect devices'));
  if (!(await waitFor(page, () => document.querySelectorAll('.mc-paired-chip').length === 2, 10_000, 'two SIM phones join'))) return;
  await waitFor(page, () => !document.querySelector('.mc-paired-continue'), 8_000, 'pairing moves on');
  check(!(await frames(page)).some((f) => /Connected devices/.test(f.title)), 'pairing alone makes no devices board');

  await page.evaluate(() => window.__mcCanvas.run('show my devices'));
  if (!(await waitFor(page, reviewOpen, 15_000, 'the devices review opens'))) return;
  check((await page.evaluate(reviewText)).includes('Replay · written example'), 'the devices review names "Replay · written example"');
  const notes = await page.evaluate(reviewNotes);
  check(notes.includes("Dropped 1 column a live devices table can't show."), `the review says the ip column was dropped (got ${JSON.stringify(notes)})`);
  await sleep(1200);
  check((await boardArtifacts(page)).length === 0, 'nothing is stored until Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, () => document.querySelectorAll('mc-table-tile').length > 0, 10_000, 'the devices board is on the canvas'))) return;
  await waitFor(page, () => [...document.querySelectorAll('mc-table-tile')].flatMap((t) => [...(t.shadowRoot?.querySelectorAll('tbody tr') ?? [])]).length === 4, 8_000, 'the live table has 4 rows');
  const rows4 = await page.evaluate(liveTableRows);
  check(rows4.length === 4, `4 rows: this laptop, two SIM phones and the SIM lamp (got ${JSON.stringify(rows4)})`);
  check(rows4[0] === '✓ Laptop | This canvas' && rows4.some((r) => r.startsWith('iPhone | SIM')) && rows4.some((r) => r.startsWith('Nothing phone | SIM')) && rows4.some((r) => r === 'Lamp | SIM lamp'), 'the rows name the laptop, the phones and the lamp, each phone and lamp SIM');
  check(rows4.filter((r) => r.startsWith('✓')).length === 1, 'only the laptop is ticked: no SIM device is');
  check(!(await page.evaluate(() => document.body.innerText + [...document.querySelectorAll('mc-table-tile')].map((t) => t.shadowRoot?.textContent ?? '').join(' '))).match(/Fridge|Oven/), "the reply's made-up rows are never shown");
  await sleep(1200);
  const stored = await boardArtifacts(page);
  const liveTable = stored[0]?.data.plan.tiles[0]?.children?.[0];
  check(stored.length === 1 && stored[0].by === 'replay' && liveTable?.source === 'devices' && liveTable.rows.length === 0,
    `the board is stored by replay with a live table and no rows (got ${JSON.stringify(stored.map((a) => [a.by, a.data.plan.tiles[0]]))})`);

  // A speaker joins: no turn, no review.
  await page.evaluate((s) => window.__mcCanvas.store.add('speaker-sim', s), SPEAKER_SIM);
  await waitFor(page, () => [...document.querySelectorAll('mc-table-tile')].flatMap((t) => [...(t.shadowRoot?.querySelectorAll('tbody tr') ?? [])]).length === 5, 8_000, 'the speaker appears as a 5th row');
  const rows5 = await page.evaluate(liveTableRows);
  check(rows5.length === 5 && rows5.includes('Speaker | SIM · simulated speaker'), `5 rows with the SIM speaker (got ${JSON.stringify(rows5)})`);
  check(!(await page.evaluate(reviewOpen)), 'no review for a device that joined');

  // The next-step chips: generated by (replayed) Nano after the approval, labelled so.
  if (!(await waitFor(page, () => document.querySelectorAll('.mc-next .mc-next-chip').length === 3, 8_000, 'three next-step chips appear'))) return;
  const chips = await page.evaluate(chipRow);
  check(chips?.chips.length === 3 && chips.label === 'Replay · written example', `three chips labelled "Replay · written example" (got ${JSON.stringify(chips)})`);
  const steps = await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.filter((a) => a.kind === 'steps').map((a) => ({ id: a.id, by: a.by, n: a.data.steps.length, status: a.status }))));
  check(steps.length === 1 && steps[0].id === 'steps-devices' && steps[0].by === 'replay' && steps[0].n === 3 && steps[0].status === 'suggested', `the steps are kept as steps-devices by replay, suggested, not approved (got ${JSON.stringify(steps)})`);
  // A chip says her words: "connect a device" opens the connect sheet.
  const mark = await page.evaluate(() => window.__mcCanvas.statusMark());
  await page.evaluate(() => [...document.querySelectorAll('.mc-next-chip')].find((c) => c.textContent.trim() === 'Connect a device')?.click());
  await sleep(600);
  check(!(await page.evaluate(reviewOpen)), `a chip press opens no review by itself (said ${JSON.stringify(await page.evaluate((m) => window.__mcCanvas.statusSince(m), mark))})`);

  // After a reload: the board and its chips come back; the rows are today's.
  if (!(await open(page, 'sim=1&hands=0'))) return;
  await waitFor(page, () => document.querySelectorAll('mc-table-tile').length > 0, 10_000, 'the devices board is back after a reload');
  await waitFor(page, () => [...document.querySelectorAll('mc-table-tile')].flatMap((t) => [...(t.shadowRoot?.querySelectorAll('tbody tr') ?? [])]).length === 4, 8_000, 'after a reload the phones are no longer paired');
  const back = await page.evaluate(liveTableRows);
  check(JSON.stringify(back) === JSON.stringify(['✓ Laptop | This canvas', 'iPhone | Not paired', 'Nothing phone | Not paired', 'Lamp | SIM lamp']), `after a reload the rows are what is here now (got ${JSON.stringify(back)})`);
  await waitFor(page, () => document.querySelectorAll('.mc-next .mc-next-chip').length === 3, 8_000, 'the kept chips are back after a reload');

  // Offline: Nano names the board and picks the columns; the same review; rows still from code.
  const beforeOff = (await boardArtifacts(page))[0];
  await page.evaluate(() => document.querySelector('[data-cmd=offline]').click());
  await page.evaluate(() => window.__mcCanvas.run('show my devices'));
  if (!(await waitFor(page, reviewOpen, 15_000, 'offline: the Nano devices review opens'))) return;
  const offText = await page.evaluate(reviewText);
  check(offText.includes('Replay · written example'), 'offline: the review names "Replay · written example"');
  check((await boardArtifacts(page))[0]?.v === beforeOff?.v, 'offline: nothing changes until Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  await waitFor(page, () => [...document.querySelectorAll('mc-table-tile')].some((t) => [...(t.shadowRoot?.querySelectorAll('th') ?? [])].map((th) => th.textContent.trim()).join('|') === 'Device|Kind|Status'), 8_000, 'offline: the table shows the columns Nano picked');
  const offRows = await page.evaluate(liveTableRows);
  check(offRows.length === 4 && offRows[0] === '✓ Laptop | Laptop | This canvas', `offline: the rows still come from the devices (got ${JSON.stringify(offRows)})`);
  await sleep(1200);
  const afterOff = (await boardArtifacts(page))[0];
  check(!!afterOff && afterOff.v > beforeOff.v && afterOff.by === 'replay' && afterOff.data.plan.tiles[0].source === 'devices' && afterOff.data.plan.tiles[0].rows.length === 0,
    `offline: the board is stored again by replay, a live table with no rows (got ${JSON.stringify(afterOff && [afterOff.v, afterOff.by, afterOff.data.plan.tiles[0]])})`);
  await page.evaluate(() => document.querySelector('[data-cmd=offline]').click());
}
SECTIONS.devices = devices;

// ---- speaker: a generated speaker tile drives a (simulated) speaker through the same checked binding ----
const SPEAKER_ID = 'speaker-sim';
const SPEAKER_NOTE = "Dropped 1 control the speaker can't use.";
const SPOTIFY_CONNECT_LINE = "Spotify isn't connected. Connect it, then try again. Nothing changed.";
const musicTile = () => {
  const r = [...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector('[data-device-cls=music]'))?.shadowRoot;
  return r ? {
    state: r.querySelector('[data-device-state]')?.textContent.trim() ?? '',
    sim: !!r.querySelector('.sim-badge'), away: !!r.querySelector('[data-unreachable]'), standard: !!r.querySelector('[data-standard]'),
    toggles: [...r.querySelectorAll('[data-act=toggle]')].map((b) => b.textContent.trim()),
    buttons: [...r.querySelectorAll('[data-act=button]')].map((b) => b.textContent.trim()),
    levels: [...r.querySelectorAll('[data-level]')].map((l) => l.getAttribute('data-level')),
    readouts: [...r.querySelectorAll('[data-readout]')].map((x) => x.textContent.trim()),
  } : null;
};
const pressMusic = (sel) => [...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector('[data-device-cls=music]'))?.shadowRoot.querySelector(sel)?.click();
const hasMusicTile = () => [...document.querySelectorAll('mc-device-tile')].some((t) => t.shadowRoot?.querySelector('[data-device-cls=music]'));

async function speaker(page) {
  // One simulated speaker (test build + ?sim=1 only); the Gemini pass is the
  // recorded speaker board.
  await page.evaluateOnNewDocument((id) => {
    const f = window.__mcFixtures ?? {};
    const replies = { ...(f.replies ?? {}) };
    replies['gemini.boardBetter'] = replies['gemini.board.speaker'];
    window.__mcFixtures = { ...f, replies, devices: [{ id, cls: 'music', label: 'Speaker', volume: 50 }] };
  }, SPEAKER_ID);
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  check(await page.evaluate((id) => { const d = window.__mcCanvas.store.get(id); return !!d?.sim && d.cls === 'music' && !d.trackTitle; }, SPEAKER_ID), 'the fixture speaker is registered, marked SIM, with no track');

  await page.evaluate(() => { window.__mcCanvas.run('add the speaker to the dashboard'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the speaker review opens'))) return;
  check((await page.evaluate(reviewText)).includes('Replay · written example'), 'the speaker review says its reply is a hand-written example: "Replay · written example"');
  const said = await page.evaluate(reviewNotes);
  check(said.includes(SPEAKER_NOTE), `the review says the brightness slider was dropped (got ${JSON.stringify(said)})`);
  check(!(await page.evaluate(hasMusicTile)) && (await boardArtifacts(page)).length === 0, '0 speaker tiles and 0 boards until Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, hasMusicTile, 10_000, 'a speaker tile after Approve'))) return;
  const kept = await page.evaluate(musicTile);
  check(kept.sim && !kept.away && !kept.standard && kept.state === 'Paused', `one SIM speaker tile with the model's controls, paused (got ${JSON.stringify(kept)})`);
  check(JSON.stringify(kept.toggles) === '["Play"]' && JSON.stringify(kept.buttons) === '["Previous","Next"]' && JSON.stringify(kept.levels) === '["volume"]',
    `play, previous, next and volume are there; the brightness slider is not (got ${JSON.stringify(kept)})`);
  check(kept.readouts.length === 1 && /Nothing playing yet/.test(kept.readouts[0]), `the track readout shows no made-up title (got ${JSON.stringify(kept.readouts)})`);

  // Press play: the tile follows the (simulated) speaker's answer.
  await page.evaluate(pressMusic, '[data-act=toggle]');
  await waitFor(page, () => { const r = [...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector('[data-device-cls=music]'))?.shadowRoot; return /^Playing/.test(r?.querySelector('[data-device-state]')?.textContent ?? '') && !!r?.querySelector('.sim-badge'); }, 5_000, 'the tile shows playing with SIM')
    .then((ok) => ok && check(true, 'play: the tile shows playing with the SIM label'));
  check(await page.evaluate((id) => window.__mcCanvas.store.get(id)?.playing === true, SPEAKER_ID), 'the speaker is playing in the store');
  // Volume +: one step from the approved slider.
  const vol0 = await page.evaluate((id) => window.__mcCanvas.store.get(id)?.volume, SPEAKER_ID);
  await page.evaluate(pressMusic, '[data-level=volume] [data-level-inc]');
  await waitFor(page, (id, v) => window.__mcCanvas.store.get(id)?.volume === v + 10 && !window.__mcCanvas.store.get(id)?.pending, 5_000, 'volume up one step', SPEAKER_ID, vol0)
    .then((ok) => ok && check(true, 'volume +: one step from the approved slider'));
  // The same toggle pauses.
  await page.evaluate(pressMusic, '[data-act=toggle]');
  await waitFor(page, (id) => window.__mcCanvas.store.get(id)?.playing === false, 5_000, 'pause', SPEAKER_ID)
    .then((ok) => ok && check(true, 'the same toggle pauses'));

  await sleep(1200); // past the save debounce
  const stored = await boardArtifacts(page);
  check(stored.length === 1 && stored[0].by === 'replay' && JSON.stringify(stored[0].data.plan).includes('"type":"music"'), `the speaker board is stored, made by replay (got ${JSON.stringify(stored.map((a) => a.by))})`);
  check(!(await page.evaluate(() => /Morning light|Monsoon raga|Built-in player/i.test(document.body.innerText + [...document.querySelectorAll('mc-device-tile')].map((t) => t.shadowRoot?.textContent ?? '').join(' ')))),
    'no placeholder track or stand-in player anywhere on the page');

  // The same board where no speaker is here (Spotify not connected): "Not
  // connected", no track, and a press says to connect Spotify.
  await page.evaluateOnNewDocument(() => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices: [] }; });
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if (!(await waitFor(page, hasMusicTile, 10_000, 'the speaker board is back after the reload'))) return;
  const away = await page.evaluate(musicTile);
  check(away.away && !away.sim && /Nothing playing yet/.test(away.readouts[0] ?? ''), `with no speaker here the tile says "Not connected" and shows no track (got ${JSON.stringify(away)})`);
  const mark = await page.evaluate(() => window.__mcCanvas.statusMark());
  await page.evaluate(pressMusic, '[data-act=toggle]');
  await sleep(300);
  const lines = await page.evaluate((m) => window.__mcCanvas.statusSince(m), mark);
  check(lines.includes(SPOTIFY_CONNECT_LINE), `a press says to connect Spotify (got ${JSON.stringify(lines)})`);
  check(await page.evaluate((id) => !window.__mcCanvas.store.get(id), SPEAKER_ID), 'and no speaker is invented');
}
SECTIONS.speaker = speaker;

// ---- gimbal: a generated gimbal tile drives the (SIM) stand through the same checked binding ----
const STAND_NOTE = "Dropped 1 control the stand can't use.";
const NO_PHONE_REFUSAL = 'No iPhone is paired with the stand. Nothing changed.';
const gimbalTile = () => {
  const r = [...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector('[data-device-cls=gimbal]'))?.shadowRoot;
  return r ? {
    state: r.querySelector('[data-device-state]')?.textContent.trim() ?? '',
    chips: [...r.querySelectorAll('[data-act=chip]')].map((b) => ({ label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') === 'true' })),
    buttons: [...r.querySelectorAll('[data-act=button]')].map((b) => b.textContent.trim()),
    readouts: [...r.querySelectorAll('[data-readout]')].map((x) => x.textContent.trim()),
    standard: !!r.querySelector('[data-standard]'),
  } : null;
};
const pressGimbalChip = (label) => [...([...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector('[data-device-cls=gimbal]'))?.shadowRoot.querySelectorAll('[data-act=chip]') ?? [])]
  .find((b) => b.textContent.trim() === label)?.click();
const modeMessages = () => window.__mcCanvas.simRelayLog().filter((m) => m.kind === 'gimbalMode');

async function gimbal(page) {
  // The SIM iPhone with a stand docked (a fixture device of class gimbal);
  // the Gemini pass is the recorded gimbal board.
  await page.evaluateOnNewDocument(() => {
    const f = window.__mcFixtures ?? {};
    const replies = { ...(f.replies ?? {}) };
    replies['gemini.boardBetter'] = replies['gemini.board.gimbal'];
    window.__mcFixtures = { ...f, replies, devices: [{ id: 'gimbal', cls: 'gimbal', label: 'Gimbal' }] };
  });
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  check(await page.evaluate(() => Object.keys(window.__mcCanvas.store.all()).length === 0), 'the stand is not a store device (the iPhone reports it)');

  // Pair the SIM phones (the SIM branch stands in for the chime).
  await page.evaluate(() => window.__mcCanvas.run('connect devices'));
  if (!(await waitFor(page, () => document.querySelectorAll('.mc-paired-chip').length === 2, 10_000, 'two phones join'))) return;
  await waitFor(page, () => !document.querySelector('.mc-paired-continue'), 8_000, 'pairing moves on');
  check(!(await page.evaluate(() => [...document.querySelectorAll('mc-device-tile')].some((t) => t.shadowRoot?.querySelector('[data-device-cls=gimbal]')))),
    'pairing a docked iPhone adds no gimbal tile by itself');

  // "add gimbal controls" is an ordinary generation turn with a review.
  await page.evaluate(() => window.__mcCanvas.run('add gimbal controls'));
  if (!(await waitFor(page, reviewOpen, 15_000, 'the gimbal review opens'))) { console.log('  said:', JSON.stringify(await page.evaluate(() => window.__mcCanvas.statusSince(0).slice(-6)))); return; }
  check((await page.evaluate(reviewText)).includes('Replay · written example'), 'the gimbal review says its reply is a hand-written example: "Replay · written example"');
  const said = await page.evaluate(reviewNotes);
  check(said.includes(STAND_NOTE), `the review says the "spin" cue was dropped (got ${JSON.stringify(said)})`);
  check(!(await page.evaluate(gimbalTile)) && (await boardArtifacts(page)).length === 0, '0 gimbal tiles and 0 boards until Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, () => !!document.querySelector('mc-device-tile') && [...document.querySelectorAll('mc-device-tile')].some((t) => t.shadowRoot?.querySelector('[data-device-cls=gimbal]')), 10_000, 'a gimbal tile after Approve'))) return;
  const kept = await page.evaluate(gimbalTile);
  check(!kept.standard && JSON.stringify(kept.chips.map((c) => c.label)) === '["Follow me","Follow my hands","Hold still"]'
    && JSON.stringify(kept.buttons) === '["Nod","Shake","Wake up"]', `the model's controls are there and "Spin" is not (got ${JSON.stringify(kept)})`);
  check(kept.state === 'SIM · Holding still' && JSON.stringify(kept.chips.filter((c) => c.pressed).map((c) => c.label)) === '["Hold still"]',
    `the status and the marked mode are the SIM iPhone's report (holding still) (got ${JSON.stringify(kept)})`);
  check((await page.evaluate(modeMessages)).length === 0, 'no mode message before a press');

  // Press "Follow my hands": one mode message, and the tile shows what the iPhone reported back.
  await page.evaluate(pressGimbalChip, 'Follow my hands');
  await waitFor(page, () => (window.__mcCanvas.simRelayLog().filter((m) => m.kind === 'gimbalMode').length > 0), 5_000, 'a mode message is sent');
  const sent = await page.evaluate(modeMessages);
  check(JSON.stringify(sent) === '[{"kind":"gimbalMode","text":"hands"}]', `the relay log shows one mode message (got ${JSON.stringify(sent)})`);
  await waitFor(page, () => {
    const r = [...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector('[data-device-cls=gimbal]'))?.shadowRoot;
    return /^SIM · Following your hands/.test(r?.querySelector('[data-device-state]')?.textContent ?? '');
  }, 5_000, 'the tile shows the reported mode').then((ok) => ok && check(true, 'the tile follows the iPhone report: "SIM · Following your hands"'));
  const after = await page.evaluate(gimbalTile);
  check(after.chips.find((c) => c.label === 'Follow my hands')?.pressed === true, `"Follow my hands" is marked from the report (got ${JSON.stringify(after.chips)})`);

  await sleep(1200); // past the save debounce
  const stored = await boardArtifacts(page);
  check(stored.length === 1 && stored[0].by === 'replay' && JSON.stringify(stored[0].data.plan).includes('"type":"gimbal"') && !JSON.stringify(stored[0].data.plan).includes('spin'),
    `the gimbal board is stored, made by replay, without the dropped cue (got ${JSON.stringify(stored.map((a) => a.by))})`);

  // The same board with no iPhone paired: the tile says so and a press is refused, nothing sent.
  await page.evaluateOnNewDocument(() => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices: [] }; });
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if (!(await waitFor(page, gimbalTile, 10_000, 'the gimbal board is back after the reload'))) return;
  const away = await page.evaluate(gimbalTile);
  check(/No iPhone paired/.test(away.state), `with no iPhone paired the tile says so (got ${JSON.stringify(away.state)})`);
  const mark = await page.evaluate(() => window.__mcCanvas.statusMark());
  await page.evaluate(pressGimbalChip, 'Follow me');
  await sleep(300);
  const lines = await page.evaluate((m) => window.__mcCanvas.statusSince(m), mark);
  check(lines.includes(NO_PHONE_REFUSAL), `a press is refused: "${NO_PHONE_REFUSAL}" (got ${JSON.stringify(lines)})`);
  check((await page.evaluate(modeMessages)).length === 0, 'and no mode message is sent');

  // A room turn whose reply leaves the docked stand out: the app adds the
  // gimbal tile, and the review says so before anything is kept.
  await page.evaluateOnNewDocument((lamp) => {
    const f = window.__mcFixtures ?? {};
    const replies = { ...(f.replies ?? {}), 'gemini.boardBetter': f.replies?.['nano.board'] };
    window.__mcFixtures = { ...f, replies, devices: [{ id: lamp, cls: 'lamp', label: 'Lamp' }, { id: 'gimbal', cls: 'gimbal', label: 'Gimbal' }] };
  }, LAMP_ID);
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  await page.evaluate(() => window.__mcCanvas.run('connect devices'));
  if (!(await waitFor(page, () => document.querySelectorAll('.mc-paired-chip').length === 2, 10_000, 'two phones join again'))) return;
  await waitFor(page, () => !document.querySelector('.mc-paired-continue'), 8_000, 'pairing moves on again');
  const buildMark = await page.evaluate(() => window.__mcCanvas.statusMark());
  await page.evaluate(() => window.__mcCanvas.run('build the dashboard'));
  await pauseBrowserIfAsked(page);
  if (!(await waitFor(page, reviewOpen, 15_000, 'the dashboard review opens'))) {
    console.log(`     said since "build the dashboard": ${JSON.stringify(await page.evaluate((m) => window.__mcCanvas.statusSince(m), buildMark))}`);
    console.log(`     frames: ${JSON.stringify(await frames(page))}`);
    return;
  }
  const keptNotes = await page.evaluate(reviewNotes);
  check(keptNotes.some((n) => /added Gimbal \(it answers here\)/i.test(n)), `the review lists the gimbal tile the app added (got ${JSON.stringify(keptNotes)})`);
  check(!(await page.evaluate(gimbalTile)), 'no gimbal tile before Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  await waitFor(page, gimbalTile, 10_000, 'the added gimbal tile is on the board after Approve').then((ok) => ok && check(true, 'the added gimbal tile is on the board after Approve'));
}
SECTIONS.gimbal = gimbal;

// ---- connector: "connect the lamp" writes a connector as data; approved, the lamp runs on it ----
const CONNECTOR_ID = 'connector-wiz-smart-bulb';
const lampTile = () => {
  const r = [...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector('[data-device-cls=lamp]'))?.shadowRoot;
  return r ? { footnote: r.querySelector('[data-connector]')?.textContent.trim() ?? '', state: r.querySelector('[data-device-state]')?.textContent.trim() ?? '', sim: !!r.querySelector('.sim-badge'), error: r.querySelector('.note.error')?.textContent.trim() ?? '' } : null;
};
const LAMP_BOARD = {
  id: 'board-f1', kind: 'board', v: 1, title: 'Desk', by: 'replay', at: Date.now(), status: 'approved',
  data: {
    frame: { kind: 'room', title: 'Desk', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false },
    plan: { kind: 'room', title: 'Desk', tiles: [{ type: 'lamp', deviceId: LAMP_ID, label: 'Lamp' }] },
  },
};
const connectorArtifacts = (page) => page.evaluate(() => window.__mcArtifacts.list().then((l) => l.filter((a) => a.kind === 'connector')));

async function connector(page) {
  await page.evaluateOnNewDocument((id) => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices: [{ id, cls: 'lamp', label: 'Lamp' }] }; }, LAMP_ID);
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  await page.evaluate((a) => window.__mcArtifacts.put(a), LAMP_BOARD);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if (!(await waitFor(page, () => !!document.querySelector('mc-device-tile'), 10_000, 'the lamp board is on the canvas'))) return;
  const before = await page.evaluate(lampTile);
  check(before?.footnote === 'Built-in WiZ connector' && before.sim, `before: the SIM lamp tile says "Built-in WiZ connector" (got ${JSON.stringify(before)})`);

  await page.evaluate(() => { window.__mcCanvas.run('connect the lamp'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the connector review opens'))) return;
  const text = await page.evaluate(reviewText);
  check(/UDP port 38899/.test(text), `the review shows port 38899 (got ${JSON.stringify(text.slice(0, 600))})`);
  check(text.includes('Replay · written example'), 'the review names the engine: "Replay · written example"');
  check(/When you ask: Brightness/.test(text) && /Set brightness/.test(text), 'the review lists the actions and the intent map rows');
  check(!/192\.168\.|127\.0\.0\.1|38888|wizToken|x-wiz-token/i.test(text), 'the review shows no address and no bridge token');
  check((await connectorArtifacts(page)).length === 0, '0 connector artifacts until Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  await waitFor(page, () => window.__mcArtifacts.list().then((l) => l.some((a) => a.id === 'connector-wiz-smart-bulb')), 5_000, `artifact ${CONNECTOR_ID} exists`)
    .then((ok) => ok && check(true, `artifact ${CONNECTOR_ID} exists`));
  const stored = await connectorArtifacts(page);
  check(stored.length === 1 && stored[0].by === 'replay' && stored[0].data.connector.source === 'cloud', `stored once, made by replay, source cloud (got ${JSON.stringify(stored.map((a) => [a.id, a.by]))})`);
  check(!JSON.stringify(stored).match(/192\.168\.|127\.0\.0\.1|38888|token/i), 'the stored connector holds no address and no token');
  await waitFor(page, () => { const n = [...document.querySelectorAll('mc-device-tile')][0]?.shadowRoot?.querySelector('[data-connector]'); return n?.getAttribute('data-connector') === 'generated'; }, 5_000, 'the built-in footnote is gone')
    .then((ok) => ok && check(true, 'after Approve the "Built-in WiZ connector" footnote is gone'));
  const made = await page.evaluate(lampTile);
  check(made?.footnote === 'Connector by Replay · written example', `the tile names the connector's maker (got ${JSON.stringify(made?.footnote)})`);

  // A press runs through the approved connector's checks (a SIM lamp: then the simulated answer).
  await page.evaluate(() => document.querySelector('mc-device-tile').shadowRoot.querySelector('[data-act=toggle]').click());
  await waitFor(page, (id) => window.__mcCanvas.store.get(id)?.on === true && !window.__mcCanvas.store.get(id)?.pending, 5_000, 'the toggle turns the lamp on', LAMP_ID)
    .then((ok) => ok && check(true, 'a press works on the generated connector'));

  // Back after a reload: the connector is checked again and the footnote stays gone.
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if (!(await waitFor(page, () => !!document.querySelector('mc-device-tile'), 10_000, 'the lamp board is back'))) return;
  check((await page.evaluate(lampTile))?.footnote === 'Connector by Replay · written example', 'after a reload the lamp still runs on the generated connector, and says who made it');

  // A tampered connector (a port outside the allow-list) is dropped at load: the lamp is back on the built-in one.
  const bad = JSON.parse(JSON.stringify(stored[0]));
  bad.data.connector.actions.push({ id: 'shell', label: 'Shell', params: [], request: { transport: 'udp', port: 22, payload: { x: 1 } }, successCue: 'x' });
  await page.evaluate((a) => window.__mcArtifacts.put(a), bad);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if (!(await waitFor(page, () => !!document.querySelector('mc-device-tile'), 10_000, 'the lamp board is back again'))) return;
  await waitFor(page, (line) => document.body.innerText.includes(line), 5_000, 'the dropped line is visible', DROPPED_LINE)
    .then((ok) => ok && check(true, 'a tampered connector is dropped and said'));
  check((await page.evaluate(lampTile))?.footnote === 'Built-in WiZ connector', 'with the tampered connector dropped, the tile says "Built-in WiZ connector" again');
}
SECTIONS.connector = connector;

// ---- floorplan: a generated floor plan opens on its own board; a voice edit; both back after a reload ----
const planDrawing = () => {
  const d = window.__mcCanvas.snapshot().drawings ?? {};
  const f = window.__mcCanvas.frames().find((x) => x.kind === 'plan');
  const doc = f ? Object.values(d[f.id] ?? {})[0] : null;
  return doc ? { frame: f.id, rooms: doc.rooms.map((r) => r.name), walls: doc.walls.length } : null;
};
const planArtifacts = (page) => page.evaluate(() => window.__mcArtifacts.list().then((l) => l.filter((a) => a.kind === 'plan' || a.kind === 'board').map((a) => ({ id: a.id, kind: a.kind, by: a.by, v: a.v, rooms: a.kind === 'plan' ? a.data.doc.rooms.map((r) => r.name) : undefined, template: a.kind === 'board' ? a.data.plan.tiles[0]?.template : undefined, frameKind: a.kind === 'board' ? a.data.frame.kind : undefined }))));

async function floorplan(page) {
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  await page.evaluate((a) => window.__mcArtifacts.put(a), VALID_BOARD);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  check((await frames(page)).length === 1, 'one board (the dashboard) before the floor plan');

  await page.evaluate(() => { window.__mcCanvas.run('draw a two bedroom floor plan'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the floor-plan review opens'))) return;
  const text = await page.evaluate(reviewText);
  check(/Bedroom 1/.test(text) && /Bedroom 2/.test(text) && /Living room/.test(text), `the review lists the rooms (got ${JSON.stringify(text.slice(0, 400))})`);
  check(/4 × 3 m/.test(text), 'the review gives room sizes in metres');
  check(/The door (into|between) /.test(text), 'the review shows the plan checks in plain words');
  check(!/\b(Door|Window) [ow]\d+\b/.test(text), 'the review shows no internal ids');
  check(text.includes('Replay · written example'), 'the review names the engine: "Replay · written example"');
  check((await frames(page)).length === 1, 'no board is made before Approve');
  check((await planArtifacts(page)).filter((a) => a.kind === 'plan').length === 0, '0 plan artifacts before Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  await waitFor(page, () => window.__mcCanvas.frames().some((f) => f.kind === 'plan'), 5_000, 'a board of kind plan exists')
    .then((ok) => ok && check(true, 'after Approve a second board, of kind plan, exists'));
  check((await frames(page)).length === 2, 'two boards: the dashboard and the floor plan');
  await waitFor(page, () => window.__mcArtifacts.list().then((l) => l.some((a) => a.kind === 'plan')), 5_000, 'the plan artifact is stored');
  const stored = await planArtifacts(page);
  const pa = stored.find((a) => a.kind === 'plan');
  const pb = stored.find((a) => a.kind === 'board' && a.frameKind === 'plan');
  check(!!pa && pa.by === 'replay' && pa.rooms.length === 5, `plan-<frame>-<board> stored by replay with 5 rooms (got ${JSON.stringify(pa)})`);
  check(!!pb && pb.by === 'replay' && pb.template === 'blank', `board-<frame> stored by replay, its plan tile blank (got ${JSON.stringify(pb)})`);
  await waitFor(page, () => !!document.querySelector('mc-plan-board .mc-plan-board svg'), 10_000, 'the drawing is on screen')
    .then((ok) => ok && check(true, 'the generated drawing is on screen'));

  await page.evaluate(() => { window.__mcCanvas.run('add a study next to bedroom 2'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the plan-edit review opens'))) return;
  const edit = await page.evaluate(reviewText);
  check(/Study/.test(edit), `the edit review names the study (got ${JSON.stringify(edit.slice(0, 300))})`);
  check((await page.evaluate(planDrawing))?.rooms.includes('Study') === false, 'the study is not drawn before Approve');
  await page.evaluate(() => window.__mcCanvas.keep());
  await waitFor(page, () => window.__mcArtifacts.list().then((l) => l.some((a) => a.kind === 'plan' && a.data.doc.rooms.some((r) => r.name === 'Study'))), 5_000, 'the stored drawing has the study')
    .then((ok) => ok && check(true, 'after Approve the stored drawing has the study'));
  const edited = (await planArtifacts(page)).find((a) => a.kind === 'plan');
  check(edited?.by === 'replay' && edited.v === 2, `the reviewed voice edit is credited to its engine, v2 (got ${JSON.stringify(edited && [edited.by, edited.v])})`);

  if (!(await open(page, 'sim=1&hands=0'))) return;
  await waitFor(page, () => window.__mcCanvas.frames().length === 2, 10_000, 'both boards are back after a reload')
    .then((ok) => ok && check(true, 'both boards are back after a reload'));
  const back = await page.evaluate(planDrawing);
  check(!!back && back.rooms.includes('Study') && back.rooms.length === 6, `the drawing is back with the study (got ${JSON.stringify(back)})`);
  await waitFor(page, () => !!document.querySelector('mc-plan-board .mc-plan-board svg'), 10_000, 'the drawing is on screen after the reload')
    .then((ok) => ok && check(true, 'the drawing is on screen after the reload'));
  await sleep(1200); // past the save debounce: loading rewrites nothing
  const after = (await planArtifacts(page)).find((a) => a.kind === 'plan');
  check(after?.v === 2 && after.by === 'replay', `loading keeps the drawing's version and maker (got ${JSON.stringify(after && [after.v, after.by])})`);

  // Asked again from an empty board she is on: that board takes the plan; the drawn plan is never overwritten.
  const firstPlan = back.frame;
  const emptyId = await page.evaluate(async () => { window.__mcCanvas.run('new board'); const f = window.__mcCanvas.frames().at(-1); await window.__mcCanvas.focus(f.id); return f.id; });
  await page.evaluate(() => { window.__mcCanvas.run('draw a two bedroom floor plan'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the second floor-plan review opens'))) return;
  await page.evaluate(() => window.__mcCanvas.keep());
  await waitFor(page, (id) => window.__mcCanvas.snapshot().surfaces[id]?.kind === 'plan', 5_000, 'the empty board she was on took the plan', emptyId)
    .then((ok) => ok && check(true, 'the empty board she was on took the plan (no extra board)'));
  check((await frames(page)).length === 3, 'three boards: the dashboard and two floor plans');
  const kept = await page.evaluate((id) => Object.values(window.__mcCanvas.snapshot().drawings?.[id] ?? {})[0]?.rooms.map((r) => r.name), firstPlan);
  check(kept?.includes('Study'), 'the first floor plan, with its study, is untouched');
  // Undo takes the generated plan back: the board is empty again and its stored plan goes.
  await page.evaluate(() => window.__mcCanvas.undo());
  await waitFor(page, (id) => window.__mcArtifacts.list().then((l) => !l.some((a) => a.kind === 'plan' && a.data.frameId === id) && !l.some((a) => a.id === `board-${id}`)), 5_000, 'undo removes the stored board and plan', emptyId)
    .then((ok) => ok && check(true, 'undo removes the generated plan and its stored artifacts'));
  const gone = await page.evaluate((id) => window.__mcCanvas.frames().find((f) => f.id === id), emptyId);
  check(!!gone && gone.title !== 'Floor plan' && gone.kind !== 'plan', `the reused board is back as it was (got ${JSON.stringify(gone)})`);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  const reloaded = await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.filter((a) => a.kind === 'plan').length));
  check(reloaded === 1, `after a reload only the first floor plan's drawing is stored (got ${reloaded})`);
}
SECTIONS.floorplan = floorplan;

// ---- phonelayout: a floor plan sent to a phone carries its current drawing, fits the phone, shows once ----
/** In the page: the plan board, its tools and its drawn labels (from sim-main e2e-phone-layout). */
function measurePlan() {
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
  const shown = (el) => !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
  const host = document.querySelector('mc-plan-board .mc-plan-board');
  const vp = document.querySelector('.mc-viewport');
  const walls = host ? [...host.querySelectorAll('svg polygon')].map(box).filter((b) => b.width > 0 || b.height > 0) : [];
  const drawing = walls.length ? { left: Math.min(...walls.map((b) => b.left)), right: Math.max(...walls.map((b) => b.right)), top: Math.min(...walls.map((b) => b.top)), bottom: Math.max(...walls.map((b) => b.bottom)) } : null;
  const labels = host ? [...host.querySelectorAll('svg text')].filter((t) => t.textContent && getComputedStyle(t).display !== 'none').map((t) => ({ text: t.textContent, box: box(t) })) : [];
  // Room names and areas must never run into each other. A dimension label
  // ("3.00 m") the generator puts on a shared wall can sit over a room name
  // on the laptop too — listed (dimOverlaps), not failed here.
  const isDim = (t) => /\d m$/.test(t);
  const overlaps = [];
  const dimOverlaps = [];
  for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
    const A = labels[a].box, B = labels[b].box;
    if (!(Math.min(A.right, B.right) - Math.max(A.left, B.left) > 1 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 1)) continue;
    (isDim(labels[a].text) || isDim(labels[b].text) ? dimOverlaps : overlaps).push(`${labels[a].text} × ${labels[b].text}`);
  }
  const toggle = document.querySelector('.mc-plan-tools-toggle');
  return {
    dimOverlaps,
    host: host ? box(host) : null, viewport: vp ? box(vp) : null, drawing,
    palette: shown(host?.querySelector('.mc-palette')), trash: shown(host?.querySelector('.mc-trash')), status: shown(host?.querySelector('.mc-status')),
    toggle: shown(toggle), expanded: toggle?.getAttribute('aria-expanded'),
    labels: labels.map((l) => l.text), overlaps,
    rooms: (host?.__mcPlanDoc?.()?.rooms ?? []).map((r) => r.name),
    planBoards: document.querySelectorAll('mc-plan-board').length,
    frames: document.querySelectorAll('.mc-frame').length,
  };
}

async function phonePlanChecks(p, vp) {
  const m = await p.evaluate(measurePlan);
  if (process.env.SHOTS) await p.screenshot({ path: join(process.env.SHOTS, `plan-${vp}.png`) });
  check(m.rooms.includes('Study') && m.labels.includes('Study'), `${vp}: the phone shows the plan as edited, with the study (${m.rooms.join(', ')})`);
  check(!m.palette && !m.trash && !m.status, `${vp}: drawing tools tucked away by default`);
  check(m.toggle && m.expanded === 'false', `${vp}: a "Tools" toggle is shown`);
  check(!!m.host && !!m.viewport && m.host.bottom <= m.viewport.bottom + 1 && m.host.left >= 0 && m.host.right <= m.viewport.right + 1, `${vp}: the plan area fits the board area (${Math.round(m.host?.bottom ?? -1)} ≤ ${Math.round(m.viewport?.bottom ?? -1)})`);
  check(!!m.host && m.host.height >= 0.45 * m.viewport.height, `${vp}: the plan area uses the screen (${Math.round(m.host?.height ?? 0)} px of ${Math.round(m.viewport?.height ?? 0)})`);
  const d = m.drawing;
  check(!!d && d.left >= m.host.left - 1 && d.right <= m.host.right + 1 && d.top >= m.host.top - 1 && d.bottom <= m.host.bottom + 1, `${vp}: the whole plan is in view`);
  check(m.overlaps.length === 0, `${vp}: no two room labels overlap${m.overlaps.length ? ` — ${m.overlaps.join('; ')}` : ''}`);
  if (m.dimOverlaps.length) console.log(`     note: a dimension label overlaps a room label (${m.dimOverlaps.join('; ')})`);
  await p.tap('.mc-plan-tools-toggle');
  await sleep(400);
  const t = await p.evaluate(measurePlan);
  check(t.palette && t.expanded === 'true', `${vp}: "Tools" brings the palette back`);
  check(t.overlaps.length === 0, `${vp}: labels stay clear with the tools open`);
  await p.tap('.mc-plan-tools-toggle');
  await sleep(300);
  check(!(await p.evaluate(measurePlan)).palette, `${vp}: "Tools" again tucks them away`);
}

async function phonelayout(page) {
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  await page.evaluate(() => window.__mcCanvas.run('connect devices'));
  if (!(await waitFor(page, () => document.querySelectorAll('.mc-paired-chip').length === 2, 10_000, 'two phones join'))) return;
  await waitFor(page, () => !document.querySelector('.mc-paired-continue'), 8_000, 'pairing moves on');
  await page.evaluate(() => { window.__mcCanvas.run('draw a two bedroom floor plan'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the floor-plan review opens'))) return;
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, () => !!document.querySelector('mc-plan-board .mc-plan-board svg'), 10_000, 'the drawing is on the laptop'))) return;
  await page.evaluate(() => { window.__mcCanvas.run('add a study next to bedroom 2'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the plan-edit review opens'))) return;
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, () => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).some((r) => r.name === 'Study'), 10_000, 'the study is drawn on the laptop'))) return;
  const planFrame = await page.evaluate(() => window.__mcCanvas.frames().find((f) => f.kind === 'plan')?.id);
  await page.evaluate((id) => window.__mcCanvas.focus(id), planFrame);

  const docRooms = (s) => Object.values(s?.boardDrawings ?? {}).flatMap((d) => (d.rooms ?? []).map((r) => r.name));
  check(await page.evaluate(() => window.__mcCanvas.sendBoard('ios')), 'the Floor plan board is sent to the iPhone edge');
  const snap = await page.evaluate(() => window.__mcLastBoardSnapshot ?? null);
  check(snap?.boardFor === 'ios' && docRooms(snap).includes('Study'), `the snapshot targets the iPhone and carries the edited drawing (got ${JSON.stringify({ to: snap?.boardFor, rooms: docRooms(snap) })})`);
  check(!JSON.stringify(snap?.board ?? {}).includes('Study'), 'the surface plan itself stays drawing-free');
  if (!snap) return;

  const browser = page.browserContext().browser();
  const mk = async (ios) => { const c = await browser.createBrowserContext(); const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e?.message || e))); return { c, p, errs, ok: await openPhone(p, ios) }; };
  const iphone = await mk(true);
  const android = await mk(false);
  try {
    if (!iphone.ok || !android.ok) return;
    check(await iphone.p.evaluate((s) => window.__mcGuestSnapshot(s), snap), 'the iPhone (440×956) takes the board');
    check(!(await android.p.evaluate((s) => window.__mcGuestSnapshot(s), snap)), 'the Nothing phone ignores a board sent to the iPhone');
    if (!(await waitFor(iphone.p, () => !!document.querySelector('mc-plan-board .mc-plan-board svg'), 15_000, 'the plan on the iPhone'))) return;
    await sleep(1200);
    await phonePlanChecks(iphone.p, 'iphone-440x956');
    // The same board arriving again (a replay on re-pair) shows once.
    check(await iphone.p.evaluate((s) => window.__mcGuestSnapshot({ ...s, rev: s.rev + 5 }), snap), "the iPhone takes the same board again (a replay on re-pair)");
    await sleep(1200);
    const once = await iphone.p.evaluate(measurePlan);
    check(once.frames === 1 && once.planBoards === 1, `a replayed board shows once (${once.frames} board(s), ${once.planBoards} plan(s))`);
    const mark = await iphone.p.evaluate(() => { try { return JSON.parse(localStorage.getItem('mc.canvas.v1') ?? 'null')?.frames?.map((f) => f.from ?? null); } catch { return null; } });
    check(JSON.stringify(mark) === '["laptop"]', `the phone saves the received mark with the board (got ${JSON.stringify(mark)})`);

    check(await page.evaluate(() => window.__mcCanvas.sendBoard('android')), 'the Floor plan board is sent to the Nothing phone edge');
    const snapA = await page.evaluate(() => window.__mcLastBoardSnapshot ?? null);
    check(snapA?.boardFor === 'android' && docRooms(snapA).includes('Study'), 'the snapshot targets the Nothing phone with the edited drawing');
    check(await android.p.evaluate((s) => window.__mcGuestSnapshot(s), snapA), 'the Nothing phone (412×915) takes the board');
    if (!(await waitFor(android.p, () => !!document.querySelector('mc-plan-board .mc-plan-board svg'), 15_000, 'the plan on the Nothing phone'))) return;
    await sleep(1200);
    await phonePlanChecks(android.p, 'android-412x915');
    check(iphone.errs.length === 0 && android.errs.length === 0, `no page errors on the phones${[...iphone.errs, ...android.errs].length ? `: ${[...iphone.errs, ...android.errs].slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await iphone.c.close();
    await android.c.close();
  }
}
SECTIONS.phonelayout = phonelayout;

// ---- persist: a board with content survives reloads; ?fresh keeps a copy of the layout and the store and leaves the address; an unreadable layout is kept safe and said once ----
const UNREADABLE_LINE_E2E = 'Couldn’t open your saved boards — they’re kept safe.';
async function persist(page) {
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  check(await page.evaluate(() => !new URLSearchParams(location.search).has('fresh') && new URLSearchParams(location.search).get('sim') === '1'), '?fresh leaves the address bar (the rest stays)');
  // A board WITH content in IndexedDB.
  await page.evaluate((a) => window.__mcArtifacts.put(a), VALID_BOARD);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  const desk = () => { const s = window.__mcCanvas.snapshot(); const f = s.frames.find((x) => x.title === 'Desk'); return f ? (s.surfaces[f.id]?.tiles ?? []).length : -1; };
  check((await page.evaluate(desk)) === 1, 'the stored board opens with its content');
  await page.evaluate(() => window.__mcCanvas.run('new board'));
  await sleep(1200); // past the save debounce
  const saved = await page.evaluate(() => localStorage.getItem('mc.canvas.v1'));
  check(!!saved && JSON.parse(saved).frames.length === 2, 'both boards are in the saved layout');
  if (!(await open(page, 'sim=1&hands=0'))) return;
  check((await frames(page)).length === 2 && (await page.evaluate(desk)) === 1, 'a reload without fresh opens both boards, the stored one with its content');
  const storedRow = await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.find((a) => a.id === 'board-f1') ?? null));
  check(!!storedRow && storedRow.data.plan.tiles.length === 1, 'the stored board is unchanged in the store after reloads');
  // ?fresh: blank, but the layout AND the stored board are copied aside first.
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  check((await frames(page)).length === 0, 'a second ?fresh starts blank');
  check(await page.evaluate((s) => localStorage.getItem('mc.canvas.v1.beforeFresh') === s, saved), 'the layout before it is kept under beforeFresh');
  const keptRows = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('mc.canvas.v1.beforeFresh.artifacts') ?? 'null'); } catch { return null; } });
  check(Array.isArray(keptRows) && keptRows.some((a) => a.id === 'board-f1' && a.data?.plan?.tiles?.length === 1), 'the stored board, with its content, is kept under beforeFresh.artifacts');
  // A layout this build cannot read: copied aside, said once, never overwritten.
  await page.evaluate(() => localStorage.setItem('mc.canvas.v1', '{"version":99,"frames":"broken"}'));
  if (!(await open(page, 'sim=1&hands=0'))) return;
  await waitFor(page, (line) => document.body.innerText.includes(line), 5_000, 'the unreadable line is said', UNREADABLE_LINE_E2E)
    .then((ok) => ok && check(true, 'the unreadable line is said'));
  await page.evaluate(() => window.__mcCanvas.run('new board'));
  await sleep(1200);
  const saidOnce = await page.evaluate((line) => window.__mcCanvas.statusSince(0).filter((l) => l.includes(line)).length, UNREADABLE_LINE_E2E);
  check(saidOnce === 1, `the unreadable line is said once (got ${saidOnce})`);
  check(await page.evaluate(() => localStorage.getItem('mc.canvas.v1.unreadable') === '{"version":99,"frames":"broken"}'), 'the unreadable layout is kept under .unreadable after a save');
  if (!(await open(page, 'sim=1&hands=0'))) return;
  await sleep(800);
  const again = await page.evaluate((line) => window.__mcCanvas.statusSince(0).filter((l) => l.includes(line)).length, UNREADABLE_LINE_E2E);
  check(again === 0, `after the save, a reload does not say it again (got ${again})`);
}
SECTIONS.persist = persist;

// ---- language: "add Kannada" → a reviewed Gemini pack → the bar in Kannada → still Kannada after an offline reload ----
const KN_FIXTURE = JSON.parse(readFileSync(join(WRITTEN, 'gemini.pack.kn.json'), 'utf8'));
const KN_PACK_REPLY = JSON.parse(KN_FIXTURE.reply.slice(KN_FIXTURE.reply.indexOf('{'), KN_FIXTURE.reply.lastIndexOf('}') + 1));
const bar = () => ({
  showEverything: document.querySelector('[data-i18n=showEverything]')?.textContent.trim(),
  newBoard: document.querySelector('[data-i18n=newBoard]')?.textContent.trim(),
  lang: document.documentElement.lang,
});
const packArtifacts = (page) => page.evaluate(() => window.__mcArtifacts.list().then((l) => l.filter((a) => a.kind === 'pack').map((a) => ({ id: a.id, by: a.by, v: a.v, lang: a.data.lang, show: a.data.strings.showEverything }))));
const statusSays = (line) => (window.__mcCanvas.statusSince(0) ?? []).some((t) => t.includes(line));

async function language(page) {
  const kn = KN_PACK_REPLY.strings;
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  const before = await page.evaluate(bar);
  check(before.showEverything === 'Show everything' && before.lang === 'en', `the bar starts in English (got ${JSON.stringify(before)})`);

  await page.evaluate(() => { window.__mcCanvas.run('add Kannada'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the Kannada review opens'))) return;
  const text = await page.evaluate(reviewText);
  check(text.includes(`Show everything → ${kn.showEverything}`) && text.includes(`New board → ${kn.newBoard}`), `the review shows the strings (got ${JSON.stringify(text.slice(0, 500))})`);
  check(/Gemini · Replay · written example/.test(text), 'the review names "Gemini" in the Replay label');
  check(text.includes(`Lights on. → ${KN_PACK_REPLY.status.lightsOn}`), 'the review shows the generated status lines too');
  check((await packArtifacts(page)).length === 0, '0 pack artifacts until Approve');
  check((await page.evaluate(bar)).showEverything === 'Show everything', 'the bar is still English until Approve');

  await page.evaluate(() => window.__mcCanvas.keep());
  await waitFor(page, (s) => document.querySelector('[data-i18n=showEverything]')?.textContent.trim() === s, 5_000, 'the bar reads the Kannada strings', kn.showEverything)
    .then((ok) => ok && check(true, 'after Approve the bar reads the Kannada strings'));
  const after = await page.evaluate(bar);
  check(after.newBoard === kn.newBoard && after.lang === 'kn', `every bar string and <html lang> follow the pack (got ${JSON.stringify(after)})`);
  await waitFor(page, () => window.__mcArtifacts.list().then((l) => l.some((a) => a.id === 'pack-kn')), 5_000, 'artifact pack-kn exists')
    .then((ok) => ok && check(true, 'artifact pack-kn exists'));
  const stored = await packArtifacts(page);
  check(stored.length === 1 && stored[0].by === 'replay' && stored[0].show === kn.showEverything, `stored once, made by replay (got ${JSON.stringify(stored)})`);

  // Reload offline: the browser says it is offline and nothing outside this server answers.
  await page.evaluateOnNewDocument(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
  await page.setRequestInterception(true);
  const outside = [];
  page.on('request', (r) => {
    if (r.isInterceptResolutionHandled()) return;
    if (r.url().startsWith(BASE) || r.url().startsWith('data:') || r.url().startsWith('blob:')) { void r.continue(); return; }
    outside.push(r.url()); void r.abort();
  });
  if (!(await open(page, 'sim=1&hands=0'))) return;
  check(await page.evaluate(() => navigator.onLine === false), 'the reloaded page is offline');
  await waitFor(page, (s) => document.querySelector('[data-i18n=showEverything]')?.textContent.trim() === s, 8_000, 'still Kannada after the offline reload', kn.showEverything)
    .then((ok) => ok && check(true, 'reload offline → still Kannada'));
  check((await page.evaluate(bar)).lang === 'kn', '<html lang> is still kn');

  // Back to English and then Kannada again, offline: the approved pack comes from the store, no review.
  await page.evaluate(() => { window.__mcCanvas.run('switch to English'); });
  await waitFor(page, () => document.querySelector('[data-i18n=showEverything]')?.textContent.trim() === 'Show everything', 5_000, 'offline: "switch to English" goes back to English')
    .then((ok) => ok && check(true, 'offline: "switch to English" goes back to English'));
  await page.evaluate(() => { window.__mcCanvas.run('add Kannada'); });
  await waitFor(page, (s) => document.querySelector('[data-i18n=showEverything]')?.textContent.trim() === s, 5_000, 'offline: "add Kannada" applies the stored pack', kn.showEverything)
    .then((ok) => ok && check(true, 'offline: "add Kannada" applies the stored pack'));
  check(!(await page.evaluate(reviewOpen)), 'offline: no review for a pack she already approved');
  check(await page.evaluate(statusSays, 'from the pack you approved'), 'offline: it says the pack came from the store');
  await page.evaluate(() => window.__mcCanvas.undo());
  await waitFor(page, () => document.querySelector('[data-i18n=showEverything]')?.textContent.trim() === 'Show everything', 5_000, 'undo goes back to English')
    .then((ok) => ok && check(true, 'undo goes back to English'));
  await sleep(1200); // past the save debounce
  const kept = await packArtifacts(page);
  check(kept.length === 1 && kept[0].v === stored[0].v && kept[0].by === 'replay', `pack-kn is kept, unchanged, after undo (got ${JSON.stringify(kept)})`);

  // A language it can't check, and one offline with no stored pack: refused, nothing written.
  await page.evaluate(() => { window.__mcCanvas.run('add Japanese'); });
  await waitFor(page, statusSays, 3_000, 'a language outside the table is refused', "I can't check that script yet. Nothing changed.")
    .then((ok) => ok && check(true, 'a language outside the table is refused'));
  await page.evaluate(() => { window.__mcCanvas.run('add Hindi'); });
  await waitFor(page, statusSays, 3_000, 'offline Hindi says it needs Gemini', 'Writing a Hindi pack needs Gemini, and you are offline.')
    .then((ok) => ok && check(true, 'offline: a new pack is not written; she is told why'));
  check((await packArtifacts(page)).length === 1, 'still one pack artifact');
  check(outside.length === 0, `offline: no request left this server (got ${JSON.stringify(outside.slice(0, 3))})`);
}
SECTIONS.language = language;

// ---- break: offline reload, "500 percent" refused by rules, a tampered store, the Artifacts sheet ----
const BREAK_LAMP_BOARD = {
  id: 'board-f1', kind: 'board', v: 1, title: 'Lamp', by: 'replay', at: Date.now(), status: 'approved',
  data: {
    frame: { kind: 'room', title: 'Lamp', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false },
    plan: { kind: 'room', title: 'Lamp', tiles: [{ type: 'lamp', deviceId: LAMP_ID, label: 'Lamp', controls: [{ kind: 'chips', label: 'Level', options: [{ label: 'Half', intent: { brightness: 50 } }, { label: 'Full', intent: { brightness: 100 } }] }] }] },
  },
};
const NOTES_BOARD = { ...VALID_BOARD, id: 'board-f2', title: 'Notes', data: { ...VALID_BOARD.data, frame: { ...VALID_BOARD.data.frame, title: 'Notes' } } };
const LAMP_REFUSAL = 'Lamps go from 10 to 100 %. Nothing changed.';
const geminiCard = () => document.querySelector('.mc-engine-card[data-engine=gemini] .mc-engine-state')?.textContent.trim();
const sheetRows = () => [...document.querySelectorAll('.mc-artifacts-sheet:not([hidden]) .mc-artifacts-row')].map((r) => ({
  id: r.dataset.artifact, kind: r.querySelector('.mc-artifacts-kind')?.textContent, title: r.querySelector('.mc-artifacts-name')?.textContent, made: r.querySelector('.mc-artifacts-made')?.textContent,
}));
const lampState = (id) => { const d = window.__mcCanvas.store.get(id); return d ? JSON.stringify({ on: d.on, brightness: d.brightness }) : null; };

async function breakIt(page) {
  const notes = [];
  page.on('console', (m) => notes.push(m.text()));
  await page.evaluateOnNewDocument((id) => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices: [{ id, cls: 'lamp', label: 'Lamp' }] }; }, LAMP_ID);
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  await page.evaluate((a, b) => Promise.all([window.__mcArtifacts.put(a), window.__mcArtifacts.put(b)]), BREAK_LAMP_BOARD, NOTES_BOARD);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if (!(await waitFor(page, () => !!document.querySelector('mc-device-tile'), 10_000, 'the lamp board is on the canvas'))) return;
  // A connector she approves (so there is one stored to tamper with).
  await page.evaluate(() => { window.__mcCanvas.run('connect the lamp'); });
  if (!(await waitFor(page, reviewOpen, 15_000, 'the connector review opens'))) return;
  await page.evaluate(() => window.__mcCanvas.keep());
  if (!(await waitFor(page, (id) => window.__mcArtifacts.list().then((l) => l.some((a) => a.id === id)), 5_000, 'the connector is stored', CONNECTOR_ID))) return;
  const head = await page.evaluate(() => document.querySelector('[data-frame=f1] .mc-frame-by')?.textContent.trim() ?? '');
  check(/^Replay · recorded reply · \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(head), `the board head names its maker and approval date (got ${JSON.stringify(head)})`);

  // Simulated offline: Gemini says Offline; a reload offline brings every board back.
  await page.evaluate(() => document.querySelector('[data-cmd=offline]').click());
  await waitFor(page, () => document.querySelector('.mc-engine-card[data-engine=gemini] .mc-engine-state')?.textContent.trim() === 'Offline', 3_000, 'the Gemini card says Offline')
    .then((ok) => ok && check(true, 'simulated offline: the Gemini card says Offline'));
  await page.evaluateOnNewDocument(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
  await page.setRequestInterception(true);
  const outside = [];
  const onRequest = (r) => {
    if (r.isInterceptResolutionHandled()) return;
    if (r.url().startsWith(BASE) || r.url().startsWith('data:') || r.url().startsWith('blob:')) { void r.continue(); return; }
    outside.push(r.url()); void r.abort();
  };
  page.on('request', onRequest);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  check(await page.evaluate(() => navigator.onLine === false), 'the reloaded page is offline');
  const back = await frames(page);
  check(back.length === 2 && back.some((f) => f.title === 'Lamp') && back.some((f) => f.title === 'Notes'), `offline reload: both boards are back (got ${JSON.stringify(back)})`);
  check((await page.evaluate(geminiCard)) === 'Offline', 'offline reload: the Gemini card says Offline');
  if (!(await waitFor(page, () => !!document.querySelector('mc-device-tile'), 10_000, 'offline: the lamp tile is back'))) return;

  // "Set the lamp to 500 percent": refused by the fixed limits, the lamp unchanged.
  const before = await page.evaluate(lampState, LAMP_ID);
  // What the AI monitor hears (the same channel monitor.html listens on).
  await page.evaluate(() => { window.__feed = []; const ch = new BroadcastChannel('mendcraft-ai'); ch.onmessage = (e) => window.__feed.push(e.data); });
  const mark = await page.evaluate(() => window.__mcCanvas.statusMark());
  await page.evaluate(() => { window.__mcCanvas.run('set the lamp to 500 percent'); });
  await waitFor(page, (m, line) => window.__mcCanvas.statusSince(m).some((t) => t.includes(line)), 10_000, 'the refusal line is said', mark, LAMP_REFUSAL)
    .then((ok) => ok && check(true, `"set the lamp to 500 percent" → "${LAMP_REFUSAL}"`));
  check(await page.evaluate((line) => document.body.innerText.includes(line), LAMP_REFUSAL), 'the refusal line is on screen');
  await sleep(300);
  check((await page.evaluate(lampState, LAMP_ID)) === before, `the lamp state is unchanged (got ${await page.evaluate(lampState, LAMP_ID)} vs ${before})`);
  check(!(await page.evaluate(reviewOpen)), 'no review opens for the refused request');
  const feed = await page.evaluate(() => window.__feed.filter((m) => m.kind === 'log').map((m) => ({ engine: m.engine, text: m.text })));
  // A test build's Nano is the replay (nano.break.json): it proposes the 500 %
  // the request asked for, and the fixed limits refuse it. Nothing reaches Gemini.
  // (With no on-device Nano the rules decide alone, under "Rules · on this
  // device" — tests/canvas/tryToBreak.test.ts.)
  check(feed.some((m) => m.engine === 'nano' && /^SIM · proposed Lamp to 500%/.test(m.text)), `the monitor shows Nano's proposal, labelled SIM (got ${JSON.stringify(feed.slice(0, 4))})`);
  check(feed.some((m) => m.engine === 'nano' && m.text === LAMP_REFUSAL), 'the monitor shows the refusal on the Nano terminal');
  check(!feed.some((m) => m.engine === 'gemini'), 'nothing went to Gemini');

  // Tamper with the store: a board control asking for brightness 500, a connector on port 22.
  const rows = await page.evaluate(() => window.__mcArtifacts.list());
  const lampBoard = JSON.parse(JSON.stringify(rows.find((a) => a.id === 'board-f1')));
  lampBoard.data.plan.tiles[0].controls[0].options[0].intent = { brightness: 500 };
  const conn = JSON.parse(JSON.stringify(rows.find((a) => a.id === CONNECTOR_ID)));
  conn.data.connector.actions[0].request.port = 22;
  await page.evaluate((a, b) => Promise.all([window.__mcArtifacts.put(a), window.__mcArtifacts.put(b)]), lampBoard, conn);
  notes.length = 0;
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if (!(await waitFor(page, () => !!document.querySelector('mc-device-tile'), 10_000, 'the lamp board is back after the tamper'))) return;
  await waitFor(page, (line) => document.body.innerText.includes(line), 5_000, 'the dropped line is visible', DROPPED_LINE)
    .then((ok) => ok && check(true, 'the tampered connector is dropped and the dropped line shows'));
  const chips = await page.evaluate(() => [...(document.querySelector('mc-device-tile')?.shadowRoot?.querySelectorAll('[data-act=chip]') ?? [])].map((b) => b.textContent.trim()));
  check(chips.includes('Full') && !chips.includes('Half'), `the 500 % control is cleaned out, the rest load (got ${JSON.stringify(chips)})`);
  check(notes.some((n) => /Dropped 1 control/.test(n)), 'the dropped-control note is logged');
  check((await page.evaluate(lampTile))?.footnote === 'Built-in WiZ connector', 'with the tampered connector dropped, the lamp is on the built-in connector');

  // The Artifacts sheet lists what remains (each checked again), and Remove takes a board off.
  await page.evaluate(() => { window.__mcCanvas.run('show artifacts'); });
  if (!(await waitFor(page, () => document.querySelectorAll('.mc-artifacts-sheet:not([hidden]) .mc-artifacts-row').length >= 2, 5_000, 'the Artifacts sheet lists the boards'))) return;
  const listed = await page.evaluate(sheetRows);
  check(listed.map((r) => r.id).sort().join(',') === 'board-f1,board-f2', `the sheet lists what remains, not the dropped connector (got ${JSON.stringify(listed.map((r) => r.id))})`);
  check(listed.every((r) => /^(Board) /.test(`${r.kind} `) && / · approved \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(r.made)), `each row has kind, maker and date (got ${JSON.stringify(listed)})`);
  check(await page.evaluate(() => document.querySelector('.mc-artifacts-sheet').innerText.includes('1 stored item failed its check')), 'the sheet says one stored item failed its check');
  const small = await page.evaluate(() => [...document.querySelectorAll('.mc-artifacts-sheet button')].filter((b) => b.getClientRects().length && b.getBoundingClientRect().height < 56).map((b) => b.textContent.trim()));
  check(small.length === 0, `every sheet button is at least 56 px tall (smaller: ${JSON.stringify(small)})`);
  await page.evaluate(() => document.querySelector('[data-artifact="board-f2"] .mc-artifacts-remove').click());
  await page.evaluate(() => document.querySelector('[data-artifact="board-f2"] .mc-artifacts-remove').click());
  await waitFor(page, () => window.__mcCanvas.frames().length === 1, 5_000, 'Remove takes the Notes board off the canvas')
    .then((ok) => ok && check(true, 'Remove takes the Notes board off the canvas'));
  await sleep(1200); // past the save debounce: nothing writes it back
  const ids = await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.map((a) => a.id).sort()));
  check(!ids.includes('board-f2') && ids.includes('board-f1'), `the Notes board is gone from the store and stays gone (got ${JSON.stringify(ids)})`);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  check((await frames(page)).map((f) => f.title).join() === 'Lamp', 'after a reload the removed board stays gone');

  // Import a file: the valid board loads, the bad entries are counted and left out.
  const bad = [{ ...NOTES_BOARD, id: 'script-x', kind: 'script' }, { ...conn, id: CONNECTOR_ID }, { ...NOTES_BOARD, id: 'board-f9', data: { ...NOTES_BOARD.data, pad: 'x'.repeat(500_000) } }];
  const file = JSON.stringify({ format: 'mendcraft-artifacts', version: 1, artifacts: [...bad, NOTES_BOARD] });
  const tmp = join(require('node:os').tmpdir(), `mendcraft-import-${process.pid}.json`);
  require('node:fs').writeFileSync(tmp, file);
  await page.evaluate(() => { window.__mcCanvas.run('show artifacts'); });
  await waitFor(page, () => !document.querySelector('.mc-artifacts-sheet')?.hidden, 3_000, 'the sheet opens again');
  const input = await page.$('.mc-artifacts-file');
  await input.uploadFile(tmp);
  if (!(await waitFor(page, () => !document.querySelector('.mc-artifacts-confirm')?.hidden, 10_000, 'the import confirm shows'))) return;
  const confirmText = await page.evaluate(() => [...document.querySelectorAll('.mc-artifacts-confirm-line')].map((p) => p.textContent));
  check(confirmText[0] === 'Adds 1, replaces 0.' && confirmText.includes('3 entries failed their check and were left out.'), `the confirm says what it adds and what was left out (got ${JSON.stringify(confirmText)})`);
  const confirmBtns = await page.evaluate(() => [...document.querySelectorAll('.mc-artifacts-confirm button')].map((b) => ({ t: b.textContent.trim(), h: b.getBoundingClientRect().height })));
  check(confirmBtns.map((b) => b.t).join() === 'Import,Cancel' && confirmBtns.every((b) => b.h >= 56), `Import / Cancel, each at least 56 px (got ${JSON.stringify(confirmBtns)})`);
  check(!(await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.some((a) => a.id === 'board-f2')))), 'nothing is written before Import');
  await page.evaluate(() => document.querySelector('.mc-artifacts-do-import').click());
  await waitFor(page, () => document.body.innerText.includes('Imported 1 artifact. 3 entries failed their check and were left out.'), 8_000, 'the import line counts what was left out')
    .then((ok) => ok && check(true, 'import: 1 kept, 3 left out, said'));
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10_000 }).catch(() => undefined);
  await waitFor(page, () => !!window.__mcCanvas && window.__mcCanvas.frames().length === 2, 10_000, 'after the import the Notes board opens');
  check((await frames(page)).some((f) => f.title === 'Notes'), 'the imported board is on the canvas');
  await waitFor(page, () => document.body.innerText.includes('Imported 1 artifact.'), 5_000, 'the import line is said again after the reload')
    .then((ok) => ok && check(true, 'the import line is said again after the reload'));
  const importedHead = await page.evaluate(() => document.querySelector('[data-frame=f2] .mc-frame-by')?.textContent.trim() ?? '');
  check(/^Imported · Replay · recorded reply · \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(importedHead), `the imported board's head says Imported (got ${JSON.stringify(importedHead)})`);
  const importedRow = await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.find((a) => a.id === 'board-f2')));
  check(importedRow?.imported === true && importedRow.by === 'replay', 'the stored row is marked imported and keeps its maker');
  require('node:fs').rmSync(tmp, { force: true });
  check(outside.length === 0, `offline: no request left this server (got ${JSON.stringify(outside.slice(0, 3))})`);
  page.off('request', onRequest);
}
SECTIONS.break = breakIt;

// ---- journey: the whole demo (spec §10) on one page, from tests/fixtures/replies/ ----
// One fresh canvas; every beat builds on the last. Checks stay true whatever
// the recorded replies say (a live recording words things its own way):
// each review shows before its change, every engine label says Replay, the
// store ends with one artifact of each kind, a reload brings it all back,
// and the whole run takes under 180 s.
const JOURNEY_MAX_MS = 180_000;
const anyReplay = (t) => /Replay · (recorded reply|written example)/.test(t ?? '');
/** What a review must not have changed yet: the stored rows and the boards.
 *  Next-step suggestions are left out: they are exempt from Approve (they only
 *  say her words) and arrive on their own after the turn before. */
const storeSig = (page) => page.evaluate(() => window.__mcArtifacts.list().then((l) => ({
  rows: l.filter((a) => a.kind !== 'steps').map((a) => `${a.id}@${a.v}`).sort().join(','),
  frames: window.__mcCanvas.frames().map((f) => f.id).join(','),
})));
const kinds = (page) => page.evaluate(() => window.__mcArtifacts.list().then((l) => l.reduce((m, a) => ({ ...m, [a.kind]: (m[a.kind] ?? 0) + 1 }), {})));
const frameHeads = () => [...document.querySelectorAll('.mc-frame-by')].filter((e) => !e.hidden).map((e) => e.textContent.trim());
const deviceClasses = () => [...document.querySelectorAll('mc-device-tile')].map((t) => t.shadowRoot?.querySelector('[data-device-cls]')?.getAttribute('data-device-cls')).filter(Boolean);
/** Focus a board without waiting on the camera move (a cancelled flyTo can
 *  leave focus() unresolved — a parked minor in the ledger). */
const focusBoard = async (page, id) => { await page.evaluate((f) => { void window.__mcCanvas.focus(f); }, id); await sleep(900); };
const pressIn = (cls, sel) => [...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector(`[data-device-cls=${cls}]`))?.shadowRoot.querySelector(sel)?.click();

async function journey(page) {
  const t0 = Date.now();
  const reviews = []; // { beat, label, before, at-open, after }
  const labels = [];  // every engine label seen on the way
  await page.evaluateOnNewDocument((devices) => { window.__mcFixtures = { ...(window.__mcFixtures ?? {}), devices }; }, JOURNEY_DEVICES);

  /** Say a beat's line; when it opens a review: check nothing changed while
   *  it is open, approve it, and check that something did. */
  const say = async (beat, o = {}) => {
    const text = line(beat);
    const before = await storeSig(page);
    const mark = await page.evaluate(() => window.__mcCanvas.statusMark());
    await page.evaluate((t) => { window.__mcCanvas.run(t); }, text);
    if (!o.review) return true;
    if (!(await waitFor(page, reviewOpen, 20_000, `${beat}: the review opens ("${text}")`))) {
      console.log(`     said since "${text}": ${JSON.stringify(await page.evaluate((m) => window.__mcCanvas.statusSince(m), mark))}`);
      return false;
    }
    const review = await page.evaluate(reviewText);
    await sleep(1200); // past the save debounce: nothing may be written while it waits
    const open = await storeSig(page);
    await page.evaluate(() => window.__mcCanvas.keep());
    const changed = await pollUntil(async () => JSON.stringify(await storeSig(page)) !== JSON.stringify(open), 10_000);
    const after = await storeSig(page);
    // A turn may open an empty board to draw its ghost in; nothing is STORED until Approve.
    const unchanged = before.rows === open.rows;
    reviews.push({ beat, label: review.match(/Replay · (recorded reply|written example)/)?.[0] ?? null, unchanged, changed: changed.ok });
    check(anyReplay(review), `${beat}: the review names a Replay engine (got ${JSON.stringify(review.slice(0, 200))})`);
    check(unchanged, `${beat}: nothing was stored while the review was open (${JSON.stringify(before.rows)} → ${JSON.stringify(open.rows)})`);
    check(changed.ok, `${beat}: approving it changed the store (${JSON.stringify(open)} → ${JSON.stringify(after)})`);
    return changed.ok;
  };

  // ---- pair the phones (the SIM branch stands in for the chime)
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  check((await frames(page)).length === 0, 'journey: an empty canvas to start');
  await say('pair');
  if (!(await waitFor(page, () => document.querySelectorAll('.mc-paired-chip').length === 2, 10_000, 'journey: two SIM phones join'))) return;
  await waitFor(page, () => !document.querySelector('.mc-paired-continue'), 8_000, 'journey: pairing moves on');

  // ---- the devices board (generated around the live table), then next-step chips
  if (!(await say('devices', { review: true }))) return;
  await waitFor(page, () => [...document.querySelectorAll('mc-table-tile')].some((t) => t.shadowRoot?.querySelector('[data-live]')), 10_000, 'journey: the live devices table is on the canvas')
    .then((ok) => ok && check(true, 'journey: the devices board shows the live table'));
  const rows = await page.evaluate(liveTableRows);
  check(rows.length === 5 && rows[0].startsWith('✓') && rows.some((r) => r.startsWith('Lamp | SIM')) && rows.some((r) => r.startsWith('Speaker | SIM')) && rows.some((r) => /^iPhone \| SIM.*Gimbal: docked/.test(r)),
    `journey: the table lists the laptop, both phones (the stand docked on the iPhone), the lamp and the speaker (got ${JSON.stringify(rows)})`);
  if (await waitFor(page, () => document.querySelectorAll('.mc-next .mc-next-chip').length > 0, 10_000, 'journey: next-step chips appear')) {
    const chips = await page.evaluate(chipRow);
    labels.push(['next steps', chips?.label]);
  }

  // ---- the dashboard: lamp, speaker and stand, driven through the checked binding
  await page.evaluate(() => window.__mcCanvas.run('new board'));
  const dashMark = await page.evaluate(() => window.__mcCanvas.statusMark());
  if (!(await say('dashboard', { review: true }))) return;
  const dashSaid = await page.evaluate((m) => window.__mcCanvas.statusSince(m), dashMark);
  check(!dashSaid.some((t) => /Nano (couldn|didn)|refused|No recorded reply/i.test(t)), `journey: Nano's draft (replayed on the live {t,d} path) was taken (said ${JSON.stringify(dashSaid.slice(0, 4))})`);
  await waitFor(page, (want) => want.every((c) => [...document.querySelectorAll('mc-device-tile')].some((t) => t.shadowRoot?.querySelector(`[data-device-cls=${c}]`))), 10_000, 'journey: lamp, speaker and stand tiles', ['lamp', 'music', 'gimbal'])
    .then((ok) => ok && check(true, 'journey: the dashboard has a lamp, a speaker and a stand tile'));
  await page.evaluate(pressIn, 'lamp', '[data-act=toggle]');
  await waitFor(page, (id) => window.__mcCanvas.store.get(id)?.on === true, 5_000, 'journey: the lamp turns on', LAMP_ID).then((ok) => ok && check(true, 'journey: a press turns the SIM lamp on'));
  await page.evaluate(pressIn, 'music', '[data-act=toggle]');
  await waitFor(page, (id) => window.__mcCanvas.store.get(id)?.playing === true, 5_000, 'journey: the speaker plays', SPEAKER_ID).then((ok) => ok && check(true, 'journey: a press plays the SIM speaker'));
  const modes = await page.evaluate(() => { const r = [...document.querySelectorAll('mc-device-tile')].find((x) => x.shadowRoot?.querySelector('[data-device-cls=gimbal]'))?.shadowRoot; const c = [...(r?.querySelectorAll('[data-act=chip]') ?? [])].find((b) => b.getAttribute('aria-pressed') !== 'true'); c?.click(); return !!c; });
  if (modes) await waitFor(page, () => window.__mcCanvas.simRelayLog().some((m) => m.kind === 'gimbalMode'), 5_000, 'journey: a stand mode is sent').then((ok) => ok && check(true, 'journey: a stand chip sends one mode message to the SIM iPhone'));
  const dashId = await page.evaluate(() => window.__mcCanvas.frames().find((f) => window.__mcCanvas.snapshot().surfaces[f.id]?.tiles?.length && JSON.stringify(window.__mcCanvas.snapshot().surfaces[f.id]).includes('"gimbal"'))?.id ?? null);

  // ---- the lamp's connector, written as data
  if (!(await say('connector', { review: true }))) return;
  check((await kinds(page)).connector === 1, 'journey: the connector is stored once');

  // ---- the floor plan on its own board, then a voice edit
  if (!(await say('floorplan', { review: true }))) return;
  if (!(await waitFor(page, () => !!document.querySelector('mc-plan-board .mc-plan-board svg'), 10_000, 'journey: the drawing is on screen'))) return;
  const planVersion = () => window.__mcArtifacts.list().then((l) => l.find((a) => a.kind === 'plan')?.v ?? 0);
  await waitFor(page, planVersion, 5_000, 'journey: the drawing is stored');
  const planV = await page.evaluate(planVersion);
  if (!(await say('planEdit', { review: true }))) return;
  await waitFor(page, (v) => window.__mcArtifacts.list().then((l) => (l.find((a) => a.kind === 'plan')?.v ?? 0) > v), 5_000, 'journey: the edited drawing is stored', planV);
  const planV2 = await page.evaluate(planVersion);
  check(planV2 === planV + 1, `journey: the voice edit is stored as the next version of the drawing (v${planV} → v${planV2})`);
  const planId = await page.evaluate(() => window.__mcCanvas.frames().find((f) => f.kind === 'plan')?.id ?? null);

  // ---- board to phone, at both edges
  const layout = await page.evaluate(() => window.__mcCanvas.edgeLayout());
  check(!!layout.left && !!layout.right && layout.left !== layout.right, `journey: a phone at each edge (got ${JSON.stringify(layout)})`);
  const browser = page.browserContext().browser();
  const mk = async (ios) => { const c = await browser.createBrowserContext(); const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e?.message || e))); return { c, p, errs, ok: await openPhone(p, ios) }; };
  const phonesOpen = [];
  try {
    for (const [side, frameId, what] of [['right', dashId, 'dashboard'], ['left', planId, 'floor plan']]) {
      if (!frameId || !layout[side]) continue;
      await focusBoard(page, frameId);
      check(await page.evaluate((s) => window.__mcCanvas.sendBoard(s), side), `journey: the ${what} is sent at the ${side} edge`);
      const snap = await page.evaluate(() => window.__mcLastBoardSnapshot ?? null);
      const phone = await mk(layout[side] === 'ios');
      phonesOpen.push(phone);
      if (!phone.ok || !snap) continue;
      check(await phone.p.evaluate((s) => window.__mcGuestSnapshot(s), snap), `journey: the ${layout[side] === 'ios' ? 'iPhone' : 'Nothing phone'} takes the ${what}`);
      await waitFor(phone.p, () => window.__mcCanvas.frames().length === 1, 10_000, `journey: the ${what} is on the phone`);
      await sleep(1200);
      const kept = await boardArtifacts(phone.p);
      check(kept.length === 1 && kept[0].by === 'replay', `journey: the phone keeps the ${what}, made by replay (got ${JSON.stringify(kept.map((a) => a.by))})`);
      check(phone.errs.length === 0, `journey: no page errors on the phone${phone.errs.length ? `: ${phone.errs.slice(0, 3).join(' | ')}` : ''}`);
    }
  } finally {
    for (const ph of phonesOpen) await ph.c.close();
  }

  // ---- offline: every board comes back from the store; Nano still drafts
  const titles = (await frames(page)).map((f) => f.title).sort();
  await page.evaluate(() => document.querySelector('[data-cmd=offline]').click());
  const offlineScript = await page.evaluateOnNewDocument(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });
  await page.setRequestInterception(true);
  const outside = [];
  const onRequest = (r) => {
    if (r.isInterceptResolutionHandled()) return;
    if (r.url().startsWith(BASE) || r.url().startsWith('data:') || r.url().startsWith('blob:')) { void r.continue(); return; }
    outside.push(r.url()); void r.abort();
  };
  page.on('request', onRequest);
  if (!(await open(page, 'sim=1&hands=0'))) return;
  check(await page.evaluate(() => navigator.onLine === false), 'journey: the reloaded page is offline');
  check(JSON.stringify((await frames(page)).map((f) => f.title).sort()) === JSON.stringify(titles), `journey: offline reload, every board is back (got ${JSON.stringify((await frames(page)).map((f) => f.title))})`);
  await page.evaluate(() => window.__mcCanvas.run('connect devices'));
  await waitFor(page, () => document.querySelectorAll('.mc-paired-chip').length === 2, 10_000, 'journey: the SIM phones join again');
  await waitFor(page, () => !document.querySelector('.mc-paired-continue'), 8_000, 'journey: pairing moves on again');
  const devicesId = await page.evaluate(() => window.__mcCanvas.frames().find((f) => JSON.stringify(window.__mcCanvas.snapshot().surfaces[f.id] ?? {}).includes('"source":"devices"'))?.id ?? null);
  if (devicesId) await focusBoard(page, devicesId);
  if (!(await say('offline', { review: true, offline: true }))) return;
  check(outside.length === 0, `journey: offline, no request left this server (got ${JSON.stringify(outside.slice(0, 3))})`);
  page.off('request', onRequest);
  await page.setRequestInterception(false);
  await page.removeScriptToEvaluateOnNewDocument(offlineScript.identifier);

  // ---- back online: Kannada
  if (!(await open(page, 'sim=1&hands=0'))) return;
  if ((await page.evaluate(geminiCard)) === 'Offline') await page.evaluate(() => document.querySelector('[data-cmd=offline]').click());
  if (!(await say('language', { review: true }))) return;
  await waitFor(page, () => document.documentElement.lang === 'kn', 5_000, 'journey: the canvas is in Kannada').then((ok) => ok && check(true, 'journey: after Approve the canvas is in Kannada'));
  await say('english');
  await waitFor(page, () => document.documentElement.lang === 'en', 5_000, 'journey: back to English');

  // ---- try to break it: an impossible level, and a tampered stored row
  await page.evaluate(() => window.__mcCanvas.run('connect devices'));
  await waitFor(page, () => document.querySelectorAll('.mc-paired-chip').length === 2, 10_000, 'journey: the SIM phones join for the last beats');
  await waitFor(page, () => !document.querySelector('.mc-paired-continue'), 8_000, 'journey: pairing moves on');
  const lampBefore = await page.evaluate(lampState, LAMP_ID);
  const breakMark = await page.evaluate(() => window.__mcCanvas.statusMark());
  const sigBefore = await storeSig(page);
  await say('break');
  await waitFor(page, (m, l) => window.__mcCanvas.statusSince(m).some((t) => t.includes(l)), 10_000, 'journey: the 500 % request is refused', breakMark, LAMP_REFUSAL)
    .then((ok) => ok && check(true, `journey: "${line('break')}" → "${LAMP_REFUSAL}"`));
  await sleep(300);
  check((await page.evaluate(lampState, LAMP_ID)) === lampBefore && !(await page.evaluate(reviewOpen)), 'journey: the lamp is unchanged and no review opened');
  check(JSON.stringify(await storeSig(page)) === JSON.stringify(sigBefore), 'journey: the refused request changed nothing stored');
  await page.evaluate((a) => window.__mcArtifacts.put(a), { ...CORRUPT_BOARD, id: 'board-tampered' });
  if (!(await open(page, 'sim=1&hands=0'))) return;
  await waitFor(page, (l) => document.body.innerText.includes(l), 5_000, 'journey: the tampered row is dropped and said', DROPPED_LINE)
    .then((ok) => ok && check(true, 'journey: a tampered stored row is dropped and said; the rest load'));
  check(JSON.stringify((await frames(page)).map((f) => f.title).sort()) === JSON.stringify(titles), 'journey: every good board is still there');
  await page.evaluate(() => window.__mcArtifacts.remove('board-tampered'));

  // ---- export, then import into an empty canvas
  await page.evaluate(() => { const oc = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { window.__mcExportBlob = b; return oc(b); }; });
  await page.evaluate(() => { window.__mcCanvas.run('show artifacts'); });
  if (!(await waitFor(page, () => !document.querySelector('.mc-artifacts-sheet')?.hidden && document.querySelectorAll('.mc-artifacts-row').length > 0, 5_000, 'journey: the Artifacts sheet lists what is stored'))) return;
  const made = await page.evaluate(() => [...document.querySelectorAll('.mc-artifacts-sheet:not([hidden]) .mc-artifacts-made')].map((m) => m.textContent.trim()));
  for (const m of made) labels.push(['artifacts sheet', m]);
  await page.evaluate(() => document.querySelector('.mc-artifacts-export').click());
  if (!(await waitFor(page, () => !!window.__mcExportBlob, 5_000, 'journey: Export writes a file'))) return;
  const exported = await page.evaluate(() => window.__mcExportBlob.text());
  const stored = await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.map((a) => a.id).sort()));
  const inFile = JSON.parse(exported).artifacts.map((a) => a.id).sort();
  check(JSON.stringify(inFile) === JSON.stringify(stored), `journey: the export holds every stored artifact (${inFile.length})`);
  check(!/token|192\.168\.|127\.0\.0\.1/i.test(exported), 'journey: the export holds no token and no address');
  if (!(await open(page, 'fresh=1&sim=1&hands=0'))) return;
  check((await frames(page)).length === 0 && (await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.length))) === 0, 'journey: a fresh canvas is empty before the import');
  const tmp = join(require('node:os').tmpdir(), `mendcraft-journey-${process.pid}.json`);
  require('node:fs').writeFileSync(tmp, exported);
  try {
    await page.evaluate(() => { window.__mcCanvas.run('show artifacts'); });
    await waitFor(page, () => !document.querySelector('.mc-artifacts-sheet')?.hidden, 3_000, 'journey: the sheet opens on the empty canvas');
    await (await page.$('.mc-artifacts-file')).uploadFile(tmp);
    if (!(await waitFor(page, () => !document.querySelector('.mc-artifacts-confirm')?.hidden, 10_000, 'journey: the import asks first'))) return;
    check(!(await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.length))), 'journey: nothing is written before Import');
    await page.evaluate(() => document.querySelector('.mc-artifacts-do-import').click());
    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined);
  } finally { require('node:fs').rmSync(tmp, { force: true }); }
  await waitFor(page, () => !!window.__mcCanvas && !!window.__mcArtifacts, 20_000, 'journey: the canvas reopens after the import');
  await waitFor(page, (n) => window.__mcCanvas.frames().length === n, 10_000, 'journey: every board is back after the import', titles.length)
    .then((ok) => ok && check(true, 'journey: the import brings every board back'));

  // ---- a last reload: everything is still there
  if (!(await open(page, 'sim=1&hands=0'))) return;
  await waitFor(page, (n) => window.__mcCanvas.frames().length === n, 10_000, 'journey: every board after the last reload', titles.length);
  check(JSON.stringify((await frames(page)).map((f) => f.title).sort()) === JSON.stringify(titles), `journey: a final reload restores every board (got ${JSON.stringify((await frames(page)).map((f) => f.title))})`);
  const finalIds = await page.evaluate(() => window.__mcArtifacts.list().then((l) => l.map((a) => a.id).sort()));
  check(JSON.stringify(finalIds) === JSON.stringify(stored), `journey: the store holds what was exported (got ${JSON.stringify(finalIds)})`);
  const k = await kinds(page);
  check(k.board >= 1 && k.plan === 1 && k.connector === 1 && k.pack === 1 && k.steps >= 1, `journey: the store holds one artifact of each kind (got ${JSON.stringify(k)})`);
  await waitFor(page, () => !!document.querySelector('mc-plan-board .mc-plan-board svg') && document.querySelectorAll('mc-device-tile').length >= 3, 10_000, 'journey: the drawing and the device tiles are back')
    .then((ok) => ok && check(true, 'journey: the drawing and the device tiles are back'));
  for (const h of await page.evaluate(frameHeads)) labels.push(['board head', h]);

  // ---- across the whole run
  check(reviews.length === JOURNEY_LINES.filter((l) => l.review).length && reviews.every((r) => r.unchanged && r.changed), `journey: every review appeared before its change (${JSON.stringify(reviews.map((r) => [r.beat, r.unchanged, r.changed]))})`);
  const notReplay = labels.filter(([, l]) => !/Replay/.test(l ?? ''));
  check(labels.length > 0 && notReplay.length === 0, `journey: every engine label says Replay (${labels.length} seen${notReplay.length ? `; not: ${JSON.stringify(notReplay)}` : ''})`);
  const took = Date.now() - t0;
  check(took < JOURNEY_MAX_MS, `journey: the whole journey took ${Math.round(took / 1000)} s (under ${JOURNEY_MAX_MS / 1000} s)`);
}
SECTIONS.journey = journey;

/** Journey order (spec §10); the whole journey, on one page, last. */
const ORDER = ['boot', 'phones', 'devices', 'dashboard', 'speaker', 'gimbal', 'connector', 'floorplan', 'phonelayout', 'persist', 'language', 'break', 'journey'];

async function main() {
  const unordered = Object.keys(SECTIONS).filter((n) => !ORDER.includes(n));
  if (unordered.length) { console.error(`e2e-actual: sections missing from ORDER: ${unordered.join(', ')}`); return 2; }
  if (ONLY && !SECTIONS[ONLY]) { console.error(`e2e-actual: no section "${ONLY}" (have: ${Object.keys(SECTIONS).join(', ')}).`); return 2; }
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-actual: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-actual: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-actual: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  const fixtures = { written: loadReplies(WRITTEN), replies: loadReplies(REPLIES) };
  stayAwake();
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'] });
  try {
    for (const name of ORDER) {
      const run = SECTIONS[name];
      if (ONLY && name !== ONLY) continue;
      const { replies, recorded, liveShape } = name === 'journey' ? fixtures.replies : fixtures.written;
      console.log(`--- ${name}`);
      const ctx = await browser.createBrowserContext();
      const page = await ctx.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e?.message || e)));
      await page.evaluateOnNewDocument((r, rec, ls) => { window.__mcFixtures = { replies: r, recorded: rec, liveShape: ls }; }, replies, recorded, liveShape);
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
