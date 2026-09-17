import { defineConfig } from 'vitest/config';

// Unit tests for the pure parts of the simulator: the flight store's rules, the
// battery model, the control easing, and every Flight School lesson's validator
// and star rubric.
//
// Node environment, not jsdom: none of this needs a DOM, and the engine's own
// modules deliberately keep `navigator` and `window` inside functions rather
// than at module load, so importing them here is safe. A test that genuinely
// needs a document opts in per file with:
//
//   // @vitest-environment jsdom
//
// Every test is named with the id of the manual case it replaces, from
// `docs/test-cases.csv` — search TC-034 and you find both.
export default defineConfig({
  resolve: {
    alias: {
      '@shared': new URL('./src/shared', import.meta.url).pathname,
      '@renderer': new URL('./src/renderer', import.meta.url).pathname,
    },
  },
  // Tests run the development configuration: models are not encrypted.
  define: {
    __ASSET_KEY_A__: JSON.stringify(''),
    __ASSET_KEY_B__: JSON.stringify(''),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
  },
});
