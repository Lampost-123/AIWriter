// Vitest settings for making the released-code fixtures only (make.run.ts; README.md one folder up). The app's code is
// imported as '@app/...' and '@shared/...', pointed at REL_ROOT (a checkout of the release, with node_modules), never
// this checkout; 'electron' is the trap harness's stand-in from that checkout.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const rel = resolve(process.env.REL_ROOT ?? '.')
const fwd = (p) => p.split('\\').join('/')

export default {
  root: dirname(fileURLToPath(import.meta.url)),
  resolve: {
    alias: [
      { find: /^electron$/, replacement: fwd(resolve(rel, 'tests/traps/fakeElectron.ts')) },
      { find: /^@app\//, replacement: `${fwd(resolve(rel, 'src'))}/` },
      { find: /^@shared\//, replacement: `${fwd(resolve(rel, 'src/shared'))}/` },
      { find: /^@\//, replacement: `${fwd(resolve(rel, 'src/renderer/src'))}/` },
      { find: /^better-sqlite3$/, replacement: fwd(resolve(rel, 'node_modules/better-sqlite3')) }
    ]
  },
  test: {
    include: ['make.run.ts'],
    environment: 'node',
    testTimeout: 120_000,
    fileParallelism: false,
    server: { deps: { inline: [/[\\/]src[\\/]/] } }
  }
}
