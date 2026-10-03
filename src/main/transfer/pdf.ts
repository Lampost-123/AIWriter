// Printing a page of HTML to PDF: a hidden window loads it, waits for its fonts, and Chromium prints it
// with page numbers at the foot. The page's own CSS sets the paper size and margins. The app's book font
// (Literata) is used when its files can be found beside the interface; otherwise Georgia.

import { BrowserWindow } from 'electron'
import { readdirSync } from 'node:fs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { newId } from '../util'

let fontRules: string | null = null

/** @font-face rules for Literata from the interface's own files (only the Latin set, so no face hides another). */
export function bookFontRules(): string {
  if (fontRules !== null) return fontRules
  fontRules = ''
  try {
    const dir = join(__dirname, '../renderer/assets')
    for (const f of readdirSync(dir)) {
      const m = /^literata-latin-(400|700)-(normal|italic)-[^.]*\.woff2$/.exec(f)
      if (!m) continue
      fontRules += `@font-face { font-family: 'Literata'; font-style: ${m[2]}; font-weight: ${m[1]}; src: url('${pathToFileURL(join(dir, f)).href}') format('woff2'); }\n`
    }
  } catch {
    /* running from source, or moved: Georgia it is */
  }
  return fontRules
}

const FOOTER = `<div style="width:100%;text-align:center;font-size:8pt;color:#777;font-family:Georgia,serif;"><span class="pageNumber"></span></div>`

/** The PDF of a page of HTML. */
export async function htmlToPdf(html: string): Promise<Uint8Array> {
  const file = join(tmpdir(), `aiwrite-print-${newId()}.html`)
  await writeFile(file, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  try {
    await win.loadFile(file)
    // The page has no scripts of its own; this only waits until its fonts have loaded.
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => true)').catch(() => undefined)
    return await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER
    })
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await rm(file, { force: true }).catch(() => undefined)
  }
}
