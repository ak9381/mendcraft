// Final review M2: a store that could not be read is never written this
// session — by board saves, next steps, and connectors alike.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('no write to an unread store', () => {
  it('onConnector and onSteps both skip the write when the store read failed', () => {
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    // Both hooks go through keepOne, which refuses to write before the put.
    for (const hook of ['onConnector', 'onSteps']) expect(main, hook).toContain(`  ${hook}: keepOne,`);
    // keepOne hands the artifact to the one-at-a-time writer, which refuses
    // to write (before the put) while the store is unread or reloading.
    expect(main).toContain('function keepOne(a: Artifact): void { oneWriter.keep(a); }');
    expect(main).toMatch(/createOneWriter\(\{[\s\S]*?put: \(a\) => artifactStore\.put\(a\),[\s\S]*?blocked: \(\) => !!loaded\.readFailed \|\| reloading,/);
    const store = readFileSync(new URL('../../src/canvas/canvasStore.ts', import.meta.url), 'utf8');
    const w = store.slice(store.indexOf('function write(a: Artifact)'), store.indexOf('function retry()'));
    expect(w.indexOf('if (o.blocked())')).toBeGreaterThan(-1);
    expect(w.indexOf('if (o.blocked())')).toBeLessThan(w.indexOf('o.put(a)'));
  });
});
