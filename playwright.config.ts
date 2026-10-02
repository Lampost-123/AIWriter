import { defineConfig } from '@playwright/test'

// App tests drive the built Electron app (run `npm run build` first; `npm run test:e2e` does).
// On Linux they need a display: `xvfb-run -a npm run test:e2e`.
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  outputDir: 'test-results',
  use: {
    // Electron windows aren't browser pages, so tests/e2e/helpers.ts takes the
    // failure screenshot itself; these apply to any plain browser page.
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
})
