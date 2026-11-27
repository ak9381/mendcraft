// Final review I12: ?sim works only in a test build (dev server or a
// VITE_E2E=1 build). In production it is an ordinary address: no scripted
// face registration, no synthetic teach recording, no SIM phones or devices,
// and the live models stay on.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (f: string): string => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8');

describe('?sim is a test-build switch only', () => {
  const main = src('canvas/canvasMain.ts');
  it('the canvas reads ?sim only when the build is a test build', () => {
    expect(main).toContain("const testBuild = import.meta.env.DEV || import.meta.env.VITE_E2E === '1';");
    expect(main).toContain("const noLiveModel = testBuild && params.has('sim') && !recordOn;");
    expect(main).toContain("const simRun = testBuild && (params.has('sim') || recordOn);");
    // Every other read of ?sim in the canvas goes through those.
    const reads = main.match(/params\.(?:has|get)\('sim'\)/g) ?? [];
    for (const line of main.split('\n').filter((l) => /params\.(?:has|get)\('sim'\)/.test(l))) expect(line).toMatch(/testBuild/);
    expect(reads.length).toBeGreaterThan(0);
  });
  it('the old editor’s SIM_ACTIVE is a test-build switch too', () => {
    expect(src('sim.ts')).toMatch(/export const SIM_ACTIVE =\s*\(import\.meta\.env\.DEV \|\| import\.meta\.env\.VITE_E2E === '1'\) &&/);
  });
});
