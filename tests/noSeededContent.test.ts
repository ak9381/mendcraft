// Guard: src/ holds no seeded boards, devices or scripted model replies.
// Recorded replies live only in tests/fixtures/ (replies/, written/). Later tasks append
// to BANNED as they strip more. Every .ts/.js/.mjs/.json file under src/ is read.
import fs from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

export const BANNED = [/\bSTUB_DEVICES\b/, /\bseedDoc\b/, /\bSCRIPTS\b/, /\bSCRIPTED_[A-Z_]+\b/, /\bscriptedEngine\b/,
  /\bscriptedReply\b/, /\bsimPlanEdit\b/, /\bSIM_POINT_IDENTITY\b/, /\bSIM_SCAN_DEVICES\b/, /\bSEEDED_LAMP_IDS\b/,
  /['"`]wiz-desk['"`]/, /['"`]wiz-ceiling['"`]/, /['"`]speaker-1['"`]/, /showcaseFixture/, /journeyReplay/, /__mcScripts/,
  /\bLampTileElement\b/, /\bBRIGHTNESS_PRESETS\b/,
  // Task 3: the names sim-main's pairing and seeded room used.
  /Living room/, /Desk lamp/, /Ceiling light/,
  // Task 4: the speaker is a generated DeviceTile; no stand-in player, no seeded track.
  /\bMusicTileElement\b/, /Morning light/, /Monsoon raga/,
  // Task 5: the gimbal and the switch are generated DeviceTiles; nothing adds the gimbal by itself.
  /\bGimbalTileElement\b/, /\bGimbalTileApi\b/, /\bSwitchTileElement\b/, /\bSwitchTileApi\b/,
  /\bGIMBAL_MODE_BUTTONS\b/, /\bGIMBAL_CUE_BUTTONS\b/, /\bisAddGimbal\b/, /\bwithGimbalTile\b/,
  /\baddGimbalTile\b/, /\bgimbalReported\b/, /\baddGimbal\b/,
  // Task 7: floor plans are generated; the only plan template is blank.
  /\btwoBedroom\b/, /\boneRoom\b/,
  // Task 8: the devices board and the next-step chips are generated.
  /\bconnectedDevicesPlan\b/, /\bruleSuggestions\b/,
  // Task 9: one language turn for any script in LANG_SCRIPTS.
  /\baddKannada\b/, /\bKN_STATUS\b/];

/** Files a pattern may still appear in, with the reason. Nothing in the canvas. */
const EXEMPT: { file: RegExp; re: RegExp; why: string }[] = [
  { file: /^landing\//, re: /Living room|Desk lamp/, why: "main's marketing landing page, not the canvas" },
  { file: /^plan\/ai\.ts$/, re: /Living room/, why: "a room name in the plan prompt's JSON format example" },
];

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
    const rel = path.relative(SRC, file);
    for (const re of BANNED) {
      if (!re.test(line)) continue;
      if (EXEMPT.some((e) => e.file.test(rel) && e.re.source.split('|').includes(re.source))) continue;
      hits.push(`${rel}:${i + 1} ${re.source}`);
    }
  });
}

it('src holds no seeded content or scripted replies', () => { expect(hits).toEqual([]); });
