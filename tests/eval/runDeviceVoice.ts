// DEVICE-VOICE HARNESS — run with `npm run eval:device-voice`.
// Offline, zero network. Writes eval/device-voice-results-<date>.json and
// eval/device-voice-summary.md. Not a *.test.ts so the default suite ignores
// the file-write; the same 20 cases are asserted in tests/eval/deviceVoice.test.ts.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCRIPTED_KN_PACK } from '../../src/canvas/languagePack';
import { pct } from '../../src/eval/commandEval';
import {
  EVAL_DEVICES,
  scoreDeviceVoice,
  type DeviceVoiceCase,
} from '../../src/eval/deviceVoiceEval';

const appRoot = fileURLToPath(new URL('../..', import.meta.url));
const outDir = join(appRoot, 'eval');

interface Dataset {
  name: string;
  cases: DeviceVoiceCase[];
}

describe('device-voice eval (sim path, offline)', () => {
  it('runs the 20-phrase eval and writes results', () => {
    const data = JSON.parse(
      readFileSync(join(appRoot, 'tests/eval/device-voice.json'), 'utf8'),
    ) as Dataset;
    const score = scoreDeviceVoice(data.cases, EVAL_DEVICES, SCRIPTED_KN_PACK);
    const date = new Date().toISOString().slice(0, 10);
    const results = {
      date,
      path: 'sim-device-voice',
      total: score.total,
      correct: score.correct,
      accuracy: score.accuracy,
      misses: score.results.filter((r) => !r.pass),
    };
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, `device-voice-results-${date}.json`), JSON.stringify(results, null, 2));
    const md = [
      `# Device-voice accuracy — ${date} (sim path, offline)`,
      '',
      `**${pct(score.accuracy)}** (${score.correct}/${score.total})`,
      '',
      '## Misses',
      '',
      ...(score.results.some((r) => !r.pass)
        ? score.results.filter((r) => !r.pass).map((r) => `- \`${r.text}\` → got \`${r.got}\`, expected \`${r.expect}\``)
        : ['None.']),
      '',
    ].join('\n');
    writeFileSync(join(outDir, 'device-voice-summary.md'), md);
    // eslint-disable-next-line no-console
    console.log(
      `\nEVAL device-voice — ${pct(score.accuracy)} (${score.correct}/${score.total}). ` +
        `Wrote eval/device-voice-results-${date}.json + eval/device-voice-summary.md\n`,
    );
    expect(score.total).toBe(20);
    expect(score.correct).toBe(20);
  });
});
