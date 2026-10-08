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
  // A name cut short in a small window shows whole on hover.
  await expect(trail.getByRole('button', { name: 'The Keeper’s Light' })).toHaveAttribute('title', /^The Keeper’s Light: /)
  await expect(trail.getByRole('button', { name: 'Lighting the Lamp' })).toHaveAttribute('title', 'Lighting the Lamp')

  // The sample world is a chip in the top bar, with the way to start Adam's own.
  const chip = win.getByRole('region', { name: 'Sample world' })
  await expect(chip.getByRole('button', { name: 'Start my own' })).toBeVisible()

  // World: the codex, and every kind with its count.
  await area(win, 'World').click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
  await expect(area(win, 'World')).toHaveAttribute('aria-current', 'page')
  await expect(list(win)).toHaveAttribute('data-area-list', 'world')
  await expect(list(win).getByRole('button', { name: /^Everything/ })).toHaveAttribute('aria-current', 'page')
  // Everything counts what the codex shows (its 9 cards: plot threads are on their own board, not here).
  await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' }).locator('xpath=..')).toContainText('9')
  await expect(list(win).getByRole('button', { name: /^Everything/ })).toContainText('9')
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(9)
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
  // With nothing found, one message and one way to check (the page's own button).
  await expect(main(win).getByRole('heading', { name: 'No issues found' })).toBeVisible()
  await expect(main(win).getByText('No open issues')).toHaveCount(0)
  await expect(main(win).getByRole('button', { name: 'Check this story', exact: true })).toHaveCount(1)

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
    const { app, win } = await launch({ env: { AIWRITE_LOOK: 'new' } })
    await createWorldFromWelcome(win, 'Harbour')
    await useFakeModel(win, fake, 'fake/slow')
    const header = win.locator('main header')

    // At every window size, both side panels open, Mark done says so on one line (it once wrapped onto two), and the
    // header fits.
    const markDone = header.getByRole('button', { name: /^Mark scene done/ })
    for (const [w, h] of [[1600, 1000], [1440, 900], [1280, 800], [1024, 700], [960, 640]] as const) {
      await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
      await expect.poll(() => win.evaluate('innerWidth')).toBe(w)
      await expect(markDone).toHaveText('Mark done')
      await expect
        .poll(() =>
          markDone.locator('span').evaluate((s) => {
            // (Run in the window: the tests' own types have no DOM.)
            const style = (globalThis as unknown as { getComputedStyle(e: unknown): { lineHeight: string } }).getComputedStyle
            return s.getBoundingClientRect().height / parseFloat(style(s).lineHeight)
          })
        )
        .toBeCloseTo(1, 1)
      expect(await header.evaluate((h) => h.scrollWidth - h.clientWidth)).toBe(0)
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))

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
    // The list's count for the scene keeps in step with the top bar's while the draft comes in (not only once saved).
    const count = (s: string, re: RegExp): number => Number(s.match(re)?.[1].replace(/,/g, '') ?? -1)
    const topWords = async (): Promise<number> => count(await win.getByTitle('Word counts and today’s writing').innerText(), /(\d[\d,]*)\s*words/)
    const rowWords = async (): Promise<number> =>
      count(await list(win).getByRole('treeitem', { name: /The Harbour Wall/ }).innerText(), /(\d[\d,]*)\s*$/)
    await expect.poll(async () => (await topWords()) > 30 && (await rowWords()) === (await topWords()), { timeout: 20_000 }).toBe(true)
    await expect(header.locator('.gen-running')).toBeVisible()
    await header.getByRole('button', { name: 'Stop' }).click()
    await expect(header.locator('.gen-running')).toHaveCount(0)

    // Done: the tick draws itself, and the scene's ring fills green in the list. Nothing beside the status moves.
    const formatAt = async (): Promise<number> => (await header.getByRole('button', { name: /^Format/ }).boundingBox())?.x ?? -1
    const before = await formatAt()
    await header.getByRole('button', { name: /^Mark scene done/ }).click()
    await expect(header.getByRole('button', { name: /^Done\. Reopen/ })).toBeVisible()
    expect(await formatAt()).toBe(before)
    // (Hovered, the button offers Reopen instead.)
    await win.mouse.move(5, 500)
    await expect(header.locator('svg.drawn-tick-draw')).toBeVisible()
    await expect(list(win).getByRole('treeitem', { name: /The Harbour Wall/ }).locator('[data-status="done"]')).toBeVisible()
    // Opening a scene that is done already doesn't play it again.
    const [story] = await invoke(win, 'listStories')
    const { chapters } = await invoke(win, 'getOutline', story.id)
    await invoke(win, 'createScene', chapters[0].id, { title: 'Low Water' })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await list(win).getByRole('treeitem', { name: /Low Water/ }).click()
    await expect(win.locator('[data-page-title]')).toContainText('Low Water')
    await list(win).getByRole('treeitem', { name: /The Harbour Wall/ }).click()
    await expect(win.locator('[data-page-title]')).toContainText('The Harbour Wall')
    await win.mouse.move(5, 500)
    await expect(header.locator('svg.drawn-tick')).toBeVisible()
    await expect(header.locator('svg.drawn-tick-draw')).toHaveCount(0)

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

test('the New look elsewhere: style presets as cards, Settings with icons, and a picture on an empty page', async ({ launch }) => {
  const win = await sampleWorld(launch)

  // An empty page (no events yet): a small picture, one sentence and its button.
  await area(win, 'World').click()
  await list(win).getByRole('button', { name: /^Events/ }).click()
  await expect(main(win).locator('[data-spot]')).toBeVisible()

  // The style guide: point of view and tense as cards, picked and unpicked with a click.
  await area(win, 'Write').click()
  await list(win).getByRole('button', { name: 'Style guide' }).click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Style guide' })).toBeVisible()
  const first = main(win).getByRole('button', { name: 'First person', exact: true })
  await first.scrollIntoViewIfNeeded()
  const before = await first.getAttribute('aria-pressed')
  await first.click()
  await expect(first).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
  await first.click()
  await expect(first).toHaveAttribute('aria-pressed', before ?? 'false')

  // Settings: a list with an icon for each page, the open one marked.
  await area(win, 'Settings').click()
  const nav = main(win).getByRole('navigation')
  await nav.getByRole('button', { name: 'Appearance' }).click()
  await expect(nav.getByRole('button', { name: 'Appearance' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('button', { name: 'Appearance' }).locator('svg')).toHaveCount(1)
  await expect(main(win).getByRole('radiogroup', { name: 'Style' })).toBeVisible()
})
