// Final review M2: a store that could not be read is never written this
// session — by board saves, next steps, and connectors alike.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('no write to an unread store', () => {
  it('onConnector and onSteps both skip the write when the store read failed', () => {
    const main = readFileSync(new URL('../../src/canvas/canvasMain.ts', import.meta.url), 'utf8');
    for (const hook of ['onConnector', 'onSteps']) {
      const start = main.indexOf(`  ${hook}: (a) => {`);
      const body = main.slice(start, main.indexOf('\n  },', start));
      expect(body, hook).toContain('if (loaded.readFailed || reloading) return;');
      expect(body.indexOf('if (loaded.readFailed || reloading) return;'), hook).toBeLessThan(body.indexOf('artifactStore.put('));
    }
  });
});
