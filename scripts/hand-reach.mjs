// HAND REACH AUDIT. Walks every interactive control on the canvas, in every
// main state (bar, boards, Proposal card, dashboard tiles inside A2UI shadow
// DOM, AI activity + history, connect sheet, teach-a-gesture, custom gestures,
// phone menu sheet), with the simulated hand pointer (window.__mcHand, the
// same hit-testing a real hand uses). For each control it aims at the control's
// centre, checks the hand resolves to it, pinches and releases, and checks the
// click reached it (dry-run: delivered, then stopped before app handlers so
// the walk doesn't change state). Separately it does REAL hand activations:
// Connect this room, Keep, a lamp tile, the menu, the mic.
//
//   node scripts/hand-reach.mjs        (BASE=http://localhost:5191 to reuse a server)
// Writes a JSON report + screenshots to screens/sim-main/hand-reach/.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runArc } from './hand-arc.mjs';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.OUT ?? '/workspace/hackathon/firebase-hybrid/screens/sim-main/hand-reach';
const ARC_OUT = process.env.ARC_OUT ?? '/workspace/hackathon/firebase-hybrid/screens/sim-main/arc';
const PORT = 5193;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const chrome = ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'].find((p) => existsSync(p));
let vite = null;
let BASE = process.env.BASE;
if (!BASE) {
  BASE = `http://localhost:${PORT}`;
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: appRoot, stdio: 'ignore', detached: true });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/canvas.html')).ok) break; } catch { /* starting */ } await sleep(300); }
}

const DEVICES = [
  { name: 'desktop', width: 1440, height: 900, dpr: 1, mobile: false },
  { name: 'iphone15', width: 393, height: 852, dpr: 3, mobile: true, platform: 'ios' },
  { name: 'nothing3a', width: 412, height: 915, dpr: 2.625, mobile: true, platform: 'android' },
];

// In-page: audit every control currently reachable.
async function audit(page, state) {
  return page.evaluate(async (state) => {
    const H = window.__mcHand; const { collectControls, controlLabel } = window.__mcHandLib;
    H.setDryRun(true);
    const res = [];
    for (const el of collectControls(document)) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const inShadow = el.getRootNode() !== document;
      // Range inputs activate by drag, not click (handPointer.ts's press()
      // routes them straight to a value-drag on pinch-down) — and dry-run
      // deliberately suppresses the 'input'/'change' it would otherwise
      // dispatch, same as it suppresses 'click' for everything else. So
      // `lastActivated` (set unconditionally, dry-run or not) is the only
      // signal available for them; every other control still needs the
      // 'click' listener to prove the event actually reached it.
      const isRange = el.matches('input[type=range]');
      let delivered = isRange;
      const mark = () => { delivered = true; };
      if (!isRange) el.addEventListener('click', mark, { capture: true, once: true });
      const got = H.pointAt(cx, cy);
      H.pinch(true); H.pinch(false);
      if (!isRange) el.removeEventListener('click', mark, { capture: true });
      // also check the snap radius: aim 24px outside the control's edge
      const near = H.pointAt(r.right + 24, cy);
      res.push({ state, label: controlLabel(el), tag: el.tagName.toLowerCase(), inShadow, w: Math.round(r.width), h: Math.round(r.height),
        resolved: got === el, activated: delivered && H.lastActivated === el, snapsFromNear: near === el });
      H.lost();
    }
    H.setDryRun(false);
    return res;
  }, state);
}

// Waits for a selector to exist AND be on-screen; resolves false (never
// throws) on timeout so a missing control is a recorded miss, not a hang.
async function waitForVisible(page, selector, timeout = 8000) {
  try {
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      if (!el || el.hidden) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }, { timeout }, selector);
    return true;
  } catch {
    return false;
  }
}

// Real hand activation of the first control matching a predicate.
async function handPress(page, test) {
  return page.evaluate(async (src) => {
    const pred = new Function('el', 'label', `return (${src})(el, label);`);
    const { collectControls, controlLabel } = window.__mcHandLib;
    const el = collectControls(document).find((e) => pred(e, controlLabel(e)));
    if (!el) return { ok: false, why: 'not found' };
    const r = el.getBoundingClientRect();
    const got = window.__mcHand.pointAt(r.left + r.width / 2, r.top + r.height / 2);
    window.__mcHand.pinch(true); await new Promise((r) => setTimeout(r, 120)); window.__mcHand.pinch(false);
    return { ok: got === el, label: controlLabel(el) };
  }, test.toString());
}

const all = []; const real = [];
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'] });
try {
  for (const d of DEVICES) {
    const page = await browser.newPage();
    await page.setViewport({ width: d.width, height: d.height, deviceScaleFactor: d.dpr, isMobile: d.mobile, hasTouch: d.mobile });
    await page.goto(`${BASE}/canvas.html?fresh=1&sim=1&hands=0${d.platform ? `&platform=${d.platform}` : ''}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.addScriptTag({ type: 'module', content: `import * as L from '/src/canvas/handPointer.ts'; window.__mcHandLib = L;` });
    await page.waitForFunction(() => window.__mcHand && window.__mcHandLib, { timeout: 15000 });
    await sleep(800);
    const S = (s) => `${d.name}:${s}`;
    all.push(...await audit(page, S('start')));

    // ?fresh=1 opens fully blank (no boards): open the Tools palette by hand
    // first — on phones that's the always-visible Menu button; on desktop
    // it's the small Tools chip beside the mic — then make a board to work in.
    if (d.name === 'desktop') {
      real.push({ device: d.name, step: 'Tools (hand)', ...await handPress(page, (el) => el.classList.contains('mc-tools-chip')) });
    } else {
      real.push({ device: d.name, step: 'Menu (hand, to open tools)', ...await handPress(page, (el) => el.classList.contains('mc-menu-btn')) });
    }
    await sleep(300);
    all.push(...await audit(page, S('tools-open')));
    real.push({ device: d.name, step: 'New board (hand)', ...await handPress(page, (el) => el.dataset?.cmd === 'new') });
    await sleep(300);

    real.push({ device: d.name, step: 'Connect this room', ...await handPress(page, (el, l) => /connect this room/i.test(l)) });
    // Every decision — desktop or phone — opens the same full-screen review;
    // its own Approve/Reject are the only visible decision controls (the
    // underlying Proposal's Keep/Drop stay in the DOM, hidden, for Approve
    // to proxy-click).
    await waitForVisible(page, '.mc-review-approve', 5000);
    all.push(...await audit(page, S('proposal')));
    const kept = await handPress(page, (el, l) => /^approve$/i.test(l));
    real.push({ device: d.name, step: 'Approve', ...kept });
    // The sim follows the quick draft with a Gemini upgrade Proposal: approve that too.
    for (let i = 0; i < 2; i++) {
      const visible = await waitForVisible(page, '.mc-review-approve', 4000);
      if (!visible) break;
      const more = await handPress(page, (el, l) => /^approve$/i.test(l));
      if (!more.ok) break;
      all.push(...await audit(page, S('upgrade-proposal')));
      real.push({ device: d.name, step: 'Approve upgrade', ...more });
    }
    await sleep(1500);
    all.push(...await audit(page, S('dashboard')));
    real.push({ device: d.name, step: 'Lamp tile (shadow DOM)', ...await handPress(page, (el, l) => el.getRootNode() !== document && /turn on|turn off|brighter|dimmer/i.test(l)) });
    await sleep(400);

    // Edit mode (editBoard.ts): Edit -> Done/Reset layout/move+resize
    // handles all appear and must be hand-reachable; press Done again so the
    // rest of the audit (connect sheet, teach, gestures) sees normal state.
    if (d.name === 'desktop') {
      real.push({ device: d.name, step: 'Edit board (hand)', ...await handPress(page, (el) => el.classList.contains('mc-edit-toggle')) });
      await waitForVisible(page, '.mc-edit-canvas.mc-editing', 3000);
      await sleep(300);
      all.push(...await audit(page, S('editing')));
      real.push({ device: d.name, step: 'Move the first tile (hand)', ...await handPress(page, (el) => el.classList?.contains?.('mc-edit-move')) });
      await sleep(300);
      real.push({ device: d.name, step: 'Done editing (hand)', ...await handPress(page, (el) => el.classList.contains('mc-edit-toggle')) });
      await sleep(300);
    }

    // AI activity / history
    if (d.mobile) {
      real.push({ device: d.name, step: 'Menu (hand)', ...await handPress(page, (el) => el.classList.contains('mc-menu-btn')) });
      await sleep(400);
      all.push(...await audit(page, S('menu-sheet')));
      await page.screenshot({ path: join(OUT, `${d.name}-menu-by-hand.png`) });
      real.push({ device: d.name, step: 'Menu close (hand)', ...await handPress(page, (el) => el.classList.contains('mc-menu-close')) });
      await sleep(300);
    }
    real.push({ device: d.name, step: 'AI activity', ...await handPress(page, (el) => el.dataset?.cmd === 'ai') });
    await sleep(500);
    all.push(...await audit(page, S('ai-activity')));
    await handPress(page, (el) => el.dataset?.cmd === 'ai');
    await sleep(300);

    // Mic by hand (sim has no speech: the press still toggles or explains)
    const mic = await handPress(page, (el) => el.classList.contains('mc-fab-mic'));
    await sleep(300);
    const micState = await page.evaluate(() => ({ pressed: document.querySelector('.mc-fab-mic').getAttribute('aria-pressed'), status: document.querySelector('.mc-canvas-status').textContent }));
    real.push({ device: d.name, step: 'Mic (hand)', ...mic, micState });
    await page.evaluate(() => { const r = document.querySelector('.mc-fab-mic').getBoundingClientRect(); window.__mcHand.pointAt(r.left + r.width / 2, r.top + r.height / 2); window.__mcHand.pinch(true); });
    await page.screenshot({ path: join(OUT, `${d.name}-mic-by-hand.png`) });
    await page.evaluate(() => { window.__mcHand.setDryRun(true); window.__mcHand.pinch(false); window.__mcHand.setDryRun(false); window.__mcHand.lost(); });

    // Connect sheet
    await page.evaluate(() => { const i = document.querySelector('#mc-say-in'); i.focus(); i.value = ''; });
    await page.keyboard.type('connect a device');
    await page.keyboard.press('Enter'); await sleep(800);
    all.push(...await audit(page, S('connect-sheet')));
    await page.keyboard.press('Escape'); await sleep(200);

    // Teach a gesture + custom gestures (modal dialogs)
    await page.evaluate(() => document.querySelector('[data-cmd=teach]').click()); await sleep(600);
    all.push(...await audit(page, S('teach')));
    await page.screenshot({ path: join(OUT, `${d.name}-teach.png`) });
    await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelector('.mc-teach-close')?.click()); await sleep(300);
    await page.evaluate(() => document.querySelector('[data-cmd=gestures]').click()); await sleep(600);
    all.push(...await audit(page, S('custom-gestures')));
    await page.evaluate(() => document.querySelector('.mc-teach-close')?.click()); await sleep(300);
    await page.close();
  }
} finally {
  await browser.close();
}

// FULL ARC, zero mouse: the whole demo story (dashboard swarm, floor plan,
// Kannada, offline/online, teach a gesture) driven by the simulated hand
// plus the say box standing in for voice. Runs once, on its own fresh page,
// after the per-control audit above. Resilient: a missing control is a
// recorded miss, not a hang.
let arc = { misses: [{ step: 'arc', why: 'did not run' }], mouseViolations: 0 };
try {
  const arcBrowser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'] });
  try {
    const page = await arcBrowser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/canvas.html?fresh=1&sim=1&hands=0`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.addScriptTag({ type: 'module', content: `import * as L from '/src/canvas/handPointer.ts'; window.__mcHandLib = L;` });
    await page.waitForFunction(() => window.__mcHand && window.__mcHandLib, { timeout: 15000 });
    await sleep(800);
    arc = await runArc(page, ARC_OUT);
    await page.close();
  } finally {
    await arcBrowser.close();
  }
} catch (e) {
  arc = { misses: [{ step: 'arc', why: String(e) }], mouseViolations: 0 };
}

// SHOWCASE: the rich nested dashboard (?showcase=energy — never reachable
// from the default demo URLs). Audits every new control type in the one
// state they're actually visible in: tab buttons switching panels (each
// switch brings a different panel's controls into reach — sortable table
// header, row-action button, toggle/slider/segmented-choice/submit, and the
// VisualTile's promoted data-action zones), then toggles Edit mode to check
// the new top-level tiles (Grid/Tabs/Card) get real move/resize chrome.
// Folds its findings into the SAME `all`/`real` arrays the per-device audit
// above uses, so a showcase regression fails the run exactly like any
// other control would — additive only; doesn't touch the arc or per-device
// loop above it.
try {
  const scBrowser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'] });
  try {
    const page = await scBrowser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/canvas.html?showcase=energy&sim=1&hands=0`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.addScriptTag({ type: 'module', content: `import * as L from '/src/canvas/handPointer.ts'; window.__mcHandLib = L;` });
    await page.waitForFunction(() => window.__mcHand && window.__mcHandLib, { timeout: 15000 });
    await sleep(800);
    // The energy showcase is a compact split (tabs beside the VisualTile)
    // so room-zone controls stay inside the default 1000×680 board at this
    // 1440×900 viewport. scrollIntoView is only a safety net if a future
    // fixture grows past the fold — collectControls ignores off-screen nodes.
    const scrollIntoView = (sel) => page.evaluate((s) => document.querySelector(s)?.scrollIntoView({ block: 'center' }), sel);

    all.push(...await audit(page, 'showcase:usage-tab'));

    real.push({ device: 'showcase', step: 'Room zone (hand)', ...await handPress(page, (el, l) => el.dataset?.action === 'zone-living' || /living room zone/i.test(l)) });
    await sleep(200);

    real.push({ device: 'showcase', step: 'Devices tab (hand)', ...await handPress(page, (el, l) => el.getAttribute('role') === 'tab' && /devices/i.test(l)) });
    await sleep(300);
    all.push(...await audit(page, 'showcase:devices-tab')); // sortable table header + row-action button now in reach

    real.push({ device: 'showcase', step: 'Settings tab (hand)', ...await handPress(page, (el, l) => el.getAttribute('role') === 'tab' && /settings/i.test(l)) });
    await sleep(300);
    all.push(...await audit(page, 'showcase:settings-tab')); // toggle/slider/choice/submit now in reach

    await scrollIntoView('.mc-edit-toggle');
    real.push({ device: 'showcase', step: 'Edit board (hand)', ...await handPress(page, (el) => el.classList.contains('mc-edit-toggle')) });
    await waitForVisible(page, '.mc-edit-canvas.mc-editing', 3000);
    await sleep(300);
    all.push(...await audit(page, 'showcase:editing')); // Grid/Tabs/Card top-level move+resize handles
    await page.screenshot({ path: join(OUT, 'showcase-editing.png') });
    real.push({ device: 'showcase', step: 'Done editing (hand)', ...await handPress(page, (el) => el.classList.contains('mc-edit-toggle')) });
    await page.close();
  } finally {
    await scBrowser.close();
  }
} catch (e) {
  all.push({ state: 'showcase', label: 'showcase pass', tag: 'error', inShadow: false, w: 0, h: 0, resolved: false, activated: false, snapsFromNear: false, error: String(e) });
} finally {
  if (vite) { try { process.kill(-vite.pid); } catch { /* gone */ } }
}

const fails = all.filter((r) => !r.resolved || !r.activated);
const smallButSnaps = all.filter((r) => (r.w < 44 || r.h < 44) && r.snapsFromNear).length;
const report = {
  controls: all.length,
  unique: new Set(all.map((r) => `${r.state.split(':')[0]}|${r.label}`)).size,
  inShadowDom: all.filter((r) => r.inShadow).length,
  passed: all.length - fails.length,
  failed: fails,
  snapFromNear: all.filter((r) => r.snapsFromNear).length,
  smallButSnaps,
  realHandActivations: real,
  arc: { misses: arc.misses, mouseViolations: arc.mouseViolations },
};
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ ...report, all }, null, 2));
console.log(JSON.stringify(report, null, 2));
if (fails.length || real.some((r) => !r.ok) || arc.mouseViolations > 0) process.exitCode = 1;
