import { defineConfig } from 'vitest/config';

// Dedicated config for `npm run eval:commands`: runs the command and device-voice
// harnesses (not *.test.ts, so the default `vitest run` suite ignores the file writes).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/eval/runEval.ts', 'tests/eval/runDeviceVoice.ts'],
  },
});
