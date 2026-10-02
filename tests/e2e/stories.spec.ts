// Milestone 3's story screens, walked through the way Adam works: the New story dialog ("What is it?"
// with its live sentence and warnings), the questions that follow a new story, story settings with
// Undo, the grey line on story cards, and deleting a story with Undo. The automatic story flows are
// another part's; here they only need to be started and reported quietly.
import type { Locator, Page } from '@playwright/test'
import type { StoryPlacement } from '../../src/shared/api'
import type { Story } from '../../src/shared/types'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

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

const storyNamed = async (win: Page, title: string): Promise<Story | undefined> => (await invoke(win, 'listStories')).find((s) => s.title === title)

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
  await expect(dialog.getByText('This story knows what happened in: Book 1 up to the end of Ch 1.')).toBeVisible()
  await expect(dialog.getByText('Side story during Book 1, after Ch 1', { exact: true })).toBeVisible()
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
  const warning = dialog.getByText("Kell's Road is a side story during Book 1, so this story would miss everything in Book 1 after Kell's Road starts.")
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

  // Undo puts Book 2 back where it was.
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await storyNamed(win, 'Book 2'))?.startStoryId).toBe(b1.id)
  expect(b2.startStoryId).toBe(b1.id)
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
  await win.getByRole('button', { name: 'Choose cast' }).click()
  await expect(win.getByRole('heading', { level: 1, name: 'Young Mara' })).toBeVisible()
  const cast = win.getByRole('combobox', { name: 'Add to the starting cast' })
  await expect(cast).toBeFocused()
  await cast.fill('Mara')
  await cast.press('Enter')
  await expect(win.getByRole('button', { name: 'Remove Mara' })).toBeVisible()
  await win.getByRole('button', { name: 'Draft how they start' }).click()
  // The drafting runs by itself; its progress is one quiet line.
  await expect(win.getByRole('status').filter({ hasText: /Drafting how each of them starts|isn’t ready yet/ })).toBeVisible()

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

  await switcher(win, 'Book 1').click()
  await win.getByRole('menuitem', { name: 'Settings for Book 2' }).click()
  await expect(win.getByRole('heading', { level: 1, name: 'Book 2' })).toBeVisible()
  await expect(win.getByText('Ash will start after Book 1 instead.')).toBeVisible()
  await win.getByRole('button', { name: 'Delete story' }).click()

  await expect(win.getByText('“Book 2” deleted.')).toBeVisible()
  await expect.poll(async () => (await invoke(win, 'listStories')).map((s) => s.title)).toEqual(['Book 1', 'Ash'])
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await invoke(win, 'listStories')).map((s) => s.title)).toEqual(['Book 1', 'Book 2', 'Ash'])
})
