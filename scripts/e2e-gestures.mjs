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
//     no pan / zoom / board move, both thumbs up open the More menu with no
//     zoom, and a hand that leaves mid-hold cancels it (no fire on return)
//     and clears the light-up, HUD and highlight;
//   - while a review is open, Save (left thumbs-up) waits behind it;
//   - peace-and-move (camera path, real hand scale): scrolls the element under
//     the hand scroll-wheel style (hand down = scroll down) and never fires
//     the peace hold; a still — or slowly drifting — peace still fires its
//     button after 2 s; a scroll stops dead when the hand is lost; nothing
//     scrolls while not facing; over a level control it steps the level
//     (90 px up after the start = 3 steps) instead; over nothing scrollable
//     it pans the canvas; a second peace after a scroll is Register, never
//     one hand's Tools.
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
    // Badges sit at each button's top-left corner: never over its label.
    const placement = await page.evaluate(() => {
      document.querySelector('.mc-tools-chip').click(); // open Tools so the bar's badges show
      return new Promise((res) => setTimeout(() => {
        const bad = [];
        for (const b of document.querySelectorAll('.mc-gesture-badge')) {
          if (b.hidden) continue;
          const key = b.dataset.key;
          const br = b.getBoundingClientRect();
          // the bound button: nearest visible control whose top-left corner is the badge centre
          const cx = br.left + 12, cy = br.top + 12;
          const btn = [...document.querySelectorAll('button')].find((x) => { const r = x.getBoundingClientRect(); return r.width && Math.abs(r.left - cx) < 2 && Math.abs(r.top - cy) < 2; });
          if (!btn) { bad.push(`${key}: no button at its corner`); continue; }
          const range = document.createRange(); range.selectNodeContents(btn);
          const tr = [...range.getClientRects()].filter((q) => q.width > 0);
          const overlaps = tr.some((q) => br.left < q.right && br.right > q.left && br.top < q.bottom && br.bottom > q.top);
          if (overlaps) bad.push(`${key}: covers "${btn.textContent.trim()}"`);
        }
        document.querySelector('.mc-tools-chip').click();
        res(bad);
      }, 1000)); // the bar settles and the badges re-place (every 300 ms)
    });
    check(placement.length === 0, `badges sit at the top-left corner and never cover a label${placement.length ? `: ${placement.join('; ')}` : ''}`);
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

    // C1 (two hands): both thumbs up = the More menu, and never a two-fist zoom.
    await presenceEmpty(t, 600);
    t += 700;
    const camB = await page.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
    const boardsB = await boards();
    let grabbedB = false;
    for (let k = 0; k < 8; k++) { const st = await presenceHold([['thumbsUp', 'L'], ['thumbsUp', 'R']], t + k * 330, 300); grabbedB = grabbedB || st.grab; }
    const camB2 = await page.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
    check(await visible('.mc-more-menu') && await visible('[data-cmd=monitor]'), 'both thumbs up open the More menu (AI monitor inside it)');
    check(!grabbedB && camB === camB2 && await boards() === boardsB, 'both thumbs up never zoom, pan or move a board');
    // The menu is never covered by the camera preview or the Facing pill.
    const cover = await page.evaluate(() => {
      const root = document.querySelector('.mc-canvas');
      const pv = document.createElement('div'); pv.className = 'mc-face-preview'; root.append(pv);
      const pill = document.createElement('div'); pill.className = 'mc-facing-banner'; pill.textContent = 'Facing this device'; root.append(pill);
      const vis = (el) => getComputedStyle(el).visibility !== 'hidden';
      const open = { preview: vis(pv), pill: vis(pill) };
      document.querySelector('.mc-more-btn').click(); // close More
      const closed = { preview: vis(pv), pill: vis(pill) };
      pv.remove(); pill.remove();
      return { open, closed };
    });
    check(!cover.open.preview && !cover.open.pill && cover.closed.preview && cover.closed.pill, `the preview + Facing pill step aside while More is open (${JSON.stringify(cover)})`);
    await wait(600); // the Tools chip ignores a toggle within 450 ms of the last one
    await page.evaluate(() => { if (document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded') === 'true') document.querySelector('.mc-tools-chip').click(); });
    await presenceEmpty(t + 2700, 600);
    t += 3500;
    // Mixed: L thumbs up + R thumbs down together = Hover to click. L comes
    // first (1.9 s alone), the right hand forms through a loose shape: Save
    // must NOT fire on the way.
    const dwell0 = await page.evaluate(() => document.querySelector('[data-cmd=dwell]').getAttribute('aria-pressed'));
    const statusM0 = await page.evaluate(() => document.querySelector('.mc-canvas-status')?.textContent ?? '');
    await page.evaluate((from) => {
      const g = window.__mcGestures;
      const L = g.hand('thumbsUp', 'L');
      let tt = from;
      for (let k = 0; k <= 57; k++) g.presence([L], (tt += 33)); // 1.9 s alone
      for (let k = 0; k <= 8; k++) g.presence([L, g.hand('relaxed', 'R')], (tt += 33)); // the right hand comes up…
      for (let k = 0; k <= 70; k++) g.presence([L, g.hand('thumbsDown', 'R')], (tt += 33)); // …thumb down, held
    }, t);
    const dwell1 = await page.evaluate(() => document.querySelector('[data-cmd=dwell]').getAttribute('aria-pressed'));
    const statusM1 = await page.evaluate(() => document.querySelector('.mc-canvas-status')?.textContent ?? '');
    check(dwell0 !== dwell1, `L thumbs up + R thumbs down toggles Hover to click (${dwell0} → ${dwell1})`);
    check(!/^Saved/.test(statusM1) || statusM1 === statusM0, `Save never fired while the mixed gesture formed ("${statusM1}")`);
    await page.evaluate(() => document.querySelector('[data-cmd=dwell]').click()); // back as it was
    await presenceEmpty(t + 4800, 600);
    t += 5600;

    // 2) Left thumbs-up = Save (the button lives in the closed Tools palette).
    await release(t + 2200);
    t += 3000;
    const save = await holdShape([['thumbsUp', 'L']], t, 2100);
    const status = await page.evaluate(() => document.querySelector('.mc-canvas-status')?.textContent ?? '');
    check(save === 'L:thumbsUp' && /^Saved/.test(status), `left thumbs-up saves ("${status}")`);

    // 3) Open palm → highlight → right thumbs-up presses it.
    await release(t + 2200);
    t += 3000;
    // Save just closed the palette: the Tools chip ignores a toggle within 450 ms (wall clock).
    await wait(600);
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
      lv.style.cssText = 'position:fixed;left:760px;top:380px;width:300px;height:360px;z-index:45;background:#eee;display:flex;gap:20px;align-items:center;justify-content:center';
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
      // Long enough for the hold engine's release (300 ms with no fixed shape).
      for (let tt = 0; tt <= Math.max(ms, 450); tt += 33) g.presence([g.hand('open', 'R', { at: { x: 0.68, y: 0.95 } })], from + tt);
    }, from, ms);
    const log = () => page.evaluate(() => document.querySelector('.mc-ai-live-log')?.textContent ?? '');
    const log0 = await log();

    // A. Peace over the scroller moving DOWN: scroll-wheel style, the list scrolls DOWN (scrollTop grows).
    const scrolled = await peaceMove('R', 500, 215, 485, t, 600);
    check(scrolled.scrollTop > 900 + 60 && scrolled.hint, `peace + downward motion scrolls the list under the hand down (scrollTop 900 → ${Math.round(scrolled.scrollTop)}, hint ${scrolled.hint})`);
    // …then held still for 2.3 s: the peace hold (R = next step 2) must NOT fire.
    const held = await peaceMove('R', 500, 485, 485, t + 700, 0, 2300);
    const log1 = await log();
    check(!/Right peace/.test(log1.replace(log0, '')) && Math.abs(held.scrollTop - scrolled.scrollTop) < 30, 'after scrolling, the still peace never fires its hold (no "Next step 2")');
    // B. Hand lost mid-scroll: stops dead, no glide.
    await openHand(t + 3100, 400);
    t += 4000;
    await peaceMove('R', 500, 215, 485, t, 500);
    await presenceEmpty(t + 550, 100);
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
    const turned = await peaceMove('R', 500, 215, 485, t, 600);
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
    // D2. A peace DRIFTING slowly (≈ 0.35 hand scales over 2.3 s) is still a hold: Tools fires, nothing pans.
    await wait(600); // the Tools chip ignores a second toggle within 450 ms (wall clock); synthetic frames run faster
    const camD = await page.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
    const logD = await log();
    const toolsD0 = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    await page.evaluate((from) => {
      const g = window.__mcGestures;
      for (let tt = 0; tt <= 2300; tt += 33) g.presence([g.hand('peace', 'L', { at: { x: 0.3, y: 0.72 + (tt / 2300) * 0.035 } })], from + tt);
    }, t);
    const toolsD1 = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    const camD1 = await page.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
    check(toolsD0 !== toolsD1 && /Left peace → Tools/.test((await log()).replace(logD, '')) && camD === camD1, `a slowly drifting peace is a hold, not a scroll (Tools ${toolsD0} → ${toolsD1}; canvas unmoved)`);
    if (toolsD1 === 'true') await page.evaluate(() => document.querySelector('.mc-tools-chip').click());
    await openHand(t + 2400, 300);
    t += 3000;
    // E. Over a level control: a quick start upward, then 90 px more up = 3 steps up, no scroll, no hold.
    const log2 = await log();
    const sc0 = await page.evaluate(() => document.querySelector('#e2e-scroller').scrollTop);
    const tools0 = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    const lvStart = await page.evaluate((from) => {
      const g = window.__mcGestures;
      const at = (y) => ({ at: g.palmFor(910, y) });
      let tt = from;
      // The start: a deliberate move up (> 0.8 hand scales) beginning over the control…
      for (let k = 0; k <= 20; k++) g.presence([g.hand('peace', 'R', at(730 - k * 12))], (tt += 33));
      for (let k = 0; k <= 10; k++) g.presence([g.hand('peace', 'R', at(490))], (tt += 33)); // settle
      window.__lvT = tt;
      return Number(document.querySelector('#e2e-level').getAttribute('aria-valuenow'));
    }, t);
    await page.evaluate(() => {
      const g = window.__mcGestures;
      const at = (y) => ({ at: g.palmFor(910, y) });
      let tt = window.__lvT;
      for (let k = 1; k <= 18; k++) g.presence([g.hand('peace', 'R', at(490 - k * 5))], (tt += 33)); // …then 90 px more up
      for (let k = 0; k <= 20; k++) g.presence([g.hand('peace', 'R', at(400))], (tt += 33)); // hold there
    });
    const lv = await page.evaluate(() => ({
      value: Number(document.querySelector('#e2e-level').getAttribute('aria-valuenow')),
      readout: document.querySelector('.mc-level-readout')?.textContent ?? '',
    }));
    const tools1 = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    const sc1 = await page.evaluate(() => document.querySelector('#e2e-scroller').scrollTop);
    const newLog = (await log()).replace(log2, '');
    check(lvStart > 50 && lv.value - lvStart === 30, `peace over a level control: 90 px up after the start → exactly 3 steps (50 → ${lvStart} → ${lv.value})`);
    check(new RegExp(`Volume ${lv.value} %`).test(lv.readout), `big level readout by the hand ("${lv.readout}")`);
    check(sc1 === sc0 && tools1 === tools0 && !/Right peace/.test(newLog), 'stepping a level never scrolls and never fires the peace hold');
    await openHand(t + 2700, 300);
    t += 3200;
    // F. Over nothing scrollable: the canvas pans — hand down = see what is below (content moves up).
    const spot = await page.evaluate(() => {
      for (let y = 600; y > 100; y -= 40) for (let x = 1400; x > 80; x -= 40) {
        const el = document.elementFromPoint(x, y);
        if (el && el.matches('.mc-viewport, .mc-world, .mc-canvas') && document.elementFromPoint(x, y + 240)?.matches('.mc-viewport, .mc-world, .mc-canvas')) return { x, y };
      }
      return null;
    });
    if (spot) {
      const cam0 = await page.evaluate(() => window.__mcGestures.state().camera);
      await page.evaluate((spot, from) => {
        const g = window.__mcGestures;
        for (let k = 0; k <= 20; k++) g.presence([g.hand('peace', 'R', { at: g.palmFor(spot.x, spot.y + k * 12) })], from + k * 33);
      }, spot, t);
      const cam1 = await page.evaluate(() => window.__mcGestures.state().camera);
      check(cam1.y > cam0.y + 50, `peace over bare canvas scrolls it down (camera y ${Math.round(cam0.y)} → ${Math.round(cam1.y)})`);
    } else check(false, 'found a bare-canvas spot for the pan check');
    await openHand(t + 800, 300);
    t += 1500;
    // G. Register after a scroll: R scrolls, then L joins with a peace and both hold still → Register, never Tools.
    const logG = await log();
    const toolsG0 = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    await peaceMove('R', 500, 215, 485, t, 500);
    await page.evaluate((from) => {
      const g = window.__mcGestures;
      const R = g.hand('peace', 'R', { at: g.palmFor(500, 485) });
      const L = g.hand('peace', 'L', { at: { x: 0.3, y: 0.75 } });
      for (let tt = 0; tt <= 2400; tt += 33) g.presence([L, R], from + tt);
    }, t + 600);
    const logG1 = (await log()).replace(logG, '');
    const toolsG1 = await page.evaluate(() => document.querySelector('.mc-tools-chip')?.getAttribute('aria-expanded'));
    check(/Both hands peace → Register/.test(logG1) && !/Left peace/.test(logG1) && toolsG0 === toolsG1, `after a scroll, a second peace is Register, not Tools (${JSON.stringify(logG1.slice(0, 120))})`);
    await openHand(t + 3200, 300);
    await page.evaluate(() => { document.querySelector('#e2e-scroller')?.remove(); document.querySelector('#e2e-level')?.remove(); document.querySelector('.mc-scan-cancel')?.click(); });

    // 4) Badges go away with Hands.
    await page.evaluate(() => window.__mcGestures.show(false));
    await wait(200);
    check(!(await visible('.mc-gesture-badge:not([hidden])')), 'badges hide when Hands goes off');

    // 5) The device tiles' discrete controls are palm-highlight targets: an
    //    open palm lands on a colour swatch / a preset chip inside the lamp
    //    tile, and a held right thumbs-up presses it (one press = one action).
    const dash = await browser.newPage();
    await dash.setViewport({ width: 1440, height: 900 });
    dash.on('pageerror', (e) => errors.push(String(e?.message || e)));
    // A saved room board with two lamps and the speaker (the demo dashboard).
    await dash.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('mc.canvas.v1', JSON.stringify({
          version: 1, camera: { x: 0, y: 0, z: 1 }, focusId: null,
          frames: [{ id: 'f1', kind: 'room', title: 'Living room', rect: { x: 0, y: 0, w: 1000, h: 680 }, pinned: false }],
          surfaces: { f1: { kind: 'room', title: 'Living room', tiles: [
            { type: 'lamp', deviceId: 'wiz-desk', label: 'Desk lamp' },
            { type: 'lamp', deviceId: 'wiz-ceiling', label: 'Ceiling light' },
            { type: 'music', deviceId: 'speaker-1', label: 'Speaker' },
          ] } },
        }));
      } catch { /* storage blocked: the checks below fail loudly */ }
    });
    await dash.goto(`${BASE}/canvas.html?sim=1&hands=0`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check(await waitFor(dash, () => !!window.__mcGestures && !!document.querySelector('.mc-frame [data-focus]')), 'dashboard page is up');
    await dash.evaluate(() => document.querySelector('.mc-frame [data-focus]').click());
    check(await waitFor(dash, () => !!document.querySelector('.mc-frame.focused mc-lamp-tile')?.shadowRoot?.querySelector('[data-act=color]')), 'the lamp tile shows its colour swatches');
    await wait(900); // the focus flight settles
    await dash.evaluate(() => window.__mcGestures.show(true));
    const tileRoot = () => document.querySelector('.mc-frame.focused mc-lamp-tile').shadowRoot;
    const noSlider = await dash.evaluate(`(${tileRoot})().querySelectorAll('input[type=range], [role=slider]').length`);
    check(noSlider === 0, 'the lamp tile has no slider');
    const sizes = await dash.evaluate(`[...(${tileRoot})().querySelectorAll('button')].map((b) => Math.min(b.offsetWidth, b.offsetHeight))`);
    check(sizes.length >= 26 && Math.min(...sizes) >= 56, `every lamp-tile control is at least 56 px (${sizes.length} controls, smallest ${Math.min(...sizes)} px)`);
    let dt = 1000;
    const aimAndPress = async (selector) => {
      const aimed = await dash.evaluate((selector, from) => {
        const g = window.__mcGestures;
        const el = document.querySelector('.mc-frame.focused mc-lamp-tile').shadowRoot.querySelector(selector);
        const r = el.getBoundingClientRect();
        const at = g.palmFor(r.left + r.width / 2, r.top + r.height / 2);
        for (let k = 0; k <= 30; k++) g.feed([g.hand('open', 'R', { at })], from + k * 33);
        return { same: g.highlighted() === el, name: g.highlighted()?.textContent?.trim() ?? null };
      }, selector, dt);
      const fired = await dash.evaluate((from) => {
        const g = window.__mcGestures;
        const hand = g.hand('thumbsUp', 'R', { at: { x: 0.68, y: 0.7 } });
        let f = null;
        for (let t = from; t <= from + 2100; t += 33) { const s = g.feed([hand], t); if (s.fired) f = s.fired; }
        for (let t = from + 2200; t <= from + 2800; t += 33) g.feed([], t);
        return f;
      }, dt + 1100);
      dt += 5000;
      await wait(700);
      return { ...aimed, fired };
    };
    const lampState = () => dash.evaluate(() => document.querySelector('.mc-frame.focused mc-lamp-tile').shadowRoot.querySelector('.state').textContent.trim());
    const blue = await aimAndPress('[data-act=color][data-value=blue]');
    check(blue.same, `an open palm highlights the Blue swatch inside the lamp tile (${blue.name})`);
    const afterBlue = await lampState();
    check(blue.fired === 'R:thumbsUp' && /Blue/.test(afterBlue), `right thumbs-up pressed it: the lamp is blue ("${afterBlue}")`);
    const chip = await aimAndPress('[data-act=level][data-value="75"]');
    const afterChip = await lampState();
    check(chip.same && /75%/.test(afterChip), `palm + thumbs-up on the 75% chip sets the brightness ("${afterChip}")`);
    const step = await aimAndPress('[data-level=brightness] [data-level-inc]');
    const afterStep = await lampState();
    check(step.same && /85%/.test(afterStep), `palm + thumbs-up on + is one step ("${afterStep}")`);

    // 6) Peace-and-move over the speaker's volume control steps it through the
    //    tile's own − / + buttons (levelControl.ts adjustLevel), and over the
    //    lamp's brightness control too — never a scroll, never a canvas pan.
    const levelProbe = (tag, kind) => dash.evaluate((tag, kind) => {
      const el = document.querySelector(`.mc-frame.focused ${tag}`).shadowRoot.querySelector(`[data-level=${kind}]`);
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, now: Number(el.getAttribute('aria-valuenow')), readout: el.querySelector('[data-level-readout]').textContent.trim() };
    }, tag, kind);
    const peaceUp = async (tag, kind) => {
      const before = await levelProbe(tag, kind);
      const cam0 = await dash.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
      dt += 4000;
      // One unbroken hold (frames 33 ms apart on the synthetic clock): a
      // deliberate start upward beginning on the control, a settle, then
      // 60 px more up = 2 steps, then hold.
      const big = await dash.evaluate((x, y, from) => {
        const g = window.__mcGestures;
        const at = (yy) => ({ at: g.palmFor(x, yy) });
        let tt = from;
        for (let k = 0; k <= 20; k++) g.presence([g.hand('peace', 'R', at(y + 40 - k * 12))], (tt += 33));
        for (let k = 0; k <= 10; k++) g.presence([g.hand('peace', 'R', at(y - 200))], (tt += 33));
        const clicks = { inc: 0 };
        const el = [...document.querySelectorAll('.mc-frame.focused mc-lamp-tile, .mc-frame.focused mc-music-tile')].map((t) => t.shadowRoot.querySelector('.mc-level-target')).find(Boolean);
        el?.querySelector('[data-level-inc]')?.addEventListener('click', () => { clicks.inc++; });
        for (let k = 1; k <= 12; k++) g.presence([g.hand('peace', 'R', at(y - 200 - k * 5))], (tt += 33));
        for (let k = 0; k <= 20; k++) g.presence([g.hand('peace', 'R', at(y - 260))], (tt += 33));
        const text = document.querySelector('.mc-level-readout')?.textContent ?? '';
        const outlined = el?.getAttribute('data-level') ?? null;
        for (let k = 0; k <= 20; k++) g.presence([], (tt += 33));
        return { text, outlined, clicks: clicks.inc };
      }, before.x, before.y, dt);
      await wait(1200);
      const after = await levelProbe(tag, kind);
      const cam1 = await dash.evaluate(() => JSON.stringify(window.__mcGestures.state().camera));
      return { before, after, big, still: cam0 === cam1 };
    };
    const vol = await peaceUp('mc-music-tile', 'volume');
    check(vol.big.outlined === 'volume' && vol.big.clicks === 2, `peace moving up over the volume control takes hold of it; 60 px more up = 2 presses of its own + button (${vol.big.clicks})`);
    check(vol.after.now > vol.before.now && (vol.after.now - vol.before.now) % 10 === 0 && vol.after.readout === `${vol.after.now} %`, `the volume stepped through the normal device path (${vol.before.now} → ${vol.after.now}; tile reads "${vol.after.readout}")`);
    check(/^Volume \d+ %$/.test(vol.big.text), `big level readout by the hand ("${vol.big.text}")`);
    check(vol.still, 'stepping the volume never moves the canvas');
    const bri = await peaceUp('mc-lamp-tile', 'brightness');
    check(bri.big.outlined === "brightness" && bri.after.now > bri.before.now && bri.after.now <= 100 && /^Brightness \d+ %$/.test(bri.big.text) && bri.still,
      `peace moving up over the lamp's brightness steps it by tens (${bri.before.now} → ${bri.after.now}; "${bri.big.text}")`);
    await dash.close();
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await browser.close().catch(() => {});
  }
  console.log(failures.length ? `\ne2e-gestures: ${failures.length} failure(s)` : '\ne2e-gestures: passed');
  return failures.length ? 1 : 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('e2e-gestures — error:', e?.stack || e); process.exit(1); });
