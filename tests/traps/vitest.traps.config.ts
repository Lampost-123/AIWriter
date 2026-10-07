// Vitest settings for the trap run only (npm run traps). The app's code is imported as '@app/...' and '@shared/...',
// pointed at TRAPS_ROOT (another checkout, say the step 2 branch's) or this one; 'electron' is the stand-in.
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

const here = resolve(__dirname, '..', '..')
const root = resolve(process.env.TRAPS_ROOT || here)

export default defineConfig({
  root: here,
  resolve: {
    alias: [
      { find: /^electron$/, replacement: resolve(here, 'tests/traps/fakeElectron.ts') },
      { find: /^@app\//, replacement: `${resolve(root, 'src').replace(/\\/g, '/')}/` },
      { find: /^@shared\//, replacement: `${resolve(root, 'src/shared').replace(/\\/g, '/')}/` },
      { find: /^@\//, replacement: `${resolve(root, 'src/renderer/src').replace(/\\/g, '/')}/` }
    ]
  },
  test: {
    include: ['tests/traps/traps.run.ts'],
    environment: 'node',
    testTimeout: 6 * 60 * 60_000,
    hookTimeout: 60_000,
    // One run at a time, with its log as it goes.
    fileParallelism: false,
    reporters: ['verbose'],
    server: { deps: { inline: [/[\\/]src[\\/]/] } }
  }
})
