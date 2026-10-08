// The desk's story home (UI overhaul, D5.1), walked through on the sample world: the lamp mark and the story's name open
// it; the book with its title, premise and how much the story holds; Continue writing back to the scene Adam was in; the
// chapters on their shelf opening the story board; the threads, the cast and this week's writing; the footer; and Next
// scene ideas for the next planned scene (the fake provider's three directions).
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const home = (win: Page) => win.locator('[data-desk-home]')
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>,
  opts: LaunchOptions = {}
): Promise<{ app: ElectronApplication; win: Page }> {
  const a = await launch({ ...opts, env: { ...DESK, ...opts.env } })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  return a
}

test('the story home: the lamp mark and the story’s name open it; the book, the shelf, the threads, the cast and the week', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  // A week of writing on this computer, with a daily target.
  const today = await win.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  await invoke(win, 'updateSettings', { goals: { daily: 150, days: [{ date: today, typed: 206, ai: 40 }] } })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()

  // The lamp mark: the story's home, in no room.
  await win.getByRole('button', { name: 'Story home' }).click()
  await expect(home(win)).toBeVisible()
  await expect(rooms(win).locator('[aria-current="page"]')).toHaveCount(0)
  await expect(win.getByRole('button', { name: 'Story home' })).toHaveAttribute('aria-current', 'page')
  await expect(home(win).getByRole('heading', { level: 1, name: 'The Keeper’s Light' })).toBeVisible()
  await expect(home(win)).toContainText('When a stranger brings word that the Gullhaven Light is to be put out for good')
  await expect(home(win).getByLabel('1,105 words, 2 chapters, 4 scenes, 3 done')).toBeVisible()
  // The generated cover, with the book's place among the stories.
  await expect(home(win).locator('[data-book-cover]')).toContainText('Book One')
  // The last lines Adam wrote, from the scene he is in.
  await expect(home(win)).toContainText('The last lines · Lighting the Lamp')
  await expect(home(win)).toContainText('thought better of it, and put it back.')

  // The chapters on the shelf, Adam's own marked; one opens the story board.
  const shelf = home(win).getByRole('region', { name: 'Chapters' })
  await expect(shelf.getByRole('button', { name: /^Chapter One, The Night Ferry\. 2 of 2 scenes done, 571 words, you are in it/ })).toBeVisible()
  await expect(shelf.getByRole('button', { name: /^Chapter Two, The Drowned Steps\. 1 of 2 scenes done, 534 words\./ })).toBeVisible()

  // The threads: open first, with how long; then resolved, with where.
  const lower = home(win).getByRole('region', { name: 'Threads, cast and this week' })
  await expect(lower.getByRole('button', { name: /^Open thread: Will the light go dark at midwinter\?/ })).toBeVisible()
  await expect(lower.getByRole('button', { name: /^Resolved thread: What is in the sealed letter\?.*Resolved in Ch 2, Sc 1/ })).toBeVisible()
  // The cast, the most important first.
  await expect(lower.getByRole('button', { name: /^Cast: Wren Halloway, .*4 characters · 3 places/ })).toBeVisible()
  // This week (typed and AI words kept), and the target.
  await expect(lower).toContainText(/246\s*words this week/)
  await expect(lower).toContainText('Target 150')
  await expect(lower.getByRole('img', { name: /today 246\. Daily target 150\./ })).toBeVisible()
  // The footer: the memory and the checks.
  await expect(home(win).locator('footer')).toContainText('No open issues')

  // Continue writing: back to the page, in the scene Adam was in.
  await home(win).getByRole('button', { name: /^Continue writing/ }).click()
  await expect(home(win)).toHaveCount(0)
  await expect(win.locator('.scene-prose')).toContainText('A hundred and twelve steps')
  await expect(rooms(win).getByRole('button', { name: /^Write/ })).toHaveAttribute('aria-current', 'page')

  // The story's name in the top bar opens the home too; its chevron still opens the story menu.
  await win.locator('[data-desk-topbar] [data-story-home]').click()
  await expect(home(win)).toBeVisible()
  await win.locator('[data-desk-topbar] [data-story-menu]').click()
  await expect(win.getByRole('menu')).toContainText('Stories in this world')
  await win.keyboard.press('Escape')

  // A chapter on the shelf opens the story board (the Plan room).
  await shelf.getByRole('button', { name: /^Chapter Two, The Drowned Steps/ }).click()
  await expect(rooms(win).getByRole('button', { name: /^Plan/ })).toHaveAttribute('aria-current', 'page')

  // The palette has it too.
  await win.keyboard.press('Control+K')
  await win.keyboard.type('story home')
  await win.keyboard.press('Enter')
  await expect(home(win)).toBeVisible()
})

test('the story home: Next scene ideas for the next planned scene, asked for only when opened', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake)
    // No planned scene with an empty card after Adam's: no button.
    await win.getByRole('button', { name: 'Story home' }).click()
    await expect(home(win).getByRole('button', { name: /^Continue writing/ })).toBeVisible()
    await expect(home(win).getByRole('button', { name: 'Next scene ideas' })).toHaveCount(0)

    // A planned scene at the end of Chapter Two (made-up title).
    const [story] = await invoke(win, 'listStories')
    const { chapters } = await invoke(win, 'getOutline', story.id)
    await invoke(win, 'createScene', chapters[1].id, { title: 'Fog on the Quay' })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await win.getByRole('button', { name: 'Story home' }).click()
    fake.reset()
    const button = home(win).getByRole('button', { name: 'Next scene ideas' })
    await expect(button).toBeVisible()
    // Nothing is asked until it is opened.
    expect(fake.requestCounts()).toEqual({})
    await button.click()
    const ideas = win.getByRole('dialog', { name: 'Ideas for the next scene' })
    await expect(ideas).toContainText('Fog on the Quay · Chapter Two, scene 3 · planned')
    await expect(ideas.locator('li')).toHaveCount(3)
    await expect(ideas.locator('li').nth(1)).toContainText('A debt called in.')
    expect(fake.requestCounts()).toEqual({ 'fake/writer': 1 })
    // Add to the plan: the story board, with the ideas beside it.
    await ideas.getByRole('button', { name: 'Add to the plan' }).click()
    await expect(rooms(win).getByRole('button', { name: /^Plan/ })).toHaveAttribute('aria-current', 'page')
  } finally {
    await fake.close()
  }
})

test('the story home fits the window without spilling, and the panels never show it', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  for (const [w, h] of [
    [1920, 1080],
    [1440, 900],
    [1280, 800],
    [960, 600]
  ] as const) {
    await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
    await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
    await win.getByRole('button', { name: 'Story home' }).click()
    await expect(home(win)).toBeVisible()
    const spill = await home(win).evaluate((e) => e.scrollWidth - e.clientWidth)
    expect(spill, `at ${w}x${h}`).toBeLessThanOrEqual(0)
  }
  // The panels: the home is the desk's own; the page shows instead.
  await invoke(win, 'updateSettings', { arrangement: 'panels' })
  await win.reload()
  await expect(win.locator('.scene-prose')).toBeVisible()
  await expect(home(win)).toHaveCount(0)
})
