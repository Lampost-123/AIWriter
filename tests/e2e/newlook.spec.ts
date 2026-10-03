// The New look's frame, walked through on the sample world: the area rail (Write, Plan, World, Check; Ask and
// Settings at its foot), the side list of the area showing, the trail of where Adam is, the sample world as a chip,
// and two-tone icons. Opening a screen from anywhere (the palette, the trail) lights its area on the rail.
import type { Page } from '@playwright/test'
import { createWorldFromWelcome, expect, invoke, test, useFakeModel } from './helpers'

const rail = (win: Page) => win.getByRole('navigation', { name: 'Areas' })
const area = (win: Page, name: string) => rail(win).getByRole('button', { name, exact: true })
const list = (win: Page) => win.locator('[data-area-list]')
const main = (win: Page) => win.locator('main')

async function sampleWorld(launch: (o?: { env?: Record<string, string> }) => Promise<{ win: Page }>): Promise<Page> {
  const { win } = await launch({ env: { AIWRITE_LOOK: 'new' } })
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(win, 'openSampleWorld')
  await win.reload()
  await expect(win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return win
}

test('the New look: the rail, its areas and their lists, the trail, and the sample world as a chip', async ({ launch }) => {
  const win = await sampleWorld(launch)
  expect(await win.evaluate<string | null>('document.documentElement.dataset.look ?? null')).toBe('new')

  // Writing: the Write area is lit, its list holds the story's chapters and scenes, and the open scene is selected.
  for (const name of ['Write', 'Plan', 'World', 'Check', 'Ask', 'Settings']) await expect(area(win, name)).toBeVisible()
  await expect(area(win, 'Write')).toHaveAttribute('aria-current', 'page')
  await expect(list(win)).toHaveAttribute('data-area-list', 'write')
  await expect(list(win).getByRole('treeitem', { name: /Lighting the Lamp/ })).toHaveAttribute('aria-selected', 'true')
  // Two-tone icons, none of Classic's line icons.
  await expect(win.locator('svg.lucide')).toHaveCount(0)
  // Today's binder isn't there: no World section under the story.
  await expect(win.getByRole('navigation', { name: 'World', exact: true })).toHaveCount(0)

  // The trail: the story, the chapter and the scene.
  const trail = win.getByRole('navigation', { name: 'Where you are' })
  await expect(trail.getByRole('button')).toHaveText(['The Keeper’s Light', 'The Night Ferry', 'Lighting the Lamp'])
  await expect(trail.getByRole('button', { name: 'Lighting the Lamp' })).toHaveAttribute('aria-current', 'page')

  // The sample world is a chip in the top bar, with the way to start Adam's own.
  const chip = win.getByRole('region', { name: 'Sample world' })
  await expect(chip.getByRole('button', { name: 'Start my own' })).toBeVisible()

  // World: the codex, and every kind with its count.
  await area(win, 'World').click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
  await expect(area(win, 'World')).toHaveAttribute('aria-current', 'page')
  await expect(list(win)).toHaveAttribute('data-area-list', 'world')
  await expect(list(win).getByRole('button', { name: /^Everything/ })).toHaveAttribute('aria-current', 'page')
  // Codex cards: a card of paper with its kind's ink along the top, and the letter in that ink.
  const wren = main(win).locator('[data-codex-card]').filter({ hasText: 'Wren Halloway' }).first()
  await expect(wren.locator('span.bg-k-char')).toHaveCount(1)
  expect(await win.evaluate<string>(`getComputedStyle(document.querySelector('[data-codex-card] .text-k-char')).color`)).not.toBe(
    await win.evaluate<string>(`getComputedStyle(document.documentElement).getPropertyValue('--muted')`)
  )
  await list(win).getByRole('button', { name: /^Characters/ }).click()
  await expect(list(win).getByRole('button', { name: /^Characters/ })).toHaveAttribute('aria-current', 'page')
  await expect(list(win).getByRole('button', { name: /^Characters/ })).toContainText('4')

  // Plan: the outline helper, and a chapter's plan from the list.
  await area(win, 'Plan').click()
  await expect(list(win)).toHaveAttribute('data-area-list', 'plan')
  await expect(list(win).getByRole('button', { name: 'Outline helper' })).toHaveAttribute('aria-current', 'page')
  await list(win).getByRole('navigation', { name: 'Chapters' }).getByRole('button', { name: 'The Drowned Steps' }).click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'The Drowned Steps' })).toBeVisible()

  // Check: consistency.
  await area(win, 'Check').click()
  await expect(list(win)).toHaveAttribute('data-area-list', 'check')
  await expect(list(win).getByRole('button', { name: 'Consistency' })).toHaveAttribute('aria-current', 'page')

  // A screen opened from the palette lights its own area: the style guide is in Write.
  await win.keyboard.press('Control+K')
  await win.keyboard.type('style guide')
  await win.keyboard.press('Enter')
  await expect(main(win).getByRole('heading', { level: 1, name: 'Style guide' })).toBeVisible()
  await expect(area(win, 'Write')).toHaveAttribute('aria-current', 'page')
  await expect(list(win).getByRole('button', { name: 'Style guide' })).toHaveAttribute('aria-current', 'page')

  // The trail leads back: the chapter to its plan (Plan), the scene to its page (Write).
  await trail.getByRole('button', { name: 'The Night Ferry' }).click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'The Night Ferry' })).toBeVisible()
  await expect(area(win, 'Plan')).toHaveAttribute('aria-current', 'page')
  await trail.getByRole('button', { name: 'Lighting the Lamp' }).click()
  await expect(area(win, 'Write')).toHaveAttribute('aria-current', 'page')
  await expect(win.locator('.scene-prose')).toBeVisible()

  // Settings at the rail's foot: its own list beside the rail, the area's list steps aside.
  await area(win, 'Settings').click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()
  await expect(area(win, 'Settings')).toHaveAttribute('aria-current', 'page')
  await expect.poll(async () => Math.round((await win.locator('aside[aria-label="Binder"]').boundingBox())?.width ?? 0)).toBeLessThanOrEqual(1)
  await area(win, 'Write').click()
  await expect.poll(async () => Math.round((await win.locator('aside[aria-label="Binder"]').boundingBox())?.width ?? 0)).toBeGreaterThan(200)

  // The list hides and shows from the top bar, as the binder does.
  await win.getByRole('button', { name: 'Show or hide the binder' }).click()
  await expect.poll(async () => (await invoke(win, 'getSettings')).layout.binderOpen).toBe(false)
  await win.getByRole('button', { name: 'Show or hide the binder' }).click()
  await expect.poll(async () => (await invoke(win, 'getSettings')).layout.binderOpen).toBe(true)
})

test('the New look while writing: the page as a sheet, its title, the save tick, Generate, Done and focus mode', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 10, slowDelayMs: 40 })
  try {
    const { win } = await launch({ env: { AIWRITE_LOOK: 'new' } })
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake, 'fake/slow')
    const header = win.locator('main header')

    // The page is a sheet of paper on the frame, with the scene's title at its head.
    const sheet = win.locator('.scene-sheet')
    expect(await win.evaluate<string>("getComputedStyle(document.querySelector('.scene-sheet')).boxShadow")).not.toBe('none')
    const title = win.locator('[data-page-title]')
    await expect(title).toContainText('Chapter 1 · Scene 1')
    // Renamed from there.
    await title.getByRole('button').click()
    await win.keyboard.press('Control+A')
    await win.keyboard.type('The Harbour Wall')
    await win.keyboard.press('Enter')
    await expect(title.getByRole('heading', { level: 1 })).toHaveText('The Harbour Wall')
    await expect(list(win).getByRole('treeitem', { name: /The Harbour Wall/ })).toBeVisible()

    // Typing: "Saved" comes with a small tick that draws itself.
    await win.locator('.scene-prose').click()
    await win.keyboard.type('The tide was out. ')
    await expect(win.locator('header').first().locator('svg.drawn-tick')).toBeVisible()

    // Generate: Stop glows amber with its shimmer while the draft is written, counting the words as they come.
    await header.getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: /^Add below/ }).click()
    await expect(header.locator('.gen-running')).toBeVisible()
    await expect(header.getByRole('status')).toContainText(/\d+ words/)
    await header.getByRole('button', { name: 'Stop' }).click()
    await expect(header.locator('.gen-running')).toHaveCount(0)

    // Done: the tick draws itself, and the scene's ring fills green in the list.
    await header.getByRole('button', { name: /^Mark scene done/ }).click()
    // (Hovered, the button offers Reopen instead.)
    await win.mouse.move(5, 500)
    await expect(header.locator('svg.drawn-tick-draw')).toBeVisible()
    await expect(list(win).getByRole('treeitem', { name: /The Harbour Wall/ }).locator('[data-status="done"]')).toBeVisible()

    // Focus mode: the rail fades with the rest, and the sheet becomes the whole window.
    await win.locator('.scene-prose').click()
    await win.keyboard.press('F11')
    // (Out of the keyboard's reach too, so found by its place rather than its role.)
    const railBox = win.locator('nav[aria-label="Areas"]')
    await expect(railBox).toHaveCSS('visibility', 'hidden')
    await expect(sheet).toHaveCSS('border-top-left-radius', '0px')
    await win.keyboard.press('Escape')
    await expect(railBox).toHaveCSS('visibility', 'visible')
  } finally {
    await fake.close()
  }
})
