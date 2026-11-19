// mobile:screens — deterministic screenshot walk for the phone + tablet
// companion shell (src/canvas/mobile/*), one PNG per state, no camera/mic/
// hub/network (?sim=1 drives every screen from mock data).
//
//   node scripts/mobile-screens.mjs
//
// Builds, serves a preview, and drives headless Chrome (puppeteer-core) at
// each target device's real viewport + DPR. Free stack, same as a11y-axe.mjs.

import { spawn, spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.env.OUT ?? '/workspace/hackathon/firebase-hybrid/screens/sim-main/mobile');

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

const PHONE_SCREENS = ['pair', 'canvas', 'dashboard', 'approval', 'gimbal'];

const DEVICES = [
  { prefix: 'iphone15', width: 393, height: 852, deviceScaleFactor: 3, platform: 'ios' },
  { prefix: 'nothing3a', width: 412, height: 915, deviceScaleFactor: 2.625, platform: 'android' },
];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(base + '/');
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('preview server did not start in time');
}

async function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.log('mobile:screens — no Chrome found. Set CHROME_PATH or install google-chrome. Skipping.');
    return 0;
  }
  let puppeteer;
  try {
    puppeteer = require('puppeteer-core');
  } catch {
    console.log('mobile:screens — missing puppeteer-core. Run: npm install --no-save puppeteer-core. Skipping.');
    return 0;
  }

  console.log('mobile:screens — building…');
  const build = spawnSync('npm', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' });
  if (build.status !== 0) {
    console.log('mobile:screens — build failed, aborting.');
    return 1;
  }

  await mkdir(OUT, { recursive: true });

  const port = 4320;
  console.log(`mobile:screens — starting preview on :${port}…`);
  const preview = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], {
    cwd: appRoot,
    stdio: 'ignore',
    detached: true,
  });
  preview.on('error', () => {});
  preview.unref();

  const base = `http://localhost:${port}`;
  let browser;
  let failed = false;
  try {
    await waitForServer(base, 20000);
    browser = await puppeteer.launch({
      executablePath: chrome,
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    for (const device of DEVICES) {
      const page = await browser.newPage();
      await page.setViewport({
        width: device.width,
        height: device.height,
        deviceScaleFactor: device.deviceScaleFactor,
        isMobile: true,
        hasTouch: true,
      });
      for (let i = 0; i < PHONE_SCREENS.length; i++) {
        const screen = PHONE_SCREENS[i];
        const url = `${base}/mobile.html?sim=1&mobileScreen=${screen}&platform=${device.platform}`;
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 20000 });
        await page.evaluate(() => document.fonts.ready);
        await sleep(250);
        const name = `${device.prefix}-${String(i + 1).padStart(2, '0')}-${screen}.png`;
        await page.screenshot({ path: resolve(OUT, name) });
        console.log(`  wrote ${name}`);
      }
      await page.close();
    }

    // One iPad split-view shot: the explicit tablet deep link, iOS styling.
    const ipad = await browser.newPage();
    await ipad.setViewport({ width: 820, height: 1180, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await ipad.goto(`${base}/mobile.html?sim=1&mobileScreen=tablet&platform=ios`, { waitUntil: 'networkidle0', timeout: 20000 });
    await sleep(250);
    await ipad.screenshot({ path: resolve(OUT, 'ipad-split.png') });
    console.log('  wrote ipad-split.png');
    await ipad.close();
  } catch (e) {
    console.error('mobile:screens — error:', e?.message || e);
    failed = true;
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { process.kill(-preview.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  console.log(`\nmobile:screens — screenshots in ${OUT}`);
  return failed ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((e) => { console.error(e); process.exit(1); });
