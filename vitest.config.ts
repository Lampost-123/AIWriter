import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve(__dirname, 'src/shared'), '@': resolve(__dirname, 'src/renderer/src') } },
  // The search model never downloads by itself in unit tests (src/main/retrieval/model/auto.ts).
  test: { include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'], environment: 'node', env: { AIWRITE_SEARCH_MODEL_AUTO: 'off' } }
})
