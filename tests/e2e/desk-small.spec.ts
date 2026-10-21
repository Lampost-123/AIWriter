// The smallest supported window, 1024 x 700 (UI polish, 2026-10-21), on the sample world: the story home, the story
// board and the top bar all fit with no sideways scroll, the book never lies over the title, the chapters keep their
// names, and the story's name stays readable in the top bar in every room without running under the rooms. Also the
// board at 1440 x 900 beside the full spine: two chapters and the next one fit with no sideways scroll, and the board
// has one main (amber) button.
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const room = (win: Page, name: string) => rooms(win).getByRole('button', { name: new RegExp(`^${name}`) })
const home = (win: Page) => win.locator('[data-desk-home]')
const board = (win: Page) => win.locator('[data-desk-board]')

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

async function size(app: ElectronApplication, win: Page, w: number, h: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
  await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
}

/** How far the window, or one element, scrolls sideways (0 when it doesn't). */
const spill = (win: Page, sel = 'html'): Promise<number> =>
  win.evaluate<number>(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.scrollWidth - e.clientWidth : -1 })()`)

/** The story's name in the top bar: how much of it shows, and the room left before the rooms. */
const storyName = (win: Page): Promise<{ shown: number; gap: number }> =>
  win.evaluate<{ shown: number; gap: number }>(`(() => {
    const words = document.querySelector('[data-desk-topbar] [data-story-home] span')
    const chev = document.querySelector('[data-desk-topbar] [data-story-menu]')
    const rooms = document.querySelector('[data-desk-rooms]')
    return { shown: words.clientWidth, gap: rooms.getBoundingClientRect().left - chev.getBoundingClientRect().right }
  })()`)

test('at 1024 x 700 the home, the board and the top bar fit, and the story’s name stays readable', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1024, 700)

  // The top bar on the writing page: the story's name shows, clear of the rooms. (Polled: a slow relayout after the
  // window or the room changes mustn't fail it.)
  const check = async (where: string): Promise<void> => {
    await expect.poll(() => spill(win), `the window at ${where}`).toBeLessThanOrEqual(0)
    // Most of "The Keeper's Light" (all of it but in the tightest room, Write, where it may lose its last letters).
    await expect.poll(async () => (await storyName(win)).shown, `the story's name's width at ${where}`).toBeGreaterThanOrEqual(100)
    await expect.poll(async () => (await storyName(win)).gap, `room between the story and the rooms at ${where}`).toBeGreaterThanOrEqual(0)
  }
  await check('Write')

  // The story home: no sideways scroll, the book beside (not over) the title, the chapters' names whole.
  await win.getByRole('button', { name: 'Story home' }).click()
  await expect(home(win)).toBeVisible()
  await check('the story home')
  await expect.poll(() => spill(win, '[data-desk-home]')).toBeLessThanOrEqual(0)
  await expect.poll(() => spill(win, '.home-shelf-row')).toBeLessThanOrEqual(0)
  await expect
    .poll(async () => {
      const book = (await home(win).locator('.home-book .book-cover').boundingBox())!
      const title = (await home(win).getByRole('heading', { level: 1, name: 'The Keeper’s Light' }).boundingBox())!
      return title.x - (book.x + book.width)
    }, 'the book ends before the title starts')
    .toBeGreaterThanOrEqual(0)
  for (const name of ['The Night Ferry', 'The Drowned Steps']) {
    await expect
      .poll(() =>
        home(win)
          .locator('.home-chap-title', { hasText: name })
          .evaluate((e) => e.scrollWidth > e.clientWidth), `${name} whole on the shelf`)
      .toBe(false)
  }

  // The story board, Build with AI, the world and the check: the window never scrolls sideways (the board pans inside
  // its own frame) and the story's name stays.
  await room(win, 'Plan').click()
  await win.locator('[data-desk-room]').getByRole('button', { name: 'Story board' }).click()
  await expect(board(win)).toBeVisible()
  await check('the story board')
  await win.locator('[data-desk-room]').getByRole('button', { name: 'Build with AI' }).first().click()
  await check('Build with AI')
  await room(win, 'World').click()
  await check('World')
  await room(win, 'Check').click()
  await check('Check')
})

test('at 1440 x 900 the story board fits beside the full spine, with one main button and its tip folding away', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'Plan').click()
  await expect(board(win)).toBeVisible()
  await expect(win.locator('[data-board-card]')).toHaveCount(4)
  // Two chapters and the next one: no sideways scroll.
  expect(await spill(win, '[data-board-scroller]')).toBeLessThanOrEqual(0)
  // One main button: Ideas for what comes next (amber, filled); New scene and the next chapter's Build with AI plain.
  const look = (name: string) =>
    board(win)
      .getByRole('button', { name, exact: true })
      .evaluate((e) => {
        const s = (globalThis as unknown as { getComputedStyle: (el: unknown) => { backgroundColor: string; backgroundImage: string } }).getComputedStyle(e)
        return `${s.backgroundColor} ${s.backgroundImage}`
      })
  const plain = await look('Add a chapter')
  expect(await look('Ideas for what comes next')).toContain('gradient')
  expect(await look('New scene')).toBe(plain)
  expect(await look('Build with AI')).toBe(plain)
  // The pins' key shares the counts' line; the tip is the only row under the head, and Got it folds it away.
  // (Polled: the key arrives with the board, rising into its place.)
  await expect
    .poll(async () => {
      const key = (await board(win).getByLabel('Pins').boundingBox())!
      const meta = (await board(win).getByText('2 chapters · 4 scenes · 1,105 words').boundingBox())!
      return Math.abs(key.y + key.height / 2 - (meta.y + meta.height / 2))
    })
    .toBeLessThanOrEqual(4)
  const hint = board(win).getByRole('note', { name: 'How to read the strings' })
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: 'Got it' }).click()
  await expect(hint).toHaveCount(0)
  await expect(board(win).getByLabel('Pins')).toBeVisible()
})

test('at 1024 x 700 the plan pages’ header line reads whole, and Story recipes’ two actions sit side by side', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await size(app, win, 1024, 700)
  await room(win, 'Plan').click()
  const line = win.locator('.plan-line').first()
  for (const page of ['Plot threads board', 'Story recipes']) {
    await win.getByRole('button', { name: page }).click()
    await expect(line).toBeVisible()
    // Not cut off: the whole line fits in the lines it has.
    await expect.poll(() => line.evaluate((e) => e.scrollHeight - e.clientHeight), page).toBeLessThanOrEqual(1)
    await expect.poll(() => spill(win), page).toBeLessThanOrEqual(0)
  }
  await expect
    .poll(async () => {
      const make = (await win.getByRole('button', { name: 'Make a recipe from a story' }).boundingBox())!
      const write = (await win.getByRole('button', { name: 'Write one yourself' }).boundingBox())!
      return Math.max(Math.abs(make.y - write.y), Math.abs(make.height - write.height))
    })
    .toBeLessThanOrEqual(1)
})
