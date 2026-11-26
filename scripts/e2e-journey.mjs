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
    // Three separate boards: Connected devices (a local table), the dashboard
    // (no plan tile on it), and the floor plan on its own board.
    check(end.boards.some((b) => b.title === 'Connected devices' && hasTile(b, (t) => t.type === 'table')), 'Connected devices board exists');
    check(!end.boards.some((b) => b.plan?.kind === 'room' && hasTile(b, (t) => t.type === 'plan')), 'no dashboard holds a floor-plan tile');
    check(end.boards.some((b) => b.title === 'Floor plan' && b.plan?.kind === 'plan' && !hasTile(b, (t) => t.type === 'lamp')), 'the floor plan is its own "Floor plan" board');
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

    await planEditByVoice(browser, errors);
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

// ---- a typed edit to the kept floor plan: a review, Approve, Undo ----------
// canvas.html?sim=1&hands=0: "draw the floor plan" → Approve, then "add a
// study next to bedroom 2" on that board must open a REVIEW (never a chat
// reply), whose plan shows the Study; Approve adds it to the drawing and
// Undo takes it back. Offline, the same ask says it is Nano's draft, and
// Reject changes nothing.
async function planEditByVoice(browser, errors) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (e) => errors.push(`${String(e?.message || e)} (during plan edit)`));
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (fn, ms = 20_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await page.evaluate(fn).catch(() => false)) return true; await wait(200); }
    return false;
  };
  const sayIt = (text) => page.evaluate((t) => { const i = document.querySelector('#mc-say-in'); i.value = t; document.querySelector('.mc-say').requestSubmit(); }, text);
  const reviewOpen = () => { const b = document.querySelector('.mc-review-approve'); return !!b && !b.closest('[hidden]') && b.getBoundingClientRect().width > 0; };
  const rooms = () => page.evaluate(() => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).map((r) => r.name));
  try {
    await page.goto(`${BASE}/canvas.html?sim=1&hands=0`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check(await waitFor(() => !!window.__canvas), 'plan edit: canvas is up');
    await sayIt('draw the floor plan');
    check(await waitFor(reviewOpen, 30_000), 'plan edit: the floor plan review is open');
    await page.evaluate(() => document.querySelector('.mc-review-approve').click());
    check(await waitFor(() => !!document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc && !document.querySelector('.mc-review-approve')?.getBoundingClientRect().width), 'plan edit: the two-bedroom plan is kept on its board');
    await wait(600);
    const start = await rooms();
    check(start.includes('Bedroom 2') && !start.includes('Study'), `plan edit: starts with Bedroom 2 and no Study (${start.join(', ')})`);

    await sayIt('add a study next to bedroom 2');
    check(await waitFor(reviewOpen, 20_000), 'plan edit: "add a study next to bedroom 2" opens a review (not a chat reply)');
    const review = await page.evaluate(() => ({
      title: document.querySelector('.mc-review-title')?.textContent ?? '',
      plan: document.querySelector('.mc-review-plan-list')?.textContent ?? '',
      engine: document.querySelector('.mc-review-dialog')?.textContent ?? '',
    }));
    check(/Study/.test(review.title) && /Study/.test(review.plan), `plan edit: the review shows the Study in its plan ("${review.title}" · "${review.plan.replace(/\s+/g, ' ').slice(0, 90)}")`);
    check(/SIM/.test(review.engine) && /Nano/.test(review.engine), 'plan edit: the review says SIM · Nano made it');
    check(!(await rooms()).includes('Study'), 'plan edit: nothing changed before Approve');
    await page.evaluate(() => document.querySelector('.mc-review-approve').click());
    check(await waitFor(() => (document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).some((r) => r.name === 'Study')), 'plan edit: Approve adds a Study room to the drawing');
    const after = await rooms();
    check(after.length === start.length + 1 && start.every((n) => after.includes(n)), `plan edit: every other room is still there (${after.join(', ')})`);

    await sayIt('undo');
    check(await waitFor(() => !(document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc?.().rooms ?? []).some((r) => r.name === 'Study')), 'plan edit: Undo takes the Study back out');

    await sayIt('simulate offline');
    await wait(400);
    await sayIt('add a study next to bedroom 2');
    check(await waitFor(reviewOpen, 20_000), 'plan edit offline: a review opens (Nano only)');
    const offline = await page.evaluate(() => document.querySelector('.mc-canvas-status')?.textContent ?? '');
    check(/You’re offline — this is Nano’s draft/.test(offline), `plan edit offline: says it is Nano's draft ("${offline.slice(0, 80)}")`);
    await page.evaluate(() => document.querySelector('.mc-review-reject').click());
    await wait(500);
    check(!(await rooms()).includes('Study'), 'plan edit offline: Reject changes nothing');

    await sayIt('add a garage next to the attic');
    await wait(1500);
    const said = await page.evaluate(() => document.querySelector('.mc-canvas-status')?.textContent ?? '');
    check(/couldn’t change the plan/.test(said) && !(await page.evaluate(reviewOpen)), `plan edit: an edit that can't be made says so plainly ("${said.slice(0, 70)}")`);
  } finally {
    await page.close().catch(() => {});
  }
}

main().then((c) => process.exit(c)).catch((e) => { console.error('e2e-journey — error:', e?.stack || e); process.exit(1); });
