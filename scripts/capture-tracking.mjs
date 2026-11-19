// capture-tracking.mjs — screenshot the synthetic tracking harness (see
// vite.config.ts's /__tracking-sim dev route) at desktop + two phone sizes.
//
//   node scripts/capture-tracking.mjs before   # or: after
//
// One headless Chrome, one `vite` dev server (port 5190), closed on exit.
// Free stack: puppeteer-core driving the already-installed Chrome, same as
// scripts/a11y-axe.mjs.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = '/workspace/hackathon/firebase-hybrid/screens/sim-main/tracking';

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

const SIZES = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1 },
  { name: 'iphone15', width: 393, height: 852, deviceScaleFactor: 3 },
  { name: 'nothing3a', width: 412, height: 915, deviceScaleFactor: 2.625 },
];

const POSES = ['open', 'point', 'pinch'];
const PORT = 5190;

async function main() {
  const prefix = process.argv[2];
  if (prefix !== 'before' && prefix !== 'after') {
    console.error('Usage: node scripts/capture-tracking.mjs <before|after>');
    return 1;
  }

  const chrome = findChrome();
  if (!chrome) {
    console.log('capture-tracking — no Chrome found. Set CHROME_PATH or install google-chrome. Skipping.');
    return 0;
  }
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    console.log('capture-tracking — missing puppeteer-core. Run: npm install --no-save puppeteer-core. Skipping.');
    return 0;
  }

  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`capture-tracking — starting vite dev on :${PORT}…`);
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], {
    cwd: appRoot,
    stdio: 'ignore',
    detached: true,
  });
  vite.on('error', () => {});
  vite.unref();

  const base = `http://localhost:${PORT}`;
  let browser;
  try {
    await waitForServer(base, 20000);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    for (const size of SIZES) {
      for (const pose of POSES) {
        const page = await browser.newPage();
        await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: size.deviceScaleFactor });
        await page.goto(`${base}/__tracking-sim?pose=${pose}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await page.waitForSelector('body[data-ready="1"]', { timeout: 5000 }).catch(() => {});
        const file = join(OUT_DIR, `${prefix}-${size.name}-${pose}.png`);
        await page.screenshot({ path: file });
        console.log(`  wrote ${file}`);
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  return 0;
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
  throw new Error('vite dev server did not start in time');
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('capture-tracking — error:', err?.message || err);
    process.exit(1);
  });
