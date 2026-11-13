// Deterministic screenshot walk for the Mendcraft CAD ('plan') hero + the part
// fallback. Drives the real app headlessly through the judge path (/?sim=1) and
// the text command box — no camera, mic, or cloud required. Captures a numbered
// PNG per milestone and a real exported DXF.
//
//   BASE_URL  preview/app origin        (default http://localhost:4173)
//   OUT       screenshot output dir     (default ../screens, relative to app/)
//
//   node scripts/screens.mjs
//
// Needs `playwright` (or `playwright-core`) resolvable and a chromium browser
// (PLAYWRIGHT_BROWSERS_PATH / ~/.cache/ms-playwright). Fake media flags let the
// camera button degrade cleanly; nothing in the walk depends on real media.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE = (process.env.BASE_URL ?? 'http://localhost:4173').replace(/\/$/, '');
const OUT = resolve(__dirname, '..', process.env.OUT ?? '../screens');

async function loadChromium() {
  for (const spec of ['playwright', 'playwright-core']) {
    try {
      return (await import(spec)).chromium;
    } catch {
      /* try the next specifier */
    }
  }
  throw new Error('Could not import "playwright" or "playwright-core". Install one to run this script.');
}

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`✗ ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${msg}`);
  }
};

async function main() {
  const chromium = await loadChromium();
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  });

  const consoleErrors = [];
  const shot = (page, name) => page.screenshot({ path: resolve(OUT, name), fullPage: false });

  async function command(page, text) {
    await page.fill('#command-input', text);
    await page.click('#btn-say');
    await page.waitForTimeout(700);
  }
  const badge = (page) => page.evaluate(() => document.getElementById('source-badge')?.textContent?.trim());

  try {
    // 01 — first-run onboarding (fresh profile, no sim so the tour auto-opens).
    const first = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    const fp = first.newPage ? await first.newPage() : first;
    fp.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    fp.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
    await fp.goto(`${BASE}/`, { waitUntil: 'networkidle' });
    await fp.waitForSelector('#onboarding [role=dialog]', { timeout: 5000 });
    await fp.waitForTimeout(400);
    await shot(fp, '01-onboarding.png');
    const dialog = await fp.evaluate(() => document.querySelector('#onboarding [role=dialog] h2')?.textContent);
    assert(/privacy/i.test(dialog ?? ''), `onboarding opens on first run ("${dialog}")`);
    await first.close();

    // The main walk runs in the judge path with the tour suppressed.
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    const page = await ctx.newPage();
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    // 02 — empty plan.
    await page.goto(`${BASE}/?sim=1`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#viewport svg', { timeout: 5000 });
    await page.waitForTimeout(500);
    await shot(page, '02-empty-plan.png');
    assert(await page.isVisible('#empty-hint'), 'empty plan shows the hint');

    // 03 — generate a two-bedroom plan (rules fallback, labelled honestly).
    await command(page, 'two bedroom plan');
    await page.waitForTimeout(500);
    const planBadge = await badge(page);
    console.log(`plan path: ${planBadge} (sim/rules, no cloud)`);
    await shot(page, '03-two-bedroom-plan.png');
    const rooms = await page.evaluate(
      () => [...document.querySelectorAll('#parts-list li')].filter((li) => /m²/.test(li.textContent || '')).length,
    );
    assert(rooms >= 4, `two-bedroom plan drew ${rooms} rooms`);

    // 04 — select the SHARED 3.00 m wall between the two bedrooms (w3). The
    // generator pre-selects it, so it is already drawn in the selection blue;
    // click its midpoint on the SVG canvas — the pinch-equivalent pointer path
    // (a real mousedown→mouseup through the renderer's hit-test), not the side
    // list — so "make it 4 meters" visibly stretches it.
    const selected = await page.evaluate(() => {
      const svg = document.querySelector('#viewport svg');
      if (!svg) return null;
      // The selected wall renders as a thick blue line (#2563eb); dim/door lines
      // in the same blue are thin (stroke-width < 2), so filter on thickness.
      const line = [...svg.querySelectorAll('line')].find(
        (l) => l.getAttribute('stroke') === '#2563eb' && Number(l.getAttribute('stroke-width')) > 2,
      );
      if (!line) return null;
      const x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1');
      const x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
      const rect = svg.getBoundingClientRect();
      const clientX = rect.left + (x1 + x2) / 2;
      const clientY = rect.top + (y1 + y2) / 2;
      const opts = { bubbles: true, clientX, clientY };
      svg.dispatchEvent(new MouseEvent('mousedown', opts));
      window.dispatchEvent(new MouseEvent('mouseup', opts));
      return document.querySelector('#parts-list li button.active')?.textContent ?? null;
    });
    await page.waitForTimeout(500);
    await shot(page, '04-wall-selected.png');
    const activeLabel = await page.evaluate(
      () => document.querySelector('#parts-list li button.active')?.textContent || '',
    );
    assert(/Wall w3 · 3\.00 m/.test(activeLabel), `shared 3 m wall w3 selected on canvas ("${activeLabel.trim()}")`);

    // 05 — set that shared wall to 4 m by voice/text. It visibly stretches: both
    // bedrooms grow, the dimension re-reads 4.00 m (no stale 3.00 m), the plan
    // re-fits taller.
    await command(page, 'make it 4 meters');
    await page.waitForTimeout(500);
    await shot(page, '05-wall-4m.png');
    const verifier = await page.evaluate(() => document.getElementById('verifier-result')?.textContent);
    assert(/w3 set to 4\.00 m/.test(verifier ?? ''), `shared wall set to 4 m ("${verifier?.trim()}")`);
    // The on-canvas dimension must now read 4.00 m and no stale 3.00 m may remain.
    const dimTexts = await page.evaluate(
      () => [...document.querySelectorAll('#viewport svg text')].map((t) => t.textContent || ''),
    );
    assert(dimTexts.includes('4.00 m'), 'a 4.00 m dimension is drawn after the stretch');
    assert(!dimTexts.includes('3.00 m'), 'no stale 3.00 m dimension remains on the shared wall');

    // 06 — extrude to 3D.
    assert(!(await page.evaluate(() => document.getElementById('btn-3d')?.hidden)), '3D button available');
    await page.click('#btn-3d');
    await page.waitForTimeout(1200);
    await shot(page, '06-3d-view.png');
    assert(
      (await page.evaluate(() => document.getElementById('btn-3d')?.getAttribute('aria-pressed'))) === 'true',
      '3D view toggled on',
    );
    // Back to 2D so the export shot reads as a plan.
    await page.click('#btn-3d');
    await page.waitForTimeout(600);

    // 07 — export DXF (+ JSON). Capture the DXF bytes and assert the structure.
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.click('#btn-export');
    await page.waitForTimeout(1200);
    await shot(page, '07-dxf-export.png');
    const dxfDownload = downloads.find((d) => d.suggestedFilename().endsWith('.dxf'));
    assert(!!dxfDownload, 'DXF download fired');
    if (dxfDownload) {
      const path = resolve(OUT, '07-export.dxf');
      const stream = await dxfDownload.createReadStream();
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const dxf = Buffer.concat(chunks).toString('utf8');
      await writeFile(path, dxf);
      assert(dxf.includes('SECTION'), 'DXF contains "SECTION"');
      assert(dxf.includes('ENTITIES'), 'DXF contains "ENTITIES"');
      console.log(`  wrote ${path} (${dxf.length} bytes)`);
    }

    // 08 — part mode fallback (cup grip in the 3D viewport).
    await page.goto(`${BASE}/?sim=1&mode=part`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    await command(page, 'cup grip');
    await page.waitForTimeout(1200);
    await shot(page, '08-part-mode.png');
    const partItems = await page.evaluate(
      () => [...document.querySelectorAll('#parts-list li')].map((li) => li.textContent),
    );
    assert(partItems.some((t) => /grip|sleeve/i.test(t || '')), `part mode built the cup grip (${partItems.join(', ')})`);

    // ─── UI-design mode walk (?mode=ui) ──────────────────────────────────────
    // ui-01 — empty frame.
    await page.goto(`${BASE}/?sim=1&mode=ui`, { waitUntil: 'networkidle' });
    await page.waitForSelector('#viewport .ui-scroll', { timeout: 5000 });
    await page.waitForTimeout(400);
    await shot(page, 'ui-01-empty-frame.png');
    assert(await page.isVisible('#viewport .ui-empty'), 'ui mode shows an empty-frame hint');

    // ui-02 — generate a login screen (rules fallback, honest badge).
    await command(page, 'login screen');
    await page.waitForTimeout(500);
    const uiBadge = await badge(page);
    console.log(`ui path: ${uiBadge} (sim/rules, no cloud)`);
    await shot(page, 'ui-02-login.png');
    const hasButton = await page.evaluate(
      () => !!document.querySelector('#viewport .ui-frame [data-id^="btn-"]'),
    );
    assert(hasButton, 'login screen rendered a sign-in button');
    // B — the desktop login is a centred card (~400px), not a full-1440 form.
    const loginWidths = await page.evaluate(() => {
      const frame = document.querySelector('#viewport .ui-frame');
      const btn = document.querySelector('#viewport .ui-frame [data-id^="btn-"]');
      if (!frame || !btn) return null;
      return { fw: frame.getBoundingClientRect().width, bw: btn.getBoundingClientRect().width };
    });
    assert(
      loginWidths && loginWidths.bw / loginWidths.fw < 0.45,
      `desktop login is a centred card, not full-width (button ${loginWidths ? Math.round((loginWidths.bw / loginWidths.fw) * 100) : '?'}% of frame)`,
    );

    // ui-03 — select the sign-in button by CLICKING it on the canvas (the
    // renderer's real pointer path = the pinch equivalent), not the side list.
    const clickedBtn = await page.evaluate(() => {
      const btn = document.querySelector('#viewport .ui-frame [data-id^="btn-"]');
      if (!btn) return null;
      const r = btn.getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
      btn.dispatchEvent(new MouseEvent('mousedown', opts));
      window.dispatchEvent(new MouseEvent('mouseup', opts));
      return true;
    });
    assert(!!clickedBtn, 'sign-in button present to click on the canvas');
    await page.waitForTimeout(400);
    await shot(page, 'ui-03-selected.png');
    const selectedBtn = await page.evaluate(
      () => (document.querySelector('#parts-list li button.active')?.textContent || '').trim(),
    );
    assert(/Button/i.test(selectedBtn), `the button is selected via canvas click ("${selectedBtn}")`);

    // ui-04 — voice edits that are VISIBLE: recolour the button green, make it
    // taller, and enlarge the heading.
    await command(page, 'make the button green');
    await page.waitForTimeout(250);
    await command(page, 'make it 56 pixels tall');
    await page.waitForTimeout(250);
    await command(page, 'bigger heading');
    await page.waitForTimeout(400);
    await shot(page, 'ui-04-voice-edit.png');
    const btnGreen = await page.evaluate(() => {
      const btn = document.querySelector('#viewport .ui-frame [data-id^="btn-"]');
      return btn ? getComputedStyle(btn).backgroundColor : '';
    });
    assert(/22,\s*163,\s*74/.test(btnGreen), `the button turned green ("${btnGreen}")`);

    // ui-05 — a mobile screen.
    await command(page, 'mobile login screen');
    await page.waitForTimeout(500);
    await shot(page, 'ui-05-mobile.png');
    const mobileW = await page.evaluate(
      () => document.querySelector('#viewport .ui-frame')?.getBoundingClientRect().width || 0,
    );
    assert(mobileW > 0, 'mobile frame rendered');
    // D — the op/JSON panel reflects the latest command, not a stale set_size.
    const opJson = await page.evaluate(() => document.getElementById('op-json')?.textContent || '');
    assert(
      /generate/.test(opJson) && !/set_size/.test(opJson),
      `op panel shows the latest command ("${opJson.replace(/\s+/g, ' ').trim().slice(0, 50)}")`,
    );

    // ui-06 — open the export panel (preview + code + actions), screenshot it,
    // then download the HTML from the panel and prove Esc closes it.
    const uiDownloads = [];
    page.on('download', (d) => uiDownloads.push(d));
    await page.click('#btn-export');
    await page.waitForSelector('#ui-export-panel .export-iframe', { timeout: 5000 });
    await page.waitForTimeout(600);
    await shot(page, 'ui-06-export.png');
    assert(await page.isVisible('#ui-export-panel [role=dialog]'), 'export panel opens as a dialog');
    const panelHasCode = await page.evaluate(
      () => /<!DOCTYPE html>/.test(document.querySelector('.export-code')?.textContent || ''),
    );
    assert(panelHasCode, 'export panel shows the exported HTML source');
    await page.click('.export-actions button'); // Download HTML
    await page.waitForTimeout(600);
    const htmlDownload = uiDownloads.find((d) => d.suggestedFilename().endsWith('.html'));
    assert(!!htmlDownload, 'HTML download fired from the panel');
    if (htmlDownload) {
      const path = resolve(OUT, 'ui-06-export.html');
      const stream = await htmlDownload.createReadStream();
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const htmlOut = Buffer.concat(chunks).toString('utf8');
      await writeFile(path, htmlOut);
      assert(htmlOut.includes('<!DOCTYPE html>'), 'exported HTML is a full document');
      assert(/<button/.test(htmlOut), 'exported HTML has a <button>');
      console.log(`  wrote ${path} (${htmlOut.length} bytes)`);
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    assert(!(await page.isVisible('#ui-export-panel')), 'Esc closes the export panel');

    await ctx.close();

    // ─── Palette walks: on-canvas tools via the SHARED pointer path ──────────
    // Every placement below drives the exact pointer stream a pinch uses: a real
    // press on a palette button (data-tool), a drag onto the canvas, release to
    // drop. page.mouse emits pointer+mouse together, so the palette's pick-and-
    // place (pointer) and the renderer's tool controller (mouse) both react.
    const palctx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    const pal = await palctx.newPage();
    // The browser reference panel frames external sites (e.g. MDN) that set
    // X-Frame-Options: deny — a framing refusal from a third-party site, not an
    // app fault, so it must not fail the walk.
    const benign = (t) => /X-Frame-Options|Refused to display|in a frame because/i.test(t);
    pal.on('console', (m) => m.type() === 'error' && !benign(m.text()) && consoleErrors.push(m.text()));
    pal.on('pageerror', (e) => !benign(e.message) && consoleErrors.push(`pageerror: ${e.message}`));

    const btnCenter = (pg, tool) =>
      pg.$eval(`.mc-palette [data-tool="${tool}"]`, (el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      });
    async function armTool(pg, tool) {
      const b = await btnCenter(pg, tool);
      await pg.mouse.click(b.x, b.y);
      await pg.waitForTimeout(80);
    }
    // Press a palette button, drag off it onto the canvas (>6px arms the ghost),
    // settle over the drop point so the tool's onHover snaps, then release.
    async function dragPlace(pg, tool, cx, cy) {
      const b = await btnCenter(pg, tool);
      await pg.mouse.move(b.x, b.y);
      await pg.mouse.down();
      await pg.mouse.move(b.x + (cx - b.x) * 0.5, b.y + (cy - b.y) * 0.5, { steps: 4 });
      await pg.mouse.move(cx, cy, { steps: 4 });
      await pg.mouse.move(cx, cy);
      await pg.waitForTimeout(70);
      await pg.mouse.up();
      await pg.waitForTimeout(140);
    }
    // Midpoints (client px) of the longest drawn walls, for hosting openings.
    const wallTargets = (pg) =>
      pg.evaluate(() => {
        const svg = document.querySelector('#viewport svg');
        const r = svg.getBoundingClientRect();
        const walls = [...svg.querySelectorAll('line')]
          .filter((l) => l.getAttribute('stroke') === '#1f2937')
          .map((l) => {
            const x1 = +l.getAttribute('x1'), y1 = +l.getAttribute('y1');
            const x2 = +l.getAttribute('x2'), y2 = +l.getAttribute('y2');
            return { x1, y1, x2, y2, len: Math.hypot(x2 - x1, y2 - y1) };
          })
          .sort((a, b) => b.len - a.len);
        const at = (w, t) => ({ x: r.left + w.x1 + (w.x2 - w.x1) * t, y: r.top + w.y1 + (w.y2 - w.y1) * t });
        // A point well inside a room: the first room name label's position.
        const label = [...svg.querySelectorAll('text')].find((t) => /Bedroom|Living|Kitchen|Room/i.test(t.textContent || ''));
        const lb = label && label.getBoundingClientRect();
        return {
          count: walls.length,
          door: walls[0] && at(walls[0], 0.35),
          window: walls[1] && at(walls[1], 0.4),
          wallA: walls[0] && at(walls[0], 0.12),
          wallB: walls[0] && at(walls[0], 0.88),
          room: lb ? { x: lb.left + lb.width / 2, y: lb.top + lb.height / 2 + 40 } : null,
          center: { x: r.left + r.width / 2, y: r.top + r.height / 2 },
        };
      });

    // palette-plan-01 — empty canvas with the on-canvas palette docked.
    await pal.goto(`${BASE}/?sim=1`, { waitUntil: 'networkidle' });
    await pal.waitForSelector('#viewport svg', { timeout: 5000 });
    await pal.waitForSelector('.mc-palette', { timeout: 5000 });
    await pal.waitForTimeout(400);
    await shot(pal, 'palette-plan-01-empty.png');
    assert(await pal.isVisible('.mc-palette'), 'plan palette docked on the empty canvas');
    assert(
      (await pal.$$('.mc-palette [data-tool="wall"]')).length === 1,
      'palette exposes the Wall tool button',
    );

    // palette-plan-02 — a real plan, then a door + window hosted on its walls and
    // a double bed dropped from the Furniture flyout, all via the palette.
    await command(pal, 'two bedroom plan');
    await pal.waitForTimeout(600);
    let wt = await wallTargets(pal);
    assert(wt.count >= 4, `plan drew ${wt.count} walls to host openings on`);
    if (wt.door) await dragPlace(pal, 'door', wt.door.x, wt.door.y);
    wt = await wallTargets(pal); // geometry/scale may have re-fit after the drop
    if (wt.window) await dragPlace(pal, 'window', wt.window.x, wt.window.y);
    // Furniture lives in a flyout: open it, then drag the double bed onto a room.
    await pal.mouse.click((await btnCenter(pal, 'furniture-group')).x, (await btnCenter(pal, 'furniture-group')).y);
    await pal.waitForTimeout(150);
    wt = await wallTargets(pal);
    const bedPt = wt.room || wt.center;
    await dragPlace(pal, 'fx:bed-double', bedPt.x, bedPt.y);
    await pal.waitForTimeout(300);
    // Drop back to Select so the armed fixture's hover-ghost clears, and park the
    // cursor off the canvas, for a clean "furnished plan" frame.
    await armTool(pal, 'select');
    await pal.mouse.move(wt.center.x, wt.center.y + 160);
    await pal.waitForTimeout(150);
    await shot(pal, 'palette-plan-02-drawn.png');
    const planCounts = await pal.evaluate(() => {
      const t = (document.getElementById('parts-list')?.textContent || '').toLowerCase();
      return { door: /door/.test(t), window: /window/.test(t), bed: /bed/.test(t) };
    });
    assert(planCounts.door, 'a door was hosted on a wall from the palette');
    assert(planCounts.window, 'a window was hosted on a wall from the palette');
    assert(planCounts.bed, 'a bed fixture was dropped from the Furniture flyout');

    // palette-plan-03 — select a wall on the canvas; the properties panel opens.
    await armTool(pal, 'select');
    wt = await wallTargets(pal);
    await pal.mouse.click(wt.door.x, wt.door.y);
    await pal.waitForTimeout(300);
    await shot(pal, 'palette-plan-03-properties.png');
    assert(await pal.isVisible('.mc-props'), 'plan properties panel opens for the selection');

    // palette-plan-04 — extrude the plan to 3D blocks.
    assert(!(await pal.evaluate(() => document.getElementById('btn-3d')?.hidden)), '3D button available in plan mode');
    await pal.click('#btn-3d');
    await pal.waitForTimeout(1200);
    await shot(pal, 'palette-plan-04-3d.png');
    assert(
      (await pal.evaluate(() => document.getElementById('btn-3d')?.getAttribute('aria-pressed'))) === 'true',
      'plan 3D view toggled on',
    );
    await pal.click('#btn-3d');
    await pal.waitForTimeout(600);

    // palette-plan-05 — measure a wall with the Measure tool (click two ends).
    await armTool(pal, 'measure');
    wt = await wallTargets(pal);
    await pal.mouse.click(wt.wallA.x, wt.wallA.y);
    await pal.waitForTimeout(120);
    await pal.mouse.click(wt.wallB.x, wt.wallB.y);
    await pal.waitForTimeout(150);
    await pal.keyboard.press('Enter');
    await pal.waitForTimeout(300);
    await shot(pal, 'palette-plan-05-measure.png');
    const measured = await pal.evaluate(
      () => [...document.querySelectorAll('#viewport svg text')].some((t) => / m$/.test(t.textContent || '')),
    );
    assert(measured, 'a measured dimension (… m) is drawn on the canvas');

    // ─── UI-design palette walk ─────────────────────────────────────────────
    // palette-ui-01 — empty frame with the palette docked.
    await pal.goto(`${BASE}/?sim=1&mode=ui`, { waitUntil: 'networkidle' });
    await pal.waitForSelector('#viewport .ui-scroll', { timeout: 5000 });
    await pal.waitForSelector('.mc-palette', { timeout: 5000 });
    await pal.waitForTimeout(400);
    await shot(pal, 'palette-ui-01-empty.png');
    assert(await pal.isVisible('.ui-empty'), 'ui mode shows the empty-frame hint + palette');

    // palette-ui-02 — build a screen from the palette: add a desktop frame from
    // the Frame flyout, then stack a navbar, heading, input and button down its
    // centre line (every drop inside the on-screen frame box so they land).
    const sc = await pal.$eval('#viewport .ui-scroll', (s) => {
      const r = s.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    });
    await pal.mouse.click((await btnCenter(pal, 'frame-group')).x, (await btnCenter(pal, 'frame-group')).y);
    await pal.waitForTimeout(150);
    await armTool(pal, 'frame-desktop');
    await pal.mouse.click(sc.left + sc.w * 0.5, sc.top + sc.h * 0.5);
    await pal.waitForTimeout(200);
    const fr = await pal.$eval('#viewport .ui-frame', (el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, w: r.width, h: r.height };
    });
    // A left-of-centre column: the elements stay x-aligned (so the alignment
    // guide later is a long, clear line) and well clear of the properties panel.
    const colX = fr.left + fr.w * 0.38;
    // Click-to-place each element down the centre line (arm the tool, click the
    // frame) — the same pointer path a pinch-tap drives.
    for (const [tool, oy] of [['navbar', 70], ['heading', 150], ['input', 230], ['button', 310]]) {
      await armTool(pal, tool);
      await pal.mouse.click(colX, fr.top + oy);
      await pal.waitForTimeout(140);
    }
    await pal.waitForTimeout(200);
    await shot(pal, 'palette-ui-02-built.png');
    const nodeCount = await pal.evaluate(
      () => document.querySelectorAll('#viewport .ui-frame [data-id]').length,
    );
    assert(nodeCount >= 4, `built ${nodeCount} elements on the frame from the palette`);

    // palette-ui-03 — grab the lowest element and nudge it; because everything was
    // dropped on the same centre line, a pink alignment guide snaps in mid-drag.
    await armTool(pal, 'select');
    const grab = await pal.evaluate(() => {
      const nodes = [...document.querySelectorAll('#viewport .ui-frame [data-id]')];
      let best = null;
      for (const n of nodes) {
        const r = n.getBoundingClientRect();
        if (r.width > 8 && r.width < 400 && (!best || r.top > best.top)) {
          best = { top: r.top, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return best && { x: best.x, y: best.y };
    });
    assert(!!grab, 'found an element to drag for the alignment-guide shot');
    await pal.mouse.move(grab.x, grab.y);
    await pal.mouse.down();
    await pal.mouse.move(grab.x + 12, grab.y - 70, { steps: 4 }); // nudge off the centre line
    await pal.mouse.move(grab.x, grab.y - 150, { steps: 6 }); // snap back to it, high in open canvas
    await pal.waitForTimeout(150);
    await shot(pal, 'palette-ui-03-guides.png');
    const guideShown = await pal.evaluate(() =>
      [...document.querySelectorAll('div')].some((d) => getComputedStyle(d).backgroundColor === 'rgb(236, 72, 153)'),
    );
    assert(guideShown, 'a pink alignment guide is visible mid-drag');
    await pal.mouse.up();
    await pal.waitForTimeout(150);

    // palette-ui-04 — the selection's properties panel.
    await shot(pal, 'palette-ui-04-properties.png');
    assert(await pal.isVisible('.mc-props'), 'ui properties panel shows for the dragged element');

    // palette-ui-05 — the export panel (preview + code).
    await pal.click('#btn-export');
    await pal.waitForSelector('#ui-export-panel', { timeout: 5000 });
    await pal.waitForTimeout(500);
    await shot(pal, 'palette-ui-05-export.png');
    assert(await pal.isVisible('#ui-export-panel'), 'ui export panel opens');
    await pal.keyboard.press('Escape');
    await pal.waitForTimeout(200);

    // ─── Input extras (gestures / on-screen keyboard / browser reference) ────
    await pal.goto(`${BASE}/?sim=1`, { waitUntil: 'networkidle' });
    await pal.waitForSelector('#viewport svg', { timeout: 5000 });
    await pal.waitForTimeout(300);
    if (await pal.$('#btn-gestures')) {
      await pal.click('#btn-gestures');
      await pal.waitForSelector('.mc-gestures-panel', { timeout: 3000 });
      await pal.waitForTimeout(300);
      await shot(pal, 'extras-gestures.png');
      assert(await pal.isVisible('.mc-gestures-panel'), 'customizable gestures panel opens');
      await pal.click('#btn-gestures');
    }
    if (await pal.$('#btn-keyboard')) {
      // The keyboard mirrors the focused field; trigger the toggle while the
      // command input holds focus (a real button click would steal it).
      await pal.evaluate(() => {
        document.getElementById('command-input')?.focus();
        document.getElementById('btn-keyboard')?.click();
      });
      await pal.waitForSelector('.mc-keyboard:not([hidden])', { timeout: 3000 });
      await pal.waitForTimeout(300);
      await shot(pal, 'extras-keyboard.png');
      assert(await pal.isVisible('.mc-keyboard'), 'on-screen keyboard shows');
      await pal.click('#btn-keyboard');
    }
    if (await pal.$('#btn-reference')) {
      await pal.click('#btn-reference');
      await pal.waitForSelector('.mc-ref-panel', { timeout: 3000 });
      await pal.waitForTimeout(400);
      await shot(pal, 'extras-browser.png');
      assert(await pal.isVisible('.mc-ref-panel'), 'browser reference panel opens');
      await pal.click('#btn-reference');
    }

    await palctx.close();

    // ─── Hybrid AI feature walks (ai-*): the new on-device/cloud features, each
    // driven through the judge path and the same shared command/pointer pipeline.
    const aictx = await browser.newContext({ viewport: { width: 1360, height: 860 } });
    const ap = await aictx.newPage();
    ap.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
    ap.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

    // Seed a two-bedroom plan to operate on.
    await ap.goto(`${BASE}/?sim=1`, { waitUntil: 'networkidle' });
    await ap.waitForSelector('#viewport svg', { timeout: 5000 });
    await ap.waitForTimeout(300);
    await command(ap, 'two bedroom plan');
    await ap.waitForTimeout(500);

    // ai-fusion — select the shared wall on the canvas (the pinch pointer path),
    // then a deictic single-op command runs through the hybrid fusion router.
    // Open the Routing panel to show the planned path vs. the honest actual source.
    await ap.evaluate(() => {
      const svg = document.querySelector('#viewport svg');
      if (!svg) return;
      const line = [...svg.querySelectorAll('line')].find(
        (l) => l.getAttribute('stroke') === '#2563eb' && Number(l.getAttribute('stroke-width')) > 2,
      );
      if (!line) return;
      const x1 = +line.getAttribute('x1'), y1 = +line.getAttribute('y1');
      const x2 = +line.getAttribute('x2'), y2 = +line.getAttribute('y2');
      const r = svg.getBoundingClientRect();
      const opts = { bubbles: true, clientX: r.left + (x1 + x2) / 2, clientY: r.top + (y1 + y2) / 2 };
      svg.dispatchEvent(new MouseEvent('mousedown', opts));
      window.dispatchEvent(new MouseEvent('mouseup', opts));
    });
    await ap.waitForTimeout(200);
    await command(ap, 'make this wall thicker by 30');
    await ap.waitForTimeout(300);
    const hasRouting = !!(await ap.$('#btn-routing'));
    if (hasRouting) { await ap.click('#btn-routing'); await ap.waitForTimeout(300); }
    await shot(ap, 'ai-fusion.png');
    const fusionBadge = await badge(ap);
    assert(!!fusionBadge, `fusion/deictic command produced a source badge ("${fusionBadge}")`);
    const routed = await ap.evaluate(
      () => document.querySelectorAll('.mc-router-row, #router-log li, [data-router-row]').length,
    );
    console.log(`routing entries after fusion: ${routed}`);
    if (hasRouting) { await ap.click('#btn-routing'); await ap.waitForTimeout(150); }

    // ai-a11y — run the accessibility check (deterministic code checks); the panel
    // lists each issue with its cited standard and a one-click fix. Accept the
    // fixes and confirm the issue count drops (the fix really applied, undoably).
    await command(ap, 'check accessibility');
    await ap.waitForSelector('.mc-a11y-panel:not([hidden])', { timeout: 3000 });
    await ap.waitForTimeout(300);
    await shot(ap, 'ai-a11y.png');
    const a11yCount = await ap.evaluate(() => document.querySelectorAll('.mc-a11y-row').length);
    assert(a11yCount >= 1, `accessibility check listed ${a11yCount} issue(s)`);
    const fixOutcome = await ap.evaluate(() => {
      const btn = [...document.querySelectorAll('.mc-a11y-panel button')]
        .find((b) => /fix all/i.test(b.textContent || '') && !b.disabled);
      if (!btn) return 'no-fixable';
      btn.click();
      return 'clicked';
    });
    await ap.waitForTimeout(400);
    const a11yAfter = await ap.evaluate(() => document.querySelectorAll('.mc-a11y-row').length);
    assert(
      fixOutcome !== 'clicked' || a11yAfter < a11yCount,
      `accepting the accessibility fix reduced issues (${a11yCount} → ${a11yAfter}, ${fixOutcome})`,
    );
    if (await ap.$('#btn-a11y')) { await ap.click('#btn-a11y'); await ap.waitForTimeout(150); }

    // ai-adapt — simulated hand metrics (numbers only, no camera) drive the
    // on-device profile pick; the toast + hand-profile panel show the result.
    // mcSim.adapt() runs the pick AND opens the hand-profile panel with the same
    // simulated metrics (the toolbar button would reset them to the empty sampler).
    await ap.evaluate(() => (window.mcSim && window.mcSim.adapt && window.mcSim.adapt()));
    await ap.waitForTimeout(450);
    await shot(ap, 'ai-adapt.png');
    const toastText = await ap.evaluate(() => {
      const t = document.getElementById('mc-toast');
      return t && !t.hidden ? (t.textContent || '') : '';
    });
    assert(!!toastText, `hand-adapt toast shown ("${toastText.slice(0, 48)}")`);
    const adaptPinches = await ap.evaluate(
      () => (document.querySelector('.mc-hands-panel, [class*="hands"]')?.textContent || ''),
    );
    console.log(`hand panel reflects simulated metrics: ${/pinch/i.test(adaptPinches)}`);
    if (await ap.$('#btn-hands')) { await ap.click('#btn-hands'); await ap.waitForTimeout(150); }

    // ai-offline — go offline (real navigator flip), queue a big cloud job, then
    // reconnect so the queue drains to the honest on-device result (ready to apply).
    await aictx.setOffline(true);
    await ap.waitForTimeout(300);
    await command(ap, 'studio apartment');
    await ap.waitForTimeout(700);
    // The queue card sits at the top of the side panel; scroll it into view and
    // clear the lingering adapt toast so the offline queue is the clear subject.
    await ap.evaluate(() => {
      document.getElementById('panel')?.scrollTo(0, 0);
      const t = document.getElementById('mc-toast');
      if (t) t.hidden = true;
    });
    await ap.waitForTimeout(150);
    await shot(ap, 'ai-offline.png');
    const netText = await ap.evaluate(() => document.getElementById('net-state')?.textContent || '');
    assert(/offline/i.test(netText), `network indicator reads offline ("${netText}")`);
    const queuedCount = await ap.evaluate(() => {
      const s = document.getElementById('queue-section');
      return s && !s.hidden ? s.querySelectorAll('.queue-item').length : 0;
    });
    assert(queuedCount >= 1, `a cloud job was queued while offline (${queuedCount})`);
    await aictx.setOffline(false);
    await ap.waitForTimeout(1200);
    const drainStatuses = await ap.evaluate(
      () => [...document.querySelectorAll('.queue-item-status')].map((e) => (e.textContent || '').trim()),
    );
    assert(
      drainStatuses.length === 0 || drainStatuses.some((s) => /ready|running/i.test(s)),
      `queue drained on reconnect (${drainStatuses.join(' | ') || 'empty'})`,
    );

    // ai-ledger — "what left this device": the running tally of cloud calls (with
    // the abstract payload that was sent) vs. the private on-device events.
    await ap.click('#btn-ledger');
    await ap.waitForSelector('.mc-ledger-panel:not([hidden])', { timeout: 3000 });
    await ap.waitForTimeout(300);
    await shot(ap, 'ai-ledger.png');
    assert(await ap.isVisible('.mc-ledger-panel'), 'ledger panel lists what left the device');
    await ap.click('#btn-ledger');
    await ap.waitForTimeout(150);

    // ai-kannada — switch the language to Kannada; the live caption bar shows the
    // (simulated) transcript, and the badge stays honest about the source.
    await ap.selectOption('#lang-select', 'kn');
    await ap.waitForTimeout(300);
    await command(ap, 'ಈ ಗೋಡೆಯನ್ನು ದಪ್ಪ ಮಾಡು');
    await ap.waitForTimeout(400);
    await shot(ap, 'ai-kannada.png');
    const caption = await ap.evaluate(() => {
      const c = document.getElementById('caption-bar');
      return c && !c.hidden ? (document.getElementById('caption-heard')?.textContent || '') : '';
    });
    assert(!!caption, `live caption shows the Kannada transcript ("${caption}")`);
    await ap.selectOption('#lang-select', 'en');
    await ap.waitForTimeout(250);

    // ai-phrase — teach a personal phrase entirely on-device (no model call,
    // nothing leaves the machine); the confirmation + op panel prove it was saved.
    await command(ap, 'teach beef it up means thicker by 20');
    await ap.waitForTimeout(400);
    // Scroll the side panel so the learned-op JSON and the "Learned:" confirmation
    // are both in frame.
    await ap.evaluate(() => document.getElementById('panel')?.scrollTo(0, 9999));
    await ap.waitForTimeout(150);
    await shot(ap, 'ai-phrase.png');
    const learned = await ap.evaluate(() => document.getElementById('verifier-result')?.textContent || '');
    assert(/learn/i.test(learned), `phrasebook learned the phrase on-device ("${learned.trim().slice(0, 60)}")`);

    // ai-point (point-and-say) is a camera-deixis feature: it needs a live video
    // frame to crop around the pinch, which the headless judge path has no way to
    // supply, so no deterministic screenshot is produced here. The deictic command
    // path it falls through to is exercised by ai-fusion above.
    console.log('ai-point: skipped — point-and-say needs a live camera frame (not reproducible headless).');

    await aictx.close();
  } finally {
    await browser.close();
  }

  console.log('\nconsole errors during walk:', consoleErrors.length ? `\n  ${consoleErrors.join('\n  ')}` : 'none');
  console.log(`screenshots in ${OUT}`);
  if (consoleErrors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
