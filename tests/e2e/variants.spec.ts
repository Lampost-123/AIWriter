// Variants (milestone 4): two or three drafts of a scene written side by side from one briefing, then
// one used whole or paragraphs taken from several. Against the fake OpenAI-compatible server
// (tests/fake-provider/server.mjs), which writes the same prose for every draft: its paragraphs are
// told apart by their first words.
import type { ElectronApplication, Locator, Page } from '@playwright/test'
import type { FakeProvider } from '../fake-provider/server.mjs'
import type { TakeSnapshotInput } from '@shared/contracts/history'
import { binder, closeWindow, createWorldFromWelcome, expect, invoke, test } from './helpers'

const prose = (win: Page) => win.locator('.scene-prose')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
/** The message in the corner that says this. */
const toastSaying = (win: Page, text: string) => toasts(win).locator('> div').filter({ hasText: text })
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
const variantsButton = (win: Page) => win.getByRole('button', { name: 'Variants', exact: true })
const column = (win: Page, n: number) => win.getByRole('region', { name: `Variant ${n}`, exact: true })
const paragraphs = (win: Page, n: number) => column(win, n).getByRole('checkbox')
const choiceHeading = (win: Page) => win.getByRole('heading', { name: 'This scene already has text' })
const usePicked = (win: Page) => win.getByRole('button', { name: 'Use the picked paragraphs' })
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const draftRows = (win: Page) => win.getByRole('tabpanel', { name: 'Drafts' }).getByRole('button', { name: /What the AI saw/ })

/** The two don't overlap on screen (a message in the corner never covers the button, say). */
async function expectApart(a: Locator, b: Locator): Promise<void> {
  const [x, y] = [await a.boundingBox(), await b.boundingBox()]
  expect(x).not.toBeNull()
  expect(y).not.toBeNull()
  const apart = x!.x + x!.width <= y!.x || y!.x + y!.width <= x!.x || x!.y + x!.height <= y!.y || y!.y + y!.height <= x!.y
  expect(apart, `${JSON.stringify(x)} overlaps ${JSON.stringify(y)}`).toBe(true)
}

const OLD = ['Mara waited by the door, counting the knocks.', 'The tavern had gone quiet around her.']
/** The first words of the fake prose's first three paragraphs. */
const P1 = 'The rain had not let up since noon'
const P2 = 'She counted the doors from the corner'
const P3 = '"You came," he said'

async function fakeProvider(): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  // fake/slow writes about 360 words in small pieces, slowly enough to watch and to stop.
  return startFakeProvider({ delayMs: 2, words: 120, slowWords: 360, slowDelayMs: 30 })
}

/** Connects the fake server: `writer` drafts, and the memory keeper reads with fake/writer (so the two are counted apart). */
async function useModels(win: Page, fake: FakeProvider, writer: string): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  const choice = (modelId: string) => ({
    providerId: p.id,
    modelId,
    label: modelId,
    contextLength: 32000,
    promptPrice: null,
    completionPrice: null
  })
  await invoke(win, 'updateSettings', { models: { writer: choice(writer), memory: choice('fake/writer') } })
  await win.reload()
  await expect(prose(win)).toBeVisible()
}

/** A story with a first scene that has text, and "The knock" after it, with Adam's two paragraphs and a card. */
async function setUpScenes(win: Page): Promise<{ first: string; knock: string }> {
  const [story] = await invoke(win, 'listStories')
  const outline = await invoke(win, 'getOutline', story.id)
  const first = outline.scenes[0].id
  await invoke(win, 'saveSceneText', first, null, 'She left the docks at dusk, the rain at her back.')
  const knock = await invoke(win, 'createScene', outline.chapters[0].id, { title: 'The knock', afterId: first })
  const card = (await invoke(win, 'getScene', knock.id)).card
  await invoke(win, 'updateSceneCard', knock.id, { ...card, beats: ['Mara meets Tobin', 'Someone knocks at the door'], targetWords: 400 })
  await invoke(win, 'saveSceneText', knock.id, null, OLD.join('\n\n'))
  return { first, knock: knock.id }
}

/** Keeps what every snapshot is asked to keep (History keeps them; here it is only watched). */
async function watchSnapshots(app: ElectronApplication): Promise<() => Promise<TakeSnapshotInput[]>> {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as { snapshots: unknown[] }
    g.snapshots = []
    ipcMain.removeHandler('api:takeSnapshot')
    ipcMain.handle('api:takeSnapshot', (_e, input: unknown) => {
      g.snapshots.push(input)
      return { ok: true, value: null }
    })
  })
  return () => app.evaluate(() => (globalThis as unknown as { snapshots: TakeSnapshotInput[] }).snapshots)
}

const savedText = async (win: Page, sceneId: string): Promise<string> => (await invoke(win, 'getScene', sceneId)).text

test('three variants are written side by side from one briefing; one stops on its own; one replaces the scene and Ctrl+Z puts it back; paragraphs from two go in below; the set is there after a restart', async ({
  launch
}) => {
  const fake = await fakeProvider()
  try {
    const { app, win, dataDir } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { first, knock } = await setUpScenes(win)
    await useModels(win, fake, 'fake/slow')
    const snapshots = await watchSnapshots(app)
    await row(win, 'The knock').click()
    await expect(prose(win).locator('p')).toHaveText(OLD)

    // ----- Starting: how many, and a direction shared with Generate's draft options -----
    await variantsButton(win).click()
    await expect(win.getByRole('heading', { name: 'No variants of this scene yet' })).toBeVisible()
    await expect(win.getByRole('radio', { name: 'Three' })).toHaveAttribute('aria-checked', 'true')
    const direction = win.getByLabel('Direction for these drafts (optional)')
    await expect(direction).toBeFocused()
    await direction.fill('End on the knock.')
    fake.reset()
    await win.getByRole('button', { name: 'Write three variants' }).click()

    // ----- Three columns, each filling as its draft is written -----
    for (const n of [1, 2, 3]) await expect(column(win, n)).toContainText(P1)
    await expect(column(win, 1).getByRole('status')).toHaveText('Writing…')
    // Stop the second on its own: it keeps what it wrote; the others write on.
    await column(win, 2).getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(column(win, 2).locator('header')).toContainText('Stopped')
    await expect(column(win, 1).getByRole('status')).toHaveText('Writing…')
    await expect(column(win, 3).getByRole('status')).toHaveText('Writing…')
    const stoppedText = await column(win, 2).locator('[data-block]').allTextContents()
    await win.waitForTimeout(400)
    expect(await column(win, 2).locator('[data-block]').allTextContents()).toEqual(stoppedText)

    // Leaving the page leaves them writing; a message says when they are done, and takes Adam back to them.
    await win.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(prose(win)).toBeVisible()
    const written = toasts(win).getByText('The variants of “The knock” are written.')
    await expect(written).toBeVisible({ timeout: 30_000 })
    await toasts(win).getByRole('button', { name: 'Show them' }).click()
    await expect(win.getByRole('button', { name: 'New variants' })).toBeVisible()

    // ----- One briefing for the set: the memory caught up once, and each variant was sent the same -----
    const set = (await invoke(win, 'getVariantSet', knock))!
    expect(set.variants.map((v) => v.status)).toEqual(['complete', 'stopped', 'complete'])
    expect(set.direction).toBe('End on the knock.')
    expect(set.variants[1].text.length).toBeLessThan(set.variants[0].text.length)
    expect(fake.requestCounts()['fake/slow']).toBe(3)
    const records = await Promise.all(set.variants.map((v) => invoke(win, 'getGeneration', v.generationId)))
    for (const r of records) {
      expect(r.job).toBe('draft')
      expect(r.messages).toEqual(records[0].messages)
      expect(r.blocks).toEqual(records[0].blocks)
    }
    expect(records.map((r) => r.params.variant)).toEqual([1, 2, 3].map((index) => ({ setId: set.setId, index, of: 3 })))
    // Nothing went into the scene, and the memory never read the variants (the scene's text is as it was).
    expect(await savedText(win, knock)).toBe(OLD.join('\n\n'))

    // ----- Use this one: the scene has text, so it asks first, in Generate's words -----
    await column(win, 1).getByRole('button', { name: 'Use this one' }).click()
    await expect(choiceHeading(win)).toBeVisible()
    await expect(win.getByText('Where should the new draft go?')).toBeVisible()
    await expect(win.getByText('Either way, Ctrl+Z undoes it.')).toBeVisible()
    await win.getByRole('button', { name: 'Replace it', exact: true }).click()
    await expect(prose(win)).toBeVisible()
    await expect(prose(win)).toContainText(P1)
    await expect(prose(win)).not.toContainText(OLD[0])
    await expect(toasts(win).getByText("Variant 1 took the place of the scene's text. Ctrl+Z puts the old text back.")).toBeVisible()
    await expect.poll(async () => (await savedText(win, knock)).trim()).toBe(records[0].response.trim())
    // The scene was kept in its history first, as it was.
    await expect.poll(async () => (await snapshots()).length).toBe(1)
    const [kept] = await snapshots()
    expect(kept).toMatchObject({
      sceneId: knock,
      kind: 'ai',
      label: 'Before a variant',
      generationId: set.variants[0].generationId,
      text: OLD.join('\n\n')
    })

    // The keyboard is in the page: Ctrl+Z puts the old text back exactly.
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(OLD)
    await expect.poll(() => savedText(win, knock)).toBe(OLD.join('\n\n'))

    // ----- Paragraphs from two variants, in the order picked, below the scene's text -----
    await variantsButton(win).click()
    await expect(column(win, 3)).toContainText(P1)
    // The message about the last one is still in the corner: it never covers the page's main button.
    const replacedMessage = toastSaying(win, 'Variant 1 took the place of the scene')
    await expect(replacedMessage).toBeVisible()
    await expectApart(usePicked(win), replacedMessage)
    await paragraphs(win, 1).nth(1).click()
    await paragraphs(win, 3).nth(0).click()
    await expect(paragraphs(win, 1).nth(1)).toHaveAttribute('aria-checked', 'true')
    await expect(paragraphs(win, 1).nth(1)).toContainText('Picked, number 1.')
    await expect(paragraphs(win, 3).nth(0)).toContainText('Picked, number 2.')
    await expect(paragraphs(win, 1).nth(0)).toHaveAttribute('aria-checked', 'false')
    await expect(win.getByText('2 paragraphs picked')).toBeVisible()
    // Picked again, a paragraph is left out, and picked once more it goes last.
    await paragraphs(win, 3).nth(2).click()
    await expect(win.getByText('3 paragraphs picked')).toBeVisible()
    await expect(paragraphs(win, 3).nth(2)).toContainText('Picked, number 3.')
    await paragraphs(win, 3).nth(2).click()
    await expect(win.getByText('2 paragraphs picked')).toBeVisible()
    await expect(paragraphs(win, 3).nth(2)).toHaveAttribute('aria-checked', 'false')

    await usePicked(win).click()
    await expect(choiceHeading(win)).toBeVisible()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    await expect(prose(win)).toBeVisible()
    await expect(prose(win).locator('hr')).toHaveCount(1)
    const pageParagraphs = prose(win).locator('p')
    await expect(pageParagraphs).toHaveCount(4)
    await expect(pageParagraphs.nth(0)).toHaveText(OLD[0])
    await expect(pageParagraphs.nth(1)).toHaveText(OLD[1])
    await expect(pageParagraphs.nth(2)).toContainText(P2)
    await expect(pageParagraphs.nth(3)).toContainText(P1)
    await expect(prose(win)).not.toContainText(P3)
    await expect(
      toasts(win).getByText("The picked paragraphs went in below the scene's text, after a scene break. Ctrl+Z takes them out again.")
    ).toBeVisible()
    await expect.poll(() => savedText(win, knock)).toMatch(new RegExp(`^${OLD.join('\n\n')}\n\n\\* \\* \\*\n\n${P2}.*\n\n${P1}`))
    await expect.poll(async () => (await snapshots()).length).toBe(2)
    expect((await snapshots())[1]).toMatchObject({ sceneId: knock, label: 'Before a variant', generationId: null, text: OLD.join('\n\n') })
    // One Ctrl+Z takes them out again, scene break and all.
    await expect(prose(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(prose(win).locator('p')).toHaveText(OLD)
    await expect(prose(win).locator('hr')).toHaveCount(0)
    await expect.poll(() => savedText(win, knock)).toBe(OLD.join('\n\n'))
    // Still only the three drafts: using them sent nothing.
    expect(fake.requestCounts()['fake/slow']).toBe(3)

    // ----- After a restart: the scene's last set, from the records; a scene without any says so -----
    await closeWindow(app)
    const again = await launch({ dataDir })
    await expect(prose(again.win)).toBeVisible()
    await row(again.win, 'The knock').click()
    await variantsButton(again.win).click()
    for (const n of [1, 2, 3]) await expect(column(again.win, n)).toContainText(P1)
    await expect(column(again.win, 2).locator('header')).toContainText('Stopped')
    await expect(again.win.getByText('Direction: “End on the knock.”')).toBeVisible()
    await again.win.getByRole('button', { name: 'Back', exact: true }).click()
    await row(again.win, 'Scene 1').click()
    expect(await invoke(again.win, 'getVariantSet', first)).toBeNull()
    await variantsButton(again.win).click()
    await expect(again.win.getByRole('heading', { name: 'No variants of this scene yet' })).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('problems starting or writing variants are said in plain words, with the way to fix them; an empty scene takes a variant straight away', async ({
  launch
}) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id

    // No writer model yet: nothing is sent, and the fix is a click away. The problem shows below the
    // button just pressed, in sight, and the button stays in sight above it.
    await variantsButton(win).click()
    const writeThree = win.getByRole('button', { name: 'Write three variants' })
    await writeThree.click()
    const needModel = win.getByText('Choose a writer model first.', { exact: false })
    await expect(needModel).toBeVisible()
    await expect(needModel).toBeInViewport({ ratio: 1 })
    await expect(writeThree).toBeInViewport({ ratio: 1 })
    expect((await writeThree.boundingBox())!.y).toBeLessThan((await needModel.boundingBox())!.y)
    await win.getByRole('button', { name: 'Open Settings › Models' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'Models' })).toBeVisible()
    expect(Object.keys(fake.requestCounts())).toEqual([])

    // Out of credit: each variant says so, with the way to Settings, and the scene is untouched.
    await useModels(win, fake, 'fake/credit')
    await variantsButton(win).click()
    await win.getByRole('radio', { name: 'Two' }).click()
    await win.getByRole('button', { name: 'Write two variants' }).click()
    for (const n of [1, 2]) {
      await expect(column(win, n).getByText('out of credit', { exact: false })).toBeVisible()
      await expect(column(win, n).getByRole('button', { name: 'Open Settings' })).toBeVisible()
      await expect(column(win, n).getByRole('button', { name: 'Use this one' })).toBeDisabled()
    }
    await expect(column(win, 3)).toHaveCount(0)
    expect(await savedText(win, sceneId)).toBe('')

    // Too much for the model: each variant offers both fixes its message names, the length first.
    await useModels(win, fake, 'fake/toolong')
    await variantsButton(win).click()
    await win.getByRole('button', { name: 'New variants' }).click()
    await win.getByRole('button', { name: 'Write two variants' }).click()
    for (const n of [1, 2]) {
      await expect(column(win, n).getByText('too much for this model together', { exact: false })).toBeVisible()
      await expect(column(win, n).getByRole('button', { name: /^(Change the length|Open Settings)$/ })).toHaveText([
        'Change the length',
        'Open Settings'
      ])
    }
    // Change the length: the panel to start again, with the keyboard in the length box, ready to type.
    await column(win, 1).getByRole('button', { name: 'Change the length' }).click()
    const length = win.getByLabel('Length of each')
    await expect(length).toBeFocused()
    // The scene card's length shows, selected, so typing replaces it.
    await expect(length).toHaveValue('1500')
    const allSelected = () =>
      length.evaluate((el) => {
        const input = el as unknown as { selectionStart: number | null; selectionEnd: number | null; value: string }
        return input.selectionStart === 0 && input.selectionEnd === input.value.length
      })
    await expect.poll(allSelected).toBe(true)
    await win.keyboard.type('300')
    await expect(length).toHaveValue('300')
    expect(await savedText(win, sceneId)).toBe('')

    // Two is remembered for next time. With a model that writes, an empty scene takes a variant straight away.
    await useModels(win, fake, 'fake/writer')
    await variantsButton(win).click()
    await win.getByRole('button', { name: 'New variants' }).click()
    await expect(win.getByRole('radio', { name: 'Two' })).toHaveAttribute('aria-checked', 'true')
    await win.getByRole('button', { name: 'Write two variants' }).click()
    await expect(win.getByRole('button', { name: 'New variants' })).toBeVisible({ timeout: 30_000 })
    await column(win, 2).getByRole('button', { name: 'Use this one' }).click()
    await expect(choiceHeading(win)).toHaveCount(0)
    await expect(prose(win)).toContainText(P1)
    await expect(toasts(win).getByText('Variant 2 went into the scene. Ctrl+Z takes it out again.')).toBeVisible()
    // The message's Undo empties the scene again.
    await toasts(win).getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(prose(win)).not.toContainText(P1)
    await expect.poll(() => savedText(win, sceneId)).toBe('')
  } finally {
    await fake.close()
  }
})

test('while variants are being written the toolbar says so, from any page; Esc stops them all, keeping what they wrote; What the AI saw leads back to them', async ({
  launch
}) => {
  const fake = await fakeProvider()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { knock } = await setUpScenes(win)
    await useModels(win, fake, 'fake/slow')
    await row(win, 'The knock').click()
    await variantsButton(win).click()
    await win.getByRole('button', { name: 'Write three variants' }).click()
    for (const n of [1, 2, 3]) await expect(column(win, n)).toContainText(P1)

    // Back on the writing page, the Variants button shows they are still being written.
    await win.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(variantsButton(win)).toHaveAttribute('title', /being written now/)
    // Generate waits for them, and says so in words that name them; nothing goes into the page.
    await generateButton(win).click()
    await expect(choiceHeading(win)).toBeVisible()
    await win.getByRole('button', { name: 'Add below', exact: true }).click()
    await expect(
      toasts(win).getByText('Variants of this scene are being written. Stop them on the Variants page, or wait for them to finish.')
    ).toBeVisible()
    await expect(prose(win).locator('p')).toHaveText(OLD)
    await expect(generateButton(win)).toBeEnabled()
    await variantsButton(win).click()
    await expect(win.getByRole('button', { name: 'Stop all' })).toBeVisible()

    // Esc stops every one of them; what each wrote stays.
    await win.keyboard.press('Escape')
    await expect(win.getByRole('button', { name: 'New variants' })).toBeVisible()
    for (const n of [1, 2, 3]) {
      await expect(column(win, n).locator('header')).toContainText('Stopped')
      await expect(column(win, n)).toContainText(P1)
      await expect(column(win, n).getByRole('button', { name: 'Use this one' })).toBeEnabled()
    }
    // Each variant's "What the AI saw" is its own record, and Back goes back to the variants.
    await column(win, 2).getByRole('button', { name: 'What the AI saw' }).click()
    await expect(win.getByText('This variant was stopped before it finished. The text that arrived is kept with it.')).toBeVisible()
    await win.getByRole('button', { name: 'Back to the variants' }).click()
    await expect(column(win, 2).locator('header')).toContainText('Stopped')
    const set = (await invoke(win, 'getVariantSet', knock))!
    expect(set.variants.map((v) => v.status)).toEqual(['stopped', 'stopped', 'stopped'])
    expect(set.variants.every((v) => v.text.startsWith(P1))).toBe(true)
    await win.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(variantsButton(win)).toHaveAttribute('title', /side by side/)
    // Nothing went into the scene.
    expect(await savedText(win, knock)).toBe(OLD.join('\n\n'))

    // A variant's record opened from the Drafts tab goes back to the scene, where Adam came from.
    await win.getByRole('tab', { name: 'Drafts' }).click()
    await expect(draftRows(win)).toHaveCount(3)
    await draftRows(win).first().click()
    await expect(win.getByText('This variant was stopped before it finished.', { exact: false })).toBeVisible()
    await expect(win.getByRole('button', { name: 'Back to the variants' })).toHaveCount(0)
    await win.getByRole('button', { name: 'Back to “The knock”' }).click()
    await expect(prose(win).locator('p')).toHaveText(OLD)
  } finally {
    await fake.close()
  }
})
