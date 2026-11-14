// a11y:axe — build, serve a preview, and run axe-core over every main screen in
// headless Chrome. Reports serious/critical WCAG violations. This is a manual
// report tool, NOT part of `vitest run` or the build gate (it needs a browser).
//
//   npm run a11y:axe
//
// Free stack: axe-core + puppeteer-core driving the already-installed
// /usr/bin/google-chrome (no Chromium download). If the deps or Chrome are
// missing it prints how to get them and exits 0 (never blocks a build).

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find((p) => existsSync(p));
}

// Screens to audit. `?view=` + `?sim=1` forms always hit index.html (no camera/
// mic/Nano needed) so the audit is deterministic and headless-safe.
const SCREENS = [
  { name: 'plan', path: '/?sim=1' },
  { name: 'ui', path: '/?sim=1&mode=ui' },
  { name: 'part', path: '/?sim=1&mode=part' },
  { name: 'control', path: '/?view=control' },
  { name: 'judges', path: '/?view=judges' },
  { name: 'tour-open', path: '/?sim=1', clickTourHelp: true },
];

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log('a11y:axe — no Chrome found. Set CHROME_PATH or install google-chrome. Skipping.');
    return 0;
  }

  let puppeteer, axeSource;
  try {
    puppeteer = require('puppeteer-core');
    axeSource = readFileSync(require.resolve('axe-core'), 'utf8');
  } catch {
    console.log('a11y:axe — missing deps. Run: npm install --no-save axe-core puppeteer-core. Skipping.');
    return 0;
  }

  console.log('a11y:axe — building…');
  const build = spawnSync('npm', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' });
  if (build.status !== 0) {
    console.log('a11y:axe — build failed, aborting.');
    return 1;
  }

  const port = 4319;
  console.log(`a11y:axe — starting preview on :${port}…`);
  const preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: appRoot,
    stdio: 'ignore',
    detached: true, // own process group, so we can kill vite + its children cleanly
  });
  preview.on('error', () => {});
  preview.unref();

  const base = `http://localhost:${port}`;
  let browser;
  let anyCritical = false;
  try {
    await waitForServer(base, 20000);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    });

    const totals = [];
    for (const screen of SCREENS) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      try {
        await page.goto(base + screen.path, { waitUntil: 'networkidle2', timeout: 25000 });
      } catch {
        // networkidle can hang on sim animations; proceed with whatever rendered.
      }
      await sleep(1200);

      if (screen.clickTourHelp) {
        const clicked = await page.evaluate(() => {
          const b = document.querySelector('#btn-help');
          if (b) { b.click(); return true; }
          return false;
        });
        if (clicked) await sleep(900);
      }

      await page.evaluate(axeSource);
      const result = await page.evaluate(async () => {
        // WCAG 2.0/2.1 A + AA.
        // eslint-disable-next-line no-undef
        return await axe.run(document, {
          runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
        });
      });

      const serious = result.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      if (serious.some((v) => v.impact === 'critical')) anyCritical = true;
      totals.push({ name: screen.name, serious });
      await page.close();
    }

    console.log('\n================ axe-core report (serious/critical) ================\n');
    for (const t of totals) {
      if (!t.serious.length) {
        console.log(`✓ ${t.name}: no serious/critical violations`);
        continue;
      }
      console.log(`✗ ${t.name}: ${t.serious.length} rule(s)`);
      for (const v of t.serious) {
        console.log(`   [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length} node(s))`);
        for (const n of v.nodes.slice(0, 3)) {
          console.log(`        ${n.target.join(' ')}`);
        }
        console.log(`        ${v.helpUrl}`);
      }
    }
    const grand = totals.reduce((a, t) => a + t.serious.length, 0);
    console.log(`\nTotal screens: ${totals.length}. Serious/critical rules across all: ${grand}.\n`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    // Kill the whole preview process group (vite + any children), ignoring the
    // signal so it does not bubble up as a non-zero exit of this script.
    try { process.kill(-preview.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  return anyCritical ? 1 : 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/');
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error('preview server did not start in time');
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('a11y:axe — error:', err?.message || err);
    process.exit(0); // never block on the report tool
  });
