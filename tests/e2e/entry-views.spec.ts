// Entry views (milestone 3): the codex and entry pages, walked through the way Adam uses them.
//
//  - "Any entry can be viewed as of any scene": slide an entry page through the story and see a
//    change appear where it happens, and "Not in the story yet" before an entry first appears.
//  - The codex: cards with portraits, filters and sorts, kept while going back and forth; its empty state.
//  - "Appears in" opens a scene at the words; changing where an entry first appears (with Undo).
//  - "As seen in" appears once there is a side story; an edit made in a later story offers to keep
//    it for that story on only.
//
// The world is set up through the app's API (the same calls the interface makes), then the window
// is reloaded so it shows it, and everything checked is done through the interface.
import type { Page } from '@playwright/test'
import type { ID } from '@shared/types'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

const main = (win: Page) => win.locator('main')
const nameBox = (win: Page) => win.getByRole('textbox', { name: 'Name', exact: true })
const entryRows = (win: Page) => win.locator('[data-entry]')

/** Book 1 with one chapter of three scenes (the first is open). */
async function bookOne(win: Page): Promise<{ b1: ID; ch1: ID; s: ID[] }> {
  const [story] = await invoke(win, 'listStories')
  await invoke(win, 'updateStory', story.id, { title: 'Book 1' })
  const outline = await invoke(win, 'getOutline', story.id)
  const ch1 = outline.chapters[0].id
  const s = [outline.scenes[0].id]
  for (let i = 0; i < 2; i++) s.push((await invoke(win, 'createScene', ch1)).id)
  return { b1: story.id, ch1, s }
}

/** Shows what was set up through the API: the window reads the world afresh. */
async function reload(win: Page): Promise<void> {
  await win.reload()
  await expect(binder(win)).toBeVisible()
}

async function openList(win: Page, list: string): Promise<void> {
  await binder(win).getByRole('button', { name: list }).click()
  await expect(main(win).getByRole('heading', { name: list, exact: true })).toBeVisible()
}

async function openEntry(win: Page, list: string, name: string): Promise<void> {
  await openList(win, list)
  await entryRows(win).filter({ hasText: name }).first().click()
  await expect(nameBox(win)).toHaveValue(name)
}

/** Opens a section of the entry page (sections stay open from one page to the next). */
async function openSection(win: Page, title: string): Promise<void> {
  const toggle = main(win).getByRole('button', { name: new RegExp(`^${title}`) })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

/** Picks an option from one of the page's pickers (found by its label). */
async function choose(win: Page, picker: string, option: string): Promise<void> {
  await main(win).getByRole('combobox', { name: picker, exact: true }).click()
  await win.getByRole('option', { name: option, exact: true }).click()
  await expect(main(win).getByRole('combobox', { name: picker, exact: true })).toHaveText(option)
}

/** The names on the codex's cards in one kind's group, in order. */
const cardNames = (win: Page, group: string): Promise<(string | null)[]> =>
  main(win)
    .getByRole('region', { name: new RegExp(`^${group}`) })
    .locator('[data-codex-card]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))

/** Gives an entry a small picture, as the interface does when one is dropped on its portrait. */
const givePicture = (id: string): string => `(async () => {
  const canvas = new OffscreenCanvas(240, 240)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#3d5a80'
  ctx.fillRect(0, 0, 240, 240)
  const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.86 })
  const res = await window.aiwrite.invoke('setEntryImage', ${JSON.stringify(id)}, { bytes: new Uint8Array(await blob.arrayBuffer()), type: blob.type })
  if (!res.ok) throw new Error(res.error.message)
  return res.value.image
})()`

test('any entry can be viewed as of any scene', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'As of')
  const { b1, s } = await bookOne(win)
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', fields: { eyes: 'blue' }, originStoryId: b1 })
  // In the second scene she loses an eye (as the memory keeper would note it, or Adam by hand).
  await invoke(win, 'createChange', {
    entryId: mara.id,
    anchor: 'scene',
    sceneId: s[1],
    kind: 'update',
    payload: { note: 'Loses her left eye', fields: { eyes: 'one grey eye' } }
  })
  // Tobin first appears in the third scene.
  const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', originStoryId: b1 })
  await invoke(win, 'setFirstExists', tobin.id, [{ kind: 'scene', storyId: b1, sceneId: s[2], byHand: true }])
  await reload(win)

  await openEntry(win, 'Characters', 'Mara')
  // Adam made her: the page says he wrote it.
  await expect(main(win).getByText("You wrote this. AI Write won't change what you've written.")).toBeVisible()
  await main(win).getByRole('button', { name: 'View as of a scene' }).click()
  const slider = main(win).getByRole('slider', { name: 'As of' })
  await expect(slider).toBeFocused()
  // It opens at the scene Adam is in, before the change.
  await expect(slider).toHaveAttribute('aria-valuetext', 'Book 1, Ch 1, Sc 1')
  await expect(main(win).getByText('blue', { exact: true })).toBeVisible()
  await expect(main(win).getByText('Changed', { exact: true })).toHaveCount(0)
  await expect(main(win).getByText('You wrote this, and none of it has changed by this point.')).toBeVisible()

  // One scene on: the change shows, marked, with what happened.
  await slider.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuetext', 'Book 1, Ch 1, Sc 2')
  await expect(main(win).getByText('one grey eye', { exact: true })).toBeVisible()
  await expect(main(win).getByText('Changed', { exact: true })).toBeVisible()
  await expect(main(win).getByText('Loses her left eye')).toBeVisible()
  await expect(main(win).getByText('You wrote this. What has changed by this point is marked.')).toBeVisible()

  // Back to the start of the story: as Adam wrote her. "Next change" jumps to where she changes.
  await slider.press('Home')
  await expect(slider).toHaveAttribute('aria-valuetext', 'Start of Book 1')
  await expect(main(win).getByText('blue', { exact: true })).toBeVisible()
  await main(win).getByRole('button', { name: 'Next change' }).click()
  await expect(slider).toHaveAttribute('aria-valuetext', 'Book 1, Ch 1, Sc 2')

  // Another entry at the same point: Tobin isn't there yet, and the page says where he first appears.
  await entryRows(win).filter({ hasText: 'Tobin' }).click()
  await expect(main(win).getByText('Not in the story yet at this point')).toBeVisible()
  await expect(main(win).getByText('First appears: Book 1, Ch 1, Sc 3.', { exact: true })).toBeVisible()
  await main(win).getByRole('slider', { name: 'As of' }).press('End')
  await expect(main(win).getByText('Not in the story yet at this point')).toHaveCount(0)
  await expect(main(win).getByText('What has happened so far')).toBeVisible()

  // One click back to editing.
  await main(win).getByRole('button', { name: 'Back to editing' }).click()
  await expect(nameBox(win)).toHaveValue('Tobin')
  await expect(main(win).getByRole('slider', { name: 'As of' })).toHaveCount(0)
  await expect(main(win).getByRole('button', { name: 'View as of a scene' })).toBeFocused()

  // A new character made while looking as of a scene opens ready to type its name.
  await main(win).getByRole('button', { name: 'View as of a scene' }).click()
  await expect(main(win).getByRole('slider', { name: 'As of' })).toBeVisible()
  await main(win).getByRole('button', { name: 'New character' }).click()
  await expect(nameBox(win)).toBeFocused()
  await expect(nameBox(win)).toHaveValue('New character')
})

test('the codex shows every entry with its portrait, filters and sorts them, and keeps them while Adam goes back and forth', async ({
  launch
}) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Codex')
  const { b1, s } = await bookOne(win)
  const b2 = await invoke(win, 'createStory', { title: 'Book 2', startStoryId: b1 })
  const mara = await invoke(win, 'createEntry', 'character', {
    name: 'Mara',
    summary: 'Runs the night ferry',
    tags: ['family'],
    fields: { role: 'protagonist' },
    originStoryId: b1
  })
  await invoke(win, 'createEntry', 'character', {
    name: 'Tobin',
    tags: ['family', 'the north'],
    fields: { role: 'antagonist' },
    originStoryId: b1
  })
  const kell = await invoke(win, 'createEntry', 'character', { name: 'Kell', originStoryId: b1 })
  await invoke(win, 'setFirstExists', kell.id, [{ kind: 'story-pre', storyId: b2.id, sceneId: null, byHand: true }])
  await invoke(win, 'createEntry', 'place', { name: 'Eelmouth', tags: ['the north'], originStoryId: b1 })
  await invoke(win, 'createEntry', 'lore', { name: 'The toll law', hardRule: true, originStoryId: b1 })
  await invoke(win, 'createEntry', 'thread', { name: 'Who left the letter?', originStoryId: b1 })
  await invoke(win, 'saveSceneText', s[0], null, 'Mara and Tobin cross the river at Eelmouth.')
  await invoke(win, 'saveSceneText', s[1], null, 'Mara waits at the steps.')
  await invoke(win, 'saveSceneText', s[2], null, 'Tobin comes back alone.')
  const { card } = await invoke(win, 'getScene', s[0])
  await invoke(win, 'updateSceneCard', s[0], { ...card, povId: mara.id })
  const picture = (await win.evaluate(givePicture(mara.id))) as string
  await reload(win)

  await binder(win).getByRole('button', { name: 'Codex' }).click()
  await expect(main(win).getByRole('heading', { level: 1, name: 'Codex' })).toBeVisible()
  // Every entry but the plot thread (it has its own board), grouped by kind, by name to begin with.
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(5)
  expect(await cardNames(win, 'Characters')).toEqual(['Kell', 'Mara', 'Tobin'])
  expect(await cardNames(win, 'Places')).toEqual(['Eelmouth'])
  expect(await cardNames(win, 'Lore')).toEqual(['The toll law'])
  const maraCard = main(win).getByRole('button', { name: 'Mara', exact: true })
  await expect(maraCard.locator('img')).toHaveAttribute('src', picture)
  await expect(maraCard).toContainText('Runs the night ferry')
  await expect(maraCard).toContainText('Protagonist')
  await expect(maraCard).toContainText('family')
  await expect(maraCard).toContainText('In 2 scenes · last in Book 1, Ch 1, Sc 2')
  await expect(main(win).getByRole('button', { name: 'Kell', exact: true })).toContainText('Not in a scene yet')

  // Sorts.
  await choose(win, 'Sort by', 'Importance')
  expect(await cardNames(win, 'Characters')).toEqual(['Mara', 'Tobin', 'Kell'])
  await choose(win, 'Sort by', 'Last appearance')
  expect(await cardNames(win, 'Characters')).toEqual(['Tobin', 'Mara', 'Kell'])

  // Filters, each on its own and then cleared.
  await choose(win, 'Kind', 'Places')
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(1)
  expect(await cardNames(win, 'Places')).toEqual(['Eelmouth'])
  await choose(win, 'Kind', 'All kinds')
  await choose(win, 'Tag', 'the north')
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(2)
  expect(await cardNames(win, 'Characters')).toEqual(['Tobin'])
  await main(win).getByRole('button', { name: 'Clear filters' }).click()
  await choose(win, 'Role', 'Antagonist')
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(1)
  expect(await cardNames(win, 'Characters')).toEqual(['Tobin'])
  await main(win).getByRole('button', { name: 'Clear filters' }).click()
  await choose(win, 'Story', 'Book 2')
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(1)
  expect(await cardNames(win, 'Characters')).toEqual(['Kell'])
  await main(win).getByRole('button', { name: 'Clear filters' }).click()
  await main(win).getByRole('textbox', { name: 'Search the codex' }).fill('ferry')
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(1)
  await main(win).getByRole('textbox', { name: 'Search the codex' }).fill('nobody here')
  await expect(main(win).getByRole('heading', { name: 'Nothing matches' })).toBeVisible()
  await expect(main(win).getByText('Nothing in the codex matches your search.')).toBeVisible()
  // The search box's own clear button comes first; the one under "Nothing matches" last.
  await main(win).getByRole('button', { name: 'Clear search' }).last().click()
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(5)
  await choose(win, 'Kind', 'Places')
  await main(win).getByRole('textbox', { name: 'Search the codex' }).fill('Mara')
  await expect(main(win).getByText('Nothing in the codex matches your search and this filter.')).toBeVisible()
  await main(win).getByRole('button', { name: 'Clear filters' }).last().click()
  await expect(main(win).locator('[data-codex-card]')).toHaveCount(5)
  await expect(main(win).getByRole('textbox', { name: 'Search the codex' })).toHaveValue('')

  // A card opens the entry's page; going back finds the codex as it was left.
  await choose(win, 'Tag', 'family')
  await choose(win, 'Sort by', 'Importance')
  await main(win).getByRole('button', { name: 'Tobin', exact: true }).click()
  await expect(nameBox(win)).toHaveValue('Tobin')
  await main(win).getByRole('button', { name: 'Back to the codex' }).click()
  await expect(main(win).getByRole('combobox', { name: 'Tag', exact: true })).toHaveText('family')
  await expect(main(win).getByRole('combobox', { name: 'Sort by', exact: true })).toHaveText('Importance')
  expect(await cardNames(win, 'Characters')).toEqual(['Mara', 'Tobin'])
})

test('an empty codex explains what entries are for and offers a way to start', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Empty')
  await binder(win).getByRole('button', { name: 'Codex' }).click()
  await expect(main(win).getByRole('heading', { name: 'Nothing in the codex yet' })).toBeVisible()
  await expect(main(win).getByText('given to the AI when a scene needs it')).toBeVisible()
  await expect(main(win).getByRole('button', { name: 'Quick start from a few notes' })).toBeVisible()
  await main(win).getByRole('button', { name: 'Create a character' }).click()
  // A new character opens with its name selected, ready to type over, and the way back.
  await expect(nameBox(win)).toBeFocused()
  await win.keyboard.type('Mara')
  await expect(entryRows(win).filter({ hasText: 'Mara' })).toBeVisible()
  await main(win).getByRole('button', { name: 'Back to the codex' }).click()
  await expect(main(win).getByRole('button', { name: 'Mara', exact: true })).toBeVisible()

  // Quick start goes to the builder.
  const empty = await launch()
  await createWorldFromWelcome(empty.win, 'Empty too')
  await binder(empty.win).getByRole('button', { name: 'Codex' }).click()
  await main(empty.win).getByRole('button', { name: 'Quick start from a few notes' }).click()
  await expect(main(empty.win).getByRole('heading', { name: 'Nothing in the codex yet' })).toHaveCount(0)
})

test('"Appears in" lists the scenes an entry is in, and opens one at its words', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Appears')
  const { b1, s } = await bookOne(win)
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', originStoryId: b1 })
  const { card } = await invoke(win, 'getScene', s[0])
  await invoke(win, 'updateSceneCard', s[0], { ...card, povId: mara.id })
  await invoke(win, 'saveSceneText', s[1], null, 'Rain fell all night. Mara kept her hood low, and waited for the ferry.')
  await invoke(win, 'saveSceneText', s[2], null, 'Nobody came.')
  await reload(win)

  await openEntry(win, 'Characters', 'Mara')
  await openSection(win, 'Appears in')
  const rows = main(win).getByRole('button', { name: /^Book 1, Ch 1, Sc \d/ })
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('Point of view')
  await expect(rows.nth(1)).toContainText('Mara kept her hood low, and waited for the ferry.')
  await rows.nth(1).click()
  // The scene opens with those words chosen.
  await expect(win.locator('.scene-prose')).toContainText('Rain fell all night.')
  const chosen = (): Promise<string> =>
    win.evaluate(() => (globalThis as unknown as { getSelection(): { toString(): string } | null }).getSelection()?.toString() ?? '')
  await expect.poll(chosen).toBe('Mara kept her hood low, and waited for the ferry.')
})

test('where an entry first appears can be changed from its page, and the change undone', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'First')
  const { b1 } = await bookOne(win)
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', originStoryId: b1 })
  await reload(win)

  await openEntry(win, 'Characters', 'Mara')
  const line = main(win).getByRole('button', { name: 'First appears: the beginning of the world' })
  await line.click()
  const panel = win.getByRole('dialog')
  await expect(panel.getByText('Worked out for you')).toBeVisible()
  // The only place can't be removed until there is another.
  await expect(panel.getByRole('button', { name: 'Remove the beginning of the world' })).toBeDisabled()
  await panel.getByRole('button', { name: 'Add another place' }).click()
  await panel.getByRole('combobox').fill('ch 1 sc 2')
  await win.getByRole('option', { name: /^Book 1, Ch 1, Sc 2/ }).click()
  await expect(panel.getByText('Book 1, Ch 1, Sc 2', { exact: true })).toBeVisible()
  await panel.getByRole('button', { name: 'Remove the beginning of the world' }).click()
  await expect(win.getByText('Mara now first appears in Book 1, Ch 1, Sc 2.')).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(main(win).getByRole('button', { name: 'First appears: Book 1, Ch 1, Sc 2' })).toBeVisible()
  // Adam's own now: never worked out again for him.
  const points = await invoke(win, 'listFirstExists', mara.id)
  expect(points.map((p) => [p.kind, p.byHand])).toEqual([['scene', true]])

  // Undo puts it back as it was.
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect(main(win).getByRole('button', { name: 'First appears: the beginning of the world' })).toBeVisible()
  expect((await invoke(win, 'listFirstExists', mara.id)).map((p) => [p.kind, p.byHand])).toEqual([['world', false]])
})

test('"As seen in" appears on entry pages once the world has a side story', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Seen')
  const { b1 } = await bookOne(win)
  await invoke(win, 'createEntry', 'character', { name: 'Mara', originStoryId: b1 })
  await reload(win)

  await openEntry(win, 'Characters', 'Mara')
  await main(win).getByRole('button', { name: 'View as of a scene' }).click()
  await expect(main(win).getByRole('slider', { name: 'As of' })).toBeVisible()
  await expect(main(win).getByRole('combobox', { name: 'As seen in' })).toHaveCount(0)

  const side = await invoke(win, 'createStory', { title: 'The Ferrywoman', startStoryId: b1 })
  await invoke(win, 'setStoryPlacement', side.id, {
    kind: 'side',
    startStoryId: b1,
    startAt: 'pre',
    startRefId: null,
    endAt: 'end',
    endRefId: null,
    leadsIntoId: null
  })
  await reload(win)
  await openEntry(win, 'Characters', 'Mara')
  await main(win).getByRole('button', { name: 'View as of a scene' }).click()
  const seenIn = main(win).getByRole('combobox', { name: 'As seen in' })
  await expect(seenIn).toHaveText('Book 1')
  await seenIn.click()
  await win.getByRole('option', { name: 'The Ferrywoman' }).click()
  await expect(seenIn).toHaveText('The Ferrywoman')
  await expect(main(win).getByRole('slider', { name: 'As of' })).toHaveAttribute('aria-valuetext', /The Ferrywoman/)
})

test('in a small window the as-of bar and the page’s buttons keep their room, with "As seen in" there too', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Small')
  const { b1 } = await bookOne(win)
  await invoke(win, 'createEntry', 'character', { name: 'Mara', originStoryId: b1 })
  const side = await invoke(win, 'createStory', { title: 'The Ferrywoman', startStoryId: b1 })
  await invoke(win, 'setStoryPlacement', side.id, {
    kind: 'side',
    startStoryId: b1,
    startAt: 'pre',
    startRefId: null,
    endAt: 'end',
    endRefId: null,
    leadsIntoId: null
  })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(960, 600))
  await reload(win)

  // The binder, the list of characters and Mara's page side by side.
  await openEntry(win, 'Characters', 'Mara')
  await expect(entryRows(win).filter({ hasText: 'Mara' })).toBeVisible()
  const builder = main(win).getByRole('button', { name: 'Open in the builder' })
  // The buttons under the name can be clicked: when they take two rows, their row grows to hold them.
  const inRow = (): Promise<boolean> =>
    builder.evaluate((b) => b.getBoundingClientRect().bottom <= b.parentElement!.getBoundingClientRect().bottom + 0.5)
  await builder.click({ trial: true })
  expect(await inRow()).toBe(true)

  await main(win).getByRole('button', { name: 'View as of a scene' }).click()
  await main(win).getByRole('combobox', { name: 'As seen in' }).click()
  await win.getByRole('option', { name: 'The Ferrywoman' }).click()
  const slider = main(win).getByRole('slider', { name: 'As of' })
  await expect(slider).toHaveAttribute('aria-valuetext', /The Ferrywoman/)
  // The slider is wide enough to drag, and says in full which scene it is at.
  const room = await slider.evaluate((input) => {
    const label = input.closest('.flex-col')?.querySelector('.truncate')
    return { track: input.getBoundingClientRect().width, cut: !label || label.scrollWidth > label.clientWidth }
  })
  expect(room.track).toBeGreaterThan(180)
  expect(room.cut).toBe(false)
  await builder.click({ trial: true })
  expect(await inRow()).toBe(true)
  await main(win).getByRole('button', { name: 'Back to editing' }).click({ trial: true })
})

test('an edit made while working in a later story offers to keep it for that story on', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Reach')
  const { b1 } = await bookOne(win)
  const b2 = await invoke(win, 'createStory', { title: 'Book 2', startStoryId: b1 })
  const ch = await invoke(win, 'createChapter', b2.id)
  const sc = await invoke(win, 'createScene', ch.id)
  const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', fields: { eyes: 'blue' }, originStoryId: b1 })
  // Adam is working in Book 2.
  await invoke(win, 'updateSettings', { lastStoryId: b2.id, lastSceneId: sc.id })
  await reload(win)

  await openEntry(win, 'Characters', 'Mara')
  await openSection(win, 'Looks')
  const eyes = main(win).getByLabel('Eyes', { exact: true })
  await expect(eyes).toHaveValue('blue')
  await expect(main(win).getByText('This changes Mara in every story')).toHaveCount(0)
  await eyes.fill('green')
  await expect(main(win).getByText('This changes Mara in every story')).toBeVisible()
  await main(win).getByRole('button', { name: 'Only from Book 2 on' }).click()
  await expect(win.getByText('From Book 2 on, Mara has the new details.')).toBeVisible()
  // The profile is back as it was; Book 2 sees the new eyes from its start, Book 1 the old ones.
  await expect(eyes).toHaveValue('blue')
  await expect(main(win).getByText('This changes Mara in every story')).toHaveCount(0)
  expect((await invoke(win, 'getEntryAsOf', mara.id, { kind: 'start', storyId: b2.id })).state?.fields.eyes).toBe('green')
  expect((await invoke(win, 'getEntryAsOf', mara.id, { kind: 'end', storyId: b1 })).state?.fields.eyes).toBe('blue')

  // Undo: the edit is on the profile again, for every story.
  await win.getByRole('button', { name: 'Undo' }).click()
  await expect(eyes).toHaveValue('green')
  expect((await invoke(win, 'listChanges', mara.id)).filter((c) => c.anchor === 'story-start')).toEqual([])
})
