// The Classic look guard (the New look, part 1): Classic keeps today's look and layout exactly. Screenshots of the
// main screens in Classic, on the sample world, in Light and Dark, are compared with baselines taken from the app
// before the New look began. The app is Windows only (CI too), so only Windows baselines are kept
// (classic.spec.ts-snapshots/*-win32.png).
//
// To take new baselines on purpose (only when Classic is meant to change): npx playwright test classic --update-snapshots
import { join } from 'node:path'
import type { Page } from '@playwright/test'
import { binder, expect, invoke, test } from './helpers'

const main = (win: Page) => win.locator('main')

/** Everything settled: fonts loaded, nothing loading, no caret blinking or squiggles. */
async function settle(win: Page): Promise<void> {
  await win.evaluate('document.fonts.ready.then(() => undefined)')
  await win.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))')
}

const NO_SCROLL_BARS = join(__dirname, 'classic.spec.css')

/** Every scroll bar drawn again, so none keeps a look from before the style above (Chromium doesn't repaint it). */
const REDRAW_SCROLL_BARS = `for (const el of document.querySelectorAll('*')) {
  const s = getComputedStyle(el)
  if (!/auto|scroll/.test(s.overflowX + s.overflowY)) continue
  const top = el.scrollTop, left = el.scrollLeft, was = el.style.overflow
  el.style.overflow = 'hidden'
  void el.offsetWidth
  el.style.overflow = was
  el.scrollTop = top
  el.scrollLeft = left
}`

const shot = async (win: Page, name: string): Promise<void> => {
  await settle(win)
  await win.evaluate(REDRAW_SCROLL_BARS)
  await settle(win)
  // Scroll bars show only while the pointer is over a list or the page, and where the real pointer rests differs from
  // one machine to another, so they are left out of every picture.
  await expect(win).toHaveScreenshot(`${name}.png`, { maxDiffPixels: 150, animations: 'disabled', caret: 'hide', stylePath: NO_SCROLL_BARS })
}

for (const theme of ['light', 'dark'] as const) {
  test(`Classic stays as it was: the main screens in ${theme}`, async ({ launch }) => {
    // One window size and one display scale everywhere, whatever the screen (Adam's PC is at 150%, CI at 100%).
    const { app, win } = await launch({ args: ['--force-device-scale-factor=1'] })
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.unmaximize()
      w.setContentSize(1280, 800)
    })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await invoke(win, 'openSampleWorld')
    // No spelling squiggles (the dictionary loads in its own time) and the theme asked for.
    await invoke(win, 'updateSettings', { theme, editor: { spellCheck: false } })
    await win.reload()
    // As soon as the page loads, before the pointer can rest on a list: a scroll bar isn't repainted when its style
    // changes later.
    await win.waitForLoadState('domcontentloaded')
    await win.addStyleTag({ path: NO_SCROLL_BARS })
    await expect(binder(win)).toBeVisible()
    await expect(win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
    await shot(win, `write-${theme}`)

    await binder(win).getByRole('button', { name: 'Codex', exact: true }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
    await expect(main(win).locator('[data-codex-card]').filter({ hasText: 'Wren Halloway' }).first()).toBeVisible()
    await shot(win, `codex-${theme}`)

    await main(win).locator('[data-codex-card]').filter({ hasText: 'Wren Halloway' }).first().click()
    await expect(main(win).getByRole('button', { name: 'Back to the codex' })).toBeVisible()
    await shot(win, `character-${theme}`)

    await binder(win).getByRole('button', { name: 'Style guide', exact: true }).click()
    await expect(main(win).getByRole('heading', { level: 1, name: 'Style guide' })).toBeVisible()
    await shot(win, `style-${theme}`)

    // (Settings › Appearance isn't here: the Style switch between the looks is added to it in both.)
    await binder(win).getByRole('button', { name: 'Plot threads board', exact: true }).click()
    await expect(main(win).locator('section[aria-labelledby^="board-"]').first()).toBeVisible()
    await shot(win, `threads-${theme}`)
  })
}
