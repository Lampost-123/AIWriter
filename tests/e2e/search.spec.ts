// Search and the command palette (Ctrl+K), and the keyboard shortcuts list (?): finding words in a
// scene, an entry by another name, a summary and a private note; running actions; and keyboard
// focus going back where it was.
import type { Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, test, useFakeModel } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const palette = (win: Page) => win.getByRole('dialog', { name: 'Search' })
const box = (win: Page) => win.getByRole('combobox', { name: 'Search, or find an action' })
const group = (win: Page, name: string) => palette(win).getByRole('group', { name, exact: true })
const scenes = (win: Page) => binder(win).locator('[data-row="scene"]')
const shortcutsList = (win: Page) => win.getByRole('dialog', { name: 'Keyboard shortcuts' })

/** The words selected in the window. */
const selectedText = (win: Page): Promise<string> => win.evaluate(() => String((globalThis as unknown as { getSelection(): unknown }).getSelection()))

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
