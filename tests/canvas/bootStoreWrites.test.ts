// Final review M2: a store that could not be read is never written this
// session — by board saves, next steps, and connectors alike.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('no write to an unread store', () => {
  it('onConnector and onSteps both skip the write when the store read failed', () => {
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    // Both hooks go through keepOne, which refuses to write before the put.
    for (const hook of ['onConnector', 'onSteps']) expect(main, hook).toContain(`  ${hook}: keepOne,`);
    const start = main.indexOf('function keepOne(');
    const body = main.slice(start, main.indexOf('\n}', start));
    expect(body).toContain('if (loaded.readFailed || reloading) return;');
    expect(body.indexOf('if (loaded.readFailed || reloading) return;')).toBeLessThan(body.indexOf('artifactStore.put('));
  });
});
