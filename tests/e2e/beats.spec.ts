// Beat by beat (milestone 4): the scene written one beat of its card at a time, pausing after each so
// Adam can steer the next from the bar over the page. Against the fake OpenAI-compatible server
// (tests/fake-provider/server.mjs), whose usual prose answers every beat.
import type { ElectronApplication, Page } from '@playwright/test'
import type { FakeProvider, FakeProviderOptions } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

const BEATS = ['Mara meets Tobin at the Gilded Eel.', 'Tobin asks for the ledger.', 'Someone knocks at the door.']
const OLD = ['Adam wrote this.', 'And this, his second paragraph.']
const NOTE = 'Make Tobin stall before he asks.'
const AGAIN = 'Let Mara answer with a question.'
/** A long scene, so its end is far out of sight from its top. */
const LONG = Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of an old draft, long enough to take up a line or two of the page.`).join(
  '\n\n'
)

const prose = (win: Page) => win.locator('.scene-prose')
const toasts = (win: Page) => win.locator('div.fixed[aria-live="polite"]')
const header = (win: Page) => win.locator('main header')
const beatsButton = (win: Page) => header(win).getByRole('button', { name: 'Beat by beat', exact: true })
const generateButton = (win: Page) => header(win).getByRole('button', { name: 'Generate', exact: true })
const bar = (win: Page) => win.locator('[data-beat-bar]')
const status = (win: Page) => bar(win).getByRole('status')
const box = (win: Page) => bar(win).getByRole('textbox')
const barButton = (win: Page, name: string) => bar(win).getByRole('button', { name, exact: true })
const choiceHeading = (win: Page) => win.getByRole('heading', { name: 'This scene already has text' })
const addBelow = (win: Page) => win.getByRole('button', { name: 'Add below', exact: true })
const noBeatsHeading = (win: Page) => win.getByRole('heading', { name: "This scene's card has no beats yet" })
const row = (win: Page, title: string) => binder(win).locator('[data-row]', { hasText: title }).first()
const palette = (win: Page) => win.getByRole('dialog', { name: 'Search' })
const scroller = (win: Page) => prose(win).locator('xpath=ancestor::div[contains(@class, "overflow-y-auto")][1]')
const pointer = (win: Page, name: string) => bar(win).getByRole('button', { name, exact: true })

type Shown = { getBoundingClientRect(): { left: number; top: number; width: number; height: number }; contains(other: unknown): boolean }
type WindowGlobals = { document: { elementFromPoint(x: number, y: number): unknown } }

/** True when nothing covers the middle of what `el` shows (it can be seen and clicked). Runs in the window. */
const onTop = (el: Shown): boolean => {
  const r = el.getBoundingClientRect()
  const top = (globalThis as unknown as WindowGlobals).document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  return !!top && el.contains(top)
}

type Snapshots = { snapshots?: string[] }

/** Notes each snapshot the app takes of a scene (by its label), in place of keeping it. */
async function watchSnapshots(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as unknown as Snapshots
    g.snapshots = []
    ipcMain.removeHandler('api:takeSnapshot')
    ipcMain.handle('api:takeSnapshot', (_e, input: { label: string }) => {
      g.snapshots!.push(input.label)
      return { ok: true, value: null }
    })
  })
}
const snapshots = (app: ElectronApplication): Promise<string[]> => app.evaluate(() => (globalThis as unknown as Snapshots).snapshots ?? [])

async function fakeProvider(options: FakeProviderOptions = {}): Promise<FakeProvider> {
  const { startFakeProvider } = await import('../fake-provider/server.mjs')
  return startFakeProvider({ delayMs: 5, ...options })
}

/** Connects the fake server and makes `modelId` the writer model, then reloads so the window reads it (and the card). */
async function useWriter(win: Page, fake: FakeProvider, modelId = 'fake/writer'): Promise<void> {
  const p = await invoke(win, 'saveProvider', { name: 'Fake', kind: 'custom', baseUrl: fake.url, apiKey: '' })
  await invoke(win, 'updateSettings', {
    models: { writer: { providerId: p.id, modelId, label: modelId, contextLength: 32000, promptPrice: null, completionPrice: null } }
  })
  await win.reload()
  await expect(prose(win)).toBeVisible()
  await listen(win)
}

async function firstScene(win: Page): Promise<{ sceneId: string; chapterId: string }> {
  const [story] = await invoke(win, 'listStories')
  const { scenes, chapters } = await invoke(win, 'getOutline', story.id)
  return { sceneId: scenes[0].id, chapterId: chapters[0].id }
}

async function setBeats(win: Page, sceneId: string, beats: string[]): Promise<void> {
  const card = (await invoke(win, 'getScene', sceneId)).card
  await invoke(win, 'updateSceneCard', sceneId, { ...card, beats, targetWords: 1500 })
}

const chatRequests = (fake: FakeProvider): number => Object.values(fake.requestCounts()).reduce((a, b) => a + b, 0)
const paragraphs = (win: Page): Promise<number> =>
  prose(win)
    .locator('p')
    .evaluateAll((ps) => ps.filter((p) => p.textContent?.trim()).length)
const savedText = async (win: Page, sceneId: string): Promise<string> => (await invoke(win, 'getScene', sceneId)).text

interface Ended {
  generationId: string
  status: string
}
type Listening = { aiwrite: { on: (event: string, fn: (p: Ended) => void) => () => void }; ended?: Ended[] }

/** Keeps every draft that ends (each beat's, and Generate's), in order, so the test can read their records. */
async function listen(win: Page): Promise<void> {
  await win.evaluate(() => {
    const w = globalThis as unknown as Listening
    w.ended = []
    w.aiwrite.on('generation:done', (p) => w.ended!.push(p))
  })
}
const ended = (win: Page): Promise<Ended[]> => win.evaluate(() => (globalThis as unknown as Listening).ended ?? [])
const records = async (win: Page) => Promise.all((await ended(win)).map((e) => invoke(win, 'getGeneration', e.generationId)))
const lastRecord = async (win: Page) => (await records(win)).at(-1)

/**
 * What the AI was sent for the scene's newest draft or beat, as its record keeps it (the messages sent,
 * as they were). Not the fake server's last request: the memory's own calls, made in the background with
 * the same model, can come after it.
 */
async function lastSent(win: Page, sceneId: string): Promise<string> {
  const [newest] = await invoke(win, 'listGenerations', sceneId)
  const record = newest ? await invoke(win, 'getGeneration', newest.id) : null
  return record?.messages.find((m) => m.role === 'user')?.content ?? ''
}
/** How many drafts and beats the scene has had: one more for each one sent. */
const sentCount = async (win: Page, sceneId: string): Promise<number> => (await invoke(win, 'listGenerations', sceneId)).length

/** Types Adam's two paragraphs into the page and waits for them to be saved. */
async function writeOldText(win: Page, sceneId: string): Promise<void> {
  await prose(win).click()
  await win.keyboard.type(OLD[0])
  await win.keyboard.press('Enter')
  await win.keyboard.type(OLD[1])
  await expect.poll(() => savedText(win, sceneId)).toBe(OLD.join('\n\n'))
}

test('Beat by beat writes one beat at a time and pauses: a note steers the next, the bar shows what the AI saw, Write it again and Ctrl+Z each take one beat, Finish keeps the text', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 60 })
  try {
    const { win, app } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await useWriter(win, fake)
    await watchSnapshots(app)

    // An empty page: the first beat is written straight away, then the bar pauses on the next one.
    await beatsButton(win).click()
    await expect(bar(win)).toBeVisible()
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(bar(win)).toContainText(BEATS[1])
    await expect(beatsButton(win)).toHaveAttribute('aria-pressed', 'true')
    await expect(prose(win)).toContainText('The rain')
    const afterOne = await paragraphs(win)
    expect(afterOne).toBeGreaterThan(0)
    const [first] = await records(win)
    expect(first.job).toBe('beat')
    expect(first.sceneId).toBe(sceneId)
    expect(first.status).toBe('complete')
    expect(first.params.beat).toMatchObject({ index: 1, of: 3 })
    expect(await lastSent(win, sceneId)).toContain('Write only the first beat of the scene now: beat 1 of the 3 on the scene card.')
    // The keyboard is in the bar's box, ready for a note.
    await expect(box(win)).toBeFocused()
    await expect(box(win)).toHaveAttribute('placeholder', 'Anything to change for the next beat?')

    // The note steers the next beat, and Enter writes it.
    await box(win).fill(NOTE)
    await win.keyboard.press('Enter')
    await expect(status(win)).toHaveText('Beat 3 of 3')
    const sent = await lastSent(win, sceneId)
    expect(sent).toContain('Write only the next beat of the scene now: beat 2 of the 3 on the scene card.')
    expect(sent).toContain(`- Beat 2 (write this one now): ${BEATS[1]}`)
    expect(sent).toContain(`The author's note for this beat: ${NOTE}`)
    // It carries on from the scene so far, which is sent once.
    expect(sent).toContain('## The scene so far')
    expect(sent.split('The rain had not let up').length - 1).toBe(1)
    const second = (await lastRecord(win))!
    expect(second.params.beat).toMatchObject({ sessionId: first.params.beat?.sessionId, index: 2, of: 3 })
    expect(second.direction).toBe(`For this beat: ${NOTE}`)
    // The box is empty again, for the next beat's note; the beats read as one piece, with no scene break.
    await expect(box(win)).toHaveValue('')
    await expect(prose(win).locator('hr')).toHaveCount(0)
    const afterTwo = await paragraphs(win)
    expect(afterTwo).toBeGreaterThan(afterOne)

    // Each beat is listed with the scene's drafts, and the bar opens what the AI saw for the beat just written.
    expect((await invoke(win, 'listGenerations', sceneId)).map((g) => g.id)).toEqual([second.id, first.id])
    await barButton(win, 'What the AI saw').click()
    await expect(win.getByRole('heading', { name: 'What the AI saw', level: 1 })).toBeVisible()
    await expect(win.getByText(`For this beat: ${NOTE}`).first()).toBeVisible()
    await win.getByRole('button', { name: /^Back to/ }).click()
    await expect(status(win)).toHaveText('Beat 3 of 3')

    // Write it again: beat 2 is undone and written afresh in its place, following the note in the box and
    // carrying on from beat 1 alone (the beat as it was isn't sent).
    await box(win).fill(AGAIN)
    await barButton(win, 'Write it again').click()
    await expect.poll(async () => (await ended(win)).length).toBe(3)
    await expect(status(win)).toHaveText('Beat 3 of 3')
    const again = (await lastRecord(win))!
    expect(again.status).toBe('complete')
    expect(again.params.beat).toMatchObject({ sessionId: first.params.beat?.sessionId, index: 2, of: 3 })
    expect(again.direction).toBe(`For this beat: ${AGAIN}`)
    const sentAgain = await lastSent(win, sceneId)
    expect(sentAgain).toContain('beat 2 of the 3 on the scene card')
    expect(sentAgain).toContain(`The author's note for this beat: ${AGAIN}`)
    expect(sentAgain).toContain('- Beat 1 (already written: the scene so far ends with it)')
    expect(sentAgain).toContain('## The scene so far')
    expect(sentAgain.split('The rain had not let up').length - 1).toBe(1)
    expect(await paragraphs(win)).toBe(afterTwo)
    await expect(box(win)).toHaveValue('')

    // One Ctrl+Z takes the new beat 2 out and the next takes beat 1 (the old beat 2 doesn't come back);
    // redo brings them back a beat at a time. The bar steps with the page.
    await expect(box(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(status(win)).toHaveText('Beat 2 of 3')
    expect(await paragraphs(win)).toBe(afterOne)
    await win.keyboard.press('Control+z')
    await expect(status(win)).toHaveText('Beat 1 of 3')
    expect(await paragraphs(win)).toBe(0)
    await win.keyboard.press('Control+y')
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await win.keyboard.press('Control+y')
    await expect(status(win)).toHaveText('Beat 3 of 3')
    expect(await paragraphs(win)).toBe(afterTwo)
    await win.keyboard.press('Control+z')
    await expect(status(win)).toHaveText('Beat 2 of 3')
    expect(await paragraphs(win)).toBe(afterOne)

    // Finish: the bar goes and the text stays, saved as it shows.
    await barButton(win, 'Finish').click()
    await expect(bar(win)).toBeHidden()
    await expect(beatsButton(win)).toHaveAttribute('aria-pressed', 'false')
    expect(await paragraphs(win)).toBe(afterOne)
    await expect.poll(async () => (await savedText(win, sceneId)).trim()).toBe(first.response.trim())
    expect(await ended(win)).toHaveLength(3)
    // The session began on an empty page, so there was nothing to keep in the scene's History, before
    // any beat (beat 1 is not "the scene before beat by beat").
    expect(await snapshots(app)).toEqual([])
  } finally {
    await fake.close()
  }
})

test('With no beats on the scene card, Beat by beat says so plainly and opens the card at its beats; nothing is sent', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 40 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    await useWriter(win, fake)
    const { sceneId } = await firstScene(win)

    await beatsButton(win).click()
    await expect(noBeatsHeading(win)).toBeVisible()
    await expect(win.getByText('Add the beats first: the things that must happen, in order.', { exact: false })).toBeVisible()
    await expect(bar(win)).toHaveCount(0)
    await win.getByRole('button', { name: 'Open the scene card' }).click()
    await expect(noBeatsHeading(win)).toBeHidden()
    // The scene card shows, with the keyboard in its first beat.
    const firstBeat = win.getByRole('tabpanel').getByPlaceholder('What happens first?')
    await expect(firstBeat).toBeFocused()
    await win.waitForTimeout(300)
    expect(chatRequests(fake)).toBe(0)
    expect(await ended(win)).toEqual([])

    // With a beat on the card, Beat by beat writes the scene around it (the card is saved first).
    await win.keyboard.type('Mara meets Tobin at the Gilded Eel.')
    await beatsButton(win).click()
    await expect(status(win)).toHaveText('The beat is written')
    expect((await invoke(win, 'getScene', sceneId)).card.beats).toContain('Mara meets Tobin at the Gilded Eel.')
    expect(await lastSent(win, sceneId)).toContain(
      'Write the scene now. The scene card has one beat:\n- Mara meets Tobin at the Gilded Eel.'
    )
    await expect(barButton(win, 'Finish')).toBeVisible()
  } finally {
    await fake.close()
  }
})

test('On a scene with text it asks first, as Generate does (also from the palette): Add below puts the beats under a scene break, Ctrl+Z takes them out a beat at a time, and Generate ends the session', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 40 })
  try {
    const { win, app } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await useWriter(win, fake)
    await writeOldText(win, sceneId)
    await watchSnapshots(app)

    // The same question as Generate's, and nothing is sent until it is answered.
    await beatsButton(win).click()
    await expect(choiceHeading(win)).toBeVisible()
    await expect(win.getByText('Where should the new draft go?')).toBeVisible()
    await expect(win.getByText('Either way, Ctrl+Z takes the beats out one at a time.')).toBeVisible()
    await win.keyboard.press('Escape')
    await expect(choiceHeading(win)).toBeHidden()
    await win.waitForTimeout(300)
    expect(chatRequests(fake)).toBe(0)
    await expect(bar(win)).toHaveCount(0)

    // From the palette, by keyboard: Add below has the keys, as for Ctrl+G. The first beat goes under a
    // scene break, and starts the scene there (no scene so far).
    await win.keyboard.press('Control+K')
    await win.keyboard.type('beat by beat')
    await expect(palette(win).getByRole('option', { selected: true })).toContainText('Beat by beat')
    await win.keyboard.press('Enter')
    await expect(choiceHeading(win)).toBeVisible()
    await expect(addBelow(win)).toBeFocused()
    await win.keyboard.press('Enter')
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(prose(win).locator('hr')).toHaveCount(1)
    await expect(prose(win).locator('p').nth(0)).toHaveText(OLD[0])
    expect(await lastSent(win, sceneId)).not.toContain('## The scene so far')

    // The next beat carries on from the beats below the break, not from Adam's text above it.
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('Beat 3 of 3')
    const sent = await lastSent(win, sceneId)
    expect(sent).toContain('## The scene so far')
    expect(sent).not.toContain(OLD[0])
    await expect(prose(win).locator('hr')).toHaveCount(1)
    // The scene as it was is kept in its History once, before the first beat.
    expect(await snapshots(app)).toEqual(['Before beat by beat'])

    // Each Ctrl+Z takes one beat out; the first goes with its scene break.
    await expect(box(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await win.keyboard.press('Control+z')
    await expect(status(win)).toHaveText('Beat 1 of 3')
    await expect(prose(win).locator('hr')).toHaveCount(0)
    await expect(prose(win).locator('p')).toHaveText(OLD)

    // Generate writes a new draft of the whole scene, so the session gives way to it (the text stays).
    await generateButton(win).click()
    await addBelow(win).click()
    await expect(bar(win)).toBeHidden()
    await expect.poll(async () => (await ended(win)).length).toBe(3)
    expect((await lastRecord(win))?.job).toBe('draft')
    await expect(prose(win).locator('p').nth(0)).toHaveText(OLD[0])
  } finally {
    await fake.close()
  }
})

test('Stop and Esc stop a beat and keep its words; another page leaves it writing; another scene stops it, and the session waits on its scene', async ({
  launch
}) => {
  const fake = await fakeProvider({ slowWords: 2000, slowDelayMs: 40 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId, chapterId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await invoke(win, 'createScene', chapterId, { title: 'The knock', afterId: sceneId })
    await useWriter(win, fake, 'fake/slow')

    await beatsButton(win).click()
    await expect(status(win)).toHaveText('Writing beat 1 of 3…')
    await expect(barButton(win, 'Stop')).toBeVisible()
    await expect(prose(win)).toContainText('The rain')

    // Another page: the beat carries on, and the top bar says so and leads back.
    await win.getByRole('button', { name: 'Settings', exact: true }).click()
    const writing = win.getByRole('button', { name: 'Writing…' })
    await expect(writing).toBeVisible()
    const before = await paragraphs(win)
    await writing.click()
    await expect(status(win)).toHaveText('Writing beat 1 of 3…')
    await expect.poll(() => paragraphs(win)).toBeGreaterThan(before)

    // Stop keeps the words so far, and the bar pauses on the next beat, saying the beat stopped part-way.
    await barButton(win, 'Stop').click()
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(bar(win)).toContainText('Beat 1 stopped part-way. Write it again, or carry on with beat 2.')
    await expect.poll(async () => (await ended(win)).map((e) => e.status)).toEqual(['stopped'])
    const kept = await paragraphs(win)
    expect(kept).toBeGreaterThan(0)

    // Esc stops a beat too. The next beat is told the scene so far stops part-way through beat 1.
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('Writing beat 2 of 3…')
    await expect.poll(() => paragraphs(win)).toBeGreaterThan(kept)
    const sent = await lastSent(win, sceneId)
    expect(sent).toContain('- Beat 1 (begun, but it stopped part-way: the scene so far ends in the middle of it)')
    expect(sent).toContain('- First bring beat 1 to its end in a few lines')
    await win.keyboard.press('Escape')
    await expect(status(win)).toHaveText('Beat 3 of 3')
    await expect(bar(win)).toContainText('Beat 2 stopped part-way. Write it again, or carry on with beat 3.')
    await expect.poll(async () => (await ended(win)).map((e) => e.status)).toEqual(['stopped', 'stopped'])
    const keptTwo = await paragraphs(win)

    // Another scene: the beat being written stops there, and the session waits on its scene.
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('Writing beat 3 of 3…')
    await expect.poll(() => paragraphs(win)).toBeGreaterThan(keptTwo)
    await row(win, 'The knock').click()
    await expect(toasts(win).getByText('Drafting stopped because you opened another scene. The text so far is kept.')).toBeVisible()
    await expect(header(win)).toContainText('The knock')
    await expect(bar(win)).toHaveCount(0)
    await expect(beatsButton(win)).toHaveAttribute('aria-pressed', 'false')
    await row(win, 'Scene 1').click()
    await expect(status(win)).toHaveText('Beat 3 stopped part-way')
    await expect(bar(win)).toContainText('Write it again, or finish with the scene as it is.')
    await expect(barButton(win, 'Write it again')).toBeEnabled()
    await barButton(win, 'Finish').click()
    await expect(bar(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('Replace it: the first beat takes the place of the scene’s text (written again too), one Ctrl+Z puts the text back, and the bar asks again before the first beat', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 40 })
  try {
    const { win, app } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await useWriter(win, fake)
    await writeOldText(win, sceneId)
    await watchSnapshots(app)

    // Replace it: the first beat is the whole page, as for Generate (the old text isn't sent, and is kept with the beat).
    await beatsButton(win).click()
    await win.getByRole('button', { name: 'Replace it', exact: true }).click()
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(prose(win)).not.toContainText(OLD[0])
    await expect(prose(win).locator('p').first()).toContainText('The rain had not let up')
    await expect(prose(win).locator('hr')).toHaveCount(0)
    expect(await lastSent(win, sceneId)).not.toContain(OLD[0])
    await expect.poll(async () => (await lastRecord(win))?.replacedText?.text).toBe(OLD.join('\n\n'))
    const [first] = await records(win)
    expect(first.job).toBe('beat')

    // Written again, the first beat takes the old text's place in the same way (and keeps it with its record).
    await barButton(win, 'Write it again').click()
    await expect.poll(async () => (await ended(win)).length).toBe(2)
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(prose(win)).not.toContainText(OLD[0])
    await expect(prose(win).locator('hr')).toHaveCount(0)
    await expect.poll(async () => (await lastRecord(win))?.replacedText?.text).toBe(OLD.join('\n\n'))

    // One Ctrl+Z puts the scene's text back, and the bar goes back to the first beat.
    await expect(box(win)).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(status(win)).toHaveText('Beat 1 of 3')
    await expect(prose(win).locator('p')).toHaveText(OLD)

    // The first beat on a page with text asks where it goes again, over the bar's button.
    await barButton(win, 'Write the next beat').click()
    await expect(choiceHeading(win)).toBeVisible()
    await addBelow(win).click()
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(prose(win).locator('hr')).toHaveCount(1)
    await expect(prose(win).locator('p').nth(0)).toHaveText(OLD[0])
    const second = (await lastRecord(win))!
    expect(second.params.beat).toMatchObject({ sessionId: first.params.beat?.sessionId, index: 1, of: 3 })
    // The scene as it was before the session was kept once, however the first beat went in.
    expect(await snapshots(app)).toEqual(['Before beat by beat'])
  } finally {
    await fake.close()
  }
})

test('A beat written out of sight below: the bar points to it (the page’s own pointer would be under the bar); a stopped beat says so, and Write it again waits for the beat to end the scene', async ({
  launch
}) => {
  const fake = await fakeProvider({ slowWords: 2000, slowDelayMs: 40 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await invoke(win, 'saveSceneText', sceneId, null, LONG)
    await useWriter(win, fake, 'fake/slow')
    await expect(prose(win)).toContainText('Line 40 of an old draft')

    // Reading the top of a long scene: the first beat goes below it, far out of sight.
    await scroller(win).evaluate((el) => (el.scrollTop = 0))
    await beatsButton(win).click()
    await addBelow(win).click()
    await expect(status(win)).toHaveText('Writing beat 1 of 3…')
    await expect(pointer(win, 'Writing beat 1 below')).toBeVisible()
    expect(await pointer(win, 'Writing beat 1 below').evaluate(onTop)).toBe(true)
    await expect(win.getByText('Writing the new draft below')).toHaveCount(0)
    expect(await scroller(win).evaluate((el) => el.scrollTop)).toBe(0)

    // The pointer leads to where the beat is being written, and goes once it is in sight.
    await pointer(win, 'Writing beat 1 below').click()
    await expect(pointer(win, 'Writing beat 1 below')).toBeHidden()
    expect(await scroller(win).evaluate((el) => el.scrollTop)).toBeGreaterThan(500)
    await expect(box(win)).toBeFocused()

    // Stopped part-way, the bar says so.
    await win.keyboard.press('Escape')
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(bar(win)).toContainText('Beat 1 stopped part-way. Write it again, or carry on with beat 2.')

    // A paragraph of Adam's own after the beat: it can't be written again in its place now, and nothing is sent.
    await prose(win).locator('p').last().click()
    await win.keyboard.press('Control+End')
    await win.keyboard.press('Enter')
    await win.keyboard.type('Adam adds a line of his own.')
    await expect(prose(win).locator('p').last()).toHaveText('Adam adds a line of his own.')
    const asked = await sentCount(win, sceneId)
    await barButton(win, 'Write it again').click()
    await expect(
      toasts(win).getByText('Beat 1 can only be written again while it ends the scene, and your own words come after it now.')
    ).toBeVisible()
    await win.waitForTimeout(300)
    expect(await sentCount(win, sceneId)).toBe(asked)
    await expect(status(win)).toHaveText('Beat 2 of 3')

    // The next beat carries on after Adam's words, and is told so.
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('Writing beat 2 of 3…')
    await expect.poll(() => sentCount(win, sceneId)).toBe(asked + 1)
    const sent = await lastSent(win, sceneId)
    expect(sent).toContain('Adam adds a line of his own.')
    expect(sent).toContain("- Beat 1 (already written, and the author's own writing comes after it at the end of the scene so far)")
    await barButton(win, 'Stop').click()
    await expect(status(win)).toHaveText('Beat 3 of 3')
  } finally {
    await fake.close()
  }
})

test('A beat that ends out of sight is pointed to from the bar rather than in a message, and a cut-off beat’s message shows above the bar, one at a time', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 80 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await invoke(win, 'saveSceneText', sceneId, null, LONG)
    await useWriter(win, fake, 'fake/length')
    await expect(prose(win)).toContainText('Line 40 of an old draft')

    await scroller(win).evaluate((el) => (el.scrollTop = 0))
    await beatsButton(win).click()
    await addBelow(win).click()
    await expect.poll(async () => (await ended(win)).length).toBe(1)
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(bar(win)).toContainText('Beat 1 stopped part-way. Write it again, or carry on with beat 2.')

    // The message about the cut-off shows above the bar, not over it; none says where the beat went.
    const cutOff = toasts(win).getByText('The model ran out of room before the end of the beat, so it stops part-way.', { exact: false })
    await expect(cutOff).toBeVisible()
    await expect
      .poll(async () => {
        const msg = (await cutOff.boundingBox())!
        const card = (await bar(win).boundingBox())!
        return msg.y + msg.height <= card.y
      })
      .toBe(true)
    await expect(toasts(win).getByText('The new draft was added at the end of the scene', { exact: false })).toHaveCount(0)

    // The bar points to the beat instead, until it has been seen.
    await expect(pointer(win, 'Beat 1 is below')).toBeVisible()
    expect(await pointer(win, 'Beat 1 is below').evaluate(onTop)).toBe(true)
    await pointer(win, 'Beat 1 is below').click()
    await expect(pointer(win, 'Beat 1 is below')).toBeHidden()

    // Write it again: the beat goes under its scene break again, and its new message takes the old one's place.
    await barButton(win, 'Write it again').click()
    await expect.poll(async () => (await ended(win)).length).toBe(2)
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(prose(win).locator('hr')).toHaveCount(1)
    await expect(cutOff).toHaveCount(1)
    await expect(toasts(win).getByText('The new draft was added at the end of the scene', { exact: false })).toHaveCount(0)
    const [one, two] = await records(win)
    expect(two.params.beat).toMatchObject({ sessionId: one.params.beat?.sessionId, index: 1, of: 3 })
  } finally {
    await fake.close()
  }
})
