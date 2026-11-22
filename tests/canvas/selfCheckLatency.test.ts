// Runs the self-check over every top-level tile of the energy showcase
// fixture (the same plan shape ?showcase=energy renders), timing dump+replay
// per tile with performance.now(), and prints the median/p95 across the
// whole set plus several repeats — a report, not just a pass/fail gate.
import { beforeEach, describe, expect, it } from 'vitest';
import { buildEnergyShowcaseDoc } from '../../src/canvas/showcaseFixture';
import { enumerateMorphTiles } from '../../src/canvas/morphTarget';
import { checkTile, expectedControlCount } from '../../src/canvas/selfCheck';
import { fakeDoc, fakeEl, fakeHost, installSelfCheckGlobals } from '../helpers/selfCheckDom';

beforeEach(() => { installSelfCheckGlobals(); });

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function percentile(sorted: readonly number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

/** A synthetic DOM for one tile: a host rect, and `n` evenly spaced,
 *  non-overlapping fake controls inside it — enough to exercise dump +
 *  replay + every assertion without a real renderer. */
function buildFakeTile(label: string, n: number) {
  const host = fakeHost({ left: 0, top: 0, width: 400, height: 40 * Math.max(1, n) }, { 'data-mc-tile': label });
  const controls = Array.from({ length: n }, (_, i) => {
    const el = fakeEl('button', { left: 10, top: i * 40 + 5, width: 100, height: 30 }, { 'aria-label': `${label} control ${i}` });
    el.parentElement = host;
    return el;
  });
  return { host, doc: fakeDoc(controls) };
}

describe('self-check latency over the showcase tiles', () => {
  it('reports per-tile dump+replay median/p95 across repeated runs', () => {
    const doc = buildEnergyShowcaseDoc();
    const plan = doc.surfaces[doc.frames[0].id];
    const entries = enumerateMorphTiles(plan).filter((e) => e.path.length === 1);
    expect(entries.length).toBeGreaterThan(0);

    const REPEATS = 20;
    const samples: number[] = [];
    for (let r = 0; r < REPEATS; r++) {
      for (const entry of entries) {
        const n = Math.max(1, expectedControlCount(entry.spec));
        const { host, doc: tileDoc } = buildFakeTile(entry.label, n);
        const t0 = now();
        checkTile(host, entry.spec, tileDoc);
        samples.push(now() - t0);
      }
    }

    const sorted = samples.slice().sort((a, b) => a - b);
    const median = percentile(sorted, 0.5);
    const p95 = percentile(sorted, 0.95);
    // eslint-disable-next-line no-console
    console.log(`[self-check latency] tiles=${entries.length} runs=${samples.length} medianMs=${median.toFixed(2)} p95Ms=${p95.toFixed(2)}`);

    expect(samples.length).toBe(entries.length * REPEATS);
    // Generous ceiling: this guards against a real regression, not micro-jitter.
    expect(p95).toBeLessThan(50);
  });
});
