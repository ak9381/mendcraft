#!/usr/bin/env node
// Local-only probe: hits real cloud Gemini through the Vite dev server (App Check
// debug token injected by vite.config.ts). Never prints secrets. Writes a
// redacted JSON report.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const puppeteer = require('puppeteer-core');
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const reportPath = process.env.PROBE_REPORT || '/tmp/mendcraft-cloud-probe.json';
const port = Number(process.env.PORT || 5173);
const base = process.env.BASE || `http://127.0.0.1:${port}`;

const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;
const redact = (s) => String(s)
  .replace(UUID_RE, '<uuid>')
  .replace(/FIREBASE_APPCHECK_DEBUG_TOKEN["'=\s:]+[^\s"']+/gi, 'FIREBASE_APPCHECK_DEBUG_TOKEN=<redacted>')
  .replace(/debug token[:\s]+[^\s]+/gi, 'debug token: <redacted>');

function hasSecretFile() {
  const p = path.join(os.homedir(), '.secrets', 'mendcraft-appcheck-debug');
  try { return fs.statSync(p).size > 8; } catch { return false; }
}

async function waitForServer(url, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const res = await fetch(url, { redirect: 'manual' });
      if (res.ok || res.status === 404 || (res.status >= 200 && res.status < 500)) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`dev server did not start at ${url}`);
}

async function ensureDevServer() {
  try {
    const res = await fetch(base, { redirect: 'manual' });
    if (res.ok || (res.status >= 200 && res.status < 500)) return { proc: null, started: false };
  } catch { /* need to start */ }
  const proc = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  let buf = '';
  const onData = (d) => { buf += d.toString(); };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  try {
    await waitForServer(base);
    return { proc, started: true };
  } catch (err) {
    proc.kill('SIGTERM');
    throw new Error(`${err.message}\nserver log (redacted):\n${redact(buf).slice(-2000)}`);
  }
}

const PLAN_SUMMARY = 'Two-bedroom plan. Bedroom 4000×3500 mm, bathroom 1400×1200 mm, kitchen 3200×2800 mm, living 5000×4000 mm. Wall thickness 100 mm. Door to bathroom 700 mm wide.';

async function main() {
  const report = {
    ok: false,
    startedAt: new Date().toISOString(),
    secretPresent: hasSecretFile(),
    appCheck: null,
    calls: [],
    accuracy: [],
    consoleErrors: [],
    nano: null,
    error: null,
  };
  let proc = null;
  let browser = null;
  try {
    if (!report.secretPresent) {
      throw new Error('App Check debug token file is missing');
    }
    const server = await ensureDevServer();
    proc = server.proc;

    browser = await puppeteer.launch({
      executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
      headless: 'new',
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      defaultViewport: { width: 1280, height: 800 },
    });
    const page = await browser.newPage();
    page.on('pageerror', (e) => report.consoleErrors.push(redact(e.message)));
    page.on('console', (m) => {
      if (m.type() === 'error' || /app check|appcheck/i.test(m.text())) {
        report.consoleErrors.push(redact(`${m.type()}: ${m.text()}`));
      }
    });

    await page.goto(`${base}/__cloud-probe`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForFunction(
      () => Boolean(globalThis.__mcCloudProbe) && document.body.dataset.ready === '1',
      { timeout: 30000 },
    );

    const status = await page.evaluate(async () => {
      const p = globalThis.__mcCloudProbe;
      const st = await p.prepareHybrid();
      return {
        appCheck: st.appCheck,
        deviceModel: st.deviceModel,
        message: st.message,
        lastError: st.lastError,
        debugTokenKind: typeof self.FIREBASE_APPCHECK_DEBUG_TOKEN,
      };
    });
    report.appCheck = {
      ...status,
      lastError: status.lastError ? redact(status.lastError) : null,
      message: status.message ? redact(status.message) : null,
    };

    const measureN = Number(process.env.MEASURE || 0);
    const gapMs = Number(process.env.GAP_MS || 0);
    if (measureN > 0 && page.evaluate) {
      const warmed = await page.evaluate(async () => {
        const p = globalThis.__mcCloudProbe;
        if (p.warmCloud) return p.warmCloud();
        return false;
      });
      report.warmed = Boolean(warmed);
    }

    // Direct cloud calls (clean source + latency)
    const jobs = [
      {
        name: 'askCopilot',
        fn: async () => page.evaluate(async (summary) => {
          const res = await globalThis.__mcCloudProbe.askCopilot(
            'Does the bathroom door leave enough width for a wheelchair, and what is the wall thickness?',
            summary,
            'International',
          );
          return res;
        }, PLAN_SUMMARY),
        check: (res) => ({
          name: 'copilot mentions wall thickness or door width from the plan',
          pass: Boolean(res?.answer) && /100\s*mm|700\s*mm|wall thickness|door|wheelchair/i.test(res.answer),
          detail: res?.answer ? String(res.answer).slice(0, 240) : 'no answer',
        }),
      },
      {
        name: 'proposeMaterials',
        fn: async () => page.evaluate(async (summary) => {
          const res = await globalThis.__mcCloudProbe.proposeMaterials('warm evening lighting', summary);
          if (!res) return null;
          return { source: res.source, ms: res.ms, rooms: res.plan?.rooms ? Object.keys(res.plan.rooms).length : 0, hasSun: Boolean(res.plan?.sun) };
        }, PLAN_SUMMARY),
        check: (res) => ({
          name: 'materials plan has rooms or lighting data',
          pass: Boolean(res && res.source === 'cloud' && (res.rooms > 0 || res.hasSun)),
          detail: res ? `rooms=${res.rooms} sun=${res.hasSun}` : 'no plan',
        }),
      },
      {
        name: 'draftClientEmail',
        fn: async () => page.evaluate(async (summary) => {
          const res = await globalThis.__mcCloudProbe.draftClientEmail(
            [{ question: 'Can the wall between the kitchen and living room come down?', answer: 'Needs a structural check before we open it up.' }],
            summary,
          );
          if (!res) return null;
          return { source: res.source, ms: res.ms, subject: res.draft?.subject ?? '', bodyLen: (res.draft?.body ?? '').length };
        }, PLAN_SUMMARY),
        check: (res) => ({
          name: 'email draft has a subject and body',
          pass: Boolean(res && res.source === 'cloud' && res.subject && res.bodyLen > 20),
          detail: res ? `subject="${String(res.subject).slice(0, 80)}" bodyLen=${res.bodyLen}` : 'no draft',
        }),
      },
      {
        name: 'explainAccessibility',
        fn: async () => page.evaluate(async (summary) => {
          const res = await globalThis.__mcCloudProbe.explainAccessibility(
            [{ id: 'door-bath', rule: 'door-width', message: 'Bathroom door is 700 mm; guideline minimum is 800 mm.', citation: 'ISO 21542' }],
            summary,
          );
          return { source: res.source, items: (res.items ?? []).map((i) => ({ id: i.id, explanation: String(i.explanation ?? '').slice(0, 180) })) };
        }, PLAN_SUMMARY),
        check: (res) => ({
          name: 'guideline explanation came from the cloud',
          pass: Boolean(res && res.source === 'cloud' && res.items.length > 0),
          detail: res?.items?.[0]?.explanation ?? `source=${res?.source ?? 'none'}`,
        }),
      },
    ];

    if (measureN === 0) for (const job of jobs) {
      const t0 = Date.now();
      let result = null;
      let error = null;
      try {
        result = await Promise.race([
          job.fn(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout 25s')), 25000)),
        ]);
      } catch (err) {
        error = redact(err.message || err);
      }
      const ms = Date.now() - t0;
      const source = result?.source ?? null;
      const ok = Boolean(result) && !error && source === 'cloud';
      report.calls.push({
        name: job.name,
        ok,
        source,
        ms,
        error,
        preview: result ? redact(JSON.stringify(result)).slice(0, 400) : null,
      });
      if (result) report.accuracy.push(job.check(result));
      else report.accuracy.push({ name: job.check(null).name, pass: false, detail: error || 'no result' });
    }

    if (measureN > 0) {
      const stats = {};
      for (const job of jobs) {
        const runs = [];
        for (let i = 0; i < measureN; i++) {
          const t0 = Date.now();
          let result = null;
          let error = null;
          try {
            result = await Promise.race([
              job.fn(),
              new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout 25s')), 25000)),
            ]);
          } catch (err) {
            error = redact(err.message || err);
          }
          const ms = Date.now() - t0;
          const source = result?.source ?? null;
          const st = await page.evaluate(() => {
            const s = globalThis.__mcCloudProbe.getHybridStatus();
            return { lastError: s.lastError, lastFailKind: s.lastFailKind ?? null };
          });
          const lastError = redact(result?.lastError || st.lastError || '');
          const lastFailKind = st.lastFailKind || result?.failKind || null;

          const ok = Boolean(result) && !error && source === 'cloud';
          runs.push({ ok, source, ms, error: error || lastError, kind: lastFailKind, preview: result ? redact(JSON.stringify(result)).slice(0, 200) : null });
          if (gapMs > 0 && !(i === measureN - 1 && job === jobs[jobs.length - 1])) {
            await new Promise((r) => setTimeout(r, gapMs));
          }
        }
        const times = runs.filter((r) => r.ok).map((r) => r.ms).sort((a, b) => a - b);
                let median = null;
        if (times.length) {
          const m = Math.floor(times.length / 2);
          median = times.length % 2 ? times[m] : Math.round((times[m - 1] + times[m]) / 2);
        }
        stats[job.name] = {
          n: measureN,
          ok: runs.filter((r) => r.ok).length,
          times: runs.map((r) => r.ms),
          sources: runs.map((r) => r.source),
          errors: runs.map((r) => r.error),
          kinds: runs.map((r) => r.kind),
          validRate: `${runs.filter((r) => r.ok).length}/${measureN}`,
          median,
          worst: times.length ? times[times.length - 1] : null,
          min: times.length ? times[0] : null,
        };
      }
      report.measure = stats;
    }

    report.ok = report.appCheck?.appCheck === 'ready'
      && (measureN > 0
        ? Object.values(report.measure ?? {}).some((s) => s.ok > 0)
        : report.calls.some((c) => c.ok));
  } catch (err) {
    report.error = redact(err.message || err);
  } finally {
    if (browser) {
      try { await browser.close(); } catch { /* */ }
    }
    if (proc) {
      proc.kill('SIGTERM');
    }
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    // Safe summary only — no token values
    const summary = {
      ok: report.ok,
      appCheck: report.appCheck?.appCheck ?? null,
      debugTokenKind: report.appCheck?.debugTokenKind ?? null,
      calls: report.calls.map((c) => ({ name: c.name, ok: c.ok, source: c.source, ms: c.ms, error: c.error })),
      measure: report.measure ?? null,
      warmed: report.warmed ?? null,
      accuracy: report.accuracy,
      error: report.error,
      consoleErrors: report.consoleErrors.slice(0, 8),
      reportPath,
    };
    console.log(JSON.stringify(summary, null, 2));
  }
}

await main();
