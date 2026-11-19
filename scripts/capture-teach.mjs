// capture-teach.mjs — drives the teach-a-gesture flow end to end under
// ?sim=1 (deterministic synthetic recording) and screenshots each step:
// recording, the approval Proposal card, the custom gestures list, and the
// history line. One headless Chrome, one `vite` dev server, both closed on
// exit — same stack as scripts/a11y-axe.mjs.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = '/workspace/hackathon/firebase-hybrid/screens/sim-main/tracking';
const PORT = 5190;

function findChrome() {
  return [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser']
    .filter(Boolean)
    .find((p) => existsSync(p));
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function waitForServer(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { const res = await fetch(base + '/'); if (res.ok) return; } catch { /* not up yet */ }
    await sleep(300);
  }
  throw new Error('vite dev server did not start in time');
}

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log('capture-teach — no Chrome found. Skipping.'); return 0; }
  let puppeteer;
  try { puppeteer = require('puppeteer-core'); } catch { console.log('capture-teach — missing puppeteer-core. Skipping.'); return 0; }

  mkdirSync(OUT_DIR, { recursive: true });
  const vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: appRoot, stdio: 'ignore', detached: true });
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
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`${base}/canvas.html?fresh=1&sim=1`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await sleep(1200);

    await page.click('[data-cmd=teach]');
    await sleep(800);
    await page.screenshot({ path: join(OUT_DIR, 'after-desktop-teach-recording.png') });

    // Deterministic synthetic samples resolve fast; wait for the describe
    // step's input to appear (2-3 samples x up to ~1.5s retry/backoff).
    await page.waitForSelector('.mc-teach-describe input', { timeout: 20000 });
    await page.type('.mc-teach-describe input', 'save the canvas');
    await page.click('.mc-teach-describe button[type=submit]');
    await page.waitForSelector('.mc-teach-proposal', { timeout: 10000 });
    await sleep(300);
    await page.screenshot({ path: join(OUT_DIR, 'after-desktop-teach-proposal.png') });

    await page.click('[data-act=keep]');
    await sleep(400);

    await page.click('[data-cmd=gestures]');
    await sleep(300);
    await page.screenshot({ path: join(OUT_DIR, 'after-desktop-custom-gestures-list.png') });
    await page.click('.mc-teach-close');

    await page.click('[data-cmd=ai]');
    const historyClicked = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('.mc-ai-history, .mc-ai')).find((n) => n.textContent?.includes('triggered'));
      return !!el;
    });
    console.log('history line present before trigger (expected false):', historyClicked);

    // Trigger it via the list's Test button to exercise the runtime path.
    await page.click('[data-cmd=gestures]');
    await sleep(200);
    await page.click('[data-act=test]');
    await sleep(600);
    await page.click('.mc-teach-close');
    await sleep(200);
    const historyText = await page.evaluate(() => document.querySelector('.mc-ai-history')?.textContent ?? '');
    console.log('history snippet:', historyText.slice(0, 300));
    await page.screenshot({ path: join(OUT_DIR, 'after-desktop-teach-history.png') });

    console.log('capture-teach — done.');
  } finally {
    if (browser) await browser.close().catch(() => {});
    try { process.kill(-vite.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error('capture-teach — error:', e?.message || e); process.exit(1); });
