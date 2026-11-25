// e2e-gestures.mjs — the button gestures end to end, no camera: opens
// canvas.html?sim=1&hands=0, asks for a floor plan (a real review opens), turns
// the gesture layer on through the sim hook, and feeds synthetic hand frames
// through the REAL classifier → 2 s hold engine → button path. Asserts:
//   - a right thumbs-up held 1 s does nothing; held 2 s approves the review;
//   - a left thumbs-up held 2 s presses Save;
//   - an open palm highlights the nearest button, and a right thumbs-up then
//     presses it;
//   - badges are only on screen while the gesture layer is on.
//
//   npx vite --port 5173 &
//   E2E_URL=http://localhost:5173 node scripts/e2e-gestures.mjs
//
// Same stack as e2e-journey.mjs: puppeteer-core + an installed Chrome.

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(page, fn, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(fn).catch(() => false)) return true;
    await wait(200);
  }
  return false;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-gestures: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-gestures: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-gestures: no dev server at ${BASE}.`); return 2; }

  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.message || e)));
    await page.goto(`${BASE}/canvas.html?sim=1&hands=0`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check(await waitFor(page, () => !!window.__mcGestures && !!window.__canvas), 'sim gesture hook is up');

    // Hold a shape for `ms` (synthetic clock), one frame every 33 ms.
    const holdShape = (spec, from, ms) => page.evaluate((spec, from, ms) => {
      const g = window.__mcGestures;
      const hands = spec.map(([shape, side, opts]) => g.hand(shape, side, opts));
      let fired = null;
      for (let t = from; t <= from + ms; t += 33) { const s = g.feed(hands, t); if (s.fired) fired = s.fired; }
      return fired;
    }, spec, from, ms);
    const release = (from) => page.evaluate((from) => { const g = window.__mcGestures; for (let t = from; t <= from + 600; t += 33) g.feed([], t); }, from);
    const visible = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el || el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);

    check(!(await visible('.mc-gesture-badge:not([hidden])')), 'no badges while Hands is off');
    await page.evaluate(() => window.__mcGestures.show(true));
    await wait(400);
    const badgeCount = await page.evaluate(() => [...document.querySelectorAll('.mc-gesture-badge')].filter((b) => !b.hidden).length);
    check(badgeCount >= 3, `badges on the bound buttons while Hands is on (${badgeCount})`);

    // 1) A review: ask for a floor plan.
    await page.evaluate(() => {
      const i = document.querySelector('#mc-say-in');
      i.value = 'draw the floor plan';
      document.querySelector('.mc-say').requestSubmit();
    });
    check(await waitFor(page, () => { const b = document.querySelector('.mc-review-approve'); return !!b && !b.closest('[hidden]') && b.getBoundingClientRect().width > 0; }, 30_000), 'the floor plan review is open');
    await wait(500);
    const approveBadge = await page.evaluate(() => { const b = document.querySelector('.mc-gesture-badge[data-key="R:thumbsUp"]'); return !!b && !b.hidden; });
    check(approveBadge, 'Approve carries the right thumbs-up badge');

    let t = 10_000;
    const short = await holdShape([['thumbsUp', 'R']], t, 1000);
    check(short === null && await visible('.mc-review-approve'), 'a 1 s thumbs-up does not approve');
    const lit = await page.evaluate(() => document.querySelector('.mc-review-approve')?.classList.contains('mc-gesture-target'));
    check(!!lit, 'Approve lights up while the thumbs-up is held');
    await release(t + 1100);
    t += 2000;
    const moving = await page.evaluate((from) => {
      const g = window.__mcGestures; let fired = null;
      for (let k = 0; k <= 90; k++) { const s = g.feed([g.hand('thumbsUp', 'R', { at: { x: 0.45 + k * 0.004, y: 0.7 } })], from + k * 33); if (s.fired) fired = s.fired; }
      return fired;
    }, t);
    check(moving === null, 'a thumbs-up moving across the frame never fires');
    await release(t + 3100);
    t += 4000;
    const fired = await holdShape([['thumbsUp', 'R']], t, 2100);
    check(fired === 'R:thumbsUp', `a 2 s right thumbs-up fires (${fired})`);
    check(await waitFor(page, () => { const d = document.querySelector('.mc-review-dialog'); return !d || d.hidden; }, 5000), 'the review closed');
    const kept = await page.evaluate(() => {
      const doc = window.__canvas.snapshot();
      return doc.frames.some((f) => { const p = doc.surfaces[f.id]; return p && (p.kind === 'plan' || JSON.stringify(p).includes('"plan"')); });
    });
    check(kept, 'the floor plan was approved (kept on its board)');
    const logged = await page.evaluate(() => document.querySelector('.mc-ai-live-log')?.textContent ?? '');
    check(/Gesture\s*Right thumbs up → Approve/.test(logged), 'the activity log says the gesture approved it');

    // 2) Left thumbs-up = Save (the button lives in the closed Tools palette).
    await release(t + 2200);
    t += 3000;
    const save = await holdShape([['thumbsUp', 'L']], t, 2100);
    const status = await page.evaluate(() => document.querySelector('.mc-canvas-status')?.textContent ?? '');
    check(save === 'L:thumbsUp' && /^Saved/.test(status), `left thumbs-up saves ("${status}")`);

    // 3) Open palm → highlight → right thumbs-up presses it.
    await release(t + 2200);
    t += 3000;
    const hi = await page.evaluate((from) => {
      const g = window.__mcGestures;
      // Aim the palm at the Tools chip: map its centre back into camera space.
      const r = document.querySelector('.mc-tools-chip').getBoundingClientRect();
      const at = g.palmFor(r.left + r.width / 2, r.top + r.height / 2);
      for (let k = 0; k <= 30; k++) g.feed([g.hand('open', 'R', { at })], from + k * 33);
      const h = g.highlighted();
      return { name: h?.textContent?.trim() ?? null, label: document.querySelector('.mc-highlight-label')?.textContent ?? '' };
    }, t);
    check(hi.name === 'Tools', `an open palm highlights the nearest button (${hi.name})`);
    check(/Tools/.test(hi.label), `the highlighted button shows its name large ("${hi.label}")`);
    const pressed = await holdShape([['thumbsUp', 'R', { at: { x: 0.68, y: 0.7 } }]], t + 1100, 2100);
    const toolsOpen = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    check(pressed === 'R:thumbsUp' && toolsOpen === 'true', `right thumbs-up pressed the highlighted Tools (open: ${toolsOpen})`);

    // 4) Badges go away with Hands.
    await page.evaluate(() => window.__mcGestures.show(false));
    await wait(200);
    check(!(await visible('.mc-gesture-badge:not([hidden])')), 'badges hide when Hands goes off');
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(failures.length ? `\ne2e-gestures: ${failures.length} failure(s)` : '\ne2e-gestures: passed');
  return failures.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('e2e-gestures — error:', e?.stack || e); process.exit(1); });
