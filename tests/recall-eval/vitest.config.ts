// Vitest settings for the offline recall measure only (recall.eval.ts says how to run it): never part of npm test.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const root = resolve(__dirname, '..', '..')

export default defineConfig({
  root,
  resolve: { alias: { '@shared': resolve(root, 'src/shared'), '@': resolve(root, 'src/renderer/src') } },
  test: {
    include: ['tests/recall-eval/recall.eval.ts'],
    environment: 'node',
    env: { AIWRITE_SEARCH_MODEL_AUTO: 'off' },
    testTimeout: 60 * 60_000,
    fileParallelism: false,
    reporters: ['verbose']
  }
})
