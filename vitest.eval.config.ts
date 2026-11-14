import { defineConfig } from 'vitest/config';

// Dedicated config for `npm run eval:commands`: runs only the eval harness
// (tests/eval/runEval.ts), which the default `vitest run` suite ignores because
// it is not a *.test.ts file.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/eval/runEval.ts'],
  },
});
