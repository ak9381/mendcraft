// e2e-gestures.mjs — the button gestures end to end, no camera: opens
// canvas.html?sim=1&hands=0, asks for a floor plan (a real review opens), turns
// the gesture layer on through the sim hook, and feeds synthetic hand frames
// through the REAL classifier → 2 s hold engine → button path. Asserts:
//   - a right thumbs-up held 1 s does nothing; held 2 s approves the review;
//   - a left thumbs-up held 2 s presses Save;
//   - an open palm highlights the nearest button, and a right thumbs-up then
//     presses it;
//   - badges are only on screen while the gesture layer is on;
//   - through the REAL camera path (canvasHands adapter → inputs → the shared
//     shape read → hand pointer + gestures): a held thumbs-up approves with
//     no pan / zoom / board move, both thumbs up open the AI monitor with no
//     zoom, and a hand that leaves mid-hold cancels it (no fire on return)
//     and clears the light-up, HUD and highlight;
//   - while a review is open, Save (left thumbs-up) waits behind it;
//   - peace-and-move (camera path, real hand scale): scrolls the element under
//     the hand (content follows the hand) and never fires the peace hold; a
//     still peace still fires its button after 2 s; a scroll stops dead when
//     the hand is lost; nothing scrolls while not facing; over a level
//     control it steps the level (90 px up = 3 steps) instead; over nothing
//     scrollable it pans the canvas.
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
      window.__litAfterHold = !!document.querySelector('.mc-review-approve.mc-gesture-target');
      return fired;
    }, spec, from, ms);
    // The same, but through the camera path (g.presence): every frame goes
    // canvasHands adapter → canvasInputs → onHandFrame, like a real camera.
    const presenceHold = (spec, from, ms) => page.evaluate((spec, from, ms) => {
      const g = window.__mcGestures;
      const hands = spec.map(([shape, side, opts]) => g.hand(shape, side, opts));
      for (let t = from; t <= from + ms; t += 33) g.presence(hands, t);
      return g.state();
    }, spec, from, ms);
    const presenceEmpty = (from, ms) => page.evaluate((from, ms) => {
      const g = window.__mcGestures;
      for (let t = from; t <= from + ms; t += 33) g.presence([], t);
      return g.state();
    }, from, ms);
    const boards = () => page.evaluate(() => JSON.stringify(window.__canvas.snapshot().frames.map((f) => f.rect)));
    const overlaysClear = () => page.evaluate(() => ({
      lit: document.querySelectorAll('.mc-gesture-target').length,
      hud: !document.querySelector('.mc-gesture-hud')?.hidden,
      ring: !document.querySelector('.mc-highlight-layer')?.hidden,
    }));
    const release = (from) => page.evaluate((from) => { const g = window.__mcGestures; for (let t = from; t <= from + 600; t += 33) g.feed([], t); }, from);
    const visible = (sel) => page.evaluate((sel) => { const el = document.querySelector(sel); if (!el || el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }, sel);

    check(!(await visible('.mc-gesture-badge:not([hidden])')), 'no badges while Hands is off');
    await page.evaluate(() => window.__mcGestures.show(true));
    await wait(400);
    const badgeCount = await page.evaluate(() => [...document.querySelectorAll('.mc-gesture-badge')].filter((b) => !b.hidden).length);
    check(badgeCount >= 3, `badges on the bound buttons while Hands is on (${badgeCount})`);
    const undoBadge = await page.evaluate(() => {
      const u = document.querySelector('.mc-hand-cluster .mc-cluster-undo');
      const b = document.querySelector('.mc-gesture-badge[data-key="L:thumbsDown"]');
      return !!u && u.getBoundingClientRect().width > 0 && !!b && !b.hidden;
    });
    check(undoBadge, 'an always-visible Undo in the hand cluster carries the left thumbs-down badge');

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
    // M2: the review is modal — a left thumbs-up (Save) waits behind it.
    const blockedSave = await holdShape([['thumbsUp', 'L']], t - 5000, 2100);
    const st0 = await page.evaluate(() => document.querySelector('.mc-canvas-status')?.textContent ?? '');
    check(blockedSave === 'L:thumbsUp' && !/^Saved/.test(st0) && await visible('.mc-review-approve'), `Save waits while the review is open ("${st0}")`);
    await release(t - 2800);
    const short = await holdShape([['thumbsUp', 'R']], t, 1000);
    check(short === null && await visible('.mc-review-approve'), 'a 1 s thumbs-up does not approve');
    const lit = await page.evaluate(() => window.__litAfterHold);
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
    // C2: through the camera path — hold 1.5 s, the hand leaves, comes back
    // at the same spot: the old hold is gone (no instant fire), and the
    // overlays cleared while it was away.
    await presenceHold([['thumbsUp', 'R']], t, 1500);
    const litBefore = await overlaysClear();
    check(litBefore.lit === 1 && litBefore.hud, 'camera path: Approve lights up during the hold');
    await presenceEmpty(t + 1533, 1200);
    const away = await overlaysClear();
    check(away.lit === 0 && !away.hud && !away.ring, `hand gone: light-up, HUD and highlight clear within 1.2 s (${JSON.stringify(away)})`);
    await presenceHold([['thumbsUp', 'R']], t + 2766, 600);
    check(await visible('.mc-review-approve'), 'the hand returns mid-way: no fire (the old hold did not survive)');
    // …and if frames simply STOP (no empty frames either), a wall-clock timeout clears it.
    await presenceHold([['thumbsUp', 'R']], t + 3400, 900);
    await wait(700);
    const stalled = await overlaysClear();
    check(stalled.lit === 0 && !stalled.hud, `frames stop: the light-up clears on its own (${JSON.stringify(stalled)})`);
    await presenceEmpty(t + 4400, 600);
    t += 6000;
    // C1: the held thumbs-up goes through the hand pointer too — and is never a fist.
    const cam0 = await page.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
    const boards0 = await boards();
    let grabbed = false;
    // 1.9 s of the hold (not yet fired): nothing may have moved.
    for (let k = 0; k < 6; k++) { const st = await presenceHold([['thumbsUp', 'R']], t + k * 330, 300); grabbed = grabbed || st.grab; }
    const approvedState = await page.evaluate(() => window.__mcGestures.state());
    const boards1 = await boards();
    check(await visible('.mc-review-approve'), 'camera path: not approved before 2 s');
    // …then the last stretch fires it (approval itself may re-fit the camera).
    await presenceHold([['thumbsUp', 'R']], t + 6 * 330, 400);
    check(!grabbed && JSON.stringify(approvedState.camera) === cam0 && boards1 === boards0,
      `a held thumbs-up never grabs: no pan, no zoom, no board move (grab ${grabbed}; camera ${cam0} → ${JSON.stringify(approvedState.camera)}; boards ${boards0} → ${boards1})`);
    t += 2500;
    check(await waitFor(page, () => { const d = document.querySelector('.mc-review-dialog'); return !d || d.hidden; }, 5000), 'the review closed');
    const kept = await page.evaluate(() => {
      const doc = window.__canvas.snapshot();
      return doc.frames.some((f) => { const p = doc.surfaces[f.id]; return p && (p.kind === 'plan' || JSON.stringify(p).includes('"plan"')); });
    });
    check(kept, 'the floor plan was approved (kept on its board)');
    const logged = await page.evaluate(() => document.querySelector('.mc-ai-live-log')?.textContent ?? '');
    check(/Gesture\s*Right thumbs up → Approve/.test(logged), 'the activity log says the gesture approved it');

    // C1 (two hands): both thumbs up = AI monitor, and never a two-fist zoom.
    await presenceEmpty(t, 600);
    t += 700;
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return {}; }; });
    const camB = await page.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
    const boardsB = await boards();
    let grabbedB = false;
    for (let k = 0; k < 8; k++) { const st = await presenceHold([['thumbsUp', 'L'], ['thumbsUp', 'R']], t + k * 330, 300); grabbedB = grabbedB || st.grab; }
    const opened = await page.evaluate(() => window.__opened);
    const camB2 = await page.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
    check(opened.some((u) => /monitor/.test(u)), `both thumbs up opened the AI monitor (${JSON.stringify(opened)})`);
    check(!grabbedB && camB === camB2 && await boards() === boardsB, 'both thumbs up never zoom, pan or move a board');
    await presenceEmpty(t + 2700, 600);
    t += 3500;

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

    // 5) Peace-and-move: scroll, levels, canvas pan — all through the camera path.
    t += 5000;
    await presenceEmpty(t, 600);
    t += 700;
    await page.evaluate(() => {
      const root = document.querySelector('.mc-canvas');
      document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded') === 'true' && document.querySelector('.mc-tools-chip').click();
      const sc = document.createElement('div');
      sc.id = 'e2e-scroller';
      sc.style.cssText = 'position:fixed;left:300px;top:200px;width:400px;height:300px;overflow:auto;z-index:45;background:#fff';
      sc.innerHTML = '<div style="height:2400px;background:linear-gradient(#fff,#ccc)">long list</div>';
      root.append(sc);
      sc.scrollTop = 900;
      const lv = document.createElement('div');
      lv.id = 'e2e-level';
      lv.setAttribute('data-level', 'volume');
      lv.setAttribute('aria-valuenow', '50'); lv.setAttribute('aria-valuemin', '0'); lv.setAttribute('aria-valuemax', '100');
      lv.style.cssText = 'position:fixed;left:300px;top:560px;width:300px;height:140px;z-index:45;background:#eee;display:flex;gap:20px;align-items:center;justify-content:center';
      lv.innerHTML = '<button data-level-dec>−</button><span>Volume</span><button data-level-inc>+</button>';
      const set = (d) => lv.setAttribute('aria-valuenow', String(Math.max(0, Math.min(100, Number(lv.getAttribute('aria-valuenow')) + d))));
      lv.querySelector('[data-level-inc]').addEventListener('click', () => set(10));
      lv.querySelector('[data-level-dec]').addEventListener('click', () => set(-10));
      root.append(lv);
    });
    // Move a peace from screen (x, y0) to (x, y1) over `ms`, then hold it at y1 for `holdMs`.
    const peaceMove = (side, x, y0, y1, from, ms, holdMs = 0) => page.evaluate((side, x, y0, y1, from, ms, holdMs) => {
      const g = window.__mcGestures;
      const n = Math.max(1, Math.round(ms / 33));
      for (let k = 0; k <= n; k++) g.presence([g.hand('peace', side, { at: g.palmFor(x, y0 + ((y1 - y0) * k) / n) })], from + k * 33);
      for (let tt = 33; tt <= holdMs; tt += 33) g.presence([g.hand('peace', side, { at: g.palmFor(x, y1) })], from + n * 33 + tt);
      return { scrollTop: document.querySelector('#e2e-scroller').scrollTop, hint: !document.querySelector('.mc-scroll-hint')?.hidden };
    }, side, x, y0, y1, from, ms, holdMs);
    const openHand = (from, ms) => page.evaluate((from, ms) => {
      const g = window.__mcGestures;
      for (let tt = 0; tt <= ms; tt += 33) g.presence([g.hand('open', 'R', { at: { x: 0.68, y: 0.95 } })], from + tt);
    }, from, ms);
    const log = () => page.evaluate(() => document.querySelector('.mc-ai-live-log')?.textContent ?? '');
    const log0 = await log();

    // A. Peace over the scroller moving DOWN: the list follows the hand (scrollTop falls).
    const scrolled = await peaceMove('R', 500, 260, 440, t, 600);
    check(scrolled.scrollTop < 900 - 150 && scrolled.hint, `peace + downward motion scrolls the list under the hand (scrollTop 900 → ${Math.round(scrolled.scrollTop)}, hint ${scrolled.hint})`);
    // …then held still for 2.3 s: the peace hold (R = next step 2) must NOT fire.
    const held = await peaceMove('R', 500, 440, 440, t + 700, 0, 2300);
    const log1 = await log();
    check(!/Right peace/.test(log1.replace(log0, '')) && Math.abs(held.scrollTop - scrolled.scrollTop) < 30, 'after scrolling, the still peace never fires its hold (no "Next step 2")');
    // B. Hand lost mid-scroll: stops dead, no glide.
    await openHand(t + 3100, 400);
    t += 4000;
    await peaceMove('R', 500, 260, 400, t, 400);
    await presenceEmpty(t + 450, 100);
    const atLoss = await page.evaluate(() => document.querySelector('#e2e-scroller').scrollTop);
    await wait(400);
    const after = await page.evaluate(() => document.querySelector('#e2e-scroller').scrollTop);
    check(Math.abs(after - atLoss) < 1, `scroll stops on hand loss (${Math.round(atLoss)} → ${Math.round(after)})`);
    await presenceEmpty(t + 600, 400);
    await openHand(t + 1100, 300);
    t += 2000;
    // C. Not facing: nothing scrolls.
    await page.evaluate(() => window.__mcGestures.facing(false));
    await wait(350);
    const before = await page.evaluate(() => document.querySelector('#e2e-scroller').scrollTop);
    const turned = await peaceMove('R', 500, 260, 440, t, 600);
    check(Math.abs(turned.scrollTop - before) < 1, 'no scroll while not facing');
    await page.evaluate(() => window.__mcGestures.facing(null));
    await openHand(t + 700, 300);
    t += 1500;
    // D. A still LEFT peace for 2.2 s still fires its button (Tools).
    const toolsBefore = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    await page.evaluate((from) => {
      const g = window.__mcGestures;
      const h = g.hand('peace', 'L', { at: { x: 0.3, y: 0.75 } });
      for (let tt = 0; tt <= 2300; tt += 33) g.presence([h], from + tt);
    }, t);
    const toolsAfter = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    check(toolsBefore !== toolsAfter && /Left peace → Tools/.test(await log()), `a still peace still fires its button after 2 s (Tools ${toolsBefore} → ${toolsAfter})`);
    if (toolsAfter === 'true') await page.evaluate(() => document.querySelector('.mc-tools-chip').click());
    await openHand(t + 2400, 300);
    t += 3000;
    // E. Over a level control: 90 px up = 3 steps up, no scroll, no hold.
    const log2 = await log();
    const sc0 = await page.evaluate(() => document.querySelector('#e2e-scroller').scrollTop);
    const tools0 = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    await peaceMove('R', 450, 660, 660 - 90.5, t, 300, 2300);
    const lv = await page.evaluate(() => ({
      value: document.querySelector('#e2e-level').getAttribute('aria-valuenow'),
      readout: document.querySelector('.mc-level-readout')?.textContent ?? '',
    }));
    const tools1 = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    const sc1 = await page.evaluate(() => document.querySelector('#e2e-scroller').scrollTop);
    const newLog = (await log()).replace(log2, '');
    check(lv.value === '80', `peace over a level control moving up 90 px → 3 steps (50 → ${lv.value})`);
    check(/Volume 80 %/.test(lv.readout), `big level readout by the hand ("${lv.readout}")`);
    check(sc1 === sc0 && tools1 === tools0 && !/Right peace/.test(newLog), 'stepping a level never scrolls and never fires the peace hold');
    await openHand(t + 2700, 300);
    t += 3200;
    // F. Over nothing scrollable: the canvas pans (content follows the hand).
    const spot = await page.evaluate(() => {
      for (let y = 760; y > 120; y -= 40) for (let x = 1400; x > 80; x -= 40) {
        const el = document.elementFromPoint(x, y);
        if (el && el.matches('.mc-viewport, .mc-world, .mc-canvas') && document.elementFromPoint(x, y + 150)?.matches('.mc-viewport, .mc-world, .mc-canvas')) return { x, y };
      }
      return null;
    });
    if (spot) {
      const cam0 = await page.evaluate(() => window.__mcGestures.state().camera);
      await page.evaluate((spot, from) => {
        const g = window.__mcGestures;
        for (let k = 0; k <= 20; k++) g.presence([g.hand('peace', 'R', { at: g.palmFor(spot.x, spot.y + k * 7.5) })], from + k * 33);
      }, spot, t);
      const cam1 = await page.evaluate(() => window.__mcGestures.state().camera);
      check(cam1.y < cam0.y - 50, `peace over bare canvas pans it (camera y ${Math.round(cam0.y)} → ${Math.round(cam1.y)})`);
    } else check(false, 'found a bare-canvas spot for the pan check');
    await openHand(t + 800, 300);
    await page.evaluate(() => { document.querySelector('#e2e-scroller')?.remove(); document.querySelector('#e2e-level')?.remove(); });

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
