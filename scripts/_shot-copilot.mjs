import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const base = process.env.BASE || 'http://localhost:4179';
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`${base}/studio`, { waitUntil: 'networkidle2', timeout: 30000 });
await wait(1500);
await page.evaluate(() => {
  for (const id of ['onboarding', 'tour']) { const el = document.getElementById(id); if (el) el.hidden = true; }
  document.querySelectorAll('.tour-overlay, .mc-tour').forEach((e) => e.remove());
});
async function cmd(text, ms = 900) {
  await page.evaluate((t) => {
    const i = document.getElementById('command-input');
    i.value = t;
    document.getElementById('command-box').requestSubmit();
  }, text);
  await wait(ms);
  return page.evaluate(() => document.getElementById('verifier-result')?.textContent ?? '');
}
const log = [];
log.push(['plan', await cmd('two bedroom plan', 1500)]);
log.push(['thickness', await cmd("what's the wall thickness?")]);
log.push(['check', await cmd('does my current drawing follow all code regulations?', 1500)]);
await page.screenshot({ path: '/workspace/shots/copilot-guideline-check.png' });
log.push(['stair', await cmd('build me a staircase for 3 metres')]);
await page.screenshot({ path: '/workspace/shots/copilot-staircase-review.png' });
log.push(['accept', await cmd('accept')]);
log.push(['history', await cmd('show me the history')]);
await page.screenshot({ path: '/workspace/shots/copilot-history.png' });
// Airplane mode at the site
await page.setOfflineMode(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await wait(400);
log.push(['offline-q', await cmd('can the wall between the kitchen and living room come down?')]);
log.push(['offline-q2', await cmd('is the soil report ready?')]);
log.push(['offline-measure', await cmd('how big is the kitchen?')]);
await cmd('open the site checklist');
await page.screenshot({ path: '/workspace/shots/site-checklist-offline.png' });
await page.setOfflineMode(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await wait(600);
log.push(['email', await cmd('email the client', 1500)]);
await page.screenshot({ path: '/workspace/shots/site-checklist-email-draft.png' });
log.push(['walk', await cmd('give me a virtual walkthrough', 2500)]);
await cmd('forward', 600); await cmd('turn left', 800);
await page.screenshot({ path: '/workspace/shots/walkthrough.png' });
log.push(['stop', await cmd('stop', 600)]);
log.push(['3d', await cmd('convert my 2D to 3D render', 2500)]);
await page.screenshot({ path: '/workspace/shots/copilot-3d-materials.png' });
const state = await page.evaluate(() => ({
  pending: JSON.parse(localStorage.getItem('mendcraft.changelog') || '{"entries":[]}').entries.map((e) => [e.actor, e.status, e.title]),
  checklist: JSON.parse(localStorage.getItem('mendcraft.sitechecklist') || '[]').map((i) => [i.status, i.question]),
}));
for (const [k, v] of log) console.log(k.padEnd(16), '|', v.slice(0, 220));
console.log(JSON.stringify(state, null, 1));
console.log('ERRORS', errors.slice(0, 10));
await browser.close();
