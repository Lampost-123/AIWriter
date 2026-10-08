// The AI planning pages on the desk (UI overhaul, "the AI planning pages"), on the sample world against the fake provider:
// each page opens in its room's frame with its picture, its one plain line and (for a wizard) its steps; the AI's work
// streams in with the lamp and shows as cards that are dealt in; Keep sends a copy of a card flying to the story's spine
// and Undo brings it back; the world builder's results are the world's own cards; the plot threads are a loom; the story
// board's strings explain themselves; with less motion nothing moves. Invented text only.
import type { ElectronApplication, Page } from '@playwright/test'
import { expect, invoke, test, type LaunchOptions } from './helpers'
import type { FakeProvider } from '../fake-provider/server.mjs'

const DESK = { AIWRITE_LOOK: 'new', AIWRITE_ARRANGEMENT: 'desk', AIWRITE_KEEPER_QUIET_MS: '600000' }
const rooms = (win: Page) => win.getByRole('navigation', { name: 'Rooms' })
const room = (win: Page, name: string) => rooms(win).getByRole('button', { name: new RegExp(`^${name}`) })
const links = (win: Page, name: string) => win.locator('[data-desk-room]').getByRole('navigation', { name })
const page = (win: Page, name: string) => win.locator(`[data-plan-page="${name}"]`)
const toastWith = (win: Page, text: string) => win.locator('div.fixed[aria-live="polite"] > div', { hasText: text })

async function fakeServer(slow = 25): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 2, slowDelayMs: slow })
}

/** The writer model (the planning pages use it when they have none of their own), without a reload. */
async function setModel(win: Page, modelId: string): Promise<void> {
  const p = (await invoke(win, 'listProviders')).find((x) => x.name === 'Fake')!
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: 0.000001, completionPrice: 0.000002 } }
  })
}

async function sampleWorld(
  launch: (o?: LaunchOptions) => Promise<{ app: ElectronApplication; win: Page }>,
  fake: FakeProvider | null,
  size: [number, number] = [1600, 960]
): Promise<{ app: ElectronApplication; win: Page }> {
  const a = await launch({ env: DESK })
  await expect(a.win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(a.win, 'openSampleWorld')
  if (fake) {
    await invoke(a.win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
    await setModel(a.win, 'fake/writer')
  }
  await a.win.reload()
  await expect(a.win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
  await a.app.evaluate(({ BrowserWindow }, [w, h]) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.unmaximize()
    b.setContentSize(w, h)
  }, size)
  await expect.poll(async () => Math.abs(((await a.win.evaluate('innerWidth')) as number) - size[0])).toBeLessThanOrEqual(1)
  return a
}

test('the outline helper on the desk: its picture and steps, the lamp while it streams, cards dealt in, Keep flies to the spine and Undo back', async ({ launch }) => {
  const fake = await fakeServer(30)
  try {
    const { win } = await sampleWorld(launch, fake)
    await room(win, 'Plan').click()
    await links(win, 'Plan').getByRole('button', { name: 'Outline helper' }).click()

    // In the Plan room's frame, on a page of its own: the lamp-lit desk, its name, one plain line and its steps.
    const outline = page(win, 'outline')
    await expect(outline).toBeVisible()
    await expect(win.locator('[data-desk-room="plan"]')).toBeVisible()
    await expect(outline.locator('[data-plan-art="outline"]')).toBeVisible()
    await expect(outline.getByRole('heading', { level: 1 })).toHaveText('Plan what comes next')
    await expect(outline.locator('.plan-line')).toContainText('nothing goes into the story until you keep it')
    const steps = outline.getByRole('list', { name: 'Steps' })
    await expect(steps.getByRole('listitem')).toHaveCount(4)
    await expect(steps.locator('[data-step="from"]')).toHaveClass(/is-done/)
    await expect(steps.locator('[data-step="suggest"]')).toHaveClass(/is-todo/)
    // Before anything is asked: what will come, with an example.
    await expect(outline.locator('[data-plan-empty]')).toContainText('Your outline will lie here')
    await expect(outline.locator('[data-plan-empty]')).toContainText('For example')
    // Two columns: what Adam writes on the left, the AI's work on the right.
    const left = (await outline.locator('[data-plan-col="left"]').boundingBox())!
    const right = (await outline.locator('[data-plan-col="right"]').boundingBox())!
    expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1)

    // Streaming: the lamp says what it is doing (no spinner), the step is at work, the words fade in, cards are dealt in.
    await setModel(win, 'fake/slow')
    await outline.getByRole('button', { name: 'Suggest an outline' }).click()
    await expect(outline.locator('[data-plan-thinking]')).toBeVisible()
    await expect(outline.locator('[data-plan-thinking]')).toContainText('Suggesting')
    await expect(steps.locator('[data-step="suggest"]')).toHaveClass(/is-working/)
    await expect(outline.locator('.plan-icard').first()).toBeVisible({ timeout: 30_000 })
    await expect.poll(() => outline.locator('.plan-fresh').count(), { timeout: 15_000 }).toBeGreaterThan(0)
    await expect(outline.locator('.plan-deal').first()).toBeVisible()
    await expect(outline.getByText(/Here is the outline:/)).toBeVisible({ timeout: 60_000 })
    await expect(outline.locator('[data-plan-thinking]')).toHaveCount(0)
    await expect(steps.locator('[data-step="keep"]')).toHaveClass(/is-now/)
    // Before anything is added: what Keep all that's left would add.
    await expect(outline.locator('[data-plan-receipt]')).toContainText('Keep all that’s left adds')
    await expect(outline.locator('.plan-count.is-ai').first()).toBeVisible()

    // Keep one scene card: it is stamped Kept, and a copy of it flies off to the story's spine.
    const scene = outline.locator('[data-suggestion="scene"]').first()
    const title = (await scene.locator('.plan-ic-title').textContent())!.trim()
    await scene.getByRole('button', { name: `Keep “${title}”` }).click()
    await expect(scene).toHaveAttribute('data-state', 'kept')
    await expect(scene.getByText('Kept', { exact: true })).toBeVisible()
    await expect(win.locator('.plan-ghost')).toHaveCount(1)
    await expect(win.locator('[data-desk-spine]').getByText(title, { exact: true })).toBeVisible()
    await expect(win.locator('.plan-ghost')).toHaveCount(0, { timeout: 3000 })

    // Undo puts it back on the desk, to decide again; it flies back from the spine.
    await toastWith(win, 'to the story').getByRole('button', { name: 'Undo' }).click()
    await expect(scene).toHaveAttribute('data-state', 'open')
    await expect(scene.locator('[data-box]')).toHaveClass(/is-back/)
    await expect(win.locator('[data-desk-spine]').getByText(title, { exact: true })).toHaveCount(0)

    // Discard puts it away; Undo brings it back.
    await scene.getByRole('button', { name: `Discard “${title}”` }).click()
    await expect(outline.getByRole('group', { name: `Scene: ${title}`, exact: true })).toHaveCount(0)
    await toastWith(win, 'Discarded').getByRole('button', { name: 'Undo' }).click()
    await expect(outline.getByRole('group', { name: `Scene: ${title}`, exact: true })).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('planning a chapter on the desk: the notebook, the interview as a slip, its scene cards', async ({ launch }) => {
  const fake = await fakeServer()
  try {
    const { win } = await sampleWorld(launch, fake)
    await room(win, 'Plan').click()
    await links(win, 'Plan').getByRole('button', { name: /Plan a chapter/ }).click()
    await win.getByRole('menuitem', { name: 'The Drowned Steps' }).click()
    const chapter = page(win, 'chapter')
    await expect(chapter.locator('[data-plan-art="chapter"]')).toBeVisible()
    await expect(chapter.getByRole('heading', { level: 1 })).toHaveText('The Drowned Steps')
    await chapter.getByRole('button', { name: 'Interview me' }).click()
    const interview = chapter.getByRole('region', { name: 'Interview' })
    await expect(interview).toHaveClass(/plan-interview/)
    await expect(interview.locator('.plan-q-text')).toHaveText('What happens in this chapter?')
    await expect(chapter.locator('[data-step="interview"]')).toHaveClass(/is-now/)
    await interview.getByLabel('Your answer').fill('The bell rope is found cut, not rotted.')
    await interview.getByRole('button', { name: 'Answer' }).click()
    await expect(interview.getByLabel('Your answer')).toBeEnabled()
    await interview.getByRole('button', { name: 'Done' }).click()
    await expect(chapter.getByRole('button', { name: 'Keep all that’s left' })).toBeVisible({ timeout: 30_000 })
    await expect(chapter.locator('.plan-icard')).toHaveCount(3)
    await expect(chapter.locator('[data-plan-receipt]')).toContainText('to this chapter')
  } finally {
    await fake.close()
  }
})

test('the world builder on the desk: the map unrolls, what the summary makes lies there as the world’s own cards, one Undo', async ({ launch }) => {
  const fake = await fakeServer()
  try {
    const { win } = await sampleWorld(launch, fake)
    await room(win, 'World').click()
    await links(win, 'World').getByRole('button', { name: 'Build from a summary' }).click()
    const world = page(win, 'world')
    await expect(world.locator('[data-plan-art="world"]')).toBeVisible()
    await expect(world.locator('[data-plan-empty]')).toContainText('What your summary makes will lie here')
    await world
      .getByRole('textbox', { name: 'Your summary' })
      .fill('Maud Fenner is a net-mender who owes the Pilots Guild a winter of wages. Skerry Hythe is a fishing village in the Saltings. Who cut the bell rope?')
    await expect(world.locator('.plan-receipt')).toContainText('Estimated cost')
    await world.getByRole('button', { name: 'Build the world' }).click()
    const made = world.getByRole('region', { name: 'Made from your summary' })
    await expect(made).toBeVisible({ timeout: 60_000 })
    await expect(made.locator('[data-made="character"]')).toHaveCount(1)
    await expect(made.locator('[data-made="place"]')).toHaveCount(1)
    await expect(made.locator('[data-made="character"] .g-art')).toBeVisible()
    await expect(made.getByRole('button', { name: 'Open Maud Fenner' })).toBeVisible()
    await expect(world.locator('[data-step="review"]')).toHaveClass(/is-done/)
    await world.getByRole('button', { name: 'Undo the whole build' }).click()
    await expect(made.getByText('The build was undone.', { exact: false })).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('the plot threads on the desk: a loom across the story, cards, and On the story board picks its string out', async ({ launch }) => {
  const { win } = await sampleWorld(launch, null)
  await room(win, 'Plan').click()
  await links(win, 'Plan').getByRole('button', { name: 'Plot threads board' }).click()
  const threads = page(win, 'threads')
  await expect(threads.locator('[data-plan-art="threads"]')).toBeVisible()
  await expect(threads.getByRole('heading', { level: 1 })).toHaveText('Plot threads')
  // The loom: a strand for each thread, the sealed letter tied off where it is paid off, midwinter fraying on.
  await expect(threads.locator('.th-strand')).toHaveCount(2)
  await expect(threads.locator('.th-k-paid')).toHaveCount(1)
  await expect(threads.locator('.th-fray')).toHaveCount(1)
  await expect(threads.locator('.th-chap')).toHaveCount(2)
  // The cards: Open and Resolved side by side, each with where it is set up (a jump to the scene).
  const midwinter = threads.locator('article[data-thread]', { hasText: 'Will the light go dark at midwinter?' })
  await expect(midwinter.getByRole('button', { name: 'Ch 2, Sc 1' })).toBeVisible()
  await expect(midwinter.locator('.th-meter')).toBeVisible()
  const letter = threads.locator('article[data-thread]', { hasText: 'What is in the sealed letter?' })
  await expect(letter.getByTestId('thread-payoff')).toBeVisible()
  // Filters: by words.
  await threads.getByRole('textbox', { name: 'Find a plot thread' }).fill('sealed')
  await expect(threads.locator('article[data-thread]')).toHaveCount(1)
  await expect(threads.locator('.th-strand')).toHaveCount(1)
  await threads.getByRole('textbox', { name: 'Find a plot thread' }).fill('')
  // On the story board: the board, with that thread's string picked out.
  const id = await midwinter.getAttribute('data-thread')
  await midwinter.getByRole('button', { name: 'On the story board' }).click()
  await expect(win.locator('[data-desk-board]')).toBeVisible()
  await expect(win.locator(`.board-str[data-thread="${id}"]`)).toHaveClass(/is-lit/)
})

test('Mark paid off: a scene after the set-up, picked from a list, opens with the thread under Pays off; Undo takes it off', async ({ launch }) => {
  const { win } = await sampleWorld(launch, null)
  await room(win, 'Plan').click()
  await links(win, 'Plan').getByRole('button', { name: 'Plot threads board' }).click()
  const midwinter = page(win, 'threads').locator('article[data-thread]', { hasText: 'Will the light go dark at midwinter?' })
  const threadId = (await midwinter.getAttribute('data-thread'))!
  await midwinter.getByRole('button', { name: 'Mark paid off' }).click()
  // Only the scenes after the one that sets it up (Ch 2, Sc 1), the latest first.
  const items = win.getByRole('menuitem')
  await expect(items).toHaveCount(1)
  await expect(items.first()).toContainText('Ch 2, Sc 2')
  await expect(items.first()).toContainText('Low Tide')
  await items.first().click()
  // The scene's card opens, with the thread under Pays off, saved as the field saves.
  await expect(win.getByRole('tabpanel', { name: 'Scene card' })).toBeVisible()
  const [story] = await invoke(win, 'listStories')
  const low = (await invoke(win, 'getOutline', story.id)).scenes.find((sc) => sc.title === 'Low Tide')!
  await expect.poll(async () => (await invoke(win, 'getScene', low.id)).card.paysOffIds).toContain(threadId)
  await toastWith(win, 'as paid off in this scene').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await invoke(win, 'getScene', low.id)).card.paysOffIds).not.toContain(threadId)
})

test('the story board’s strings explain themselves: tags where they start and end, a line on hover, the hint once', async ({ launch }) => {
  const { win } = await sampleWorld(launch, null)
  await room(win, 'Plan').click()
  const board = win.locator('[data-desk-board]')
  await expect(board).toBeVisible()
  // The legend over the board says what the strings are.
  await expect(board.locator('.board-lg-explain')).toContainText('each is a plot thread, from the scene that opens a question')
  // Each string's name where it starts; the letter's knot is "resolved here"; midwinter runs on, "still open".
  await expect(board.locator('[data-tag="opens"]')).toHaveCount(2)
  await expect(board.locator('[data-tag="resolved"]')).toHaveCount(1)
  await expect(board.locator('[data-tag="open"]')).toHaveCount(1)
  await expect(board.locator('.board-str .s-arrow')).toHaveCount(1)
  // Pins say where the scene stands.
  await expect(board.locator('.board-canvas .board-pin.is-done').first()).toHaveAttribute('title', 'Done')
  // A tag picks its string out; the string under the pointer says what it is.
  const letter = (await invoke(win, 'listEntries', 'thread')).find((e) => e.name === 'What is in the sealed letter?')!
  await board.locator(`[data-tag="opens"][data-thread-tag="${letter.id}"]`).hover()
  await expect(board.locator(`.board-str[data-thread="${letter.id}"]`)).toHaveClass(/is-lit/)
  await expect(board.locator('.board-str.is-dim')).toHaveCount(1)
  // Halfway along the string, between its two cards.
  await win.mouse.move(5, 5)
  const at = await win.evaluate<{ x: number; y: number }>(
    `(() => { const p = document.querySelector('.board-str[data-thread="${letter.id}"] .s-hit'); const pt = p.getPointAtLength(p.getTotalLength() / 2); const m = p.getScreenCTM(); return { x: pt.x * m.a + m.e, y: pt.y * m.d + m.f } })()`
  )
  await win.mouse.move(at.x, at.y, { steps: 3 })
  await expect(board.getByRole('tooltip')).toHaveText('What is in the sealed letter? · opened in Ch 1, Sc 2 · resolved in Ch 2, Sc 1')
  await expect(board.locator(`.board-str[data-thread="${letter.id}"]`)).toHaveClass(/is-lit/)
  // The hint, the first time; Got it puts it away for good.
  const hint = board.getByRole('note', { name: 'How to read the strings' })
  await expect(hint).toBeVisible()
  await hint.getByRole('button', { name: 'Got it' }).click()
  await expect(hint).toHaveCount(0)
  await win.reload()
  await room(win, 'Plan').click()
  await expect(board.locator('[data-tag="opens"]').first()).toBeVisible()
  await expect(board.getByRole('note', { name: 'How to read the strings' })).toHaveCount(0)
  await expect(board.locator('.board-lg-explain')).toContainText('Coloured strings are plot threads')
  // A tag opens its thread.
  await board.locator(`[data-tag="resolved"]`).click()
  await expect(win.locator('[data-desk-room="world"]')).toBeVisible()
})

test('Story recipes on the desk: the library, and the recipe maker as steps with the chapters as cards', async ({ launch }) => {
  const { win } = await sampleWorld(launch, null)
  await room(win, 'Plan').click()
  await links(win, 'Plan').getByRole('button', { name: 'Story recipes' }).click()
  const recipes = page(win, 'recipes')
  await expect(recipes.locator('[data-plan-art="recipes"]')).toBeVisible()
  await expect(recipes.getByRole('heading', { level: 1, name: 'Story recipes' })).toBeVisible()
  await expect(recipes.locator('[data-plan-empty]')).toContainText('No recipes yet')
  await recipes.getByRole('button', { name: 'Make a recipe from a story' }).click()
  await expect(recipes.getByRole('heading', { level: 1, name: 'Make a recipe' })).toBeVisible()
  await expect(recipes.locator('[data-step="bring"]')).toHaveClass(/is-now/)
  await recipes.getByRole('radio', { name: 'Paste the text' }).click()
  await recipes
    .getByLabel('The story’s text')
    .fill('Chapter 1\n\nThe cart left Pell at dawn.\n\nChapter 2\n\nHis aunt kept bees.\n\nChapter 3\n\nThe swarm left the old skep.')
  await recipes.getByRole('button', { name: 'Read it' }).click()
  await expect(recipes.locator('.plan-chapcard')).toHaveCount(3)
  await expect(recipes.locator('[data-step="check"]')).toHaveClass(/is-now/)
  await expect(recipes.getByRole('button', { name: 'Make the recipe' })).toBeVisible()
})

test('the scene card’s ideas on the desk: the lamp while they come, index cards, Use this fills the card', async ({ launch }) => {
  const fake = await fakeServer(30)
  try {
    const { win } = await sampleWorld(launch, fake)
    const [story] = await invoke(win, 'listStories')
    const o = await invoke(win, 'getOutline', story.id)
    await invoke(win, 'createScene', o.chapters[1].id, { title: 'The Bell Rope' })
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    await win.locator('[data-desk-spine] [data-row="scene"]', { hasText: 'The Bell Rope' }).first().click()
    await setModel(win, 'fake/slow')
    await win.keyboard.press('Control+K')
    await win.keyboard.type('Ideas for this scene')
    await win.getByRole('option', { name: /^Ideas for this scene/ }).first().click()
    const ideas = win.getByRole('region', { name: 'Ideas for this scene' })
    await expect(ideas.locator('[data-plan-thinking]')).toBeVisible()
    await expect(ideas.locator('[data-idea]')).toHaveCount(3, { timeout: 30_000 })
    await expect(ideas.locator('[data-idea].plan-idea').first()).toBeVisible()
    await expect(ideas.locator('[data-plan-thinking]')).toHaveCount(0, { timeout: 30_000 })
    await ideas.getByRole('button', { name: 'Use “The door left open” for this scene' }).click()
    await expect(win.locator('.plan-ghost')).toHaveCount(1)
    await expect(win.locator('.plan-ghost')).toHaveCount(0, { timeout: 3000 })
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes.find((s) => s.title.includes('door') || s.title === 'The Bell Rope')!.id
    await expect.poll(async () => (await invoke(win, 'getScene', sceneId)).card.beats.length).toBeGreaterThan(0)
  } finally {
    await fake.close()
  }
})

test('with less motion the planning pages are still: no flights, the drawings rest, words simply appear', async ({ launch }) => {
  const fake = await fakeServer()
  try {
    const { win } = await sampleWorld(launch, fake)
    await win.emulateMedia({ reducedMotion: 'reduce' })
    await room(win, 'Plan').click()
    await links(win, 'Plan').getByRole('button', { name: 'Outline helper' }).click()
    const outline = page(win, 'outline')
    await expect(outline.locator('[data-plan-art="outline"]')).toBeVisible()
    expect(await win.evaluate<string>(`getComputedStyle(document.querySelector('[data-plan-art="outline"] .pa-drift')).animationName`)).toBe('none')
    await outline.getByRole('button', { name: 'Suggest an outline' }).click()
    await expect(outline.getByText(/Here is the outline:/)).toBeVisible({ timeout: 30_000 })
    expect(await win.evaluate<string>(`getComputedStyle(document.querySelector('.plan-deal')).animationName`)).toBe('none')
    const scene = outline.locator('[data-suggestion="scene"]').first()
    const title = (await scene.locator('.plan-ic-title').textContent())!.trim()
    await scene.getByRole('button', { name: `Keep “${title}”` }).click()
    await expect(scene).toHaveAttribute('data-state', 'kept')
    await expect(win.locator('.plan-ghost')).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('a window that isn’t full screen: the planning pages keep their two columns at 1366 and stack when narrower, with nothing spilling', async ({ launch }) => {
  const { app, win } = await sampleWorld(launch, null, [1366, 768])
  await room(win, 'Plan').click()
  await links(win, 'Plan').getByRole('button', { name: 'Outline helper' }).click()
  const outline = page(win, 'outline')
  await expect(outline).toBeVisible()
  const left = (await outline.locator('[data-plan-col="left"]').boundingBox())!
  const right = (await outline.locator('[data-plan-col="right"]').boundingBox())!
  expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - 1)
  expect(await win.evaluate<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(0)
  // (The window can't be made narrower than about 950 pixels: the page is zoomed in instead, for a narrower room.)
  await app.evaluate(({ BrowserWindow }) => {
    const b = BrowserWindow.getAllWindows()[0]
    b.setContentSize(1100, 760)
    b.webContents.setZoomFactor(1.45)
  })
  await expect.poll(async () => (await win.evaluate('innerWidth')) as number).toBeLessThanOrEqual(800)
  await expect
    .poll(async () => {
      const l = (await outline.locator('[data-plan-col="left"]').boundingBox())!
      const r = (await outline.locator('[data-plan-col="right"]').boundingBox())!
      return r.y >= l.y + l.height - 1
    })
    .toBe(true)
  expect(await win.evaluate<number>('document.documentElement.scrollWidth - innerWidth')).toBeLessThanOrEqual(0)
})
