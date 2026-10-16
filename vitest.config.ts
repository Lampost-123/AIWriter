import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  // The search model never downloads by itself in unit tests (src/main/retrieval/model/auto.ts).
  // GitHub's shared Windows runners run the suite many times slower than a desk machine while hundreds of files share four
  // cores: tests with no waits at all (a world exported, a backup copied: under a quarter of a second here) passed 5 s
  // there at random. CI gets 20 s a test and 30 s a hook; at a desk the defaults stay, so a slow test still shows. Speed
  // checks have their own budgets (src/shared/testPerf.ts).
  test: {
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
    env: { AIWRITE_SEARCH_MODEL_AUTO: 'off' },
    ...(process.env.CI ? { testTimeout: 20_000, hookTimeout: 30_000 } : {})
  }
})
