// Pure helpers for the screen grader (scripts/grade-screens.mjs). No I/O, no
// child processes — just caption derivation, prompt building, and parsing the
// `agy` CLI's JSON output into a normalized rubric. Kept in its own module so
// tests/screenGrade.test.ts can unit-test the parsing without shelling out to a
// model. Everything here is deterministic.

/** The grading rubric. Each screen is scored 1 (bad) … 5 (great) per axis. */
export const RUBRIC_AXES = ['legibility', 'targetSize', 'contrast', 'clutter', 'matchesCaption'];

/** JSON schema handed to `agy --json-schema` so Gemini returns structured grades. */
export const RUBRIC_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [...RUBRIC_AXES, 'overall', 'pass', 'summary'],
  properties: {
    legibility: { type: 'integer', minimum: 1, maximum: 5, description: 'Is text readable at a glance?' },
    targetSize: { type: 'integer', minimum: 1, maximum: 5, description: 'Are tap/pinch targets large enough (WCAG 2.2 ≥24px)?' },
    contrast: { type: 'integer', minimum: 1, maximum: 5, description: 'Is text/background contrast sufficient (WCAG AA)?' },
    clutter: { type: 'integer', minimum: 1, maximum: 5, description: 'Is the screen uncluttered and focused (5 = calm)?' },
    matchesCaption: { type: 'integer', minimum: 1, maximum: 5, description: 'Does the screen show what the caption claims?' },
    overall: { type: 'integer', minimum: 1, maximum: 5, description: 'Overall quality.' },
    pass: { type: 'boolean', description: 'Would you ship this screen to a user with limited hand use?' },
    summary: { type: 'string', description: 'One sentence: the single most important issue, or "looks good".' },
  },
};

/** Turn "03-two-bedroom-plan.png" → "two bedroom plan" as a fallback caption. */
export function humanizeCaption(filename) {
  const base = String(filename).replace(/\.[a-z0-9]+$/i, '');
  return base
    .replace(/^.*?\d+[a-z]?-/i, '') // strip up to the first number segment: "03-", "ui-02-", "palette-plan-01-"
    .replace(/^(palette|extras|ai|ui)-/i, '') // else drop a known prefix ("ai-fusion" → "fusion")
    .replace(/-/g, ' ')
    .trim() || base;
}

/** Caption for a screenshot: an explicit captions map wins, else humanized name. */
export function captionFor(filename, captions) {
  if (captions && typeof captions === 'object' && typeof captions[filename] === 'string') {
    return captions[filename];
  }
  return humanizeCaption(filename);
}

/** Build the grader prompt. The model must open the PNG and score the rubric. */
export function buildPrompt({ imagePath, caption }) {
  return [
    'You are an accessibility & UI reviewer grading a single product screenshot for Mendcraft,',
    'a hands-free design tool used by someone with arthritis (big pinch/tap targets, calm layout, high contrast).',
    `Open and look at the image file at: ${imagePath}`,
    `The screen is captioned: "${caption}"`,
    'Grade it on each axis from 1 (bad) to 5 (great): legibility, targetSize, contrast, clutter (5 = uncluttered),',
    'and matchesCaption (does the screenshot actually show what the caption says?).',
    'Also give an overall 1-5, a pass boolean (would you ship it to a user with limited hand use?),',
    'and a one-sentence summary naming the single most important issue (or "looks good").',
    'Respond ONLY with the JSON object required by the schema. Do not add prose.',
  ].join('\n');
}

/** Clamp a raw model grade into the rubric shape; tolerant of missing fields. */
export function normalizeGrade(raw) {
  const out = {};
  for (const axis of [...RUBRIC_AXES, 'overall']) {
    const n = Number(raw?.[axis]);
    out[axis] = Number.isFinite(n) ? Math.min(5, Math.max(1, Math.round(n))) : null;
  }
  out.pass = raw?.pass === true || raw?.pass === 'true';
  out.summary = typeof raw?.summary === 'string' ? raw.summary.trim() : '';
  return out;
}

/**
 * Pull the first balanced JSON object out of a string (the model may wrap it in
 * ```json fences or trailing prose). Returns the parsed object or null.
 */
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < cleaned.length; i++) {
    const c = cleaned[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Parse the stdout of `agy -p … --output-format json`. The envelope commonly
 * carries the model's text under `result`/`response`/`text`/`content`; that text
 * is (or contains) the rubric JSON. Falls back to treating stdout as the JSON
 * itself. Returns { ok, grade } or { ok: false, error }.
 */
export function parseAgyResult(stdout) {
  if (!stdout || !String(stdout).trim()) return { ok: false, error: 'empty grader output' };
  let envelope = null;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    /* not a clean JSON envelope — maybe raw text with embedded JSON */
  }

  // If the envelope already looks like a rubric, use it directly.
  if (envelope && typeof envelope === 'object' && 'overall' in envelope) {
    return { ok: true, grade: normalizeGrade(envelope) };
  }

  let inner = null;
  if (envelope && typeof envelope === 'object') {
    for (const key of ['result', 'response', 'text', 'content', 'output']) {
      const v = envelope[key];
      if (typeof v === 'string' && v.trim()) { inner = v; break; }
      if (v && typeof v === 'object' && 'overall' in v) return { ok: true, grade: normalizeGrade(v) };
    }
  }

  const obj = extractJsonObject(inner ?? String(stdout));
  if (!obj) return { ok: false, error: 'no rubric JSON found in grader output' };
  return { ok: true, grade: normalizeGrade(obj) };
}

/** Average scores and flag the worst screens; `graded` = [{ file, caption, grade }]. */
export function summarize(graded) {
  const scored = graded.filter((g) => g.grade && Number.isFinite(g.grade.overall));
  const avg = (axis) => {
    const vals = scored.map((g) => g.grade[axis]).filter((n) => Number.isFinite(n));
    return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
  };
  const averages = {};
  for (const axis of [...RUBRIC_AXES, 'overall']) averages[axis] = avg(axis);
  const failing = scored.filter((g) => g.grade.pass === false).map((g) => g.file);
  const worst = [...scored]
    .sort((a, b) => (a.grade.overall ?? 5) - (b.grade.overall ?? 5))
    .slice(0, 3)
    .map((g) => ({ file: g.file, overall: g.grade.overall, summary: g.grade.summary }));
  return { count: graded.length, scored: scored.length, averages, failing, worst };
}
