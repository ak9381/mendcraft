#!/usr/bin/env node
// End-to-end ramble-condenser latency: time a long utterance with and without
// the on-device condenser. Writes a JSON report. Uses the dev-only
// __mcCloudProbe hook (same as cloud-gemini-probe.mjs).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = process.env.CONDENSE_REPORT || '/workspace/shots/condense-measure.json';
const port = Number(process.env.PORT || 5173);
const base = process.env.BASE || `http://127.0.0.1:${port}`;

const RAMBLE = process.env.RAMBLE || (
  'I was thinking you know the kitchen feels so cramped when I am rolling out chapatis and my '
  + 'wrists start hurting maybe if the counter near the window were a little wider it would help, '
  + 'and also the door into the kitchen is tight when I turn with a tray so could we make that wider too'
);
const SHORT = process.env.SHORT || 'Widen the kitchen counter near the window and the kitchen door.';
const PLAN = 'Two-bedroom plan. Bedroom 4000×3500 mm, bathroom 1400×1200 mm, kitchen 3200×2800 mm, living 5000×4000 mm. Wall thickness 100 mm. Kitchen door 700 mm wide.';
const RUNS = Math.max(1, Number(process.env.RUNS || 2));

function hasSecretFile() {
  try { return fs.statSync(path.join(os.homedir(), '.secrets', 'mendcraft-appcheck-debug')).size > 8; } catch { return false; }
}

async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok || (res.status >= 200 && res.status < 500)) return;
    } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`dev server did not start at ${url}`);
}

async function ensureDevServer() {
  try {
    const res = await fetch(base, { redirect: 'manual' });
    if (res.ok || (res.status >= 200 && res.status < 500)) return { proc: null };
  } catch { /* start */ }
  const proc = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env },
  });
  try {
    await waitForServer(base);
    return { proc };
  } catch (err) {
    proc.kill('SIGTERM');
    throw err;
  }
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }

async function main() {
  const report = {
    ok: false,
    at: new Date().toISOString(),
    host: os.hostname(),
    nano: null,
    rambleWords: RAMBLE.trim().split(/\s+/).length,
    shortWords: SHORT.trim().split(/\s+/).length,
    runs: [],
    summary: {},
    recommendation: '',
    error: null,
  };
  let proc = null;
  let browser = null;
  try {
    if (!hasSecretFile()) throw new Error('App Check debug token file is missing; cannot time cloud legs');
    const server = await ensureDevServer();
    proc = server.proc;
    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      defaultViewport: { width: 1280, height: 800 },
    });
    const page = await browser.newPage();
    await page.goto(`${base}/__cloud-probe`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(() => Boolean(globalThis.__mcCloudProbe) && document.body.dataset.ready === '1', { timeout: 30000 });
    const status = await page.evaluate(async () => {
      const p = globalThis.__mcCloudProbe;
      const st = await p.prepareHybrid();
      return { deviceModel: st.deviceModel, message: st.message, appCheck: st.appCheck };
    });
    report.nano = status;
    await page.evaluate(async () => { const p = globalThis.__mcCloudProbe; if (p.warmCloud) await p.warmCloud(); });

    for (let i = 0; i < RUNS; i++) {
      const row = await page.evaluate(async ({ ramble, short, plan }) => {
        const p = globalThis.__mcCloudProbe;
        const t0 = performance.now();
        const without = await p.askCopilot(ramble, plan, 'International');
        const withoutMs = performance.now() - t0;
        const c0 = performance.now();
        const condensed = p.condenseUtterance ? await p.condenseUtterance(ramble) : null;
        const condenseMs = performance.now() - c0;
        const shortText = condensed?.text || short;
        const t1 = performance.now();
        const withShort = await p.askCopilot(shortText, plan, 'International');
        const shortMs = performance.now() - t1;
        return {
          withoutMs: Math.round(withoutMs),
          withoutModelMs: without?.ms ?? null,
          withoutOk: Boolean(without?.answer),
          condenseMs: Math.round(condenseMs),
          condensed: condensed ? { text: condensed.text, from: condensed.fromWords, to: condensed.toWords, ms: condensed.ms } : null,
          shortMs: Math.round(shortMs),
          shortModelMs: withShort?.ms ?? null,
          shortOk: Boolean(withShort?.answer),
          withTotalMs: Math.round(condenseMs + shortMs),
        };
      }, { ramble: RAMBLE, short: SHORT, plan: PLAN });
      report.runs.push(row);
    }

    const withs = report.runs.map((r) => r.withTotalMs);
    const withouts = report.runs.map((r) => r.withoutMs);
    const condenses = report.runs.map((r) => r.condenseMs);
    const shorts = report.runs.map((r) => r.shortMs);
    report.summary = {
      withoutMeanMs: Math.round(mean(withouts)),
      withMeanMs: Math.round(mean(withs)),
      condenseMeanMs: Math.round(mean(condenses)),
      shortCloudMeanMs: Math.round(mean(shorts)),
      savedMs: Math.round(mean(withouts) - mean(withs)),
      nanoWorked: report.runs.some((r) => r.condensed),
    };
    const s = report.summary;
    const cap = 1500;
    const projectedTimeout = s.shortCloudMeanMs + cap;
    if (!s.nanoWorked) {
      report.recommendation = s.withoutMeanMs <= projectedTimeout
        ? `No Nano on this host. Short-cloud ${s.shortCloudMeanMs} ms vs long-cloud ${s.withoutMeanMs} ms — even a ${cap} ms condense cap would not save time overall. Raise the gate to ~40 words or leave the condenser off by default.`
        : `No Nano on this host. Short-cloud is ${s.withoutMeanMs - s.shortCloudMeanMs} ms faster than the ramble. A successful Nano condense under ${s.withoutMeanMs - s.shortCloudMeanMs} ms would help; a ${cap} ms miss would not. Measure on a Nano device before leaving the 18-word gate on.`;
    } else if (s.savedMs <= 0) {
      report.recommendation = `Condenser did not save time (with ${s.withMeanMs} ms vs without ${s.withoutMeanMs} ms). Raise the gate to ~40 words or leave it off by default.`;
    } else {
      report.recommendation = `Condenser saved about ${s.savedMs} ms end-to-end (with ${s.withMeanMs} ms vs without ${s.withoutMeanMs} ms). Keep the current gate.`;
    }
    report.ok = report.runs.every((r) => r.withoutOk && r.shortOk);
  } catch (err) {
    report.error = err instanceof Error ? err.message : String(err);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (proc) proc.kill('SIGTERM');
  }
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

main();
