// Inside the manuscript (milestone 3): names of known entries underlined in the page, the hover card,
// Ctrl+click to show an entry beside the page, the Cast tab, "Add to memory" and "Quick start a
// character" from selected words, and a page that stays wide enough to read in a small window.
import type { ElectronApplication, Page } from '@playwright/test'
import { emptySceneCard } from '@shared/defaults'
import { binder, createWorldFromWelcome, expect, invoke, startFake, test, useFakeModel } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const names = (win: Page, entryId: string) => prose(win).locator(`.aw-name[data-name-of="${entryId}"]`)
const card = (win: Page) => win.getByRole('tooltip')
const scenePanel = (win: Page) => win.getByRole('complementary', { name: 'Scene panel' })
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const mod = process.platform === 'darwin' ? 'Meta' : 'Control'

const TEXT = [
  'Mara crossed the yard of the mill at dusk, her coat dark with rain.',
  'Tobin waited by the door. Mara Venn said nothing to him.',
  'A tall stranger called Jory Ashdown stood under the eaves, watching the road.',
  'Mara lost her temper with the bellows that night.'
]

interface World {
  sceneId: string
  storyId: string
  mara: string
  tobin: string
  mill: string
}

/** A world with two characters and a place, a change to Mara in the scene, a scene card and some text. */
async function setUp(win: Page): Promise<World> {
  await createWorldFromWelcome(win, 'Alpha')
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  const sceneId = scenes[0].id
  const mara = await invoke(win, 'createEntry', 'character', {
    name: 'Mara Venn',
    aliases: ['Mara'],
    summary: 'A smith’s daughter who keeps her own counsel.',
    fields: {
      speech: 'Short and plain',
      tics: 'Says “aye” to everything',
      neverSays: 'Sorry',
      sampleLines: '"Aye, I heard you."\n"Leave it."'
    },
    originStoryId: story.id
  })
  const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'The ferryman.', originStoryId: story.id })
  const mill = await invoke(win, 'createEntry', 'place', {
    name: 'The Mill',
    summary: 'A burned-out mill by the river.',
    originStoryId: story.id
  })
  await invoke(win, 'createChange', {
    kind: 'update',
    payload: { note: 'lost her left hand', fields: { marks: 'left hand missing' } },
    entryId: mara.id,
    anchor: 'scene',
    sceneId,
    storyId: story.id
  })
  await invoke(win, 'updateSceneCard', sceneId, { ...emptySceneCard(), povId: mara.id, presentIds: [tobin.id], locationId: mill.id })
  await invoke(win, 'saveSceneText', sceneId, null, TEXT.join('\n\n'))
  // The window reads the world afresh.
  await win.reload()
  await expect(prose(win)).toContainText('watching the road')
  return { sceneId, storyId: story.id, mara: mara.id, tobin: tobin.id, mill: mill.id }
}

/** Selects one paragraph of the page with the mouse. */
async function selectParagraph(win: Page, i: number): Promise<void> {
  await prose(win).locator('p').nth(i).click({ clickCount: 3 })
}

test('names in the page: underlines, the hover card, Ctrl+click beside the page, and the Cast tab', async ({ launch }) => {
  const { win } = await launch()
  const w = await setUp(win)

  // Underlined: the full name, the alias, and a place named in lower case ("the mill").
  await expect(names(win, w.mara)).toHaveCount(3)
  await expect(names(win, w.mara).nth(1)).toHaveText('Mara Venn')
  await expect(names(win, w.tobin)).toHaveText('Tobin')
  await expect(names(win, w.mill)).toHaveText('the mill')
  // Underlines are drawn over the text: the saved scene is just the words.
  expect((await invoke(win, 'getScene', w.sceneId)).text).toBe(TEXT.join('\n\n'))

  // Resting on a name shows its card, with how it stands as of this scene.
  await names(win, w.mara).first().hover()
  await expect(card(win)).toBeVisible()
  await expect(card(win)).toHaveAccessibleName('Mara Venn')
  await expect(card(win)).toContainText('A smith’s daughter')
  await expect(card(win)).toContainText('Lost her left hand · in this scene')
  await expect(card(win)).toContainText('Distinguishing marks: left hand missing')
  await expect(card(win)).toContainText(`${mod === 'Meta' ? '⌘' : 'Ctrl'}+click to open`)
  // Any key closes it.
  await win.keyboard.press('ArrowRight')
  await expect(card(win)).toBeHidden()

  // A plain click on a name only places the caret.
  await prose(win).locator('p').nth(3).click()
  await win.keyboard.press('End')
  await names(win, w.tobin).click()
  await expect(scenePanel(win).getByRole('tab', { name: 'Scene card' })).toBeVisible()

  // Ctrl+click shows the entry beside the page; the scene stays open and the caret where it was.
  await prose(win).locator('p').nth(3).click()
  await win.keyboard.press('End')
  await names(win, w.mara).first().click({ modifiers: [mod] })
  const peek = scenePanel(win).getByRole('region', { name: 'Mara Venn' })
  await expect(peek).toBeVisible()
  await expect(peek).toContainText('Lost her left hand')
  await expect(peek.getByRole('region', { name: 'Relationships' })).toContainText('No relationships yet.')
  await expect(peek.getByRole('region', { name: 'Voice' })).toContainText('Short and plain')
  await expect(peek.getByRole('region', { name: 'Voice' })).toContainText('“Aye, I heard you.”')
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type(' Still here.')
  await expect(prose(win).locator('p').nth(3)).toHaveText('Mara lost her temper with the bellows that night. Still here.')

  // Back to the tab Adam was on.
  await peek.getByRole('button', { name: 'Back to Scene card' }).click()
  await expect(scenePanel(win).getByRole('tab', { name: 'Scene card', selected: true })).toBeVisible()

  // The Cast tab: point of view, the others present, where, then anyone else named.
  await scenePanel(win).getByRole('tab', { name: 'Cast' }).click()
  const cast = scenePanel(win).getByRole('tabpanel', { name: 'Cast' })
  await expect(cast.getByRole('region', { name: 'Point of view' }).getByRole('button', { name: 'Mara Venn' })).toBeVisible()
  await expect(cast.getByRole('region', { name: 'Point of view' })).toContainText('Lost her left hand · in this scene')
  await expect(cast.getByRole('region', { name: 'Point of view' })).toContainText('How they speak: Short and plain')
  await expect(cast.getByRole('region', { name: 'Point of view' })).toContainText('Never says: Sorry')
  await expect(cast.getByRole('region', { name: 'Also in the scene' }).getByRole('button', { name: 'Tobin' })).toBeVisible()
  await expect(cast.getByRole('region', { name: 'Where' }).getByRole('button', { name: 'The Mill' })).toBeVisible()
  // Clicking one shows it beside the page, and Back returns to Cast.
  await cast.getByRole('button', { name: 'Tobin' }).click()
  await expect(scenePanel(win).getByRole('region', { name: 'Tobin' })).toContainText('The ferryman.')
  await expect(scenePanel(win).getByRole('button', { name: 'Back to Cast' })).toBeFocused()
  await win.keyboard.press('Escape')
  await expect(scenePanel(win).getByRole('tab', { name: 'Cast', selected: true })).toBeFocused()

  // Four tabs fit the panel at its narrowest, each label on one line.
  await invoke(win, 'updateSettings', { layout: { inspectorWidth: 260 } })
  await win.reload()
  await expect(scenePanel(win)).toBeVisible()
  await expect.poll(() => scenePanel(win).evaluate((el) => Math.round(el.getBoundingClientRect().width))).toBe(260)
  const fits = await win.evaluate(`(() => {
    const list = document.querySelector('[aria-label="Scene panel"] [role="tablist"]')
    const right = list.getBoundingClientRect().right
    return [...list.querySelectorAll('[role="tab"]')].map((t) => {
      const words = document.createRange()
      words.selectNodeContents(t)
      return t.getBoundingClientRect().right <= right + 0.5 && words.getClientRects().length === 1
    })
  })()`)
  expect(fits).toEqual([true, true, true, true])
})

test('Add to memory and Quick start from selected words', async ({ launch }) => {
  const { win } = await launch()
  const w = await setUp(win)
  const bar = win.getByRole('toolbar', { name: 'Selected words' })
  const form = win.getByRole('form', { name: 'Add to memory' })

  // Words about someone new: a new character, named from the words, the words as the description.
  await selectParagraph(win, 2)
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: 'Add to memory' }).click()
  await expect(form.getByRole('heading', { name: 'New character' })).toBeVisible()
  await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('Jory Ashdown')
  await expect(form.getByRole('textbox', { name: 'Description' })).toHaveValue(TEXT[2])
  await form.getByRole('button', { name: 'Add to memory' }).click()
  await expect(form).toBeHidden()
  await expect(toasts(win)).toContainText('Added Jory Ashdown to your characters.')
  const jory = (await invoke(win, 'listEntries', 'character')).find((e) => e.name === 'Jory Ashdown')
  expect(jory?.description).toBe(TEXT[2])
  // The new name is underlined straight away, and the caret is back in the page.
  await expect(names(win, jory!.id)).toHaveText('Jory Ashdown')
  await expect(prose(win)).toBeFocused()

  // Words that name someone known: a change to them, pinned to this scene.
  await selectParagraph(win, 3)
  await bar.getByRole('button', { name: 'Add to memory' }).click()
  await expect(form.getByRole('heading', { name: 'A change to Mara Venn' })).toBeVisible()
  await expect(form.getByRole('textbox', { name: 'What changed' })).toHaveValue(TEXT[3])
  await form.getByRole('textbox', { name: 'What changed' }).fill('Lost her temper with the bellows.')
  await win.keyboard.press(`${mod}+Enter`)
  await expect(toasts(win)).toContainText('Added to memory for Mara Venn: “Lost her temper with the bellows.”')
  const changes = await invoke(win, 'listChanges', w.mara)
  expect(changes.find((c) => c.kind === 'update' && c.payload.note === 'Lost her temper with the bellows.')).toMatchObject({
    anchor: 'scene',
    sceneId: w.sceneId,
    origin: 'adam'
  })
  // Ctrl+Enter in the form saved it, and didn't also mark the scene done.
  expect((await invoke(win, 'getScene', w.sceneId)).status).not.toBe('done')

  // Esc closes the bar and leaves the words selected.
  await selectParagraph(win, 0)
  await expect(bar).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(bar).toBeHidden()
  expect(await win.evaluate('window.getSelection().toString()')).toContain('Mara crossed the yard')

  // Quick start a character opens the builder with the passage.
  await selectParagraph(win, 2)
  await bar.getByRole('button', { name: 'Quick start a character' }).click()
  await expect(prose(win)).toBeHidden()
  // (The builder shows the passage in its Quick start notes; its own tests check what it does with them.)
  const passage = JSON.stringify(TEXT[2])
  await expect
    .poll(() =>
      win.evaluate(
        `document.body.innerText.includes('The builder is on its way.') || [...document.querySelectorAll('textarea')].some((t) => t.value.includes(${passage}))`
      )
    )
    .toBe(true)
})

test('Ctrl+Enter and Esc still work with a hover card open', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    const w = await setUp(win)
    await useFakeModel(win, fake, 'fake/slow')
    await expect(names(win, w.tobin)).toHaveCount(1)

    // Esc stops a draft being written, with a card open over a name above it.
    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await expect(win.locator('main header').getByRole('button', { name: 'Stop' })).toBeVisible()
    await expect(prose(win).locator('hr')).toHaveCount(1)
    await names(win, w.tobin).hover()
    await expect(card(win)).toBeVisible()
    await win.keyboard.press('Escape')
    await expect.poll(async () => (await invoke(win, 'listGenerations', w.sceneId))[0]?.status).toBe('stopped')
    await expect(card(win)).toBeHidden()

    // Ctrl+Enter marks the scene done, with a card open.
    await prose(win).locator('p').first().click()
    await names(win, w.tobin).hover()
    await expect(card(win)).toBeVisible()
    await win.keyboard.press(`${mod}+Enter`)
    await expect.poll(async () => (await invoke(win, 'getScene', w.sceneId)).status).toBe('done')
  } finally {
    await fake.close()
  }
})

/** Sets the size of the window's inside (the page Adam sees) and waits for the panels to settle. */
async function resize(app: ElectronApplication, win: Page, width: number, height: number): Promise<void> {
  await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [width, height])
  await expect.poll(() => win.evaluate('window.innerWidth')).toBe(width)
  // The panels follow the window straight away while it is resized, then settle.
  await win.waitForTimeout(400)
}

/** How many characters each full line of the first paragraph holds (the last line, which is short, left out). */
async function charsPerLine(win: Page): Promise<number[]> {
  return win.evaluate(`(() => {
    const text = document.querySelector('.scene-prose p').firstChild
    const range = document.createRange()
    const lines = new Map()
    for (let i = 0; i < text.textContent.length; i++) {
      range.setStart(text, i)
      range.setEnd(text, i + 1)
      const r = range.getClientRects()[0]
      if (!r) continue
      const top = Math.round(r.top)
      lines.set(top, (lines.get(top) ?? 0) + 1)
    }
    return [...lines.values()].slice(0, -1)
  })()`)
}

/** The page's own padding either side of the words. */
const pagePadding = (win: Page): Promise<string> =>
  win.evaluate(`getComputedStyle(document.querySelector('.scene-prose').parentElement.parentElement).paddingLeft`)

const LONG =
  'The harbour lamps burned low while the fishermen hauled their nets across the slick stones, and Mara watched the water ' +
  'turn from grey to black as the tide came in under the pier. Nobody on the quay spoke of the fire, though every one of them ' +
  'had smelled the smoke from the mill on the far bank, and every one of them knew whose name would be said first in the morning.'

test('a small window keeps the page wide enough to read, and the binder floats over it', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const [story] = await invoke(win, 'listStories')
  const { scenes, chapters } = await invoke(win, 'getOutline', story.id)
  await invoke(win, 'updateScene', scenes[0].id, { title: 'The Knock at the Door' })
  await invoke(win, 'saveSceneText', scenes[0].id, null, LONG)
  await invoke(win, 'createScene', chapters[0].id, { title: 'The Ferry' })
  const before = (await invoke(win, 'getSettings')).layout
  await win.reload()
  await expect(prose(win)).toContainText('The harbour lamps')
  const title = win.locator('main header').getByRole('button', { name: 'The Knock at the Door' })
  const notCutShort = () => title.evaluate((el) => el.scrollWidth <= el.clientWidth)

  // A 1366 px laptop at 125%: both panels beside the page, squeezed, and the page keeps its room.
  await resize(app, win, 1093, 700)
  await expect(binder(win)).toBeVisible()
  await expect(scenePanel(win)).toBeVisible()
  let lines = await charsPerLine(win)
  expect(lines.length).toBeGreaterThan(1)
  expect(Math.min(...lines)).toBeGreaterThanOrEqual(55)
  expect(await notCutShort()).toBe(true)
  // The page's own padding is trimmed when it is narrow.
  expect(await pagePadding(win)).toBe('24px')

  // The smallest window: no room for both panels, so the binder floats over the page when asked for.
  await resize(app, win, 960, 600)
  await expect(binder(win)).toBeHidden()
  await expect(scenePanel(win)).toBeVisible()
  lines = await charsPerLine(win)
  expect(Math.min(...lines)).toBeGreaterThanOrEqual(55)
  expect(await notCutShort()).toBe(true)

  const binderButton = win.getByRole('button', { name: 'Show or hide the binder' })
  await binderButton.click()
  await expect(binder(win)).toBeVisible()
  // Over the page: the page doesn't move.
  expect(await charsPerLine(win)).toEqual(lines)
  await win.keyboard.press('Escape')
  await expect(binder(win)).toBeHidden()
  await expect(binderButton).toBeFocused()
  // Picking a scene in it closes it.
  await binderButton.click()
  await binder(win).locator('[data-row]', { hasText: 'The Ferry' }).click()
  await expect(binder(win)).toBeHidden()
  await expect(win.locator('main header').getByRole('button', { name: 'The Ferry' })).toBeVisible()
  // So does a click outside it.
  await binderButton.click()
  await expect(binder(win)).toBeVisible()
  await prose(win).click()
  await expect(binder(win)).toBeHidden()
  // The saved layout is as it was.
  expect((await invoke(win, 'getSettings')).layout).toEqual(before)

  // A wider window: the binder is back beside the page.
  await resize(app, win, 1440, 900)
  await expect(binder(win)).toBeVisible()
  expect(await pagePadding(win)).toBe('40px')
})

test('a squeezed panel is dragged from where it shows, and stays where it is let go', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  await resize(app, win, 1200, 800)
  const width = () => binder(win).evaluate((el) => Math.round(el.getBoundingClientRect().width))
  const shown = await width()
  // Squeezed below the 272 px it was given, so the page keeps its room.
  expect(shown).toBeLessThan(272)
  const handle = binder(win).getByRole('separator')
  const box = (await handle.boundingBox())!
  await win.mouse.move(box.x + box.width / 2, box.y + 200)
  await win.mouse.down()
  // The first movement starts from where it shows: no jump.
  await win.mouse.move(box.x + box.width / 2 - 1, box.y + 200)
  expect(Math.abs((await width()) - (shown - 1))).toBeLessThanOrEqual(1)
  await win.mouse.move(box.x + box.width / 2 - 30, box.y + 200, { steps: 5 })
  await win.mouse.up()
  await win.waitForTimeout(400)
  expect(Math.abs((await width()) - (shown - 30))).toBeLessThanOrEqual(1)
})
