// The desk's story board, the Plan room's front page (UI overhaul, D5.2), on the sample world: the scenes as index cards
// in a column for each chapter, with their pins, the plot threads as strings and their legend; a card opens its scene,
// its ⋯ opens its card in the drawer; Cards | Outline; dragging a card (and Alt+arrows) moves the scene; the ghost slot
// adds a planned scene without leaving the board; and the board fits beside the spine in a window that isn't full screen.
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, startFake, test, useFakeModel, type LaunchOptions } from './helpers'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const room = (win: Page, name: string) => rooms(win).getByRole('button', { name: new RegExp(`^${name}`) })
const board = (win: Page) => win.locator('[data-desk-board]')
const card = (win: Page, title: string) => win.locator('[data-board-card]', { hasText: title })

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

/** Waits until the pointer would reach the card itself (not a page crossfading in over it). */
async function reachable(win: Page, title: string): Promise<void> {
  const sel = JSON.stringify(`[data-board-card]`)
  const text = JSON.stringify(title)
  await expect
    .poll(() =>
      win.evaluate<boolean>(
        `(() => { const c = [...document.querySelectorAll(${sel})].find((e) => e.textContent.includes(${text})); const r = c.getBoundingClientRect(); return c.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)) })()`
      )
    )
    .toBe(true)
}

async function order(win: Page): Promise<string[][]> {
  const [story] = await invoke(win, 'listStories')
  const o = await invoke(win, 'getOutline', story.id)
  return o.chapters.map((c) => o.scenes.filter((s) => s.chapterId === c.id).sort((a, b) => a.position - b.position).map((s) => s.title))
}

test('the story board: cards in chapter columns with pins, threads as strings with a legend, Cards and Outline', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'Plan').click()
  await expect(board(win)).toBeVisible()
  await expect(win.locator('[data-desk-room]').getByRole('button', { name: 'Story board' })).toHaveAttribute('aria-current', 'page')
  // One heading: the room's Plan (the board has none of its own), with the counts and buttons under it.
  await expect(win.getByRole('region', { name: 'Story board' })).toBeVisible()
  await expect(board(win).getByRole('heading')).toHaveCount(0)
  await expect(win.locator('[data-desk-room]').getByText('Story board', { exact: true })).toHaveCount(1)
  await expect(board(win)).toContainText('2 chapters · 4 scenes · 1,105 words')

  // A column for each chapter, its cards in order, and one for the next chapter.
  await expect(board(win).locator('[data-board-chapter]')).toHaveCount(2)
  await expect(board(win).locator('[data-board-chapter]').nth(0)).toContainText('Chapter One')
  await expect(board(win).locator('[data-board-chapter]').nth(0)).toContainText('2 of 2 done')
  await expect(board(win).locator('[data-board-chapter]').nth(1)).toContainText('1 of 2 done')
  await expect(win.locator('[data-board-card]')).toHaveCount(4)
  // Each card: what happens, when, its words; the scene Adam is in is marked.
  await expect(card(win, 'Lighting the Lamp')).toContainText('Wren lights the lamp')
  await expect(card(win, 'Lighting the Lamp')).toContainText('Day 1, dusk')
  await expect(card(win, 'Lighting the Lamp')).toHaveClass(/is-current/)
  await expect(card(win, 'Low Tide').getByRole('button', { name: /^Low Tide, drafted, 288 words, told through Wren Halloway/ })).toBeVisible()
  // Pins: three done, one drafted.
  await expect(board(win).locator('.board-canvas .board-pin.is-done')).toHaveCount(3)
  await expect(board(win).locator('.board-canvas .board-pin.is-drafted')).toHaveCount(1)
  await expect(board(win).locator('.board-canvas .board-pin.is-ai')).toHaveCount(0)

  // The strings: the sealed letter, paid off (a knot), and midwinter, still open (an open end).
  const strings = board(win).locator('.board-str')
  await expect(strings).toHaveCount(2)
  const letter = await invoke(win, 'listEntries', 'thread').then((es) => es.find((e) => e.name === 'What is in the sealed letter?')!)
  await expect(board(win).locator(`.board-str[data-thread="${letter.id}"] .s-knot`)).toHaveCount(1)
  await expect(board(win).locator('.board-str .s-end')).toHaveCount(1)
  // The legend: hovering a thread picks out its string and its cards.
  const legend = board(win).getByRole('group', { name: 'Plot threads' })
  await expect(legend.getByRole('button', { name: /Will the light go dark at midwinter\?\s*Open/ })).toBeVisible()
  await legend.getByRole('button', { name: /What is in the sealed letter\?\s*Resolved/ }).hover()
  await expect(board(win).locator('.board-str.is-dim')).toHaveCount(1)
  await expect(card(win, 'A Letter for the Keeper')).toHaveClass(/is-lifted/)
  // Clicked, it stays picked out.
  await legend.getByRole('button', { name: /What is in the sealed letter\?/ }).click()
  await expect(legend.getByRole('button', { name: /What is in the sealed letter\?/ })).toHaveAttribute('aria-pressed', 'true')

  // Outline: the same story as a compact list; a row opens its scene.
  await board(win).getByRole('button', { name: 'Outline' }).click()
  const outline = board(win).getByRole('region', { name: 'Outline of the story' })
  await expect(outline).toBeVisible()
  await expect(win.locator('[data-board-card]')).toHaveCount(0)
  await expect(outline.getByRole('button')).toHaveCount(4)
  await expect(outline).toContainText('2 of 2 done · 571 words')
  await board(win).getByRole('button', { name: 'Cards' }).click()
  await expect(win.locator('[data-board-card]')).toHaveCount(4)

  // A card opens its scene; ⋯ opens its card in the drawer.
  await card(win, 'Low Tide').getByRole('button', { name: /^Low Tide,/ }).click()
  await expect(room(win, 'Write')).toHaveAttribute('aria-current', 'page')
  await expect(win.locator('.scene-prose')).toContainText('At low tide the Drowned Steps came up out of the sea')
  await room(win, 'Plan').click()
  await card(win, 'What the Letter Said').hover()
  await card(win, 'What the Letter Said').getByRole('button', { name: 'Edit the card of What the Letter Said' }).click()
  await expect(win.locator('aside.desk-drawer')).toBeVisible()
  await expect(win.locator('.scene-prose')).toContainText('Her father read the letter at the kitchen table')
})

test('the story board: dragging a card moves its scene (the others make room); Alt+arrows from the keyboard; Add a scene', async ({ launch }) => {
  const { win } = await sampleWorld(launch)
  await room(win, 'Plan').click()
  await expect(win.locator('[data-board-card]')).toHaveCount(4)
  expect(await order(win)).toEqual([
    ['Lighting the Lamp', 'A Letter for the Keeper'],
    ['What the Letter Said', 'Low Tide']
  ])

  // Drag "A Letter for the Keeper" to the top of Chapter Two.
  await reachable(win, 'A Letter for the Keeper')
  const from = (await card(win, 'A Letter for the Keeper').boundingBox())!
  const to = (await card(win, 'What the Letter Said').boundingBox())!
  await win.mouse.move(from.x + 60, from.y + 70)
  await win.mouse.down()
  await win.mouse.move(from.x + 80, from.y + 60, { steps: 4 })
  await win.mouse.move(to.x + 60, to.y + 20, { steps: 12 })
  // While it is held, the cards below it in Chapter Two make room.
  await expect(card(win, 'A Letter for the Keeper')).toHaveClass(/is-dragging/)
  await expect.poll(() => card(win, 'What the Letter Said').getAttribute('style')).toMatch(/translateY/)
  await win.mouse.up()
  await expect.poll(() => order(win)).toEqual([['Lighting the Lamp'], ['A Letter for the Keeper', 'What the Letter Said', 'Low Tide']])
  // Dropped, it is still on the board (a drag never opens the scene).
  await expect(room(win, 'Plan')).toHaveAttribute('aria-current', 'page')

  // Esc while dragging puts it back, and letting go then doesn't open the scene.
  await reachable(win, 'Low Tide')
  const lt = (await card(win, 'Low Tide').boundingBox())!
  await win.mouse.move(lt.x + 60, lt.y + 70)
  await win.mouse.down()
  await win.mouse.move(lt.x + 90, lt.y + 40, { steps: 6 })
  await expect(card(win, 'Low Tide')).toHaveClass(/is-dragging/)
  await win.keyboard.press('Escape')
  await expect(card(win, 'Low Tide')).not.toHaveClass(/is-dragging/)
  await win.mouse.up()
  await expect(room(win, 'Plan')).toHaveAttribute('aria-current', 'page')
  expect(await order(win)).toEqual([['Lighting the Lamp'], ['A Letter for the Keeper', 'What the Letter Said', 'Low Tide']])

  // From the keyboard: Alt+↓ one place down, Alt+← to the chapter before.
  await card(win, 'A Letter for the Keeper').getByRole('button', { name: /^A Letter for the Keeper,/ }).focus()
  await win.keyboard.press('Alt+ArrowDown')
  await expect.poll(() => order(win)).toEqual([['Lighting the Lamp'], ['What the Letter Said', 'A Letter for the Keeper', 'Low Tide']])
  await card(win, 'A Letter for the Keeper').getByRole('button', { name: /^A Letter for the Keeper,/ }).focus()
  await win.keyboard.press('Alt+ArrowLeft')
  await expect.poll(() => order(win)).toEqual([['Lighting the Lamp', 'A Letter for the Keeper'], ['What the Letter Said', 'Low Tide']])

  // Add a scene, under Chapter Two: a planned card, and the board stays.
  await board(win).getByRole('button', { name: 'Add a scene' }).nth(1).click()
  await expect(win.locator('[data-board-card]')).toHaveCount(5)
  await expect(room(win, 'Plan')).toHaveAttribute('aria-current', 'page')
  await expect(board(win).locator('.board-canvas .board-pin.is-planned')).toHaveCount(1)
  expect((await order(win))[1]).toHaveLength(3)
})

test('the story board fits beside the spine at 1920, 1440, 1366 and 1280, scrolling inside itself', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch)
  await room(win, 'Plan').click()
  await expect(board(win)).toBeVisible()
  for (const [w, h] of [
    [1920, 1080],
    [1440, 900],
    [1366, 768],
    [1280, 800]
  ] as const) {
    await app.evaluate(({ BrowserWindow }, [cw, ch]) => BrowserWindow.getAllWindows()[0].setContentSize(cw, ch), [w, h] as [number, number])
    await expect.poll(async () => Math.abs(((await win.evaluate('innerWidth')) as number) - w)).toBeLessThanOrEqual(1)
    await win.waitForTimeout(150)
    // Nothing spills past the window; the board scrolls inside the room instead.
    const spill = await win.evaluate<number>('Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth')
    expect(spill, `at ${w}x${h}`).toBeLessThanOrEqual(0)
    const box = (await win.locator('[data-board-scroller]').boundingBox())!
    expect(box.x + box.width, `at ${w}x${h}`).toBeLessThanOrEqual(w)
    // Nothing of the board lies under the spine, when it shows beside the room.
    const spine = (await win.locator('[data-desk-spine]').count()) ? await win.locator('[data-desk-spine]').boundingBox() : null
    if (spine) expect(box.x, `at ${w}x${h}`).toBeGreaterThanOrEqual(spine.x + spine.width)
  }
})

test('the ideas drawer: ideas for what comes next become a card; Use this fills it (AI idea, amber pin), Undo empties it', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await sampleWorld(launch)
    await useFakeModel(win, fake)
    await room(win, 'Plan').click()
    await expect(win.locator('[data-board-card]')).toHaveCount(4)
    fake.reset()

    // The amber button: a planned scene at the story's end, and three directions for it in the drawer.
    await board(win).getByRole('button', { name: 'Ideas for what comes next' }).click()
    const drawer = win.getByRole('complementary', { name: 'What could come next' })
    await expect(drawer).toBeVisible()
    await expect(win.locator('[data-board-card]')).toHaveCount(5)
    await expect(drawer).toContainText('Chapter Two, scene 3')
    await expect(drawer.locator('[data-idea]')).toHaveCount(3)
    await expect(drawer.locator('[data-idea]')).toContainText(['The door left open', 'A debt called in', 'The wrong messenger'])
    expect(fake.requestCounts()).toEqual({ 'fake/writer': 1 })
    expect(fake.lastRequest()!.body.messages[0].content.startsWith('[AIWRITE-OUTLINE v1] ideas')).toBe(true)

    // Dismiss puts one away.
    await drawer.getByRole('button', { name: 'Dismiss “The wrong messenger”' }).click()
    await expect(drawer.locator('[data-idea]')).toHaveCount(2)

    // Use this: the card fills (and is named after the idea), tagged AI idea with an amber pin; the drawer closes.
    await drawer.getByRole('button', { name: 'Use “A debt called in”' }).click()
    await expect(drawer).toHaveCount(0)
    const used = card(win, 'A debt called in')
    await expect(used).toContainText('Tobin calls in the favour Mara owes him')
    await expect(used).toContainText('AI idea')
    await expect(board(win).locator('.board-canvas .board-pin.is-ai')).toHaveCount(1)
    expect((await invoke(win, 'getBoardMarks')).aiIdeas).toHaveLength(1)

    // Undo: the card empty again, its plain name back, and no tag.
    await win.getByRole('button', { name: 'Undo' }).click()
    await expect(card(win, 'A debt called in')).toHaveCount(0)
    await expect(board(win).locator('.board-canvas .board-pin.is-ai')).toHaveCount(0)
    await expect.poll(async () => (await invoke(win, 'getBoardMarks')).aiIdeas).toEqual([])
    const last = win.locator('[data-board-card]').last()
    await expect(last).toContainText('Nothing planned yet.')
    // An empty planned card offers its own ideas (the ones already asked for show again, with no new ask).
    await last.getByRole('button', { name: /^Ideas for / }).click()
    await expect(drawer.locator('[data-idea]')).toHaveCount(3)
    expect(fake.requestCounts()).toEqual({ 'fake/writer': 1 })
    await win.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
  } finally {
    await fake.close()
  }
})
