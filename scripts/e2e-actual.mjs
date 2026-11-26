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

/** Every reply file: file name without .json → its `reply` text, and the
 *  keys whose `source` is "recorded" (every other one is a written example). */
function loadReplies() {
  const replies = {};
  const recorded = [];
  if (!existsSync(FIXTURES)) return { replies, recorded };
  for (const f of readdirSync(FIXTURES)) {
    if (!f.endsWith('.json')) continue;
    const rec = JSON.parse(readFileSync(join(FIXTURES, f), 'utf8'));
    if (typeof rec.reply !== 'string') throw new Error(`${f}: no "reply" string`);
    const key = f.slice(0, -'.json'.length);
    replies[key] = rec.reply;
    if (rec.source === 'recorded') recorded.push(key);
  }
  return { replies, recorded };
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
  // Pairing still opens the fixed "Connected devices" table (Task 8 replaces
  // it with a generated board). It is on the canvas but never stored.
  check((await frames(page)).some((f) => f.title === 'Connected devices'), 'pairing shows the Connected devices table');
  await sleep(1200); // past the save debounce
  const early = await boardArtifacts(page);
  check(early.length === 0, `nothing is stored until Approve, not even the devices table (got ${JSON.stringify(early.map((a) => a.title))})`);
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
  if (!(await waitFor(page, reviewOpen, 15_000, 'the gimbal review opens'))) return;
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
}
SECTIONS.gimbal = gimbal;

async function main() {
  if (ONLY && !SECTIONS[ONLY]) { console.error(`e2e-actual: no section "${ONLY}" (have: ${Object.keys(SECTIONS).join(', ')}).`); return 2; }
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-actual: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-actual: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-actual: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  const { replies, recorded } = loadReplies();
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
      await page.evaluateOnNewDocument((r, rec) => { window.__mcFixtures = { replies: r, recorded: rec }; }, replies, recorded);
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
