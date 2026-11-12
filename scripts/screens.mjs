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

    // ui-03 — select the sign-in button via the renderer's pointer path.
    await command(page, 'select the button');
    await page.waitForTimeout(400);
    await shot(page, 'ui-03-selected.png');
    const selectedBtn = await page.evaluate(
      () => (document.querySelector('#parts-list li button.active')?.textContent || '').trim(),
    );
    assert(/Button/i.test(selectedBtn), `the button is selected ("${selectedBtn}")`);

    // ui-04 — voice edit: recolour then resize the selected button.
    await command(page, 'make the button blue');
    await page.waitForTimeout(300);
    await command(page, 'make it 48 pixels tall');
    await page.waitForTimeout(400);
    await shot(page, 'ui-04-voice-edit.png');

    // ui-05 — a mobile screen.
    await command(page, 'mobile login screen');
    await page.waitForTimeout(500);
    await shot(page, 'ui-05-mobile.png');
    const mobileW = await page.evaluate(
      () => document.querySelector('#viewport .ui-frame')?.getBoundingClientRect().width || 0,
    );
    assert(mobileW > 0, 'mobile frame rendered');

    // ui-06 — export clean HTML (+ SVG). Capture the HTML bytes.
    const uiDownloads = [];
    page.on('download', (d) => uiDownloads.push(d));
    await page.click('#btn-export');
    await page.waitForTimeout(1000);
    await shot(page, 'ui-06-export.png');
    const htmlDownload = uiDownloads.find((d) => d.suggestedFilename().endsWith('.html'));
    assert(!!htmlDownload, 'HTML download fired');
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

    await ctx.close();
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
