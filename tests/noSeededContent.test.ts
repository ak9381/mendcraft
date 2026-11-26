// Guard: src/ holds no seeded boards, devices or scripted model replies.
// Recorded replies live only in tests/fixtures/replies/. Later tasks append
// to BANNED as they strip more. Every .ts/.js/.mjs/.json file under src/ is read.
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

export const BANNED = [/\bSTUB_DEVICES\b/, /\bseedDoc\b/, /\bSCRIPTS\b/, /\bSCRIPTED_[A-Z_]+\b/, /\bscriptedEngine\b/,
  /\bscriptedReply\b/, /\bsimPlanEdit\b/, /\bSIM_POINT_IDENTITY\b/, /\bSIM_SCAN_DEVICES\b/, /\bSEEDED_LAMP_IDS\b/,
  /['"`]wiz-desk['"`]/, /['"`]wiz-ceiling['"`]/, /['"`]speaker-1['"`]/, /showcaseFixture/, /journeyReplay/, /__mcScripts/];

const SRC = path.resolve(__dirname, '../src');

function srcFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...srcFiles(p));
    else if (/\.(ts|js|mjs|json)$/.test(e.name)) out.push(p);
  }
  return out;
}

const hits: string[] = [];
for (const file of srcFiles(SRC)) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const re of BANNED) if (re.test(line)) hits.push(`${path.relative(SRC, file)}:${i + 1} ${re.source}`);
  });
}

it('src holds no seeded content or scripted replies', () => { expect(hits).toEqual([]); });
