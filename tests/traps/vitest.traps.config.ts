// Vitest settings for the trap run only (npm run traps). The app's code is imported as '@app/...' and '@shared/...',
// pointed at TRAPS_ROOT (another checkout, say the step 2 branch's) or this one; 'electron' is the stand-in.
//
// The app starts some work on worker threads through electron-vite's `?nodeWorker` imports (token counting, and from
// step 5 the search model). Vite's test runner can't start those, so here each one is bundled once with esbuild into a
// plain script in the temp folder and started as a real worker thread, as the built app does. Native packages
// (onnxruntime-node, better-sqlite3) stay outside the bundle and load from the checkout's own node_modules.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const here = resolve(__dirname, '..', '..')
const root = resolve(process.env.TRAPS_ROOT || here)
const PREFIX = '\0traps-worker:'

/** A `?nodeWorker` import, as a real worker thread running the bundled worker script. */
function nodeWorkers(): Plugin {
  const fromRoot = createRequire(join(root, 'package.json'))
  return {
    name: 'traps-node-workers',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!id.endsWith('?nodeWorker') || !importer) return null
      const base = resolve(dirname(importer.replace(/\?.*$/, '')), id.replace(/\?nodeWorker$/, ''))
      const file = [base, `${base}.ts`, `${base}.js`].find((f) => existsSync(f) && statSync(f).isFile())
      return file ? PREFIX + file : null
    },
    async load(id) {
      if (!id.startsWith(PREFIX)) return null
      const entry = id.slice(PREFIX.length)
      const stamp = createHash('sha1').update(`${entry}|${statSync(entry).mtimeMs}`).digest('hex').slice(0, 16)
      const dir = join(tmpdir(), 'aiwrite-traps-workers')
      const out = join(dir, `${stamp}.cjs`)
      if (!existsSync(out)) {
        mkdirSync(dir, { recursive: true })
        await build({
          entryPoints: [entry],
          outfile: out,
          bundle: true,
          platform: 'node',
          format: 'cjs',
          target: 'node20',
          logLevel: 'silent',
          alias: { '@shared': join(root, 'src', 'shared') },
          plugins: [
            {
              name: 'native-from-checkout',
              setup(b) {
                // A dynamic import needs a file URL on Windows; a require, the plain path.
                b.onResolve({ filter: /^(?:onnxruntime-node|better-sqlite3)$/ }, (args) => {
                  const path = fromRoot.resolve(args.path)
                  return { path: args.kind === 'dynamic-import' ? pathToFileURL(path).href : path, external: true }
                })
              }
            }
          ]
        })
      }
      return `import { Worker } from 'node:worker_threads'\nexport default (options) => new Worker(${JSON.stringify(out)}, options)\n`
    }
  }
}

export default defineConfig({
  root: here,
  plugins: [nodeWorkers()],
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
