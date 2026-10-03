// The New look's frame, walked through on the sample world: the area rail (Write, Plan, World, Check; Ask and
// Settings at its foot), the side list of the area showing, the trail of where Adam is, the sample world as a chip,
// and two-tone icons. Opening a screen from anywhere (the palette, the trail) lights its area on the rail.
import type { Page } from '@playwright/test'
import { expect, invoke, test } from './helpers'

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
