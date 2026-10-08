// The repository's social preview card (GitHub: 1280 x 640): the app's New look colours, its icon and serif name,
// the tagline, and part of hero.png on a sheet with a soft shadow. A small page of its own, drawn in a hidden
// window by the app's Electron and captured.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const url = (path: string): string => pathToFileURL(path).href

/** The page, with file addresses for the fonts the app bundles (out/renderer/assets), the icon and hero.png. */
export function socialPage(root: string): string {
  const assets = join(root, 'out', 'renderer', 'assets')
  const files = readdirSync(assets)
  const font = (prefix: string): string => {
    const f = files.find((x) => x.startsWith(prefix) && x.endsWith('.woff2'))
    if (!f) throw new Error(`No bundled font ${prefix} (run npm run build first)`)
    return url(join(assets, f))
  }
  const literata = font('literata-latin-opsz-normal-')
  const inter = font('inter-latin-wght-normal-')
  const icon = url(join(root, 'build', 'icon.png'))
  const hero = url(join(root, 'docs', 'images', 'hero.png'))
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Literata Variable'; src: url('${literata}') format('woff2'); font-weight: 200 900; }
@font-face { font-family: 'Inter Variable'; src: url('${inter}') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; }
body { background: #ebe5da; color: #221d17; font-family: 'Inter Variable', sans-serif; position: relative; }
.left { position: absolute; left: 60px; top: 0; bottom: 0; width: 466px; display: flex; flex-direction: column; justify-content: center; }
.icon { width: 112px; height: 112px; margin-bottom: 28px; filter: drop-shadow(0 6px 14px rgb(80 55 25 / 0.18)); }
h1 { font-family: 'Literata Variable', serif; font-weight: 600; font-size: 72px; line-height: 1; letter-spacing: -0.01em; margin: 0 0 22px; }
.tag { font-size: 28px; line-height: 1.32; font-weight: 450; margin: 0 0 30px; color: #221d17; }
.small { font-size: 17px; color: #574f45; font-weight: 500; white-space: nowrap; }
.sheet { position: absolute; right: 44px; top: 50px; width: 700px; height: 540px; border-radius: 16px; overflow: hidden;
  background: #fffdf9 url('${hero}') no-repeat; background-size: 907px auto; background-position: -199px -27px;
  box-shadow: 0 0 0 1px rgb(80 55 25 / 0.08), 0 2px 4px rgb(80 55 25 / 0.06), 0 14px 34px rgb(80 55 25 / 0.14), 0 40px 80px -20px rgb(80 55 25 / 0.2); }
</style></head><body>
<div class="left">
  <img class="icon" src="${icon}" alt="">
  <h1>AI Write</h1>
  <p class="tag">Write long stories with an AI that remembers your world.</p>
  <div class="small">Free for Windows · github.com/Lampost-123/AIWriter</div>
</div>
<div class="sheet"></div>
</body></html>`
}
