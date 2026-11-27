// record-fixtures.mjs — record the journey's model replies from LIVE Gemini
// and Nano into tests/fixtures/replies/ (spec §12, "Recording").
//
//   npm run record                       # against http://localhost:5173 (npx vite)
//   E2E_URL=https://<preview>.web.app npm run record
//
// It opens canvas.html?fresh=1&record=1&sim=1&hands=0 in a real, visible
// Chrome (Nano needs it), says the journey lines of scripts/journey.lib.mjs
// through the canvas, approves each review, then writes what the page kept in
// window.__mcRecorded as one fixture file per reply, marked
// `source: "recorded"`. It needs:
//   - a test build: `npx vite` (DEV) or a VITE_E2E=1 build. ?record=1 does
//     nothing in a production build, so it can't be run against
//     mendcraft.web.app as deployed — use a VITE_E2E=1 preview channel
//     (`VITE_E2E=1 npm run build && firebase hosting:channel:deploy record`)
//     or the dev server with a registered App Check debug token in .env.local.
//   - Chrome with Gemini Nano downloaded in the profile it uses: RECORD_PROFILE
//     (a user-data-dir; default ~/.mendcraft-record-chrome — open it once,
//     visit chrome://on-device-internals and let the model download), or
//     CHROME_CDP=http://127.0.0.1:9222 to drive a Chrome already running with
//     --remote-debugging-port.
// ?record=1 is always a SIM run (canvasMain forces it): the devices and phones
// are the SIM fixtures the replay uses — no WiZ discovery, no Spotify, no real
// relay — while every turn runs the live production path (real prompt,
// constraint, retries, checks). Replies are kept as the model wrote them, with
// names and emails redacted in the page; here a reply is refused if it holds
// a key, token, email, address or hardware id, any value from .env.local, or
// a device the journey did not set up (scripts/recordGuard.lib.mjs).
// Review `git diff tests/fixtures/replies/` by eye after.
//
// Exit 0: every reply the journey needs was recorded. 1: some were not (the
// ones that were are still written). 2: it could not run.

import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pollUntil } from './e2eWait.lib.mjs';
import { JOURNEY_DEVICES, JOURNEY_LINES } from './journey.lib.mjs';
import { envSecrets, unsafeFixture } from './recordGuard.lib.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const OUT = join(ROOT, 'tests/fixtures/replies');
const PROFILE = process.env.RECORD_PROFILE || join(homedir(), '.mendcraft-record-chrome');

/** Live turns are slow (a cold Nano load is up to ~45 s). */
const TURN_MS = 120_000;

/** A reply is in once no new one has arrived for this long. */
const QUIET_MS = 4_000;

function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  ].filter(Boolean).find((p) => existsSync(p));
}

const reviewOpen = () => { const d = document.querySelector('.mc-review-dialog'); return !!d && !d.hidden; };
const recordedCount = (page) => page.evaluate(() => Object.keys(window.__mcRecorded ?? {}).length);

/** Wait (sleep-aware) until the recordings stop growing: no new reply for
 *  QUIET_MS, or `ms` in all. The next-step turn that follows an approval
 *  lands here. */
async function settleRecordings(page, ms = 30_000) {
  let last = await recordedCount(page);
  let since = Date.now();
  await pollUntil(async () => {
    const n = await recordedCount(page);
    if (n !== last) { last = n; since = Date.now(); return false; }
    return Date.now() - since >= QUIET_MS;
  }, ms, { everyMs: 500 });
}

async function main() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('record: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`record: nothing at ${BASE} (start npx vite, or set E2E_URL).`); return 2; }
  const secrets = envSecrets(join(ROOT, '.env.local'));
  let browser;
  if (process.env.CHROME_CDP) browser = await puppeteer.connect({ browserURL: process.env.CHROME_CDP, defaultViewport: null });
  else {
    const chrome = findChrome();
    if (!chrome) { console.error('record: no Chrome found (set CHROME_PATH).'); return 2; }
    browser = await puppeteer.launch({ executablePath: chrome, headless: false, userDataDir: PROFILE, defaultViewport: null, args: ['--no-first-run', '--no-default-browser-check', '--window-size=1440,900'] });
  }
  const page = await browser.newPage();
  let missing = [];
  try {
    await page.evaluateOnNewDocument((devices) => { window.__mcFixtures = { devices }; }, JOURNEY_DEVICES);
    await page.goto(`${BASE}/canvas.html?fresh=1&record=1&sim=1&hands=0`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const ready = await pollUntil(() => page.evaluate(() => !!window.__mcCanvas), 30_000);
    if (!ready.ok) { console.error('record: the canvas did not open with test hooks (is this a dev or VITE_E2E=1 build?).'); return 2; }
    const live = await page.evaluate(() => typeof LanguageModel !== 'undefined' ? LanguageModel.availability().catch(() => 'error') : 'missing');
    console.log(`Nano in this Chrome: ${live}`);

    for (const l of JOURNEY_LINES) {
      if (l.offline) await page.evaluate(() => { const b = document.querySelector('[data-cmd=offline]'); if (b?.getAttribute('aria-pressed') !== 'true') b?.click(); });
      // The dashboard goes on a board of its own, as in the journey e2e.
      if (l.beat === 'dashboard') await page.evaluate(() => window.__mcCanvas.run('new board'));
      const mark = await page.evaluate(() => window.__mcCanvas.statusMark());
      console.log(`> ${l.say}`);
      await page.evaluate((t) => { window.__mcCanvas.run(t); }, l.say);
      if (l.beat === 'pair') {
        await pollUntil(() => page.evaluate(() => document.querySelectorAll('.mc-paired-chip').length === 2 && !document.querySelector('.mc-paired-continue')), 20_000);
        continue;
      }
      if (!l.review) {
        // A line with no review is done when the canvas has said something back.
        await pollUntil(() => page.evaluate((m) => window.__mcCanvas.statusSince(m).length > 0, mark), TURN_MS);
        await settleRecordings(page);
        continue;
      }
      const r = await pollUntil(() => page.evaluate(reviewOpen), TURN_MS);
      if (!r.ok) { console.log(`  no review: ${JSON.stringify(await page.evaluate((m) => window.__mcCanvas.statusSince(m), mark))}`); continue; }
      await page.evaluate(() => window.__mcCanvas.keep());
      await settleRecordings(page);
      if (l.offline) await page.evaluate(() => { const b = document.querySelector('[data-cmd=offline]'); if (b?.getAttribute('aria-pressed') === 'true') b.click(); });
    }
    await settleRecordings(page);
    const got = await page.evaluate(() => window.__mcRecorded ?? {});
    const expected = new Set(readdirSync(OUT).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
    let wrote = 0;
    for (const [key, rec] of Object.entries(got)) {
      if (!/^(nano|gemini)\.[A-Za-z]+(\.[a-z0-9]+)*$/.test(key)) { console.log(`  skipped ${key}: not a fixture name`); continue; }
      const file = {
        engine: rec.engine, model: rec.model, turnKind: rec.turnKind, recordedAt: rec.recordedAt,
        promptSha: rec.promptSha, source: 'recorded',
        note: `Recorded from a live run of the journey (scripts/record-fixtures.mjs, ${BASE.startsWith('http://localhost') || BASE.startsWith('http://127.') ? 'dev server' : 'test build'}).`,
        reply: rec.reply,
      };
      const why = unsafeFixture(file, { devices: JOURNEY_DEVICES, secrets });
      if (why) { console.log(`  NOT written ${key}: it holds ${why}`); continue; }
      writeFileSync(join(OUT, `${key}.json`), `${JSON.stringify(file, null, 1)}\n`);
      expected.delete(key);
      wrote += 1;
      console.log(`  wrote ${key}.json`);
    }
    missing = [...expected].filter((k) => {
      try { return JSON.parse(readFileSync(join(OUT, `${k}.json`), 'utf8')).source !== 'recorded'; } catch { return true; }
    });
    console.log(`\nRecorded ${wrote} repl${wrote === 1 ? 'y' : 'ies'}.${missing.length ? ` Still hand-written: ${missing.join(', ')}.` : ''}`);
  } finally {
    await page.close().catch(() => undefined);
    if (process.env.CHROME_CDP) browser.disconnect(); else await browser.close();
  }
  // The fixtures must still pass their checks, and none may be left hand-written.
  const t = spawnSync('npx', ['vitest', 'run', 'tests/fixtures/fixtureShape.test.ts'], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, MC_REQUIRE_RECORDED: '1' } });
  console.log('\nNext: read `git diff tests/fixtures/replies/` for anything personal, then run `npm run e2e`.');
  return missing.length || t.status !== 0 ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
