// e2e-plan-hands.mjs — editing the floor plan with a hand, end to end, no
// camera: opens canvas.html?sim=1&hands=0, builds the floor-plan board, turns
// the gesture layer on, and feeds synthetic hand frames through the REAL
// camera path (canvasHands adapter → shape read → hand pointer + gestures).
// Asserts (docs/plan/2026-11-26-plan-hands-design.md):
//   - Hands on: banner, ≥ 56 px palette tools, element handles;
//   - open palm + right thumbs-up 2 s arms the Wall tool;
//   - a held fist draws a wall (live length), and neither the board nor the
//     canvas moves;
//   - a fist tap places a door on the nearest wall;
//   - the palm highlight snaps to a plan element; thumbs-up selects it;
//   - peace-and-move resizes it in 10 cm steps; left peace rotates furniture;
//   - right thumbs-down 2 s removes it; left thumbs-down 2 s (Undo) restores it;
//   - Hand edit off: the fist moves the board again.
//
//   npx vite --port 5173 &
//   E2E_URL=http://localhost:5173 node scripts/e2e-plan-hands.mjs
//   SHOTS=/some/dir  → also writes screenshots of each hand-edit state.

import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const BASE = (process.env.E2E_URL || 'http://localhost:5173').replace(/\/$/, '');
const SHOTS = process.env.SHOTS || '';

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
async function waitFor(page, fn, ms = 20_000, ...args) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await page.evaluate(fn, ...args).catch(() => false)) return true;
    await wait(200);
  }
  return false;
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.error('e2e-plan-hands: no Chrome found (set CHROME_PATH).'); return 2; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.error('e2e-plan-hands: puppeteer-core missing (npm ci).'); return 2; }
  try { await fetch(`${BASE}/canvas.html`); } catch { console.error(`e2e-plan-hands: no dev server at ${BASE}.`); return 2; }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--no-first-run', '--no-default-browser-check'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e?.message || e)));
    await page.goto(`${BASE}/canvas.html?sim=1&hands=0`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    check(await waitFor(page, () => !!window.__mcGestures && !!window.__canvas), 'sim gesture hook is up');
    // The pointer drops a hand it has not seen for 400 ms of real time, so the
    // last frame keeps arriving (as a camera would send it) while a screenshot is taken.
    const shot = async (name) => {
      if (!SHOTS) return;
      await page.evaluate(() => window.__ph?.keep(true));
      await wait(120);
      await page.screenshot({ path: join(SHOTS, `${name}.png`) });
      await page.evaluate(() => window.__ph?.keep(false));
    };

    // ---- a floor-plan board
    await page.evaluate(() => {
      const i = document.querySelector('#mc-say-in');
      i.value = 'draw the floor plan';
      document.querySelector('.mc-say').requestSubmit();
    });
    check(await waitFor(page, () => { const b = document.querySelector('.mc-review-approve'); return !!b && !b.closest('[hidden]') && b.getBoundingClientRect().width > 0; }, 30_000), 'the floor plan review is open');
    await page.evaluate(() => document.querySelector('.mc-review-approve').click());
    check(await waitFor(page, () => { const h = document.querySelector('mc-plan-board .mc-plan-board'); return !!h && !!h.__mcPlanDoc && h.getBoundingClientRect().height > 200 && !document.querySelector('.mc-review-approve')?.getBoundingClientRect().width; }), 'the plan board is on the canvas');
    await wait(900);

    // ---- helpers that run in the page: one frame every 33 ms of synthetic time
    await page.evaluate(() => {
      const g = window.__mcGestures;
      const P = (window.__ph = { t: 100_000 });
      P.host = () => document.querySelector('mc-plan-board .mc-plan-board');
      P.doc = () => P.host().__mcPlanDoc();
      P.hand = (shape, side, x, y) => g.hand(shape, side, { at: g.palmFor(x, y) });
      P.feed = (hands, frames) => { P.last = hands; for (let i = 0; i < frames; i++) { P.t += 33; g.presence(hands, P.t); } };
      P.keep = (on) => { clearInterval(P.timer); P.timer = on && P.last ? setInterval(() => { P.t += 33; g.presence(P.last, P.t); }, 50) : 0; };
      P.open = (x, y, frames = 10) => P.feed([P.hand('open', 'R', x, y)], frames);
      P.fist = (x, y, frames = 1) => P.feed([P.hand('fist', 'R', x, y)], frames);
      P.fistTo = (a, b, frames) => { for (let i = 1; i <= frames; i++) P.fist(a.x + ((b.x - a.x) * i) / frames, a.y + ((b.y - a.y) * i) / frames); };
      P.gone = (frames = 16) => P.feed([], frames);
      P.hold = (shape, side, x, y, ms) => P.feed([P.hand(shape, side, x, y)], Math.ceil(ms / 33));
      P.tap = (x, y) => { P.open(x, y, 12); P.fist(x, y, 4); P.open(x, y, 6); };
      P.strokeStart = (a, b) => { P.open(a.x, a.y, 12); P.fist(a.x, a.y, 14); P.fistTo(a, b, 24); P.fist(b.x, b.y, 12); };
      P.strokeEnd = (b) => { P.open(b.x, b.y, 8); };
      P.rect = () => { const r = P.host().getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; };
      P.center = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
      P.banner = () => { const b = document.querySelector('mc-plan-board .mc-plan-hand-banner'); return b && !b.hidden && getComputedStyle(b).display !== 'none' ? b.textContent : null; };
      P.readout = () => document.querySelector('mc-plan-board .mc-plan-hand-readout')?.textContent ?? '';
      P.tool = () => P.host().querySelector('.mc-palette .active[data-tool]')?.dataset.tool ?? null;
      P.frames = () => JSON.stringify(window.__canvas.snapshot().frames.map((f) => f.rect));
      P.camera = () => JSON.stringify(g.state().camera);
      // A clear patch of floor: a point on the drawing area with no element,
      // no button and no chrome within 70 px.
      P.clear = (w = 220) => P.clearIn(w, true) ?? P.clearIn(w, false);
      P.clearIn = (w, strict) => {
        const r = P.rect();
        for (let y = r.top + 60; y < r.top + r.height - 110; y += 20) {
          for (let x = r.left + 190; x + w < r.left + r.width - 30; x += 20) {
            let ok = true;
            for (let dx = -20; dx <= w + 20 && ok; dx += 20) for (const dy of [-40, -20, 0, 20]) {
              const el = document.elementFromPoint(x + dx, y + dy);
              if (!el || !P.host().contains(el) || el.closest('button, .mc-palette, .mc-props, .mc-plan-hand-bar, .mc-plan-hand-banner, .mc-trash, .mc-fsctl') || (strict && P.host().__mcPlanPick(x + dx, y + dy))) { ok = false; break; }
            }
            if (ok) return { x, y };
          }
        }
        return null;
      };
    });
    const P = (fn, ...args) => page.evaluate(fn, ...args);

    // ---- Hands on
    check((await P(() => window.__ph.banner())) === null, 'no hand banner while Hands is off');
    await P(() => window.__mcGestures.show(true));
    await wait(1500); // the focused plan board grows to the free screen (camera fly)
    const on = await P(() => {
      const h = window.__ph.host();
      const sizes = [...h.querySelectorAll('.mc-palette > .mc-palette-btn')].map((b) => b.getBoundingClientRect()).map((r) => Math.min(r.width, r.height));
      const toggle = document.querySelector('.mc-plan-hand-toggle');
      const r = h.getBoundingClientRect();
      const clipped = [...h.querySelectorAll('.mc-palette > .mc-palette-btn')].filter((b) => { const q = b.getBoundingClientRect(); return q.bottom > r.bottom + 1 || q.top < r.top - 1; }).length;
      return { banner: window.__ph.banner(), min: Math.min(...sizes), n: sizes.length, clipped, toggle: !!toggle && toggle.getBoundingClientRect().width > 0, hot: h.querySelectorAll('.mc-plan-hot').length, els: (() => { const d = window.__ph.doc(); return d.walls.length + d.rooms.length + d.openings.length + d.fixtures.length; })() };
    });
    check(!!on.banner && /^Select|selected — /.test(on.banner), `Hands on: the banner names the mode (${on.banner})`);
    check(on.n >= 12 && on.min >= 55.5, `every palette tool is ≥ 56 px while Hands is on (${on.n} tools, smallest ${Math.round(on.min)} px)`);
    check(on.clipped === 0, 'no palette tool is clipped by the board');
    check(on.toggle, 'the "Hand edit" switch is in the plan toolbar');
    check(on.hot >= 4, `plan elements have handles for the palm highlight (${on.hot} of ${on.els})`);
    const big = await P(() => {
      const h = window.__ph.host();
      const f = h.closest('.mc-frame').getBoundingClientRect();
      const sc = h.querySelector('.mc-plan-scale');
      const pill = h.querySelector('.mc-status');
      const acts = [...document.querySelectorAll('.mc-frame.focused .mc-frame-hand-acts button')].map((b) => ({ t: b.textContent, h: b.getBoundingClientRect().height }));
      const body = h.closest('.mc-frame-body');
      return { frameW: f.width, vw: innerWidth, pxPerM: Number(sc?.dataset.pxPerM ?? 0), scaleText: sc?.textContent ?? '', scaleShown: !!sc && getComputedStyle(sc).display !== 'none', pill: !!pill && getComputedStyle(pill).display !== 'none' && pill.textContent !== '', acts, scrolls: h.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + 1 || h.getBoundingClientRect().top < body.getBoundingClientRect().top - 1 };
    });
    check(big.frameW >= big.vw * 0.75, `the plan board takes most of the screen (${Math.round(big.frameW)} of ${big.vw} px)`);
    check(big.pxPerM >= 60 && big.pxPerM <= 80, `the plan shows at 60–80 px per metre (${big.pxPerM})`);
    check(big.scaleShown && big.scaleText === '1 m', `a scale bar says so (${big.scaleText})`);
    check(!big.pill, 'the mouse hint pill is hidden while the hand banner shows');
    check(big.acts.length === 3 && big.acts.every((a) => a.h >= 56), `the focused board offers ${big.acts.map((a) => a.t).join(' / ')} at ≥ 56 px`);
    check(!big.scrolls, 'the whole plan surface is on screen without scrolling the board');
    await shot('01-hands-on-select');

    const frames0 = await P(() => window.__ph.frames());
    const camera0 = await P(() => window.__ph.camera());

    // ---- open palm + right thumbs-up arms the Wall tool
    const wallBtn = await P(() => window.__ph.center(window.__ph.host().querySelector('.mc-palette [data-tool=wall]')));
    await P((c) => { window.__ph.open(c.x + 6, c.y + 4, 24); }, wallBtn);
    check(await P(() => window.__mcGestures.highlighted()?.dataset?.tool === 'wall'), 'an open palm highlights the Wall tool');
    await shot('02-palm-highlights-wall-tool');
    await P((c) => { window.__ph.hold('thumbsUp', 'R', c.x + 6, c.y + 4, 2200); window.__ph.gone(); }, wallBtn);
    check((await P(() => window.__ph.tool())) === 'wall', 'right thumbs-up held 2 s arms it');
    const b1 = await P(() => window.__ph.banner());
    check(/^Drawing walls with your hand/.test(b1 ?? ''), `the banner says so (${b1})`);

    // ---- a held fist draws a wall
    const spot = await P(() => window.__ph.clear(120));
    check(!!spot, 'there is clear floor to draw on');
    const a = spot ?? { x: 700, y: 600 };
    const b = { x: a.x + 120, y: a.y };
    const walls0 = await P(() => window.__ph.doc().walls.length);
    await P((a, b) => window.__ph.strokeStart(a, b), a, b);
    const live = await P(() => ({ banner: window.__ph.banner(), readout: window.__ph.readout(), walls: window.__ph.doc().walls.length, grab: window.__mcGestures.state().grab }));
    check(live.grab && live.walls === walls0, 'fist down: a stroke is running and nothing is applied yet');
    check(/^Wall: \d+\.\d\d m$/.test(live.readout), `the live length shows in metres (${live.readout})`);
    check(/open your hand to finish/.test(live.banner ?? ''), 'the banner says how to finish');
    await shot('03-drawing-a-wall-fist-down');
    await P((b) => window.__ph.strokeEnd(b), b);
    const drawn = await P(() => { const d = window.__ph.doc(); const w = d.walls[d.walls.length - 1]; return { n: d.walls.length, len: Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y), ax: w.a.x, ay: w.a.y, by: w.b.y }; });
    check(drawn.n === walls0 + 1, 'opening the hand adds one wall');
    check(drawn.len >= 300 && Math.round(drawn.len) % 100 === 0 && drawn.ay === drawn.by, `the wall is on the 10 cm grid and level (${(drawn.len / 1000).toFixed(2)} m)`);
    check((await P(() => window.__ph.frames())) === frames0, 'the board did not move while drawing');
    check((await P(() => window.__ph.camera())) === camera0, 'the canvas did not pan or zoom while drawing');
    await shot('04-wall-drawn');

    // ---- a fist tap places a door on the nearest wall
    await P(() => { window.__ph.gone(); window.__ph.host().querySelector('.mc-palette [data-tool=door]').click(); });
    const doors0 = await P(() => window.__ph.doc().openings.length);
    const mid = { x: (a.x + b.x) / 2, y: a.y - 26 };
    await P((m) => { window.__ph.open(m.x, m.y, 14); }, mid);
    await shot('05-door-ghost-under-the-palm');
    await P((m) => { window.__ph.tap(m.x, m.y); window.__ph.gone(); }, mid);
    const door = await P(() => { const d = window.__ph.doc(); const o = d.openings[d.openings.length - 1]; return { n: d.openings.length, kind: o?.kind, onNew: o?.wallId === d.walls[d.walls.length - 1].id }; });
    check(door.n === doors0 + 1 && door.kind === 'door', 'a fist tap places a door');
    check(door.onNew, 'it snapped onto the nearest wall (the one just drawn)');
    await shot('06-door-placed');

    // ---- Select: the palm highlight snaps to a plan element
    await P(() => window.__ph.host().querySelector('.mc-palette [data-tool=select]').click());
    await wait(200);
    check(await P(() => /^Door .* selected/.test(window.__ph.banner() ?? '')), 'back on Select, the door just placed is the selection');
    await P(() => window.__ph.host().querySelector('.mc-plan-deselect').click()); // "Done"
    await wait(100);
    const target = await P(() => {
      const d = window.__ph.doc();
      const wall = d.walls[d.walls.length - 1];
      const el = window.__ph.host().querySelector(`.mc-plan-hot[data-plan-id="${wall.id}"]`);
      return el ? { ...window.__ph.center(el), id: wall.id, label: el.getAttribute('aria-label') } : null;
    });
    check(!!target, 'the new wall has a handle');
    if (target) {
      // Approach from the side: the highlight snaps to it before the palm is on it.
      await P((c) => { window.__ph.open(c.x + 4, c.y + 34, 26); }, target);
      const hi = await P(() => { const h = window.__mcGestures.highlighted(); return { id: h?.dataset?.planId ?? null, name: document.querySelector('.mc-highlight-name')?.textContent ?? '' }; });
      check(hi.id === target.id, `an open palm near the wall highlights it (${hi.name})`);
      await shot('07-palm-highlight-on-a-wall');
      await P((c) => { window.__ph.hold('thumbsUp', 'R', c.x + 4, c.y + 34, 2200); window.__ph.gone(); }, target);
      const sel = await P(() => ({ id: window.__ph.doc().selectedId, banner: window.__ph.banner(), readout: window.__ph.readout(), bar: [...window.__ph.host().querySelectorAll('.mc-plan-hand-bar button')].map((b) => ({ t: b.textContent, h: b.getBoundingClientRect().height })) }));
      check(sel.id === target.id, 'right thumbs-up selects it');
      check(/selected — fist on it: move/.test(sel.banner ?? ''), `the banner lists what the hand can do (${sel.banner})`);
      check(sel.bar.some((x) => x.t === 'Remove') && sel.bar.every((x) => x.h >= 56), `the action bar is up with ≥ 56 px buttons (${sel.bar.map((x) => x.t).join(', ')})`);
      const badges = await P(() => { const q = (k) => { const el = document.querySelector(`.mc-gesture-badge[data-key="${k}"]`); return !!el && !el.hidden; }; return { remove: q('R:thumbsDown') }; });
      await wait(400);
      check(badges.remove || (await P(() => { const el = document.querySelector('.mc-gesture-badge[data-key="R:thumbsDown"]'); return !!el && !el.hidden; })), 'Remove carries the right thumbs-down badge');
      await shot('08-wall-selected-action-bar');

      // ---- peace-and-move resizes it: 95 px = 3 steps = 30 cm
      const len0 = drawn.len;
      await P((c) => {
        const P = window.__ph;
        P.feed([P.hand('peace', 'R', c.x, c.y - 44)], 2);
        for (let i = 1; i <= 6; i++) P.feed([P.hand('peace', 'R', c.x + (95 * i) / 6, c.y - 44)], 1);
        P.feed([P.hand('peace', 'R', c.x + 95, c.y - 44)], 6);
      }, target);
      const rs = await P(() => ({ readout: window.__ph.readout(), banner: window.__ph.banner() }));
      check(rs.readout === `Wall: ${((len0 + 300) / 1000).toFixed(2)} m`, `peace-and-move resizes in 10 cm steps with a live readout (${rs.readout})`);
      await shot('09-resizing-with-peace-and-move');
      await P((c) => { window.__ph.open(c.x + 95, c.y - 44, 10); window.__ph.gone(); }, target);
      const len1 = await P((id) => { const w = window.__ph.doc().walls.find((x) => x.id === id); return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y); }, target.id);
      check(Math.round(len1 - len0) === 300, `changing shape keeps it: the wall is 30 cm longer (${(len1 / 1000).toFixed(2)} m)`);

      // ---- peace-and-move over the size stepper: the shared level gesture steps it
      const lv = await P(() => { const g = window.__ph.host().querySelector('.mc-plan-size[data-level]'); return g ? window.__ph.center(g.querySelector('.mc-plan-size-value')) : null; });
      check(!!lv, 'the size stepper is a data-level control');
      if (lv) {
        await P((c) => {
          const P = window.__ph;
          P.feed([P.hand('peace', 'R', c.x, c.y)], 3);
          for (let i = 1; i <= 10; i++) P.feed([P.hand('peace', 'R', c.x, c.y - i * 12)], 1);
          P.feed([P.hand('peace', 'R', c.x, c.y - 120)], 8);
          P.open(c.x, c.y - 120, 10); P.gone();
        }, lv);
        const len2 = await P((id) => { const w = window.__ph.doc().walls.find((x) => x.id === id); return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y); }, target.id);
        check(len2 > len1 && Math.round(len2 - len1) % 100 === 0, `peace-and-move up over it lengthens the wall in 10 cm steps (${(len1 / 1000).toFixed(2)} → ${(len2 / 1000).toFixed(2)} m)`);
        check((await P(() => window.__ph.camera())) === camera0, 'and the canvas did not scroll');
      }

      // ---- a held fist moves it
      const before = await P((id) => { const w = window.__ph.doc().walls.find((x) => x.id === id); return { x: w.a.x, y: w.a.y }; }, target.id);
      // Where the wall is NOW (it grew, and the view may have followed it): a
      // point on the wall itself, clear of the door.
      const from = await P((id) => { const P = window.__ph; const el = P.host().querySelector(`.mc-plan-hot[data-plan-id="${id}"]`); const c = P.center(el); for (const dx of [-70, 70, -50, 50, -90, 90]) if (P.host().__mcPlanPick(c.x + dx, c.y) === id) return { x: c.x + dx, y: c.y }; return c; }, target.id);
      await P((a, b) => { window.__ph.strokeStart(a, b); }, from, { x: from.x + 6, y: from.y - 52 });
      await shot('10-moving-the-wall-fist-down');
      await P((b) => { window.__ph.strokeEnd(b); window.__ph.gone(); }, { x: from.x + 6, y: from.y - 52 });
      const after = await P((id) => { const w = window.__ph.doc().walls.find((x) => x.id === id); return { x: w.a.x, y: w.a.y }; }, target.id);
      check(after.y > before.y && (after.y - before.y) % 100 === 0, `a held fist moves the selected wall, snapped to 10 cm (${after.y - before.y} mm up)`);
      check((await P(() => window.__ph.frames())) === frames0 && (await P(() => window.__ph.camera())) === camera0, 'still: the board and the canvas did not move');

      // ---- right thumbs-down removes; left thumbs-down (Undo) restores
      const n0 = await P(() => window.__ph.doc().walls.length);
      // With Tools open, thumbs-down closes Tools; it must not remove the wall.
      await P(() => document.querySelector('.mc-tools-chip').click());
      await wait(1600); // the Tools toggle is latched against a second press right after the first
      const toolsOpen = await P(() => document.querySelector('.mc-tools-chip').getAttribute('aria-expanded') === 'true');
      await P(() => { window.__ph.hold('thumbsDown', 'R', 900, 300, 2300); window.__ph.gone(); });
      const afterClose = await P(() => ({ n: window.__ph.doc().walls.length, open: document.querySelector('.mc-tools-chip').getAttribute('aria-expanded') === 'true' }));
      check(toolsOpen && !afterClose.open && afterClose.n === n0, 'with Tools open, right thumbs-down closes Tools and removes nothing');
      await wait(1600);
      await P(() => { window.__ph.hold('thumbsDown', 'R', 900, 300, 1000); });
      check((await P(() => window.__ph.doc().walls.length)) === n0, 'right thumbs-down held 1 s removes nothing');
      await shot('11-thumbs-down-filling-remove');
      await P(() => { window.__ph.hold('thumbsDown', 'R', 900, 300, 1300); window.__ph.gone(); });
      const gone = await P((id) => ({ n: window.__ph.doc().walls.length, has: window.__ph.doc().walls.some((w) => w.id === id) }), target.id);
      check(gone.n === n0 - 1 && !gone.has, 'held 2 s it removes the selected wall');
      await shot('12-removed');
      await P(() => { window.__ph.hold('thumbsDown', 'L', 500, 300, 2200); window.__ph.gone(); });
      const back = await P((id) => window.__ph.doc().walls.some((w) => w.id === id), target.id);
      check(back, 'left thumbs-down (Undo) brings it back');
      await shot('13-undone');
      const hist = await P(() => [...document.querySelectorAll('.mc-ai-history li')].map((li) => li.textContent).join(' | '));
      check(/Drew a wall/.test(hist) && /Removed Wall/.test(hist), 'the plan edits are in the canvas history');
    }

    // ---- furniture: place, select, left peace = rotate
    await P(() => { const h = window.__ph.host(); h.querySelector('.mc-palette [data-tool=furniture-group]').click(); });
    await wait(150);
    await shot('14-furniture-flyout');
    const fly = await P(() => { const h = window.__ph.host(); const r = h.getBoundingClientRect(); const btns = [...h.querySelectorAll('.mc-flyout:not([hidden]) .mc-palette-btn')].map((b) => b.getBoundingClientRect()); return { n: btns.length, min: Math.min(...btns.map((q) => Math.min(q.width, q.height))), clipped: btns.filter((q) => q.bottom > r.bottom + 1 || q.right > r.right + 1).length }; });
    check(fly.n >= 10 && fly.min >= 56 && fly.clipped === 0, `the Furniture flyout opens with ≥ 56 px items, none clipped (${fly.n}, smallest ${Math.round(fly.min)} px, ${fly.clipped} clipped)`);
    await P(() => window.__ph.host().querySelector('.mc-flyout [data-tool="fx:chair"]').click());
    const spot2 = (await P(() => window.__ph.clear(80))) ?? { x: a.x, y: a.y + 40 };
    const fx0 = await P(() => window.__ph.doc().fixtures.length);
    await P((s) => { window.__ph.tap(s.x + 30, s.y); window.__ph.gone(); }, spot2);
    check((await P(() => window.__ph.doc().fixtures.length)) === fx0 + 1, 'a fist tap places a chair');
    await P(() => window.__ph.host().querySelector('.mc-palette [data-tool=select]').click());
    await wait(200);
    const rot0 = await P(() => { const d = window.__ph.doc(); const f = d.fixtures[d.fixtures.length - 1]; return { id: f.id, rotation: f.rotation, selected: d.selectedId === f.id, rotateBtn: !!window.__ph.host().querySelector('.mc-plan-rotate') }; });
    check(rot0.selected && rot0.rotateBtn, 'the placed chair is selected and the bar offers Rotate');
    await wait(400);
    await shot('15-chair-selected-rotate');
    await P(() => { window.__ph.hold('peace', 'L', 520, 320, 2200); window.__ph.gone(); });
    const rot1 = await P((id) => window.__ph.doc().fixtures.find((f) => f.id === id)?.rotation, rot0.id);
    check(rot1 === (rot0.rotation + 90) % 360, `left peace held 2 s rotates it 90° (${rot0.rotation}° → ${rot1}°)`);

    // ---- two fists ON the plan zoom the plan, not the canvas
    const z0 = await P(() => ({ px: Number(window.__ph.host().querySelector('.mc-plan-scale').dataset.pxPerM), cam: window.__ph.camera() }));
    await P(() => {
      const P = window.__ph, r = P.rect();
      const y = r.top + r.height / 2, cx = r.left + r.width / 2 + 60;
      const two = (d, shape) => [P.hand(shape, 'L', cx - d, y), P.hand(shape, 'R', cx + d, y)];
      P.feed(two(110, 'open'), 12);
      P.feed(two(110, 'fist'), 16);
      for (let i = 1; i <= 12; i++) P.feed(two(110 - i * 5, 'fist'), 1);
      P.feed(two(50, 'fist'), 6);
    });
    await shot('15b-two-fists-zoom-the-plan');
    await P(() => { const P = window.__ph, r = P.rect(); const y = r.top + r.height / 2, cx = r.left + r.width / 2 + 60; P.feed([P.hand('open', 'L', cx - 50, y), P.hand('open', 'R', cx + 50, y)], 10); P.gone(); });
    const z1 = await P(() => ({ px: Number(window.__ph.host().querySelector('.mc-plan-scale').dataset.pxPerM), cam: window.__ph.camera(), text: window.__ph.host().querySelector('.mc-plan-scale').textContent }));
    check(z1.px < z0.px * 0.75, `two fists closing in zoom the plan out (${z0.px} → ${z1.px} px per metre; bar: ${z1.text})`);
    check(z1.cam === z0.cam, 'the canvas itself did not zoom');

    // ---- Hand edit off: the fist moves the board again
    await P(() => document.querySelector('.mc-plan-hand-toggle').click());
    check((await P(() => window.__ph.banner())) === null, 'Hand edit off: the banner is gone');
    const wallsN = await P(() => window.__ph.doc().walls.length);
    const c = await P(() => { const r = window.__ph.rect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await P((c) => { window.__ph.strokeStart(c, { x: c.x + 60, y: c.y }); window.__ph.strokeEnd({ x: c.x + 60, y: c.y }); window.__ph.gone(); }, c);
    check(((await P(() => window.__ph.frames())) !== frames0 || (await P(() => window.__ph.camera())) !== camera0) && (await P(() => window.__ph.doc().walls.length)) === wallsN, 'a held fist on the plan moves the board (or pans, when it is the focused board) and draws nothing');
    await P(() => document.querySelector('.mc-plan-hand-toggle').click());
    check(!!(await P(() => window.__ph.banner())), 'Hand edit on again: the banner is back');

    // ---- board buttons for hands: Smaller, Close board, Undo
    const drawing0 = await P(() => { const d = window.__ph.doc(); return JSON.stringify([d.walls.length, d.openings.length, d.fixtures.length]); });
    const stored = await P(() => { const snap = window.__canvas.snapshot(); return { drawings: JSON.stringify(snap.drawings ?? {}).includes('"walls"'), inSurfaces: JSON.stringify(snap.surfaces).includes('"walls"') }; });
    check(stored.drawings, 'the drawing is stored with the board in the canvas document');
    check(!stored.inSurfaces, 'and not inside the surface plan that model prompts and transfers serialize');
    const w0 = await P(() => window.__canvas.snapshot().frames.find((f) => document.querySelector(`[data-frame="${f.id}"] mc-plan-board`)).rect.w);
    await P(() => document.querySelector('.mc-frame.focused .mc-frame-smaller').click());
    await wait(500);
    const w1 = await P(() => window.__canvas.snapshot().frames.find((f) => document.querySelector(`[data-frame="${f.id}"] mc-plan-board`)).rect.w);
    check(w1 < w0, `Smaller shrinks the board (${Math.round(w0)} → ${Math.round(w1)} px)`);
    const closeBtn = await P(() => window.__ph.center(document.querySelector('.mc-frame.focused .mc-frame-close')));
    await P((c) => { window.__ph.open(c.x, c.y, 24); }, closeBtn);
    check(await P(() => window.__mcGestures.highlighted()?.classList.contains('mc-frame-close')), 'an open palm highlights "Close board"');
    await shot('15c-close-board-highlighted');
    await P((c) => { window.__ph.hold('thumbsUp', 'R', c.x, c.y, 2200); window.__ph.gone(); }, closeBtn);
    await wait(600);
    check(!(await P(() => !!document.querySelector('mc-plan-board'))), 'right thumbs-up closes the board');
    await P(() => { window.__ph.hold('thumbsDown', 'L', 500, 300, 2200); window.__ph.gone(); });
    check(await waitFor(page, () => !!document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc, 5000), 'left thumbs-down (Undo) brings the board back');
    await wait(500);
    check((await P(() => { const d = window.__ph.doc(); return JSON.stringify([d.walls.length, d.openings.length, d.fixtures.length]); })) === drawing0, `and the drawing came back with it (${drawing0})`);

    // ---- Hands off: all of it goes away
    await P(() => window.__mcGestures.show(false));
    await wait(200);
    const off = await P(() => { const h = window.__ph.host(); const vis = (s) => [...h.querySelectorAll(s)].some((el) => getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0); return { banner: window.__ph.banner(), bar: vis('.mc-plan-hand-bar'), hot: vis('.mc-plan-hot') }; });
    check(off.banner === null && !off.bar && !off.hot, 'Hands off: no banner, bar or handles');
    await shot('16-hands-off');
    await wait(900);
    const sizes = await P(() => { const f = window.__canvas.snapshot().frames.find((x) => document.querySelector(`[data-frame="${x.id}"] mc-plan-board`)); const el = document.querySelector(`[data-frame="${f.id}"]`); return { stored: f.rect.w, shown: Math.round(parseFloat(el.style.width)) }; });
    check(sizes.shown === Math.round(sizes.stored) || sizes.shown < sizes.stored, `Hands off: the board shows at its own stored size (${Math.round(sizes.stored)} px stored, ${sizes.shown} px shown)`);

    // ---- reload: the drawing is still there
    await wait(600); // the debounced save
    await page.goto(`${BASE}/canvas.html?sim=1&hands=0`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    const again = await waitFor(page, () => !!document.querySelector('mc-plan-board .mc-plan-board')?.__mcPlanDoc, 15_000);
    check(again, 'after a reload the plan board is back');
    if (again) {
      const d1 = await page.evaluate(() => { const d = document.querySelector('mc-plan-board .mc-plan-board').__mcPlanDoc(); return JSON.stringify([d.walls.length, d.openings.length, d.fixtures.length]); });
      check(d1 === drawing0, `and it still shows what was drawn (${d1})`);
    }

    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
  } finally {
    await browser.close();
  }
  console.log(failures.length ? `\ne2e-plan-hands: ${failures.length} FAILED` : '\ne2e-plan-hands: all passed');
  return failures.length ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => { console.error(err); process.exit(1); });
