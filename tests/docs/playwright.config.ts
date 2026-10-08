import { defineConfig } from '@playwright/test'

// The README / user guide screenshots (tests/docs/screenshots.spec.ts). Not part of the app tests or CI: the main
// playwright.config.ts only looks in tests/e2e. Run with `npm run docs:screenshots` (it builds the app first).
export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list']],
  outputDir: '../../test-results/docs'
})
