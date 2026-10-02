// Milestone 3's story screens, walked through the way Adam works: the New story dialog ("What is it?"
// with its live sentence and warnings), the questions that follow a new story, story settings with
// Undo, the grey line on story cards and their reading order, and deleting a story, chapter or scene
// with Undo. The automatic story flows are another part's; here they only need to be started and
// reported quietly. No model is chosen in these worlds, so a flow that starts says it needs one, or
// that nothing needed doing.
import type { Locator, Page } from '@playwright/test'
import type { StoryPlacement } from '../../src/shared/api'
import type { Story } from '../../src/shared/types'
import { binder, closeWindow, createWorldFromWelcome, expect, invoke, test } from './helpers'

const crumbs = (win: Page) => win.locator('main header').first()
const switcher = (win: Page, title: string) => binder(win).getByRole('button', { name: title, exact: true })

async function openNewStory(win: Page, current: string): Promise<Locator> {
  await switcher(win, current).click()
  await win.getByRole('menuitem', { name: 'New story' }).click()
  const dialog = win.getByRole('dialog', { name: 'New story' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Picks an option from one of the dialog's or page's drop-downs. */
async function choose(win: Page, scope: Locator, label: string, option: string): Promise<void> {
  await scope.getByRole('combobox', { name: label, exact: true }).click()
  await win.getByRole('option', { name: option, exact: true }).click()
}

const side = (startStoryId: string, patch: Partial<StoryPlacement> = {}): StoryPlacement => ({
  kind: 'side',
  startStoryId,
  startAt: 'post',
  startRefId: null,
  endAt: 'end',
  endRefId: null,
  leadsIntoId: null,
  ...patch
})
const after = (startStoryId: string): StoryPlacement => ({ ...side(startStoryId), kind: 'continues', startAt: 'end', endAt: null })

/** A world with Book 1 of two chapters (a scene each), made through the welcome screen. */
async function world(win: Page): Promise<Story> {
  await createWorldFromWelcome(win, 'Varn')
  const [b1] = await invoke(win, 'listStories')
  const ch2 = await invoke(win, 'createChapter', b1.id, {})
  await invoke(win, 'createScene', ch2.id, {})
  return b1
}

const storyNamed = async (win: Page, title: string): Promise<Story | undefined> =>
  (await invoke(win, 'listStories')).find((s) => s.title === title)

/** Expects the story menu to list these stories, in this order. */
async function expectShelf(win: Page, current: string, titles: string[]): Promise<void> {
  await switcher(win, current).click()
  await expect(win.getByRole('menu').locator('[role="menuitem"] span.leading-5')).toHaveText(titles)
  await win.keyboard.press('Escape')
}

/** The toast showing this message. */
const toastWith = (win: Page, message: string): Locator =>
  win
    .locator('div')
    .filter({ has: win.getByText(message, { exact: true }) })
    .last()

/** Opens a story's settings from the story menu. */
async function openSettings(win: Page, current: string, title: string): Promise<void> {
  await switcher(win, current).click()
  await win.getByRole('menuitem', { name: `Settings for ${title}` }).click()
  await expect(win.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

test('a normal Book 2 takes one click and simply continues', async ({ launch }) => {
  const { win } = await launch()
  const b1 = await world(win)

  const dialog = await openNewStory(win, 'Book 1')
  await expect(dialog.getByRole('textbox', { name: 'Title' })).toHaveValue('Book 2')
  await expect(dialog.getByText('Continues after Book 1', { exact: true })).toBeVisible()
  await expect(dialog.getByText(/belongs in a new world/)).toBeVisible()
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(dialog).toBeHidden()
  await expect(crumbs(win)).toContainText('Book 2')
  // He is in its first scene, ready to write.
  await win.keyboard.type('It began again.')
  const b2 = (await storyNamed(win, 'Book 2'))!
  expect(b2).toMatchObject({ kind: 'continues', startStoryId: b1.id, startAt: 'end', seriesId: b1.seriesId })
  const { scenes } = await invoke(win, 'getOutline', b2.id)
  await expect.poll(async () => (await invoke(win, 'getScene', scenes[0].id)).text).toBe('It began again.')

  // A story that simply continues has no extra line on its card.
  await switcher(win, 'Book 2').click()
  const menu = win.getByRole('menu')
  await expect(menu.getByRole('menuitem', { name: 'Book 2', exact: true })).toBeVisible()
  await expect(menu.getByText(/Continues after/)).toHaveCount(0)
})

test('a side story during Book 1 from Ch 1 shows what it will know while it is chosen, and on its card', async ({ launch }) => {
  const { win } = await launch()
  const b1 = await world(win)

  const dialog = await openNewStory(win, 'Book 1')
  await dialog.getByRole('textbox', { name: 'Title' }).fill("Kell's Road")
  await dialog.getByRole('button', { name: 'Change' }).click()
  await dialog.getByText('Side story during', { exact: true }).click()
  await expect(dialog.getByRole('radio', { name: 'Side story during' })).toBeChecked()
  await expect(dialog.getByRole('combobox', { name: 'Story', exact: true })).toHaveText('Book 1')
  await expect(dialog.getByText('This story knows what happened in: the start of Book 1.')).toBeVisible()

  await choose(win, dialog, 'Starts', 'After Ch 1')
  // The sentence sits under the line saying what the story is, in view as he chooses.
  await expect(dialog.getByText('This story knows what happened in: Book 1 up to the end of Ch 1.')).toBeInViewport({ ratio: 1 })
  await expect(dialog.getByText('Side story during Book 1, after Ch 1', { exact: true })).toBeInViewport({ ratio: 1 })
  await expect(dialog.getByRole('combobox', { name: 'Ends' })).toHaveText('At its end')
  // Nothing to come after, so no time gap to fill in.
  await expect(dialog.getByRole('textbox', { name: /Time since/ })).toBeHidden()
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(crumbs(win)).toContainText("Kell's Road")
  const kr = (await storyNamed(win, "Kell's Road"))!
  const [c1] = (await invoke(win, 'getOutline', b1.id)).chapters
  expect(kr).toMatchObject({ kind: 'side', startStoryId: b1.id, startAt: 'chapter', startRefId: c1.id, endAt: 'end' })

  // Its card says what it is in one grey line; Book 1's says nothing extra.
  await switcher(win, "Kell's Road").click()
  const menu = win.getByRole('menu')
  await expect(menu.getByText('Side story during Book 1, after Ch 1', { exact: true })).toBeVisible()
  await expect(menu.getByText(/Continues after/)).toHaveCount(0)
})

test('continuing after a side story warns first and offers the likely alternative', async ({ launch }) => {
  const { win } = await launch()
  const b1 = await world(win)
  await invoke(win, 'createStoryAs', { title: "Kell's Road", seriesId: b1.seriesId, placement: side(b1.id) })

  const dialog = await openNewStory(win, 'Book 1')
  await expect(dialog.getByText('Continues after Book 1', { exact: true })).toBeVisible()
  await dialog.getByRole('button', { name: 'Change' }).click()
  await choose(win, dialog, 'Story', "Kell's Road")
  const warning = dialog.getByText(
    "Kell's Road is a side story during Book 1, so this story would miss everything in Book 1 after Kell's Road starts."
  )
  await expect(warning).toBeVisible()
  // A warning, not a refusal: he can still go ahead.
  await expect(dialog.getByRole('button', { name: 'Create' })).toBeEnabled()

  await dialog.getByRole('button', { name: 'Continue after Book 1 instead' }).click()
  await expect(warning).toBeHidden()
  await expect(dialog.getByText('Continues after Book 1', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('combobox', { name: 'Story', exact: true })).toHaveText('Book 1')
})

test('a story set between Book 1 and Book 2 asks "Should Book 2 now continue after it?"', async ({ launch }) => {
  const { win } = await launch()
  const b1 = await world(win)
  const { story: b2 } = await invoke(win, 'createStoryAs', { title: 'Book 2', seriesId: b1.seriesId, placement: after(b1.id) })

  const dialog = await openNewStory(win, 'Book 1')
  await expect(dialog.getByText('Continues after Book 2', { exact: true })).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Title' }).fill('The Quiet Year')
  await dialog.getByRole('button', { name: 'Change' }).click()
  await choose(win, dialog, 'Story', 'Book 1')
  await expect(dialog.getByText('Continues after Book 1', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Time since Book 1 ended' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(win.getByText('Should Book 2 now continue after The Quiet Year?')).toBeVisible()
  await win.getByRole('button', { name: 'Yes' }).click()
  await expect(win.getByText('Book 2 now continues after The Quiet Year.')).toBeVisible()
  const qy = (await storyNamed(win, 'The Quiet Year'))!
  await expect.poll(async () => (await storyNamed(win, 'Book 2'))?.startStoryId).toBe(qy.id)
  // The story menu lists the stories in reading order.
  await expectShelf(win, 'The Quiet Year', ['Book 1', 'The Quiet Year', 'Book 2'])

  // Undo puts Book 2 back where it was, and the AI is never asked to sort the changes at its start.
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await storyNamed(win, 'Book 2'))?.startStoryId).toBe(b1.id)
  expect(b2.startStoryId).toBe(b1.id)
  await expectShelf(win, 'The Quiet Year', ['Book 1', 'Book 2', 'The Quiet Year'])
  const sorting = win
    .getByRole('status')
    .filter({ hasText: /Working out when the changes at the start of Book 2 happened|Nothing needed sorting|Choose a memory model/ })

  // Story settings ask too. No says Book 2 stays where it is, with Undo, which asks again.
  await openSettings(win, 'The Quiet Year', 'The Quiet Year')
  const question = win.getByText('Should Book 2 now continue after The Quiet Year?')
  await expect(question).toBeVisible()
  await expect(sorting).toHaveCount(0)
  await win.getByRole('button', { name: 'No', exact: true }).click()
  await expect(question).toBeHidden()
  await toastWith(win, 'Book 2 stays where it is.').getByRole('button', { name: 'Undo' }).click()
  await expect(question).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'getStoryDetails', qy.id)).mightFollow.map((s) => s.title)).toEqual(['Book 2'])
  // A No left in place is kept with the world: the question doesn't come back.
  await win.getByRole('button', { name: 'No', exact: true }).click()
  await expect(question).toBeHidden()
  await openSettings(win, 'The Quiet Year', 'Book 1')
  await openSettings(win, 'The Quiet Year', 'The Quiet Year')
  await expect(win.getByText('This story knows what happened in: Book 1.')).toBeVisible()
  await expect(question).toBeHidden()
  expect((await invoke(win, 'getStoryDetails', qy.id)).mightFollow).toEqual([])

  // A Yes left in place: once its Undo has gone, the AI works out when those changes happened. Until
  // then, story settings doesn't offer to do it either.
  const { story: dawn } = await invoke(win, 'createStoryAs', { title: 'Dawn', seriesId: b1.seriesId, placement: after(b1.id) })
  await openSettings(win, 'The Quiet Year', 'Dawn')
  await win.getByRole('button', { name: 'Yes', exact: true }).click()
  await expect(win.getByText('Book 2 now continues after Dawn.')).toBeVisible()
  await expect.poll(async () => (await storyNamed(win, 'Book 2'))?.startStoryId).toBe(dawn.id)
  const sortAgain = win.getByRole('button', { name: 'When did these happen?' })
  await expect(sorting).toHaveCount(0)
  await expect(sortAgain).toHaveCount(0)
  await toastWith(win, 'Book 2 now continues after Dawn.').getByRole('button', { name: 'Dismiss' }).click()
  await expect(sorting).toBeVisible()
  await expect(sortAgain).toBeVisible()
})

test('the flows\' quiet line can be stopped, and a world switch never leaves it running or starts a sort there', async ({ launch }) => {
  const { app, win } = await launch()
  const b1 = await world(win)
  await invoke(win, 'createStoryAs', { title: 'Book 2', seriesId: b1.seriesId, placement: after(b1.id) })
  const { story: dawn } = await invoke(win, 'createStoryAs', { title: 'Dawn', seriesId: b1.seriesId, placement: after(b1.id) })
  const flow = (state: 'running' | 'done', message: string | null): Promise<void> =>
    app.evaluate(({ BrowserWindow }, status) => BrowserWindow.getAllWindows()[0].webContents.send('event:story:flow', status), {
      storyId: dawn.id,
      flow: 'when' as const,
      state,
      message
    })
  const sorting = win.getByRole('status').filter({ hasText: /Working out when|Nothing needed sorting|Choose a memory model|Stopped/ })
  const sortAgain = win.getByRole('button', { name: 'When did these happen?' })

  await openSettings(win, 'Book 1', 'Dawn')
  await win.getByRole('button', { name: 'Yes', exact: true }).click()
  await expect.poll(async () => (await storyNamed(win, 'Book 2'))?.startStoryId).toBe(dawn.id)
  await toastWith(win, 'Book 2 now continues after Dawn.').getByRole('button', { name: 'Dismiss' }).click()
  await expect(sortAgain).toBeVisible()
  // Book 2 has no changes at its start yet, so the real run finishes straight away.
  await expect(sorting).toContainText('Nothing needed sorting')

  // While a flow runs, its line offers Stop; stopped, it says so without a tick or Try again.
  await flow('running', 'Working out when the changes at the start of Book 2 happened…')
  await expect(sorting).toContainText('Working out when the changes at the start of Book 2 happened…')
  await expect(sorting.getByRole('button', { name: 'Stop' })).toBeVisible()
  await expect(sortAgain).toBeDisabled()
  await flow('done', 'Stopped. Nothing was changed.')
  await expect(sorting).toHaveText('Stopped. Nothing was changed.')
  await expect(sortAgain).toBeEnabled()

  // A run going when the world closes is stopped without a word, so the line forgets it.
  await flow('running', 'Working out when the changes at the start of Book 2 happened…')
  await expect(sorting.getByRole('button', { name: 'Stop' })).toBeVisible()
  const topBar = win.locator('header').first()
  const switchTo = async (name: string): Promise<void> => {
    await topBar.getByRole('button', { name: /Varn|Beta/ }).click()
    await win.getByRole('menuitem', { name }).click()
    await expect(topBar.getByRole('button', { name: new RegExp(name) })).toBeVisible()
  }
  await topBar.getByRole('button', { name: /Varn/ }).click()
  await win.getByRole('menuitem', { name: 'New world…' }).click()
  await win.getByRole('dialog').getByLabel('World name').fill('Beta')
  await win.getByRole('dialog').getByRole('button', { name: 'Create world' }).click()
  await expect(topBar.getByRole('button', { name: /Beta/ })).toBeVisible()
  await switchTo('Varn')
  await openSettings(win, 'Book 1', 'Dawn')
  await expect(sortAgain).toBeEnabled()
  await expect(sorting).toHaveCount(0)

  // A Yes whose Undo is cut short by a world switch isn't sorted in the world being closed; story
  // settings offers it instead.
  const { story: dusk } = await invoke(win, 'createStoryAs', { title: 'Dusk', seriesId: b1.seriesId, placement: after(dawn.id) })
  await openSettings(win, 'Book 1', 'Dusk')
  await win.getByRole('button', { name: 'Yes', exact: true }).click()
  await expect(win.getByText('Book 2 now continues after Dusk.')).toBeVisible()
  await switchTo('Beta')
  await expect(win.getByText('Book 2 now continues after Dusk.')).toHaveCount(0)
  await switchTo('Varn')
  expect((await storyNamed(win, 'Book 2'))?.startStoryId).toBe(dusk.id)
  await openSettings(win, 'Book 1', 'Dusk')
  await expect(sortAgain).toBeVisible()
  await expect(sorting).toHaveCount(0)
  await sortAgain.click()
  await expect(sorting).toContainText('Nothing needed sorting')
})

test('a prequel asks for its starting cast', async ({ launch }) => {
  const { win } = await launch()
  await world(win)
  await invoke(win, 'createEntry', 'character', { name: 'Mara' })

  const dialog = await openNewStory(win, 'Book 1')
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Young Mara')
  await dialog.getByRole('button', { name: 'Change' }).click()
  await dialog.getByText('Prequel to', { exact: true }).click()
  await expect(dialog.getByRole('combobox', { name: 'Book' })).toHaveText('Book 1')
  await expect(dialog.getByText('Prequel to Book 1', { exact: true })).toBeVisible()
  await expect(dialog.getByText('This story knows only the starting setup.')).toBeVisible()
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(win.getByText(/Young Mara is a prequel/)).toBeVisible()
  // With its settings already open, Choose cast goes straight to the cast.
  await openSettings(win, 'Young Mara', 'Young Mara')
  const cast = win.getByRole('combobox', { name: 'Add to the starting cast' })
  await expect(cast).not.toBeFocused()
  await win.getByRole('button', { name: 'Choose cast' }).click()
  await expect(cast).toBeFocused()
  await expect(cast).toBeInViewport({ ratio: 1 })
  // Typing elsewhere on the page stays there while it saves, and the window itself never scrolls.
  const premise = win.getByRole('textbox', { name: 'Premise' })
  await premise.click()
  await premise.pressSequentially('Mara at twelve.')
  await win.waitForTimeout(1500)
  await premise.pressSequentially(' She runs.')
  await expect(premise).toBeFocused()
  await expect(premise).toHaveValue('Mara at twelve. She runs.')
  await expect.poll(async () => (await storyNamed(win, 'Young Mara'))?.premise).toBe('Mara at twelve. She runs.')
  expect(await win.locator('html').evaluate((html) => html.scrollTop)).toBe(0)
  await expect(switcher(win, 'Young Mara')).toBeInViewport({ ratio: 1 })
  await cast.fill('Mara')
  await cast.press('Enter')
  await expect(win.getByRole('button', { name: 'Remove Mara' })).toBeVisible()
  await win.getByRole('button', { name: 'Draft how they start' }).click()
  // The drafting runs by itself; its progress is one quiet line.
  await expect(win.getByRole('status').filter({ hasText: /Drafting how each of them starts|Choose a memory model/ })).toBeVisible()

  // Its card says what it is.
  await switcher(win, 'Young Mara').click()
  await expect(win.getByRole('menu').getByText('Prequel to Book 1', { exact: true })).toBeVisible()
})

test('story settings change what a story is, with Undo', async ({ launch }) => {
  const { win } = await launch()
  const b1 = await world(win)
  await invoke(win, 'createStoryAs', { title: "Kell's Road", seriesId: b1.seriesId, placement: side(b1.id) })

  await switcher(win, 'Book 1').click()
  await win.getByRole('menuitem', { name: "Settings for Kell's Road" }).click()
  await expect(win.getByRole('heading', { level: 1, name: "Kell's Road" })).toBeVisible()
  await expect(win.getByText('This story knows what happened in: the start of Book 1.')).toBeVisible()

  await choose(win, win.locator('main'), 'Starts', 'After Ch 1')
  await expect(win.getByText('This story knows what happened in: Book 1 up to the end of Ch 1.')).toBeVisible()
  await expect(win.getByText("Kell's Road: Side story during Book 1, after Ch 1.")).toBeVisible()
  await expect.poll(async () => (await storyNamed(win, "Kell's Road"))?.startAt).toBe('chapter')

  await win.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await storyNamed(win, "Kell's Road"))?.startAt).toBe('post')
  await expect(win.getByText('This story knows what happened in: the start of Book 1.')).toBeVisible()

  // The premise saves by itself.
  await win.getByRole('textbox', { name: 'Premise' }).fill('Kell walks home the long way.')
  await expect.poll(async () => (await storyNamed(win, "Kell's Road"))?.premise).toBe('Kell walks home the long way.')

  // The style the AI gets is listed with where each rule comes from.
  const rules = win.getByRole('list', { name: 'Style rules' })
  await expect(rules.getByText('My preferences').first()).toBeVisible()
  // Its own style is changed in the style guide, which opens on this story.
  await win.getByRole('button', { name: 'Change this story’s style' }).click()
  await expect(win.getByRole('tab', { name: 'This story' })).toHaveAttribute('aria-selected', 'true')
  await expect(switcher(win, "Kell's Road")).toBeVisible()
})

test('deleting a story names the stories that start in it, and Undo brings it back', async ({ launch }) => {
  const { win } = await launch()
  const b1 = await world(win)
  const { story: b2 } = await invoke(win, 'createStoryAs', { title: 'Book 2', seriesId: b1.seriesId, placement: after(b1.id) })
  await invoke(win, 'createStoryAs', { title: 'Ash', seriesId: b1.seriesId, placement: side(b2.id) })

  await openSettings(win, 'Book 1', 'Book 2')
  await expect(
    win.getByText('Ash starts in Book 2. If you delete Book 2, Ash will start after Book 1 instead. A backup is made first.')
  ).toBeVisible()
  await win.getByRole('button', { name: 'Delete story' }).click()

  await expect(win.getByText('“Book 2” deleted.')).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'listStories')).map((s) => s.title)).toEqual(['Book 1', 'Ash'])
  // Ash now starts where Book 2 did, and its settings say so rather than refusing.
  await openSettings(win, 'Book 1', 'Ash')
  const main = win.locator('main')
  await expect(main.getByRole('combobox', { name: 'Story', exact: true })).toHaveText('Book 1')
  await expect(main.getByRole('combobox', { name: 'Starts' })).toHaveText('After its end')
  await expect(main.getByText('This story knows what happened in: Book 1.')).toBeVisible()
  await expect(main.getByText(/no longer exists/)).toHaveCount(0)
  // It starts at Book 1's end, so that is the only end it can have.
  await main.getByRole('combobox', { name: 'Ends' }).click()
  await expect(win.getByRole('option')).toHaveText(['At its end'])
  await win.keyboard.press('Escape')

  await toastWith(win, '“Book 2” deleted.').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await invoke(win, 'listStories')).map((s) => s.title)).toEqual(['Book 1', 'Book 2', 'Ash'])
  await expect(main.getByRole('combobox', { name: 'Story', exact: true })).toHaveText('Book 2')

  // Deleting the story he is in, from its own settings, opens the next one without first saying the
  // story isn't there.
  await switcher(win, 'Book 1').click()
  await win.getByRole('menuitem', { name: 'Book 2', exact: true }).click()
  await openSettings(win, 'Book 2', 'Book 2')
  await win.locator('body').evaluate((body) => {
    const page = globalThis as unknown as {
      goneShown: boolean
      MutationObserver: new (seen: () => void) => { observe(target: unknown, options: Record<string, boolean>): void }
    }
    page.goneShown = false
    new page.MutationObserver(() => {
      if (body.textContent?.includes('This story isn’t here any more')) page.goneShown = true
    }).observe(body, { childList: true, subtree: true, characterData: true })
  })
  await win.getByRole('button', { name: 'Delete story' }).click()
  await expect(win.getByText('“Book 2” deleted.')).toBeVisible()
  await expect(switcher(win, 'Book 1')).toBeVisible()
  await expect(crumbs(win)).toContainText('Scene 1')
  expect(await win.evaluate(() => (globalThis as unknown as { goneShown: boolean }).goneShown)).toBe(false)
})

test('deleting the scene a story starts after moves its start back and says so in the same toast, with Undo', async ({ launch }) => {
  const { win } = await launch()
  const b1 = await world(win)
  const { scenes } = await invoke(win, 'getOutline', b1.id)
  const ashore = scenes[1]
  await invoke(win, 'updateScene', ashore.id, { title: 'Ashore' })
  const { story: kr } = await invoke(win, 'createStoryAs', {
    title: "Kell's Road",
    seriesId: b1.seriesId,
    placement: side(b1.id, { startAt: 'scene', startRefId: ashore.id })
  })
  await win.reload()
  const deleteAshore = async (): Promise<void> => {
    await binder(win).getByText('Ashore').click({ button: 'right' })
    await win.getByRole('menuitem', { name: /Delete scene/ }).click()
  }
  const startsAt = async (): Promise<StoryPlacement> => (await invoke(win, 'getStoryDetails', kr.id)).placement

  await deleteAshore()
  const deleted = "“Ashore” deleted. Kell's Road now starts after Book 1, Ch 1 instead."
  await expect(win.getByText(deleted, { exact: true })).toBeVisible()
  // One toast says it all, so its Undo takes the note away too.
  await expect(win.getByText(/Kell's Road now starts/)).toHaveCount(1)

  // Its settings show where it starts now rather than refusing.
  await openSettings(win, 'Book 1', "Kell's Road")
  const main = win.locator('main')
  const starts = main.getByRole('combobox', { name: 'Starts' })
  await expect(starts).toHaveText('After Ch 1')
  await expect(main.getByText('This story knows what happened in: Book 1 up to the end of Ch 1.')).toBeVisible()
  await expect(main.getByText(/isn’t in|isn't in|no longer exists/)).toHaveCount(0)

  // Undo brings the scene back, and with it where Kell's Road started; the note goes with the toast.
  await toastWith(win, deleted).getByRole('button', { name: 'Undo' }).click()
  await expect(win.getByText(/Kell's Road now starts/)).toHaveCount(0)
  await expect(binder(win).getByText('Ashore')).toBeVisible()
  await expect.poll(startsAt).toMatchObject({ startAt: 'scene', startRefId: ashore.id })

  // Deleted again, a change made in its settings can be undone too.
  await deleteAshore()
  await expect(win.getByText(deleted, { exact: true })).toBeVisible()
  await expect(starts).toHaveText('After Ch 1')
  await choose(win, main, 'Starts', 'At its beginning')
  await expect(main.getByText('This story knows what happened in: the start of Book 1.')).toBeVisible()
  await expect.poll(async () => (await storyNamed(win, "Kell's Road"))?.startAt).toBe('post')
  await toastWith(win, "Kell's Road: Side story during Book 1.").getByRole('button', { name: 'Undo' }).click()
  await expect(starts).toHaveText('After Ch 1')
  await expect.poll(startsAt).toMatchObject({ startAt: 'chapter', startRefId: scenes[0].chapterId })
  await expect(main.getByText(/isn’t in|isn't in|no longer exists/)).toHaveCount(0)
})

test('a new side story can end a still-running one first: nothing changes until Create, then Undo is offered', async ({ launch }) => {
  const { win } = await launch()
  const b1 = await world(win)
  await invoke(win, 'createStoryAs', { title: 'Ash', seriesId: b1.seriesId, placement: side(b1.id) })
  const [c1] = (await invoke(win, 'getOutline', b1.id)).chapters

  const dialog = await openNewStory(win, 'Book 1')
  await dialog.getByRole('textbox', { name: 'Title' }).fill('Ember')
  await dialog.getByRole('button', { name: 'Change' }).click()
  await dialog.getByText('Side story during', { exact: true }).click()
  await choose(win, dialog, 'Starts', 'After Ch 1')
  const running = dialog.getByText(
    'This story knows what happened in: Book 1 up to the end of Ch 1. Does not know: Ash, which is still running here.'
  )
  await expect(running).toBeVisible()

  await dialog.getByRole('button', { name: 'End Ash after Ch 1' }).click()
  await expect(dialog.getByText('This story knows what happened in: Book 1 up to the end of Ch 1; Ash.')).toBeVisible()
  await expect(dialog.getByText('Creating this story also ends Ash after Ch 1.')).toBeVisible()
  expect(await storyNamed(win, 'Ash')).toMatchObject({ endAt: 'end', endRefId: null })
  // He can change his mind before Create.
  await dialog.getByRole('button', { name: 'Keep Ash running' }).click()
  await expect(running).toBeVisible()
  await dialog.getByRole('button', { name: 'End Ash after Ch 1' }).click()
  await dialog.getByRole('button', { name: 'Create' }).click()

  await expect(dialog).toBeHidden()
  await expect(crumbs(win)).toContainText('Ember')
  await expect(win.getByText('Ash now ends after Ch 1.')).toBeVisible()
  expect(await storyNamed(win, 'Ash')).toMatchObject({ endAt: 'chapter', endRefId: c1.id })
  await toastWith(win, 'Ash now ends after Ch 1.').getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => await storyNamed(win, 'Ash')).toMatchObject({ endAt: 'end', endRefId: null })
})

test('the time before a story is saved as it is typed, even when the window closes straight away', async ({ launch }) => {
  const first = await launch()
  const b1 = await world(first.win)
  await invoke(first.win, 'createStoryAs', { title: 'Book 2', seriesId: b1.seriesId, placement: after(b1.id) })

  await openSettings(first.win, 'Book 1', 'Book 2')
  const gap = first.win.getByRole('textbox', { name: 'Time since Book 1 ended' })
  await gap.fill('200 years')
  await gap.press('Tab')
  // Leaving the box asks the AI to fill in what changed, and says so quietly.
  const filling = first.win.getByRole('status').filter({ hasText: /Working out what changed in the 200 years|Choose a memory model/ })
  await expect(filling).toBeVisible()
  await expect.poll(async () => (await storyNamed(first.win, 'Book 2'))?.timeGap).toBe('200 years')

  await gap.click()
  await gap.press('End')
  await gap.pressSequentially(' later')
  await closeWindow(first.app)

  const second = await launch({ dataDir: first.dataDir })
  await expect(binder(second.win)).toBeVisible()
  expect((await storyNamed(second.win, 'Book 2'))?.timeGap).toBe('200 years later')
})

test('in a small window the New story dialog scrolls inside, keeping what the story is, what it will know and Create in view', async ({
  launch
}) => {
  const { app, win } = await launch()
  const b1 = await world(win)
  await invoke(win, 'createStoryAs', { title: 'Ash', seriesId: b1.seriesId, placement: side(b1.id) })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 600))
  await expect.poll(() => win.locator('html').evaluate((html) => html.clientHeight)).toBe(600)

  // In a window this small the binder floats over the page, shown with the top bar's binder button.
  await win.getByRole('button', { name: 'Show or hide the binder' }).click()
  const dialog = await openNewStory(win, 'Book 1')
  const create = dialog.getByRole('button', { name: 'Create' })
  await expect(dialog.getByText('Continues after Book 1', { exact: true })).toBeVisible()
  // Closed, everything fits.
  expect(await dialog.locator('form').evaluate((f) => f.scrollHeight - f.clientHeight)).toBe(0)
  await dialog.getByRole('button', { name: 'Change' }).click()
  await dialog.getByText('Side story during', { exact: true }).click()
  await choose(win, dialog, 'Starts', 'After Ch 1')
  const pinned = [
    dialog.getByText('Side story during Book 1, after Ch 1', { exact: true }),
    dialog.getByText('This story knows what happened in: Book 1 up to the end of Ch 1. Does not know: Ash, which is still running here.'),
    dialog.getByRole('button', { name: 'End Ash after Ch 1' }),
    create
  ]
  for (const el of pinned) await expect(el).toBeInViewport({ ratio: 1 })
  // The dialog itself, with its title and buttons, never scrolls.
  expect(await dialog.evaluate((d) => d.scrollHeight - d.clientHeight)).toBe(0)

  // Moving back up with the keyboard shows the chosen answer below what stays in view, not under it.
  await dialog.getByRole('combobox', { name: 'Story', exact: true }).focus()
  await win.keyboard.press('Shift+Tab')
  const radio = dialog.getByRole('radio', { name: 'Side story during' })
  await expect(radio).toBeFocused()
  const card = dialog.locator('label').filter({ has: win.getByRole('radio', { name: 'Side story during' }) })
  await expect(card).toBeInViewport({ ratio: 1 })
  const uncovered = await card.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const top = el.ownerDocument.elementFromPoint(r.left + r.width / 2, r.top + 3)
    return !!top && el.contains(top)
  })
  expect(uncovered).toBe(true)

  await dialog.locator('form').evaluate((f) => (f.scrollTop = f.scrollHeight))
  await expect(dialog.getByText(/belongs in a new world/)).toBeInViewport()
  for (const el of pinned) await expect(el).toBeInViewport({ ratio: 1 })
  await expect(dialog.getByRole('heading', { name: 'New story' })).toBeInViewport({ ratio: 1 })

  // An own version of events from the beginning has one choice, wide enough to read.
  await dialog.getByText('Own version of events', { exact: true }).click()
  const startsFrom = dialog.getByRole('combobox', { name: 'Starts from' })
  await expect(startsFrom).toHaveText('The beginning of the world')
  expect(await startsFrom.locator('span').first().evaluate((s) => s.scrollWidth - s.clientWidth)).toBe(0)
})

test('with many stories the story menu scrolls between its heading and New story…, and each grey line shows in full', async ({
  launch
}) => {
  const { win } = await launch()
  const b1 = await world(win)
  const { scenes } = await invoke(win, 'getOutline', b1.id)
  const whatIf: StoryPlacement = { ...after(b1.id), kind: 'own', startAt: 'scene', startRefId: scenes[0].id }
  for (let i = 1; i <= 9; i++) await invoke(win, 'createStoryAs', { title: `What if ${i}`, seriesId: b1.seriesId, placement: whatIf })
  await switcher(win, 'Book 1').click()
  const menu = win.getByRole('menu')
  const newStory = menu.getByRole('menuitem', { name: 'New story…' })
  await expect(menu.getByRole('menuitem', { name: /^What if 1/ })).toBeVisible()
  await expect(newStory).toBeInViewport({ ratio: 1 })
  // The last story is further down the list; scrolling to it keeps New story… where it was.
  const last = menu.getByRole('menuitem', { name: /^What if 9/ })
  await expect(last).not.toBeInViewport()
  await last.scrollIntoViewIfNeeded()
  await expect(last).toBeInViewport({ ratio: 0.95 })
  await expect(newStory).toBeInViewport({ ratio: 1 })
  await expect(menu.getByText('Own version of events, after Book 1, Ch 1, Sc 1', { exact: true })).toHaveCount(9)
  const cut = await menu.locator('.line-clamp-2').evaluateAll((lines) => lines.filter((l) => l.scrollHeight > l.clientHeight + 1).length)
  expect(cut).toBe(0)
  await newStory.click()
  await expect(win.getByRole('dialog', { name: 'New story' })).toBeVisible()
})
