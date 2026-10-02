// Builds the app with a stand-in scene view (SceneViewStub.jsx), for checking
// the drafting controls before the real editor is merged:
//   npx electron-vite build --config tests/fake-provider/harness/harness.config.mjs
// Run it from the project folder, and `npm run build` afterwards to get the normal app back.
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// electron-vite bundles this file before running it, so paths start from the project folder.
const root = process.cwd()
const stub = resolve(root, 'tests/fake-provider/harness/SceneViewStub.jsx')
const shared = { '@shared': resolve(root, 'src/shared') }

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared }, build: { rollupOptions: { input: resolve(root, 'src/main/index.ts') } } },
  preload: { plugins: [externalizeDepsPlugin()], resolve: { alias: shared }, build: { rollupOptions: { input: resolve(root, 'src/preload/index.ts') } } },
  renderer: {
    root: resolve(root, 'src/renderer'),
    resolve: {
      alias: [
        { find: /^@\/features\/editor\/SceneView$/, replacement: stub },
        { find: '@shared', replacement: resolve(root, 'src/shared') },
        { find: '@', replacement: resolve(root, 'src/renderer/src') }
      ]
    },
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: resolve(root, 'src/renderer/index.html') } }
  }
})
