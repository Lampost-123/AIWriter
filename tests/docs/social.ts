// The repository's social preview card (GitHub: 1280 x 640): the app's New look colours, its icon and serif name,
// the tagline, and a collage of the app's own screenshots (hero.png in front, four rooms around it). A small page of its own, drawn in a hidden
// window by the app's Electron and captured.
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const url = (path: string): string => pathToFileURL(path).href

/** The page, with file addresses for the fonts the app bundles (out/renderer/assets), the icon and the screenshots. */
/** The New look's colours for the card: background, text, quieter text, the sheet's paper and its shadow's hue. */
const COLOURS = {
  dark: { bg: '#12110f', fg: '#eee8de', muted: '#aaa295', page: '#221f1c', shadow: '0 0 0 1px rgb(255 240 220 / 0.08), 0 2px 4px rgb(0 0 0 / 0.3), 0 14px 34px rgb(0 0 0 / 0.45), 0 40px 80px -20px rgb(0 0 0 / 0.55)' },
  light: { bg: '#ebe5da', fg: '#221d17', muted: '#574f45', page: '#fffdf9', shadow: '0 0 0 1px rgb(80 55 25 / 0.08), 0 2px 4px rgb(80 55 25 / 0.06), 0 14px 34px rgb(80 55 25 / 0.14), 0 40px 80px -20px rgb(80 55 25 / 0.2)' },
  sepia: { bg: '#e5d9c0', fg: '#3b2f22', muted: '#56493a', page: '#faf4e5', shadow: '0 0 0 1px rgb(80 55 25 / 0.08), 0 2px 4px rgb(80 55 25 / 0.06), 0 14px 34px rgb(80 55 25 / 0.14), 0 40px 80px -20px rgb(80 55 25 / 0.2)' }
}

export function socialPage(root: string, theme: keyof typeof COLOURS = 'dark'): string {
  const c = COLOURS[theme]
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
  const img = (name: string): string => url(join(root, 'docs', 'images', `${name}.png`))
  // A collage of the app's own screenshots (1440 x 900 each): the desk's Write room in front, four rooms around it, Ask over its corner.
  // Each panel: [picture, left, top, width, height, scale of the picture, crop x, crop y (in the picture's pixels), label (none where the picture shows its own title), z].
  const panels: [string, number, number, number, number, number, number, number, string, number][] = [
    ['world-gallery', 468, 34, 340, 214, 0.5, 372, 270, 'World', 1],
    ['story-board', 918, 26, 330, 212, 0.5, 318, 262, 'Plan', 1],
    ['world-map', 452, 392, 330, 214, 0.42, 500, 330, 'Relationship map', 2],
    ['ask', 1000, 404, 252, 204, 0.75, 1078, 66, '', 4],
    ['hero', 598, 150, 500, 330, 0.55, 476, 46, 'Write', 3]
  ]
  const panel = ([name, left, top, w, h, scale, x, y, label, z]: (typeof panels)[number]): string =>
    `<div class="panel" style="left:${left}px;top:${top}px;width:${w}px;height:${h}px;z-index:${z};background-image:url('${img(name)}');background-size:${1440 * scale}px auto;background-position:${-x * scale}px ${-y * scale}px">${label ? `<span class="label">${label}</span>` : ''}</div>`
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face { font-family: 'Literata Variable'; src: url('${literata}') format('woff2'); font-weight: 200 900; }
@font-face { font-family: 'Inter Variable'; src: url('${inter}') format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: 1280px; height: 640px; overflow: hidden; }
body { background: ${c.bg}; color: ${c.fg}; font-family: 'Inter Variable', sans-serif; position: relative; }
body::before { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse 60% 70% at 72% 50%, rgb(240 190 110 / 0.07), transparent 70%); }
.left { position: absolute; left: 56px; top: 0; bottom: 0; width: 372px; display: flex; flex-direction: column; justify-content: center; }
.icon { width: 96px; height: 96px; margin-bottom: 24px; filter: drop-shadow(0 6px 14px rgb(0 0 0 / 0.3)); }
h1 { font-family: 'Literata Variable', serif; font-weight: 600; font-size: 64px; line-height: 1; letter-spacing: -0.01em; margin: 0 0 20px; }
.tag { font-size: 25px; line-height: 1.34; font-weight: 450; margin: 0 0 26px; color: ${c.fg}; }
.small { font-size: 15px; color: ${c.muted}; font-weight: 500; white-space: nowrap; }
.panel { position: absolute; border-radius: 14px; overflow: hidden; background-color: ${c.page}; background-repeat: no-repeat; box-shadow: ${c.shadow}; }
.label { position: absolute; left: 10px; top: 10px; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 600;
  color: ${c.fg}; background: rgb(18 17 15 / 0.78); box-shadow: 0 0 0 1px rgb(255 240 220 / 0.12); }
</style></head><body>
<div class="left">
  <img class="icon" src="${icon}" alt="">
  <h1>AI Write</h1>
  <p class="tag">Write long stories with an AI that remembers your world.</p>
  <div class="small">Free for Windows · github.com/Lampost-123/AIWriter</div>
</div>
${panels.map(panel).join('')}
</body></html>`
}
