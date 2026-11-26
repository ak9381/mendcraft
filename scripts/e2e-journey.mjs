// e2e-journey.mjs — the judge replay IS the end-to-end test. Opens
// canvas.html?replay=demo (implies sim=1&hands=0: scripted engines, SIM
// labelled, no camera) in headless Chrome against a running dev server, lets
// the product play its own journey (real run() commands, real reviews), and
// asserts the outcome. Exits non-zero on any failure.
//
//   npx vite --port 5173 &      # or any running dev server
//   E2E_URL=http://localhost:5173 npm run e2e
//
// Same stack as scripts/a11y-axe.mjs: puppeteer-core + an installed Chrome
// (CHROME_PATH wins). Its own throwaway profile; never a running Chrome.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const LIMIT_MS = 3 * 60_000;

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

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-journey: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-journey: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-journey: no dev server at ${BASE} (start one: npx vite).`); return 2; }

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: ['--no-sandbox', '--mute-audio', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check'],
  });
  const t0 = Date.now();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    let at = 'boot';
    page.on('pageerror', (e) => { errors.push(`${String(e?.message || e)} (during ${at})`); if (process.env.E2E_STACK) console.log(e?.stack); });
    page.on('console', (m) => { if (/^\[replay\]/.test(m.text())) console.log(`     ${m.text()}`); });
    await page.goto(`${BASE}/canvas.html?replay=demo`, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Progress: print each step as the banner moves on.
    let lastLog = 0;
    const deadline = t0 + LIMIT_MS + 15_000;
    let state = null;
    while (Date.now() < deadline) {
      state = await page.evaluate(() => {
        const r = window.__replay;
        return r ? { done: r.done, log: r.log.slice(), result: r.result } : null;
      }).catch(() => null);
      if (state) {
        const steps = state.log.filter((l) => l.startsWith('step '));
        if (steps.length) at = steps[steps.length - 1];
        for (const line of state.log.slice(lastLog)) console.log(`     ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${line}`);
        lastLog = state.log.length;
        if (state.done) break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    const wall = Date.now() - t0;
    check(!!state?.done, 'replay finished');
    const result = state?.result;
    if (!result) { check(false, 'replay produced a result'); return 1; }

    // Every step lands; only a step whose route isn't in this build may skip.
    for (const s of result.steps) {
      const tag = `${s.outcome.padEnd(7)} ${s.id} (${(s.ms / 1000).toFixed(1)} s)${s.note ? ` — ${s.note}` : ''}`;
      const fine = s.outcome === 'done' || (s.outcome === 'skipped' && s.id === 'point');
      check(fine, `step ${tag}`);
      if (!fine) for (const l of s.lines.slice(-6)) console.log(`       said: ${l}`);
    }
    check(result.ok, 'the whole journey played');

    const lines = result.steps.flatMap((s) => s.lines);
    check(!lines.some((l) => /isn[’']t a canvas command/i.test(l)), 'no "isn\'t a canvas command"');
    const shouldWork = new Set(['check', '3d', 'build', 'floorplan', 'kannada', 'online', 'save', 'music', 'send', 'point']);
    check(!result.steps.some((s) => shouldWork.has(s.id) && s.lines.some((l) => /^Nothing to\b/.test(l))), 'no "Nothing to …" on steps that should work');

    // Try to break it: refused, and the lamp is unchanged.
    const brk = result.steps.find((s) => s.id === 'break');
    check(!!brk?.lines.some((l) => /10 to 100 %.*Nothing changed/.test(l)), 'try-to-break shows the refusal');

    const end = await page.evaluate(() => {
      const c = window.__canvas;
      const doc = c.snapshot();
      const boards = doc.frames.map((f) => ({ title: f.title, plan: doc.surfaces[f.id] ?? null }));
      const lamps = c.store.all();
      const q = (s) => document.querySelector(s)?.textContent?.trim() ?? '';
      return {
        boards,
        lamps,
        ledger: q('.mc-ai-ledger-total'),
        footer: q('.mc-terminal-foot, .mc-ai-footer, .mc-footer'),
        engineBytes: q('.mc-engine-bytes'),
        simLabels: (document.body.innerText.match(/\bSIM\b/g) || []).length,
        failing: !!document.querySelector('.mc-terminal.is-failing, .is-failing'),
        url: location.search,
      };
    });
    const hasTile = (b, pred) => {
      const walk = (tiles) => (tiles || []).some((t) => pred(t) || walk(t.tiles) || walk(t.children));
      return walk(b.plan?.tiles);
    };
    check(end.url.includes('sim=1') && end.url.includes('hands=0'), `replay runs as sim=1&hands=0 (${end.url})`);
    check(end.boards.some((b) => b.plan?.kind === 'room' && /living room/i.test(b.title) && hasTile(b, (t) => t.type === 'lamp')), 'Living room dashboard exists');
    check(end.boards.some((b) => b.plan?.kind === 'plan' || hasTile(b, (t) => t.type === 'plan' && !/room-plan/.test(t.boardId || ''))), 'floor plan board exists');
    const pointRan = result.steps.find((s) => s.id === 'point')?.outcome === 'done';
    if (pointRan) check(end.boards.some((b) => /^Board/i.test(b.title) && hasTile(b, (t) => t.type === 'lamp')), 'a Board with a WiZ lamp exists');
    else console.log('     (point-to-connect not in this build: no "Board with a WiZ lamp" check)');
    const desk = end.lamps['wiz-desk'];
    check(!!desk && desk.brightness >= 10 && desk.brightness <= 100, `desk lamp unchanged by the refused 500 % (brightness ${desk?.brightness})`);
    const num = end.ledger.match(/(\d+(?:\.\d+)?)\s*(B|KB|MB)\b/);
    check(/\d+ AI turns?/.test(end.ledger) && !!num, `ledger total is a real number ("${end.ledger}")`);
    // SIM: scripted turns send nothing — the ledger and the engine bar say what
    // they WOULD send, labelled SIM, and never claim real bytes left.
    check(!/sent to (Gemini|cloud)/i.test(end.ledger) && /SIM · would send \d/.test(end.ledger), `SIM ledger books no real bytes ("${end.ledger}")`);
    check(!/[1-9][\d.]* ?(B|KB|MB) sent to cloud/.test(end.engineBytes) && /SIM · would send/.test(end.engineBytes), `engine bar shows SIM would-send, not real bytes ("${end.engineBytes}")`);
    check(end.simLabels > 0, `SIM labels on screen (${end.simLabels})`);
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
    check(wall < LIMIT_MS, `completed in ${(wall / 1000).toFixed(1)} s (< 180 s); replay ${(result.ms / 1000).toFixed(1)} s`);
    if (failures.length) {
      const shot = join(tmpdir(), 'e2e-journey-failure.png');
      await page.screenshot({ path: shot }).catch(() => {});
      console.log(`     screenshot: ${shot}`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(failures.length ? `\ne2e-journey: ${failures.length} failure(s)` : `\ne2e-journey: passed in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return failures.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('e2e-journey — error:', e?.stack || e); process.exit(1); });
