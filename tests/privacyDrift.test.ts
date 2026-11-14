// PRIVACY DRIFT TEST — the static backstop behind the honest badge + ledger.
//
// It walks every src/*.ts file and checks that the ways a byte can leave this
// device have not drifted away from what we declare (src/core/outbound.ts) and
// claim (docs/PRIVACY.md + the in-app ledger panel). A new fetch(), Firestore
// write, cloud model, or image-to-cloud path that nobody registered FAILS here,
// so the privacy story cannot silently rot.

import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  KNOWN_OUTBOUND,
  CLOUD_LEDGER_JOBS,
  baseLedgerJob,
} from '../src/core/outbound';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const srcRoot = join(appRoot, 'src');

/** Repo-relative, forward-slashed path for a file under app/. */
function rel(abs: string): string {
  return relative(appRoot, abs).split('\\').join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else if (abs.endsWith('.ts') && !abs.endsWith('.d.ts')) out.push(abs);
  }
  return out;
}

const srcFiles = walk(srcRoot)
  .map((abs) => ({ path: rel(abs), text: readFileSync(abs, 'utf8') }))
  // The registry itself names every primitive (as regex strings) — exclude it so
  // those declarations don't read as call sites.
  .filter((f) => f.path !== 'src/core/outbound.ts');

describe('privacy drift: outbound primitives are all registered', () => {
  for (const surface of KNOWN_OUTBOUND) {
    it(`"${surface.kind}" (${surface.primitive}) only appears in declared files`, () => {
      const re = new RegExp(surface.primitive);
      const found = srcFiles.filter((f) => re.test(f.text)).map((f) => f.path).sort();
      const declared = [...surface.files].sort();
      // Every file that uses the primitive must be declared. (A declared file
      // that no longer uses it is fine — it just means we can tidy the registry.)
      const undeclared = found.filter((p) => !declared.includes(p));
      expect(
        undeclared,
        `UNDECLARED outbound site for "${surface.kind}": ${undeclared.join(', ')}. ` +
          `Register it in src/core/outbound.ts and document it in docs/PRIVACY.md.`,
      ).toEqual([]);
    });
  }
});

describe('privacy drift: ledger cloud jobs match the known kinds', () => {
  // Pull every recordLedger('cloud', '<job>', …) and record({ source: 'cloud', … })
  // literal job name out of the source and assert it is a declared cloud kind.
  const jobLiterals = new Set<string>();
  const cloudRecord = /recordLedger\(\s*'cloud'\s*,\s*'([^']+)'/g;
  for (const f of srcFiles) {
    let m: RegExpExecArray | null;
    while ((m = cloudRecord.exec(f.text))) jobLiterals.add(m[1]);
  }

  it('found the known cloud ledger call sites', () => {
    // Guards against the regex silently matching nothing (e.g. a refactor).
    expect(jobLiterals.size).toBeGreaterThan(0);
  });

  it('every cloud ledger job is a declared outbound kind', () => {
    const unknown = [...jobLiterals].filter((j) => !CLOUD_LEDGER_JOBS.includes(baseLedgerJob(j)));
    expect(
      unknown,
      `Ledger emits cloud job(s) not in CLOUD_LEDGER_JOBS: ${unknown.join(', ')}. ` +
        `Add them to src/core/outbound.ts and docs/PRIVACY.md.`,
    ).toEqual([]);
  });
});

describe('privacy drift: image/camera data only reaches the documented cloud path', () => {
  const hybrid = srcFiles.find((f) => f.path === 'src/ai/hybrid.ts');

  it('the AI module is present', () => {
    expect(hybrid).toBeDefined();
  });

  it('the only inlineData sent into a Gemini model is the point-and-say crop', () => {
    // Across all of src/, the files that build an `inlineData` part destined for
    // a Gemini model must be exactly the AI module (point-and-say). Camera frames
    // elsewhere (local capture, relay stills) never construct a model part.
    const sendsImageToModel = srcFiles
      .filter((f) => /\{\s*inlineData:\s*\{\s*mimeType/.test(f.text))
      .map((f) => f.path)
      .sort();
    expect(sendsImageToModel).toEqual(['src/ai/hybrid.ts']);
  });

  it('the hand-adaptive model is ONLY_ON_DEVICE (numbers never leave)', () => {
    expect(hybrid!.text).toMatch(/handAdapt[\s\S]{0,120}InferenceMode\.ONLY_ON_DEVICE/);
  });

  it('the ledger keeps a redaction backstop for media + landmark vectors', () => {
    const ledger = srcFiles.find((f) => f.path === 'src/core/ledger.ts')!;
    expect(ledger.text).toMatch(/data:\(image\|audio\|video\)/); // base64 media scrub
    expect(ledger.text).toMatch(/landmarks removed/); // landmark-vector scrub
  });
});

describe('privacy drift: docs + in-app text match the declared surfaces', () => {
  const privacyPath = join(appRoot, 'docs', 'PRIVACY.md');

  it('docs/PRIVACY.md exists', () => {
    expect(existsSync(privacyPath)).toBe(true);
  });

  it('docs/PRIVACY.md mentions every declared outbound kind', () => {
    const privacy = readFileSync(privacyPath, 'utf8');
    const missing = KNOWN_OUTBOUND.map((s) => s.kind).filter((k) => !privacy.includes(k));
    expect(
      missing,
      `docs/PRIVACY.md is missing outbound kind(s): ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('docs/PRIVACY.md keeps the core camera/voice claim', () => {
    const privacy = readFileSync(privacyPath, 'utf8').toLowerCase();
    expect(privacy).toContain('never leave this device');
    expect(privacy).toMatch(/point[- ]and[- ]say/);
  });

  it('the in-app ledger panel repeats the core claim', () => {
    const panel = srcFiles.find((f) => f.path === 'src/ui/ledgerPanel.ts')!;
    expect(panel.text.toLowerCase()).toContain('never leave this device');
  });
});
