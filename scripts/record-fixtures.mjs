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
// With ?sim=1 the devices and phones are the SIM fixtures the replay uses, so a
// reply can only name fixture ids; replies are redacted in the page like cloud
// prompts (names, numbers, emails) and checked again here: nothing that looks
// like a key, a token, an address or an email is ever written, and nothing
// from .env.local. Review `git diff tests/fixtures/replies/` by eye after.
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

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const OUT = join(ROOT, 'tests/fixtures/replies');
const PROFILE = process.env.RECORD_PROFILE || join(homedir(), '.mendcraft-record-chrome');

/** Live turns are slow (a cold Nano load is up to ~45 s). */
const TURN_MS = 120_000;

const FORBIDDEN = [
  ['an API key', /AIza[0-9A-Za-z_-]{20,}/],
  ['a bearer or access token', /\b(?:Bearer\s+[A-Za-z0-9._-]{16,}|ya29\.[A-Za-z0-9._-]+|access_token|refresh_token)/i],
  ['an email address', /\b[A-Za-z0-9][\w.+-]*@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b/],
  ['an IP address', /\b(?:\d{1,3}\.){3}\d{1,3}\b/],
  ['a MAC address', /\b[0-9a-f]{2}(?::[0-9a-f]{2}){5}\b/i],
  ['a long hex secret', /\b[0-9a-f]{32,}\b/i],
];
/** Every value in .env.local (keys, ids, tokens): none may reach a fixture. */
function envSecrets() {
  const p = join(ROOT, '.env.local');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').map((l) => l.replace(/^[^=]*=/, '').trim().replace(/^["']|["']$/g, '')).filter((v) => v.length >= 8);
}
/** Why this text must not be written, or null. */
function unsafe(text, secrets) {
  for (const [what, re] of FORBIDDEN) if (re.test(text)) return what;
  if (secrets.some((s) => text.includes(s))) return 'a value from .env.local';
  return null;
}

function findChrome() {
  return [
    process.env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
  ].filter(Boolean).find((p) => existsSync(p));
}

const reviewOpen = () => { const d = document.querySelector('.mc-review-dialog'); return !!d && !d.hidden; };

async function main() {
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('record: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`record: nothing at ${BASE} (start npx vite, or set E2E_URL).`); return 2; }
  const secrets = envSecrets();
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
      if (!l.review) { await new Promise((r) => setTimeout(r, 8_000)); continue; }
      const r = await pollUntil(() => page.evaluate(reviewOpen), TURN_MS);
      if (!r.ok) { console.log(`  no review: ${JSON.stringify(await page.evaluate((m) => window.__mcCanvas.statusSince(m), mark))}`); continue; }
      await page.evaluate(() => window.__mcCanvas.keep());
      await new Promise((res) => setTimeout(res, 4_000)); // the next-step turn that follows an approval
      if (l.offline) await page.evaluate(() => { const b = document.querySelector('[data-cmd=offline]'); if (b?.getAttribute('aria-pressed') === 'true') b.click(); });
    }
    await new Promise((res) => setTimeout(res, 10_000));
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
      const why = unsafe(JSON.stringify(file), secrets);
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
