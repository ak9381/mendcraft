// Screen grader — a second opinion from a DIFFERENT company's model than the one
// that builds the app. Mendcraft infers with Firebase AI Logic (Google Gemini);
// here we ask Google Antigravity's `agy` CLI (Gemini) to GRADE the screenshots
// that scripts/screens.mjs produced, on a fixed accessibility rubric. It never
// touches the app — it only reads the PNGs on disk.
//
//   node scripts/grade-screens.mjs
//
//   SCREENS   dir of PNGs to grade     (default ../screens, same as screens.mjs OUT)
//   AGY_BIN   path to the agy CLI      (default /home/box/.local/bin/agy, else `agy` on PATH)
//   AGY_MODEL model override for agy   (optional; agy picks a Gemini default otherwise)
//   GRADE_OUT output JSON report       (default <SCREENS>/grades.json)
//
// If `agy` is not installed, the script prints "skipped: no grader available"
// and exits 0 — grading is an optional review pass, never a build gate. Captions
// come from <SCREENS>/captions.json ({ "03-two-bedroom-plan.png": "…" }) when
// present, otherwise they are derived from the filename.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUBRIC_AXES,
  RUBRIC_SCHEMA,
  buildPrompt,
  captionFor,
  parseAgyResult,
  summarize,
} from './screenGrade.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCREENS = resolve(__dirname, '..', process.env.SCREENS ?? '../screens');
const OUT = process.env.GRADE_OUT ?? join(SCREENS, 'grades.json');

function findAgy() {
  const candidates = [process.env.AGY_BIN, '/home/box/.local/bin/agy'].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  const which = spawnSync('bash', ['-lc', 'command -v agy'], { encoding: 'utf8' });
  const onPath = which.status === 0 ? which.stdout.trim() : '';
  return onPath || null;
}

function loadCaptions() {
  const path = join(SCREENS, 'captions.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    console.warn(`captions.json present but unreadable — using filename captions.`);
    return {};
  }
}

function gradeOne(agy, imagePath, caption) {
  const prompt = buildPrompt({ imagePath, caption });
  const schemaJson = JSON.stringify(RUBRIC_SCHEMA);
  const args = [
    '-p', prompt,
    '--output-format', 'json',
    '--json-schema', schemaJson,
    '--add-dir', SCREENS,
    '--dangerously-skip-permissions',
    '--disable-slash-commands',
  ];
  if (process.env.AGY_MODEL) args.push('--model', process.env.AGY_MODEL);

  const run = spawnSync(agy, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (run.error) return { ok: false, error: `agy failed to spawn: ${run.error.message}` };
  if (run.status !== 0) {
    return { ok: false, error: `agy exited ${run.status}: ${(run.stderr || '').trim().slice(0, 200)}` };
  }
  return parseAgyResult(run.stdout);
}

function main() {
  if (!existsSync(SCREENS)) {
    console.log(`skipped: no screens directory at ${SCREENS}. Run scripts/screens.mjs first.`);
    return 0;
  }
  const pngs = readdirSync(SCREENS).filter((f) => f.toLowerCase().endsWith('.png')).sort();
  if (!pngs.length) {
    console.log(`skipped: no PNGs in ${SCREENS}. Run scripts/screens.mjs first.`);
    return 0;
  }

  const agy = findAgy();
  if (!agy) {
    console.log('skipped: no grader available (agy CLI not found). Set AGY_BIN or install Antigravity.');
    return 0;
  }

  const captions = loadCaptions();
  console.log(`Grading ${pngs.length} screen(s) with ${agy} …\n`);

  const graded = [];
  for (const file of pngs) {
    const imagePath = join(SCREENS, file);
    const caption = captionFor(file, captions);
    const res = gradeOne(agy, imagePath, caption);
    if (res.ok) {
      const g = res.grade;
      const line = RUBRIC_AXES.map((a) => `${a[0]}${a.slice(1, 3)}:${g[a] ?? '-'}`).join(' ');
      console.log(`  ${g.pass ? '✓' : '✗'} ${file}  ${line}  overall:${g.overall ?? '-'}  — ${g.summary}`);
      graded.push({ file, caption, grade: g });
    } else {
      console.log(`  ? ${file}  (not graded: ${res.error})`);
      graded.push({ file, caption, grade: null, error: res.error });
    }
  }

  const summary = summarize(graded);
  const report = { generatedWith: agy, model: process.env.AGY_MODEL ?? 'agy default (Gemini)', summary, screens: graded };
  writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log('\n──────── summary ────────');
  console.log(`graded ${summary.scored}/${summary.count} screens`);
  for (const axis of [...RUBRIC_AXES, 'overall']) console.log(`  ${axis.padEnd(16)} ${summary.averages[axis] ?? '—'}`);
  if (summary.failing.length) console.log(`  would-not-ship: ${summary.failing.join(', ')}`);
  console.log(`\nreport written to ${OUT}`);
  return 0;
}

try {
  process.exit(main());
} catch (err) {
  // A grader is a review tool — never block on it.
  console.error('grade-screens — error:', err?.message || err);
  process.exit(0);
}
