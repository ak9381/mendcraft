// COMMAND-ACCURACY HARNESS — run with `npm run eval:commands`.
//
// Runs the deterministic RULES path (offline, zero network) over the fixed eval
// sets and writes eval/results-<date>.json + eval/summary.md with accuracy per
// language. This file is intentionally NOT a *.test.ts, so the default
// `vitest run` suite ignores it; `npm run eval:commands` selects it via
// vitest.eval.config.ts.
//
// To measure the Nano / cloud path (Chrome only): open the app in Chrome with
// Gemini Nano enabled, paste an eval set into the console, call the hybrid
// fuseIntent()/generatePlan() path per utterance, and compare opLabel() the same
// way. That path is not scriptable headless, so it is documented, not automated
// here — see docs/ACCURACY.md.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePlanCommand } from '../../src/plan/ruleParser';
import {
  scoreCases,
  scoreRouting,
  pct,
  type EvalCase,
  type ParseResult,
} from '../../src/eval/commandEval';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const evalDir = join(appRoot, 'tests', 'eval');
const outDir = join(appRoot, 'eval');

interface Dataset {
  language: string;
  cases: EvalCase[];
}

function load(name: string): Dataset {
  return JSON.parse(readFileSync(join(evalDir, name), 'utf8')) as Dataset;
}

const parse = (u: string): ParseResult => parsePlanCommand(u) as ParseResult;

describe('command accuracy eval (rules path, offline)', () => {
  it('runs the eval and writes results', () => {
    const en = load('commands.en.json');
    const kn = load('commands.kn.json');

    const enScore = scoreCases(parse, en.cases);
    const knScore = scoreCases(parse, kn.cases);
    const knRouting = scoreRouting(parse, kn.cases);

    const date = new Date().toISOString().slice(0, 10);
    const results = {
      date,
      path: 'rules',
      english: {
        total: enScore.total,
        correct: enScore.correct,
        accuracy: enScore.accuracy,
        misses: enScore.results.filter((r) => !r.pass),
      },
      kannada: {
        total: knScore.total,
        correct: knScore.correct,
        accuracy: knScore.accuracy,
        routeOffRate: knRouting.rate,
        note: 'Rules path is English-only; Kannada is handled by the cloud translate path.',
      },
    };

    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `results-${date}.json`), JSON.stringify(results, null, 2));

    const md = [
      `# Command accuracy — ${date} (rules path, offline)`,
      '',
      `| language | cases | correct | accuracy |`,
      `| --- | --- | --- | --- |`,
      `| English | ${enScore.total} | ${enScore.correct} | **${pct(enScore.accuracy)}** |`,
      `| Kannada | ${knScore.total} | ${knScore.correct} | ${pct(knScore.accuracy)} |`,
      '',
      `Kannada route-off rate (rules correctly declines → cloud): **${pct(knRouting.rate)}** ` +
        `(${knRouting.routedOff}/${knRouting.total}).`,
      '',
      '## English misses (rules path)',
      '',
      ...enScore.results
        .filter((r) => !r.pass)
        .map((r) => `- \`${r.text}\` → got \`${r.got}\`, expected \`${r.expect}\``),
      '',
    ].join('\n');
    writeFileSync(join(outDir, 'summary.md'), md);

    // eslint-disable-next-line no-console
    console.log(
      `\nEVAL rules path — English ${pct(enScore.accuracy)} (${enScore.correct}/${enScore.total}), ` +
        `Kannada ${pct(knScore.accuracy)} (${knScore.correct}/${knScore.total}), ` +
        `Kannada route-off ${pct(knRouting.rate)}.\n` +
        `Wrote eval/results-${date}.json + eval/summary.md\n`,
    );

    // The datasets must be non-trivial and loadable.
    expect(enScore.total).toBeGreaterThanOrEqual(40);
    expect(knScore.total).toBeGreaterThanOrEqual(35);
  });
});
