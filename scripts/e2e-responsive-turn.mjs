// e2e-responsive-turn.mjs — the page must stay responsive while a board turn
// runs. Runs canvas.html?sim=1&hands=0&fresh=1 (scripted engines, SIM
// labelled), watches the main thread with a 20 ms heartbeat and the
// long-animation-frame observer, and runs "connect everything in this room"
// twice: once with the usual scripted replies, once with a slow scripted
// engine (long padded replies streamed in many small chunks). Fails if any
// single main-thread block is longer than MAX_BLOCK_MS, and checks that a
// plain page.evaluate still answers quickly in the middle of the turn (the
// live freeze showed up as DevTools Runtime.evaluate timing out).
//
//   npx vite --port 5173 &
//   E2E_URL=http://localhost:5173 node scripts/e2e-responsive-turn.mjs

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const MAX_BLOCK_MS = 500;

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
  if (!chrome) { console.error('e2e-responsive-turn: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-responsive-turn: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-responsive-turn: no dev server at ${BASE} (start one: npx vite).`); return 2; }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.message || e)));
    await page.goto(`${BASE}/canvas.html?sim=1&hands=0&fresh=1`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForFunction(() => !!window.__canvas && !!window.__mcScripts, { timeout: 20_000 });
    await sleep(1500);

    const reviewOpen = () => !!document.querySelector('.mc-proposal-keep');
    const waitFor = async (fn, ms, what) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await page.evaluate(fn).catch(() => false)) return true; await sleep(200); }
      check(false, `timed out: ${what}`);
      return false;
    };
    const watch = () => page.evaluate(() => {
      const w = { maxGap: 0, loaf: [] };
      window.__resp = w;
      let last = performance.now();
      w.hb = setInterval(() => { const n = performance.now(); w.maxGap = Math.max(w.maxGap, n - last); last = n; }, 20);
      try {
        w.obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) w.loaf.push({ ms: Math.round(e.duration), blocking: Math.round(e.blockingDuration ?? 0), src: (e.scripts || []).slice(0, 2).map((s) => `${s.invoker} ${(s.sourceURL || '').split('/').pop()}:${s.sourceFunctionName}`).join(' ; ') }); });
        w.obs.observe({ type: 'long-animation-frame' });
      } catch { /* older Chrome: the heartbeat alone */ }
    });
    const stopWatch = () => page.evaluate(() => {
      const w = window.__resp; clearInterval(w.hb); w.obs?.disconnect();
      return { maxGap: Math.round(w.maxGap), worst: w.loaf.sort((a, b) => b.blocking - a.blocking).slice(0, 3) };
    });

    const turn = async (label) => {
      await watch();
      const t0 = Date.now();
      await page.evaluate(() => window.__canvas.run('connect everything in this room'));
      // Mid-turn: a plain evaluate must come back at once.
      await sleep(400);
      const e0 = Date.now();
      await page.evaluate(() => 1);
      const evalMs = Date.now() - e0;
      if (!(await waitFor(reviewOpen, 90_000, `${label}: review`))) return;
      const r = await stopWatch();
      console.log(`     ${label}: review after ${Date.now() - t0} ms, max heartbeat gap ${r.maxGap} ms, worst frames ${JSON.stringify(r.worst)}`);
      check(evalMs < 1000, `${label}: an evaluate mid-turn answers in ${evalMs} ms`);
      check(r.maxGap < MAX_BLOCK_MS, `${label}: the main thread is never blocked ${MAX_BLOCK_MS} ms or more (max gap ${r.maxGap} ms)`);
      check(r.worst.every((f) => f.blocking < MAX_BLOCK_MS), `${label}: no long animation frame blocks ${MAX_BLOCK_MS} ms or more`);
      await page.evaluate(() => window.__canvas.drop?.() ?? window.__canvas.keep());
      await waitFor(() => !document.querySelector('.mc-proposal-keep'), 10_000, `${label}: review closed`);
      await sleep(800);
    };

    await turn('usual replies');

    // A slow engine: long replies (whitespace-padded, still valid JSON) in many small chunks.
    await page.evaluate(() => {
      const pad = (json) => json.replace(/,/g, ',' + ' '.repeat(400));
      window.__mcScripts.nanoRoom = pad(window.__mcScripts.nanoRoom);
      window.__mcScripts.geminiRoom = pad(window.__mcScripts.geminiRoom);
    });
    await turn('slow padded replies');

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nall checks passed');
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code), (e) => { console.error(e); process.exit(1); });
