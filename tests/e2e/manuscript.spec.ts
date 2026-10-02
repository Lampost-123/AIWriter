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

  // Clicking the card shows the entry beside the page too, even where the card hangs below the last
  // line of the scene, and the caret stays where it was.
  await prose(win).locator('p').first().click()
  await win.keyboard.press('Home')
  await names(win, w.mara).last().hover()
  await expect(card(win)).toBeVisible()
  const words = (await prose(win).boundingBox())!
  const cardBox = (await card(win).boundingBox())!
  expect(cardBox.y + cardBox.height - 12).toBeGreaterThan(words.y + words.height)
  await card(win).click({ position: { x: 24, y: cardBox.height - 12 } })
  await expect(peek).toBeVisible()
  await expect(card(win)).toBeHidden()
  await expect(prose(win)).toBeFocused()
  await win.keyboard.type('So. ')
  await expect(prose(win).locator('p').first()).toHaveText(`So. ${TEXT[0]}`)
  await expect(prose(win).locator('p').nth(3)).toHaveText('Mara lost her temper with the bellows that night. Still here.')
  await peek.getByRole('button', { name: 'Back to Scene card' }).click()

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
  // Open on the toast shows the new character beside the page.
  await toasts(win).getByRole('button', { name: 'Open' }).click()
  await expect(scenePanel(win).getByRole('region', { name: 'Jory Ashdown' })).toBeVisible()
  await scenePanel(win).getByRole('button', { name: 'Back to Scene card' }).click()

  // Words that name someone known: a change to them, pinned to this scene.
  await selectParagraph(win, 3)
  await bar.getByRole('button', { name: 'Add to memory' }).click()
  await expect(form.getByRole('heading', { name: 'A change to Mara Venn' })).toBeVisible()
  await expect(form.getByRole('textbox', { name: 'What changed' })).toHaveValue(TEXT[3])
  await form.getByRole('textbox', { name: 'What changed' }).fill('Lost her temper with the bellows.')
  await win.keyboard.press(`${mod}+Enter`)
  // Added while the first one's toast still shows: that toast says both (see the next test).
  await expect(toasts(win)).toContainText('Added 2 things to memory.')
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

  // Opened from the last lines of the scene, the form hangs below the words. Its parts work with the
  // mouse there too: the form stays open, and the scene's words and the selection are left alone.
  await selectParagraph(win, 3)
  await bar.getByRole('button', { name: 'Add to memory' }).click()
  await expect(form.getByRole('heading', { name: 'A change to Mara Venn' })).toBeVisible()
  const words = (await prose(win).boundingBox())!
  const somethingNew = form.getByRole('radio', { name: 'Something new' })
  expect((await somethingNew.boundingBox())!.y).toBeGreaterThan(words.y + words.height)
  await somethingNew.click()
  await expect(form.getByRole('heading', { name: 'New character' })).toBeVisible()
  await form.getByRole('combobox', { name: 'Kind' }).click()
  await win.getByRole('option', { name: 'Place' }).click()
  await expect(form.getByRole('heading', { name: 'New place' })).toBeVisible()
  await form.getByRole('textbox', { name: 'Name' }).click()
  await win.keyboard.type('The Forge')
  await expect(form.getByRole('textbox', { name: 'Name' })).toHaveValue('The Forge')
  await form.getByRole('textbox', { name: 'Description' }).click()
  await expect(form.getByRole('textbox', { name: 'Description' })).toBeFocused()
  await form.getByRole('radio', { name: 'A change' }).click()
  await form.getByRole('textbox', { name: 'What changed' }).click()
  await expect(form.getByRole('textbox', { name: 'What changed' })).toBeFocused()
  await form.getByRole('button', { name: 'Cancel' }).click()
  await expect(form).toBeHidden()
  await expect(prose(win)).toBeFocused()
  expect(await win.evaluate('window.getSelection().toString()')).toContain('Mara lost her temper')
  expect((await invoke(win, 'getScene', w.sceneId)).text).toBe(TEXT.join('\n\n'))

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

test('quick adds share one toast: Undo takes them all back, and Open shows the latest, beside the page or on its own page', async ({
  launch
}) => {
  const { win } = await launch()
  const w = await setUp(win)
  const bar = win.getByRole('toolbar', { name: 'Selected words' })
  const form = win.getByRole('form', { name: 'Add to memory' })
  const undoButtons = toasts(win).getByRole('button', { name: 'Undo' })
  const addChange = async (note: string): Promise<void> => {
    await selectParagraph(win, 3)
    await bar.getByRole('button', { name: 'Add to memory' }).click()
    await form.getByRole('textbox', { name: 'What changed' }).fill(note)
    await win.keyboard.press(`${mod}+Enter`)
    await expect(form).toBeHidden()
    // Back in the page with the words still selected; the next add selects afresh.
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('ArrowRight')
  }

  // Something new, shown beside the page from its toast.
  await selectParagraph(win, 2)
  await bar.getByRole('button', { name: 'Add to memory' }).click()
  await form.getByRole('button', { name: 'Add to memory' }).click()
  await expect(toasts(win)).toContainText('Added Jory Ashdown to your characters.')
  await toasts(win).getByRole('button', { name: 'Open' }).click()
  await expect(scenePanel(win).getByRole('region', { name: 'Jory Ashdown' })).toBeVisible()

  // Two more while that toast shows: one toast says all three, so they never pile up over the page.
  await addChange('Lost her temper with the bellows.')
  await addChange('Swore never to go back to the mill.')
  await expect(toasts(win)).toContainText('Added 3 things to memory.')
  await expect(undoButtons).toHaveCount(1)
  // Its Open shows the latest.
  await toasts(win).getByRole('button', { name: 'Open' }).click()
  await expect(scenePanel(win).getByRole('region', { name: 'Mara Venn' })).toBeVisible()
  await scenePanel(win).getByRole('button', { name: 'Back to Scene card' }).click()
  await toasts(win).getByRole('button', { name: 'Open' }).click()
  await expect(scenePanel(win).getByRole('region', { name: 'Mara Venn' })).toBeVisible()
  await scenePanel(win).getByRole('button', { name: 'Back to Scene card' }).click()

  // Undo takes all three back. A new entry shown beside the page goes from there quietly, rather than
  // saying it isn't in the world any more.
  const jory = (await invoke(win, 'listEntries', 'character')).find((e) => e.name === 'Jory Ashdown')!
  await names(win, jory.id).click({ modifiers: [mod] })
  await expect(scenePanel(win).getByRole('region', { name: 'Jory Ashdown' })).toBeVisible()
  await undoButtons.click()
  await expect(scenePanel(win).getByRole('tab', { name: 'Scene card', selected: true })).toBeVisible()
  await expect(scenePanel(win).getByText('Not in your world any more')).toHaveCount(0)
  await expect.poll(async () => (await invoke(win, 'listEntries', 'character')).map((e) => e.name).sort()).toEqual(['Mara Venn', 'Tobin'])
  await expect
    .poll(async () => (await invoke(win, 'listChanges', w.mara)).filter((c) => c.kind === 'update' && c.anchor === 'scene').length)
    .toBe(1)

  // From another page, Open goes to the entry's own page (the scene panel isn't there to show it).
  await addChange('Sold the bellows.')
  await binder(win).getByRole('button', { name: 'Codex' }).click()
  await toasts(win).getByRole('button', { name: 'Open' }).click()
  await expect(win.locator('main').getByRole('textbox', { name: 'Name' })).toHaveValue('Mara Venn')
})

test('words the app selects to show where a fact came from aren’t offered for Add to memory again', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch({ env: { AIWRITE_KEEPER_QUIET_MS: '700' } })
    await createWorldFromWelcome(win, 'Alpha')
    await useFakeModel(win, fake)
    await prose(win).click()
    await win.keyboard.type('The ferry was late. Mara lost her left hand.')
    // The memory reads the words, and What changed shows where the fact came from.
    const quoted = async () => (await invoke(win, 'listMemoryLog', {})).find((l) => l.what === 'change' && l.quote)?.quote ?? ''
    await expect.poll(quoted, { timeout: 30_000 }).toContain('left hand')
    const quote = (await quoted()).trim()
    await binder(win).getByRole('button', { name: 'What changed' }).click()
    await win.locator('main').getByTitle('Show these words in the scene').filter({ hasText: 'left hand' }).click()

    // The scene opens with those words selected, and no bar offers to add them to memory.
    await expect(prose(win)).toBeFocused()
    await expect.poll(() => win.evaluate('window.getSelection().toString()')).toBe(quote)
    const bar = win.getByRole('toolbar', { name: 'Selected words' })
    await win.waitForTimeout(1000)
    await expect(bar).toBeHidden()
    // A selection Adam makes himself is offered as usual.
    await win.keyboard.press('Shift+ArrowLeft')
    await expect(bar).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('Ctrl+Enter and Esc still work with a hover card open', async ({ launch }) => {
  const fake = await startFake()
  try {
    const { win } = await launch()
    const w = await setUp(win)
    await useFakeModel(win, fake, 'fake/slow')
    await expect(names(win, w.tobin)).toHaveCount(1)

    // Esc stops a draft being written, with a card open over a name above it. The scene has text, so
    // Generate asks where the draft goes: below it.
    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
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

test('with a draft being written, Esc on the Selected words bar or the floating binder closes only that, and Ctrl+G under the Add to memory form does nothing', async ({
  launch
}) => {
  const fake = await startFake()
  try {
    const { app, win } = await launch()
    const w = await setUp(win)
    await useFakeModel(win, fake, 'fake/slow')
    const bar = win.getByRole('toolbar', { name: 'Selected words' })
    const form = win.getByRole('form', { name: 'Add to memory' })
    const stop = win.locator('main header').getByRole('button', { name: 'Stop' })
    const status = async (): Promise<string | undefined> => (await invoke(win, 'listGenerations', w.sceneId))[0]?.status

    // Ctrl+G with the form open: no draft, no question about the scene's text, and the form keeps what Adam typed.
    await selectParagraph(win, 3)
    await bar.getByRole('button', { name: 'Add to memory' }).click()
    await form.getByRole('textbox', { name: 'What changed' }).fill('She hates the mill')
    await win.keyboard.press(`${mod}+g`)
    await win.waitForTimeout(500)
    await expect(form.getByRole('textbox', { name: 'What changed' })).toHaveValue('She hates the mill')
    await expect(win.getByRole('button', { name: 'Add below', exact: true })).toHaveCount(0)
    expect(await invoke(win, 'listGenerations', w.sceneId)).toEqual([])
    await form.getByRole('button', { name: 'Cancel' }).click()
    await expect(form).toBeHidden()

    // A draft being written below Adam's text. Esc with the bar showing over his words closes the bar,
    // and the draft carries on; the next Esc stops it, as Stop says.
    await win.locator('main header').getByRole('button', { name: 'Generate', exact: true }).click()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    await expect(stop).toBeVisible()
    await selectParagraph(win, 0)
    await expect(bar).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(bar).toBeHidden()
    await win.waitForTimeout(1000)
    expect(await status()).toBe('streaming')
    await expect(stop).toBeVisible()
    await win.keyboard.press('Escape')
    await expect.poll(status).toBe('stopped')

    // The same with the binder floating over the page in the smallest window: it opens with the keyboard
    // on the scene's row, and its Esc closes it while the draft carries on.
    await resize(app, win, 960, 600)
    await win.getByRole('button', { name: 'Show or hide the binder' }).click()
    await expect(binder(win)).toBeVisible()
    await expect(binder(win).locator('[data-row="scene"]')).toBeFocused()
    await win.keyboard.press(`${mod}+g`)
    await win.keyboard.press('Enter')
    await expect(stop).toBeVisible()
    await expect(prose(win)).toBeFocused()
    await expect(binder(win)).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(binder(win)).toBeHidden()
    await win.waitForTimeout(1000)
    expect((await invoke(win, 'listGenerations', w.sceneId)).map((g) => g.status)).toEqual(['streaming', 'stopped'])
    await win.keyboard.press('Escape')
    await expect.poll(status).toBe('stopped')
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
  // The button looks pressed only while the floating binder shows.
  const pressed = /(^|\s)bg-surface-2(\s|$)/
  await expect(binderButton).not.toHaveClass(pressed)
  await binderButton.click()
  await expect(binder(win)).toBeVisible()
  await expect(binderButton).toHaveClass(pressed)
  // The keyboard is on the open scene's row, so the arrows and Enter work straight away.
  await expect(binder(win).locator('[data-row]', { hasText: 'The Knock at the Door' })).toBeFocused()
  await win.keyboard.press('ArrowDown')
  await expect(binder(win).locator('[data-row]', { hasText: 'The Ferry' })).toBeFocused()
  // Over the page: the page doesn't move.
  expect(await charsPerLine(win)).toEqual(lines)
  await win.keyboard.press('Escape')
  await expect(binder(win)).toBeHidden()
  await expect(binderButton).not.toHaveClass(pressed)
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

  // Large text in the smallest window: the page can't be given its full minimum, so it keeps the
  // narrow padding and leaves that room to the words.
  await binder(win).locator('[data-row]', { hasText: 'The Knock at the Door' }).click()
  await invoke(win, 'updateSettings', { editor: { ...(await invoke(win, 'getSettings')).editor, fontSize: 22 } })
  await win.reload()
  await expect(prose(win)).toContainText('The harbour lamps')
  await resize(app, win, 960, 600)
  expect(await pagePadding(win)).toBe('24px')
  expect(Math.min(...(await charsPerLine(win)))).toBeGreaterThanOrEqual(55)
})

const MANY = Array.from({ length: 13 }, (_, i) =>
  i % 3 === 1
    ? `Mara walked the long road past the mill again, counting the stones and saying nothing to anyone (${i + 1}).`
    : `The rain kept on over the valley while the river rose against the old stone banks, and nobody slept (${i + 1}).`
)

test('the Add to memory form fits the smallest window, and stays where it opened while in use', async ({ launch }) => {
  const { app, win } = await launch()
  await createWorldFromWelcome(win, 'Alpha')
  const [story] = await invoke(win, 'listStories')
  const { scenes } = await invoke(win, 'getOutline', story.id)
  await invoke(win, 'createEntry', 'character', { name: 'Mara Venn', aliases: ['Mara'], originStoryId: story.id })
  await invoke(win, 'saveSceneText', scenes[0].id, null, MANY.join('\n\n'))
  await win.reload()
  await expect(prose(win)).toContainText('(13)')
  await resize(app, win, 960, 600)
  const bar = win.getByRole('toolbar', { name: 'Selected words' })
  const form = win.getByRole('form', { name: 'Add to memory' })
  const popUp = win.locator('[data-add-to-memory]')
  const top = async () => (await popUp.boundingBox())!.y
  // The form grows in from slightly smaller as it opens: it is measured once it rests.
  const grownIn = `Promise.all(document.querySelector('[data-add-to-memory]').getAnimations().map((a) => a.finished)).then(() => true)`

  /** Selects paragraph i with its top `y` px down the window (or the page scrolled to its end), and opens the form for it. */
  async function openFrom(i: number, y: number | 'end'): Promise<void> {
    await win.evaluate(`(() => {
      const scroller = document.querySelector('.scene-prose').closest('.overflow-y-auto')
      const top = document.querySelectorAll('.scene-prose p')[${i}].getBoundingClientRect().top
      scroller.scrollTop = ${y === 'end' ? 'scroller.scrollHeight' : `Math.round(scroller.scrollTop + top - ${y})`}
    })()`)
    await selectParagraph(win, i)
    expect(await win.evaluate('window.getSelection().toString()')).toBe(MANY[i])
    await bar.getByRole('button', { name: 'Add to memory' }).click()
    await expect(form).toBeVisible()
    await win.evaluate(grownIn)
  }

  /** The form lies inside the window, its heading, box to type in and buttons all in view, the box at least two lines tall. */
  async function inView(box: string): Promise<void> {
    const outer = (await popUp.boundingBox())!
    expect(outer.y).toBeGreaterThanOrEqual(0)
    expect(outer.y + outer.height).toBeLessThanOrEqual(600)
    expect(outer.x).toBeGreaterThanOrEqual(0)
    expect(outer.x + outer.width).toBeLessThanOrEqual(960)
    const heading = (await form.getByRole('heading').boundingBox())!
    const text = (await form.getByRole('textbox', { name: box }).boundingBox())!
    const save = (await form.getByRole('button', { name: 'Add to memory' }).boundingBox())!
    expect(heading.y).toBeGreaterThanOrEqual(outer.y)
    expect(text.y).toBeGreaterThan(heading.y + heading.height)
    expect(text.height).toBeGreaterThanOrEqual(50)
    expect(save.y).toBeGreaterThan(text.y + text.height)
    expect(save.y + save.height).toBeLessThanOrEqual(outer.y + outer.height)
  }

  // Words in the middle of the page: there's room for the form on neither side of the bar, so it
  // takes the side with more room and covers the bar rather than leave the window or hide its parts.
  await openFrom(7, 300)
  await expect(form.getByRole('heading', { name: 'A change to Mara Venn' })).toBeVisible()
  await inView('What changed')
  const [barBox, formBox] = [(await bar.boundingBox())!, (await popUp.boundingBox())!]
  expect(formBox.y < barBox.y + barBox.height && formBox.y + formBox.height > barBox.y).toBe(true)
  // Switching between the two kinds of form, and typing, never move it.
  const at = await top()
  await form.getByRole('radio', { name: 'Something new' }).click()
  await expect(form.getByRole('heading', { name: 'New character' })).toBeVisible()
  await inView('Description')
  expect(await top()).toBe(at)
  await form.getByRole('radio', { name: 'A change' }).click()
  await form.getByRole('textbox', { name: 'What changed' }).click()
  await win.keyboard.press(mod === 'Meta' ? 'Meta+ArrowDown' : 'Control+End')
  for (const line of [' and on,', 'and on,', 'and on.']) {
    await win.keyboard.type(line)
    await win.keyboard.press('Enter')
  }
  await expect(form.getByRole('textbox', { name: 'What changed' })).toHaveValue(`${MANY[7]} and on,\nand on,\nand on.\n`)
  expect(await top()).toBe(at)
  await inView('What changed')
  await win.keyboard.press('Escape')
  await expect(form).toBeHidden()
  await win.keyboard.press('Escape')
  await expect(bar).toBeHidden()

  // The last words of the scene, in both kinds of form.
  await openFrom(12, 'end')
  await expect(form.getByRole('heading', { name: 'New character' })).toBeVisible()
  await inView('Description')
  await form.getByRole('radio', { name: 'A change' }).click()
  await inView('What changed')
  await win.keyboard.press('Escape')
  await expect(form).toBeHidden()
  // Nothing was added, and the scene's words are as they were.
  expect((await invoke(win, 'getScene', scenes[0].id)).text).toBe(MANY.join('\n\n'))
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
