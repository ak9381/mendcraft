// Screenshot smoke for the Connect-anything demo (sim=1: fake camera/lamp, no model calls).
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const base = process.env.BASE || 'http://localhost:4391';
const out = process.env.OUT || '/workspace/shots';
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto(`${base}/studio?sim=1`, { waitUntil: 'load', timeout: 30000 });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await wait(2500);
await page.screenshot({ path: `${out}/connect-1-empty.png` });
await page.click('.mc-hub-add');
await wait(1200);
await page.click('.mc-ad-mode[data-mode="point"]');
await page.waitForSelector('.mc-ad-writing.streaming', { timeout: 15000 });
await wait(500);
await page.screenshot({ path: `${out}/connect-2a-writing-live.png` });
await page.waitForSelector('.mc-ad-writing.streaming .mc-ad-w-errors', { timeout: 15000 });
await wait(600);
await page.screenshot({ path: `${out}/connect-2b-fixing-rejected-draft.png` });
await page.waitForSelector('.mc-ad-yes', { timeout: 15000 });
await wait(300);
await page.screenshot({ path: `${out}/connect-2-pinch-confirm.png` });
await page.click('.mc-ad-yes');
await page.waitForSelector('.mc-ad-result.good, .mc-ad-result.bad, .mc-ad-result.unsure', { timeout: 20000 });
await wait(3000);
await page.screenshot({ path: `${out}/connect-3-lamp-added.png` });
const result = await page.$eval('.mc-ad-result', (n) => n.textContent);
await page.evaluate(() => document.querySelector('.mc-ad-close, [data-close], .mc-ad button[aria-label="Close"]')?.click());
// sim=1 never saves; seed one real-shaped saved WiZ connector to show the offline list.
await page.evaluate(() => {
  const wiz = { version: 1, key: 'wiz|smart-bulb', deviceKind: 'smart-bulb', brand: 'WiZ', protocol: 'wiz-udp', discovery: { method: 'wiz-udp-broadcast', port: 38899 },
    actions: [{ id: 'power-on', label: 'Turn on', params: [], request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: true } } }, successCue: 'the bulb is lit' },
      { id: 'power-off', label: 'Turn off', params: [], request: { transport: 'udp', port: 38899, payload: { method: 'setPilot', params: { state: false } } }, successCue: 'the bulb is dark' }],
    test: { action: 'power-on', prepare: 'power-off' }, source: 'cloud', createdAt: Date.now() };
  localStorage.setItem('mendcraft.connectors', JSON.stringify({ [wiz.key]: wiz }));
  localStorage.setItem('mendcraft.devices', JSON.stringify([{ id: 'wiz|smart-bulb@192.168.1.42', name: 'Desk lamp', connectorKey: wiz.key, host: '192.168.1.42', addedAt: Date.now(), verified: 'done' }]));
});
await page.evaluate(() => { const b = [...document.querySelectorAll('.mc-hub-card button')].find((x) => /iPad/.test(x.textContent)); b?.click(); });
await wait(2500);
await page.screenshot({ path: `${out}/connect-4-saved-and-ipad.png` });
const hub = await page.$eval('.mc-hub', (n) => n.innerText);
console.log('RESULT', result);
console.log(hub);
console.log('ERRORS', errors);
await browser.close();
