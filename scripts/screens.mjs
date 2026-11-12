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

    // 04 — select a wall (click == pinch-equivalent). Pick a long outer wall so
    // the selection highlight is unmistakable in the shot.
    const selected = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('#parts-list li button')];
      const w = btns.find((b) => /Wall w\d+ · 4\.00 m/.test(b.textContent || '')) ??
        btns.find((b) => /Wall w\d+/.test(b.textContent || ''));
      if (!w) return null;
      w.click();
      return w.textContent;
    });
    await page.waitForTimeout(500);
    await shot(page, '04-wall-selected.png');
    assert(/selected/i.test(await page.evaluate(
      () => document.querySelector('#parts-list li button.active')?.textContent || '',
    )), `wall selected (${selected})`);

    // 05 — set that wall to 4 m by voice/text.
    await command(page, 'make it 4 meters');
    await page.waitForTimeout(500);
    await shot(page, '05-wall-4m.png');
    const verifier = await page.evaluate(() => document.getElementById('verifier-result')?.textContent);
    assert(/4\.00 m/.test(verifier ?? ''), `wall set to 4 m ("${verifier?.trim()}")`);

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
