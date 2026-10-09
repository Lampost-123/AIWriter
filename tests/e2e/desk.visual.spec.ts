// The desk's look guard (UI overhaul, D3.7): screenshots of the desk's writing room (the sheet, the whole story down the
// spine, the margin's notes and the AI dock), the slim spine's flyout and the scene drawer beside the page, on the
// sample world, in Light, Dark and Sepia, at 1920×1080 and a display scale of 1, compared with Windows baselines
// (desk.visual.spec.ts-snapshots/*-win32.png; CI runs on Windows too). Where there are none the pictures are skipped
// rather than failing (take them on purpose, below).
//
// To take new baselines on purpose (when the desk is meant to change): npx playwright test desk.visual --update-snapshots
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const NO_SCROLL_BARS = join(__dirname, 'classic.spec.css')
const SNAPSHOTS = join(__dirname, 'desk.visual.spec.ts-snapshots')

/** Everything settled: fonts loaded, nothing arriving, two frames drawn. */
async function settle(win: Page): Promise<void> {
  await win.evaluate('document.fonts.ready.then(() => undefined)')
  await win.evaluate('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(undefined))))')
}

const shot = async (win: Page, name: string): Promise<void> => {
  await settle(win)
  // The pointer out of the way (a hovered slip straightens; a hovered button lights).
  await win.mouse.move(2, 900)
  await settle(win)
  // A tight colour threshold (Playwright's default, 0.2, let the whole desk turn from brown to blue unnoticed): a change
  // of palette fails, while a few pixels of text drawn differently still pass.
  await expect(win).toHaveScreenshot(`${name}.png`, { maxDiffPixels: 200, threshold: 0.04, animations: 'disabled', caret: 'hide', stylePath: NO_SCROLL_BARS })
}

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.unmaximize()
    b.setContentSize(cw, ch)
  }, [w, h] as [number, number])
  await expect.poll(() => win.evaluate('innerWidth')).toBe(w)
}

for (const theme of ['light', 'dark', 'sepia'] as const) {
  test(`the desk looks as it should: the writing room, the flyout and the drawer in ${theme}`, async ({ launch }) => {
    const updating = ['all', 'changed'].includes(String(test.info().config.updateSnapshots))
    test.skip(
      !existsSync(join(SNAPSHOTS, `write-${theme}-${process.platform}.png`)) && !updating,
      `No ${process.platform} baselines for the desk yet (take them with --update-snapshots).`
    )
    // One display scale everywhere (Adam's PC is at 150%, CI at 100%), as classic.spec does.
    const { app, win } = await launch({ env: DESK, args: ['--force-device-scale-factor=1'] })
    await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
    await invoke(win, 'openSampleWorld')
    await invoke(win, 'updateSettings', { theme, editor: { spellCheck: false } })
    await win.reload()
    await win.waitForLoadState('domcontentloaded')
    await win.addStyleTag({ path: NO_SCROLL_BARS })
    await size(app, win, 1920, 1080)
    await expect(win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
    // The notes are in: the scene card and the entities named on the page.
    await expect(win.locator('[data-slip="card"]')).toBeVisible()
    await expect(win.locator('[data-slip^="entity:"]', { hasText: 'Edric Halloway' })).toBeVisible()
    await win.waitForTimeout(1800)
    await shot(win, `write-${theme}`)

    // The scene drawer beside the page.
    await win.locator('[data-desk-topbar]').getByRole('button', { name: /^Scene details/ }).click()
    await expect(win.locator('aside.desk-drawer')).toHaveAttribute('data-docked')
    await win.waitForTimeout(500)
    await shot(win, `drawer-${theme}`)
    await win.locator('[data-desk-topbar]').getByRole('button', { name: /^Scene details/ }).click()
    await expect(win.locator('aside.desk-drawer')).toHaveAttribute('data-state', 'closed')

    // The slim spine and its flyout.
    await win.getByRole('complementary', { name: 'Chapters and scenes' }).getByRole('button', { name: 'Collapse to the spine' }).click()
    await expect(win.locator('[data-desk-spine]')).toHaveAttribute('data-shape', 'slim')
    await win.locator('[data-desk-spine]').getByRole('button', { name: 'Story contents', exact: true }).evaluate((el) => (el as unknown as { click(): void }).click())
    await expect(win.getByRole('complementary', { name: 'Story contents' })).toBeVisible()
    await win.waitForTimeout(500)
    await shot(win, `flyout-${theme}`)
  })
}
