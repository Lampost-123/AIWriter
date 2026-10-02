// Search and the command palette (Ctrl+K), and the keyboard shortcuts list (?): finding words in a
// scene, an entry by another name, a summary and a private note; running actions; and keyboard
// focus going back where it was. Also the top bar's search box at the smallest window.
import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, test, useFakeModel } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const palette = (win: Page) => win.getByRole('dialog', { name: 'Search' })
const box = (win: Page) => win.getByRole('combobox', { name: 'Search, or find an action' })
const group = (win: Page, name: string) => palette(win).getByRole('group', { name, exact: true })
const scenes = (win: Page) => binder(win).locator('[data-row="scene"]')
const shortcutsList = (win: Page) => win.getByRole('dialog', { name: 'Keyboard shortcuts' })

/** The words selected in the window. */
const selectedText = (win: Page): Promise<string> =>
  win.evaluate(() => String((globalThis as unknown as { getSelection(): unknown }).getSelection()))

/** The words selected in the box that has the keyboard. */
const selectedInBox = (win: Page): Promise<string> =>
  win.evaluate<string>(`(() => {
    const el = document.activeElement
    return el && 'selectionStart' in el ? el.value.slice(el.selectionStart, el.selectionEnd) : ''
  })()`)

/** The window's size, as Adam might make it. */
const resize = (app: ElectronApplication, width: number, height: number): Promise<void> =>
  app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height] as const)

/** Opens the palette with Ctrl+K and types into it. */
async function search(win: Page, words: string): Promise<void> {
  await win.keyboard.press('Control+K')
  await expect(box(win)).toBeFocused()
  await win.keyboard.type(words)
}

test('Ctrl+K finds words in a scene, an entry by another name, a summary and a private note, and runs actions', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await prose(win).click()
  await win.keyboard.type('The ferry crossed the Vellmoor strait at dawn.')

  // An action, found by typing: a new scene, opened with the caret in it.
  await search(win, 'new sce')
  await expect(palette(win).getByRole('option', { name: 'New scene' })).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(palette(win)).toBeHidden()
  await expect(scenes(win)).toHaveCount(2)
  await expect(scenes(win).nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type('Osk was quiet.')

  // A word from the first scene, under Scenes as it is typed (searching takes a few milliseconds).
  const timed = await invoke(win, 'search', 'vellmoor')
  expect(timed.ms).toBeLessThan(100)
  await search(win, 'vellm')
  const hit = group(win, 'Scenes').getByRole('option').first()
  await expect(hit).toContainText('Vellmoor strait at dawn', { timeout: 2000 })
  await expect(hit).toContainText('Book 1, Ch 1, Sc 1')
  await expect(hit.locator('mark')).toHaveText('Vellm')
  await expect(hit).toHaveAttribute('aria-selected', 'true')
  // Enter opens the scene at the words.
  await win.keyboard.press('Enter')
  await expect(palette(win)).toBeHidden()
  await expect(scenes(win).nth(0)).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => selectedText(win)).toBe('Vellmoor')
  await expect(prose(win)).toBeFocused()

  // An entry by another name it goes by, with its private note; a chapter summary.
  await invoke(win, 'createEntry', 'character', {
    name: 'Mara Quell',
    aliases: ['The Grey Widow'],
    notes: 'Keeps the lighthouse keys under a loose board.'
  })
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  await invoke(win, 'setSummary', 'chapter', outline.chapters[0].id, 'Mara reaches the island and hides the brass lantern.')

  await search(win, 'grey wid')
  const mara = group(win, 'Characters').getByRole('option').first()
  await expect(mara).toContainText('Mara Quell')
  await expect(mara).toContainText('Also called: The Grey Widow')
  await expect(mara).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue('Mara Quell')

  await search(win, 'brass lantern')
  await expect(group(win, 'Summaries').getByRole('option').first()).toContainText('hides the brass lantern')
  await expect(group(win, 'Summaries').getByRole('option').first()).toContainText('Chapter summary')
  await win.keyboard.press('Escape')
  await expect(palette(win)).toBeHidden()

  await search(win, 'lighthouse keys')
  const note = group(win, 'Notes').getByRole('option').first()
  await expect(note).toContainText('Mara Quell')
  await expect(note).toContainText('Private notes')
  await expect(note).toContainText('Keeps the lighthouse keys')
  await win.keyboard.press('Escape')

  // Nothing typed: the places visited lately (not the open scene or entry), and the most useful actions.
  await win.keyboard.press('Control+K')
  await expect(group(win, 'Recent').getByRole('option')).toHaveCount(1)
  await expect(group(win, 'Recent')).toContainText('Scene 2')
  await expect(group(win, 'Suggested').getByRole('option', { name: 'Codex' })).toBeVisible()
  // Moving down and back up the list with the arrow keys (it wraps around).
  const first = palette(win).getByRole('option').first()
  await expect(first).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('ArrowUp')
  await expect(palette(win).getByRole('option').last()).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('ArrowDown')
  await expect(first).toHaveAttribute('aria-selected', 'true')

  // Another action: a page of the world.
  await win.keyboard.type('codex')
  await expect(palette(win).getByRole('option', { name: 'Codex' })).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(binder(win).getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-current', 'page')

  // Nothing found says so plainly.
  await search(win, 'zzyzx')
  await expect(palette(win)).toContainText('Nothing matches “zzyzx”')
  await win.keyboard.press('Escape')
  await expect(palette(win)).toBeHidden()
})

test('Esc gives focus back; ? lists the shortcuts, but not while typing; the top bar has a search box', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await prose(win).click()
  await win.keyboard.type('Rain on the roof')

  // Esc closes the palette and the caret is back in the page, where it was.
  await search(win, 'anything')
  await win.keyboard.press('Escape')
  await expect(palette(win)).toBeHidden()
  await expect(prose(win)).toBeFocused()
  // ? while typing is just a question mark.
  await win.keyboard.type('?')
  await expect(prose(win)).toContainText('Rain on the roof?')
  await expect(shortcutsList(win)).toHaveCount(0)

  // The top bar's search box opens the palette too, and closing it goes back to the page.
  const searchBox = win.getByRole('banner').getByRole('button', { name: 'Search (Ctrl+K)' })
  await expect(searchBox).toContainText('Search')
  await searchBox.click()
  await expect(box(win)).toBeFocused()
  await win.keyboard.press('Escape')
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type('!')
  await expect(prose(win)).toContainText('Rain on the roof?!')

  // Tooltips name the shortcuts.
  await expect(win.getByRole('button', { name: 'Settings', exact: true })).toHaveAttribute('title', 'Settings (Ctrl+,)')

  // Outside the text, ? opens the list of shortcuts, in groups, with this computer's keys.
  await win.getByRole('banner').click({ position: { x: 640, y: 20 } })
  await expect(prose(win)).not.toBeFocused()
  await win.keyboard.press('?')
  const list = shortcutsList(win)
  await expect(list).toBeVisible()
  const writing = list.getByRole('region', { name: 'Writing' })
  await expect(writing.getByRole('listitem').filter({ hasText: 'Generate a draft of the scene' })).toContainText('Ctrl')
  await expect(writing.getByRole('listitem').filter({ hasText: 'Mark scene done' })).toContainText('Enter')
  await expect(list.getByRole('region', { name: 'Moving around' }).getByRole('listitem').filter({ hasText: 'Search' })).toContainText('K')
  await expect(list).not.toContainText('Focus mode')
  await win.keyboard.press('Escape')
  await expect(list).toBeHidden()

  // From the palette too; Esc closes it and the caret goes back to the page.
  await prose(win).click()
  await search(win, 'shortcuts')
  await expect(palette(win).getByRole('option', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(list).toBeVisible()
  await expect(palette(win)).toBeHidden()
  await win.keyboard.press('Escape')
  await expect(list).toBeHidden()
  await expect(prose(win)).toBeFocused()
})

test('Generate a draft and Stop the draft run from the palette, from any page', async ({ launch }) => {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  const fake = await startFakeProvider({ delayMs: 5, slowWords: 900, slowDelayMs: 20 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useFakeModel(win, fake, 'fake/slow')
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id

    // From another page, Generate goes back to the scene and starts the draft, as Ctrl+G does there.
    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await search(win, 'generate')
    await expect(palette(win).getByRole('option', { name: 'Generate a draft' })).toHaveAttribute('aria-selected', 'true')
    await win.keyboard.press('Enter')
    await expect(prose(win)).toContainText('The rain')

    // While it writes, the palette offers Stop (and not Generate).
    await search(win, 'stop')
    await expect(palette(win).getByRole('option', { name: 'Stop the draft' })).toHaveAttribute('aria-selected', 'true')
    await win.keyboard.press('Enter')
    await expect.poll(async () => (await invoke(win, 'listGenerations', sceneId))[0]?.status, { timeout: 15_000 }).toBe('stopped')
  } finally {
    await fake.close()
  }
})

test('Keys pressed before the list catches up act on what was typed; a note opens the card at it; the world menu and name box keep their places', async ({
  launch
}) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await prose(win).click()
  await win.keyboard.type('Rain on the roof.')

  // The words and Enter in the same moment, before the search for the words is back: Enter acts on
  // those words (the Codex), not on the list that was showing (whose first row is Generate).
  await win.keyboard.press('Control+K')
  await expect(group(win, 'Suggested').getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await win.evaluate(`(() => {
    const input = document.querySelector('input[aria-label="Search, or find an action"]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'codex')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  })()`)
  await expect(palette(win)).toBeHidden()
  await expect(binder(win).getByRole('button', { name: 'Codex' })).toHaveAttribute('aria-current', 'page')
  await expect(win.getByText('Choose a writer model first')).toHaveCount(0)

  // A scene's notes for the AI: opening one shows the scene with its card scrolled to the notes.
  const [story] = await invoke(win, 'listStories')
  const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
  const { card } = await invoke(win, 'getScene', sceneId)
  await invoke(win, 'updateSceneCard', sceneId, { ...card, notes: 'Keep the brass lantern out of sight until the very end.' })
  const notes = win.getByRole('textbox', { name: 'Notes for the AI' })
  await search(win, 'brass lantern')
  const note = group(win, 'Notes').getByRole('option').first()
  await expect(note).toContainText('Notes for the AI')
  await win.keyboard.press('Enter')
  await expect(notes).toHaveValue('Keep the brass lantern out of sight until the very end.')
  await expect(notes).toBeInViewport()
  await expect(prose(win)).toBeFocused()

  // Renaming the world from the palette: the name box opens in place, so the search box beside the
  // name doesn't move, and once the name is in the caret is back in the page.
  const searchBox = win.getByRole('banner').getByRole('button', { name: 'Search (Ctrl+K)' })
  const before = await searchBox.boundingBox()
  await search(win, 'rename world')
  await win.keyboard.press('Enter')
  const name = win.getByRole('textbox', { name: 'World name' })
  await expect(name).toBeFocused()
  expect(await searchBox.boundingBox()).toEqual(before)
  await win.keyboard.type('The Saltmarsh Chronicles of the Long Coast')
  expect(await searchBox.boundingBox()).toEqual(before)
  await win.keyboard.press('Enter')
  await expect(win.getByRole('banner')).toContainText('The Saltmarsh Chronicles')
  await expect(prose(win)).toBeFocused()
  // From the world menu too; Esc there puts the keyboard back on the world's button.
  const worldButton = win.getByRole('banner').getByRole('button', { name: 'The Saltmarsh Chronicles of the Long Coast' })
  const renamed = await searchBox.boundingBox()
  await worldButton.click()
  await win.getByRole('menuitem', { name: 'Rename this world' }).click()
  await expect(name).toBeFocused()
  expect(await searchBox.boundingBox()).toEqual(renamed)
  await win.keyboard.press('Escape')
  await expect(name).toHaveCount(0)
  await expect(worldButton).toBeFocused()

  // Switching worlds from the palette: the menu opens with the worlds in place and the keyboard on
  // the other one; Esc closes it and the caret goes back to the page.
  await search(win, 'new world')
  await expect(palette(win).getByRole('option', { name: 'New world' })).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  const newWorld = win.getByRole('dialog', { name: 'New world' })
  await newWorld.getByLabel('World name').fill('Beta')
  await newWorld.getByRole('button', { name: 'Create world' }).click()
  await expect(win.getByRole('banner')).toContainText('Beta')
  await prose(win).click()
  await search(win, 'switch')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('menuitem', { name: 'The Saltmarsh Chronicles of the Long Coast' })).toBeFocused()
  await win.keyboard.press('Escape')
  await expect(win.getByRole('menu')).toHaveCount(0)
  await expect(prose(win)).toBeFocused()
})

test('An entry opens where the words were found; a scene action from another page puts the caret back in the page', async ({ launch }) => {
  const { win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await prose(win).click()
  await win.keyboard.type('Rain on the roof.')
  // Long private notes with the words at the end, a field in a section that starts closed, and a change over the story.
  const lines = Array.from({ length: 40 }, (_, i) => `Note ${i + 1}: nothing much to say here.`)
  const notes = [...lines, 'She keeps the lighthouse keys under a loose board.'].join('\n')
  const mara = await invoke(win, 'createEntry', 'character', {
    name: 'Mara Quell',
    fields: { fears: 'Deep water at night, and the bell tower ringing.' },
    notes
  })
  const [story] = await invoke(win, 'listStories')
  const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
  await invoke(win, 'createChange', {
    entryId: mara.id,
    anchor: 'scene',
    sceneId,
    kind: 'update',
    payload: { note: 'Lost her left hand in the mill fire' }
  })

  // A field in a closed section: the section opens, and the words are selected in the field.
  await search(win, 'bell tower')
  const fears = group(win, 'Characters').getByRole('option').first()
  await expect(fears).toContainText('Fears: Deep water at night, and the bell tower ringing.')
  await expect(fears).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('button', { name: 'Personality' })).toHaveAttribute('aria-expanded', 'true')
  const fearsBox = win.getByRole('textbox', { name: 'Fears', exact: true })
  await expect(fearsBox).toBeFocused()
  await expect.poll(() => selectedInBox(win)).toBe('bell tower')
  await expect(fearsBox).toBeInViewport()

  // Private notes longer than their box: the page goes down to them and the box's own text to the words.
  await search(win, 'lighthouse keys')
  await expect(group(win, 'Notes').getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  const notesBox = win.getByRole('textbox', { name: 'Private notes (never sent to the AI)' })
  await expect(notesBox).toBeFocused()
  await expect.poll(() => selectedInBox(win)).toBe('lighthouse keys')
  await expect(notesBox).toBeInViewport()
  expect(await notesBox.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)

  // What the memory has about her over the story: that section opens, at the change.
  await search(win, 'mill fire')
  await expect(group(win, 'Characters').getByRole('option').first()).toContainText('Changes over time: Lost her left hand in the mill fire')
  await win.keyboard.press('Enter')
  await expect(win.getByRole('button', { name: /^Changes over time/ })).toHaveAttribute('aria-expanded', 'true')
  await expect(win.getByText('Lost her left hand in the mill fire', { exact: true })).toBeInViewport()

  // Mark scene done from another page, from the top bar's search box: back at the scene, the caret
  // is in the page (not on the search box), as when the binder opens a scene. Reopening it likewise.
  const searchBox = win.getByRole('banner').getByRole('button', { name: 'Search (Ctrl+K)' })
  await binder(win).getByRole('button', { name: 'Codex' }).click()
  await searchBox.click()
  await win.keyboard.type('mark scene done')
  await expect(palette(win).getByRole('option', { name: 'Mark scene done' })).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(prose(win)).toBeFocused()
  await expect.poll(async () => (await invoke(win, 'getOutline', story.id)).scenes[0].status).toBe('done')
  await binder(win).getByRole('button', { name: 'Codex' }).click()
  await searchBox.click()
  await win.keyboard.type('reopen')
  await expect(palette(win).getByRole('option', { name: 'Reopen this scene' })).toHaveAttribute('aria-selected', 'true')
  await win.keyboard.press('Enter')
  await expect(prose(win)).toBeFocused()
  await expect.poll(async () => (await invoke(win, 'getOutline', story.id)).scenes[0].status).not.toBe('done')
})

test('The top bar fits the smallest window with a long world name, on every page and with an update offered', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await resize(app, 960, 600)
  await invoke(win, 'updateWorld', { name: 'The Saltmarsh Chronicles of the Long Coast' })
  await win.reload()
  await prose(win).click()
  await win.keyboard.type('Rain on the roof all night long.')
  const bar = win.getByRole('banner')
  const count = bar.getByText('7 words', { exact: true })
  const searchBox = bar.getByRole('button', { name: 'Search (Ctrl+K)' })
  /** Everything fits: nothing pushed out of the bar, and the word count on one line. */
  const fits = async (): Promise<void> => {
    expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)
    if (await count.isVisible()) expect((await count.boundingBox())!.height).toBeLessThan(20)
  }
  await expect(count).toBeVisible()
  await expect(searchBox).toContainText('Search')
  await fits()

  // The search box is the same on another page (where the word count isn't shown).
  const writing = (await searchBox.boundingBox())!
  await binder(win).getByRole('button', { name: 'Codex' }).click()
  await expect(count).toHaveCount(0)
  expect((await searchBox.boundingBox())!.width).toBe(writing.width)
  await fits()
  await scenes(win).first().click()

  // An update offered in the middle of the bar: its buttons fit beside the word count.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('event:update:status', { state: 'ready', version: '9.9.9', notes: 'Faster saving' })
  })
  const restart = bar.getByRole('button', { name: 'Restart to update' })
  await expect(restart).toBeVisible()
  await expect(count).toBeVisible()
  await fits()
  expect((await restart.boundingBox())!.x + (await restart.boundingBox())!.width).toBeLessThanOrEqual((await count.boundingBox())!.x)
  expect((await searchBox.boundingBox())!.x + (await searchBox.boundingBox())!.width).toBeLessThanOrEqual(
    (await bar.getByRole('button', { name: 'Later' }).boundingBox())!.x
  )
})

