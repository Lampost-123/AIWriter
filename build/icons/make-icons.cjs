// Draws the AI Write app icon and writes every size the app and installers need.
// Run with Electron (it rasterises the SVG with Chromium), from the repo root:
//   xvfb-run -a npx electron build/icons/make-icons.cjs     (Linux)
//   npx electron build/icons/make-icons.cjs                 (Windows / Mac)
// Then build/icon.ico is assembled from the PNGs with ImageMagick if it's installed:
//   convert build/icons/png/icon-{16,20,24,32,40,48,64,128,256}.png build/icon.ico
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..', '..')
const OUT = path.join(__dirname, 'png')

const ACCENT_LIGHT = '#557aa6'
const ACCENT = '#3d5a80'
const ACCENT_DARK = '#283f5e'
const PAPER = '#fcf8ee'
const PAPER_SHADE = '#eee2c6'
const PAGE_EDGES = '#dccaa3'
const AMBER = '#f2b84b'
const AMBER_LIGHT = '#fff1c9'

const mirror = (d) => d.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_m, x, y) => `${1024 - Number(x)} ${y}`)

function star(cx, cy, r, k = 0.2) {
  const q = r * k
  return `M ${cx} ${cy - r} Q ${cx + q} ${cy - q} ${cx + r} ${cy} Q ${cx + q} ${cy + q} ${cx} ${cy + r} Q ${cx - q} ${cy + q} ${cx - r} ${cy} Q ${cx - q} ${cy - q} ${cx} ${cy - r} Z`
}

/** The icon as SVG. `small` drops the fine detail that turns to mush at 16-32 pixels. */
function iconSvg(size, small) {
  const s = small ? 1.12 : 1
  const ty = small ? 30 : 46
  // Left page: spine top -> outer top corner -> outer bottom corner -> spine bottom.
  const page = 'M 512 470 C 446 424 340 400 214 414 L 214 718 C 340 704 446 726 512 772 Z'
  const under = 'M 512 492 C 446 448 334 426 196 440 L 196 744 C 334 730 446 750 512 796 Z'
  const cover = 'M 512 506 C 446 466 326 446 176 462 L 176 768 C 326 752 446 770 512 814 Z'
  // Lines of writing, following the curve of the page tops; the last one is short.
  const lines = small
    ? ''
    : [0, 1, 2, 3]
        .map((i) => {
          const y = 408 + 72 + i * 56
          const l =
            i === 3
              ? `M 256 ${y} C 300 ${y - 4} 350 ${y - 2} 400 ${y + 8}`
              : `M 256 ${y} C 330 ${y - 6} 410 ${y + 4} 476 ${y + 32}`
          return `<path d="${l}" /><path d="${mirror(l)}" />`
        })
        .join('')
  const spark = small ? star(512, 250, 168, 0.2) : star(560, 280, 104, 0.19)
  const spark2 = small ? '' : `<path d="${star(690, 196, 40, 0.24)}" fill="url(#spark)" />`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${ACCENT_LIGHT}" />
      <stop offset="0.55" stop-color="${ACCENT}" />
      <stop offset="1" stop-color="${ACCENT_DARK}" />
    </linearGradient>
    <radialGradient id="sheen" cx="0.3" cy="0.12" r="0.75">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.22" />
      <stop offset="1" stop-color="#ffffff" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="pageL" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${PAPER}" />
      <stop offset="0.78" stop-color="${PAPER}" />
      <stop offset="1" stop-color="${PAPER_SHADE}" />
    </linearGradient>
    <linearGradient id="pageR" x1="1" y1="0" x2="0" y2="0">
      <stop offset="0" stop-color="#f8f1e1" />
      <stop offset="0.78" stop-color="#f8f1e1" />
      <stop offset="1" stop-color="${PAPER_SHADE}" />
    </linearGradient>
    <radialGradient id="spark" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${AMBER_LIGHT}" />
      <stop offset="0.55" stop-color="#ffd47a" />
      <stop offset="1" stop-color="${AMBER}" />
    </radialGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="${AMBER}" stop-opacity="0.55" />
      <stop offset="1" stop-color="${AMBER}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="shadow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#0b1626" stop-opacity="0.45" />
      <stop offset="1" stop-color="#0b1626" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#bg)" />
  <rect x="64" y="64" width="896" height="896" rx="208" fill="url(#sheen)" />
  <g transform="translate(512 ${ty}) scale(${s}) translate(-512 0)">
    <ellipse cx="512" cy="826" rx="350" ry="${small ? 40 : 46}" fill="url(#shadow)" />
    <path d="${cover}" fill="#1c304b" /><path d="${mirror(cover)}" fill="#1c304b" />
    <path d="${under}" fill="${PAGE_EDGES}" /><path d="${mirror(under)}" fill="${PAGE_EDGES}" />
    <path d="${page}" fill="url(#pageL)" /><path d="${mirror(page)}" fill="url(#pageR)" />
    <path d="M 512 470 L 512 772" stroke="#cdb98f" stroke-width="${small ? 10 : 6}" stroke-linecap="round" />
    <g fill="none" stroke="${ACCENT}" stroke-opacity="0.26" stroke-width="13" stroke-linecap="round">${lines}</g>
  </g>
  ${small ? '' : `<circle cx="560" cy="${280 + ty}" r="190" fill="url(#glow)" />`}
  <g transform="translate(0 ${ty})">
    <path d="${spark}" fill="url(#spark)" />
    ${spark2}
  </g>
</svg>`
}

app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  fs.writeFileSync(path.join(__dirname, 'icon.svg'), iconSvg(1024, false))
  fs.writeFileSync(path.join(__dirname, 'icon-small.svg'), iconSvg(32, true))

  const win = new BrowserWindow({ show: false, width: 200, height: 200, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html,<!doctype html><html><body></body></html>')
  const render = async (size) => {
    const svg = iconSvg(size, size <= 32)
    const b64 = Buffer.from(svg).toString('base64')
    const dataUrl = await win.webContents.executeJavaScript(`(async () => {
      const img = new Image()
      img.src = 'data:image/svg+xml;base64,${b64}'
      await img.decode()
      const c = document.createElement('canvas')
      c.width = c.height = ${size}
      const ctx = c.getContext('2d')
      ctx.imageSmoothingQuality = 'high'
      ctx.drawImage(img, 0, 0, ${size}, ${size})
      return c.toDataURL('image/png')
    })()`)
    const file = path.join(OUT, `icon-${size}.png`)
    fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'))
    return file
  }

  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256, 512, 1024]
  const files = {}
  for (const size of sizes) files[size] = await render(size)

  fs.copyFileSync(files[1024], path.join(ROOT, 'build', 'icon.png'))
  fs.mkdirSync(path.join(ROOT, 'resources'), { recursive: true })
  fs.copyFileSync(files[512], path.join(ROOT, 'resources', 'icon.png'))
  try {
    const icoSizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
    execFileSync('convert', [...icoSizes.map((s) => files[s]), path.join(ROOT, 'build', 'icon.ico')])
    console.log('wrote build/icon.ico')
  } catch (e) {
    console.log('ImageMagick not found: assemble build/icon.ico from build/icons/png yourself.', e.message)
  }
  console.log('wrote', Object.values(files).length, 'PNGs, build/icon.png and resources/icon.png')
  app.quit()
})
