// Beat by beat (milestone 4): the scene written one beat of its card at a time, pausing after each so
// Adam can steer the next from the bar over the page. Against the fake OpenAI-compatible server
// (tests/fake-provider/server.mjs), whose usual prose answers every beat.
import type { Page } from '@playwright/test'
import type { FakeProvider, FakeProviderOptions } from '../fake-provider/server.mjs'
import { binder, createWorldFromWelcome, expect, invoke, test } from './helpers'

const BEATS = ['Mara meets Tobin at the Gilded Eel.', 'Tobin asks for the ledger.', 'Someone knocks at the door.']
const OLD = ['Adam wrote this.', 'And this, his second paragraph.']
const NOTE = 'Make Tobin stall before he asks.'

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

/** What the AI was last sent, as the fake server's /__last shows it. */
async function lastSent(fake: FakeProvider): Promise<string> {
  const last = (await (await fetch(`${fake.url}/__last`)).json()) as { body: { messages: { role: string; content: string }[] } }
  return last.body.messages.find((m) => m.role === 'user')?.content ?? ''
}

/** Types Adam's two paragraphs into the page and waits for them to be saved. */
async function writeOldText(win: Page, sceneId: string): Promise<void> {
  await prose(win).click()
  await win.keyboard.type(OLD[0])
  await win.keyboard.press('Enter')
  await win.keyboard.type(OLD[1])
  await expect.poll(() => savedText(win, sceneId)).toBe(OLD.join('\n\n'))
}

test('Beat by beat writes one beat at a time and pauses: a note steers the next, Write it again and Ctrl+Z each take one beat, Finish keeps the text', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 60 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await useWriter(win, fake)

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
    expect(await lastSent(fake)).toContain('Write only the first beat of the scene now: beat 1 of the 3 on the scene card.')
    // The keyboard is in the bar's box, ready for a note.
    await expect(box(win)).toBeFocused()
    await expect(box(win)).toHaveAttribute('placeholder', 'Anything to change for the next beat?')

    // The note steers the next beat, and Enter writes it.
    await box(win).fill(NOTE)
    await win.keyboard.press('Enter')
    await expect(status(win)).toHaveText('Beat 3 of 3')
    const sent = await lastSent(fake)
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

    // Write it again: beat 2 is written afresh in its place, not added after it.
    await barButton(win, 'Write it again').click()
    await expect.poll(async () => (await ended(win)).length).toBe(3)
    await expect(status(win)).toHaveText('Beat 3 of 3')
    const again = (await lastRecord(win))!
    expect(again.status).toBe('complete')
    expect(again.params.beat).toMatchObject({ sessionId: first.params.beat?.sessionId, index: 2, of: 3 })
    expect(await lastSent(fake)).toContain('beat 2 of the 3 on the scene card')
    expect(await paragraphs(win)).toBe(afterTwo)

    // One Ctrl+Z takes one beat out (the new beat 2), and the bar steps back with the page.
    await expect(box(win)).toBeFocused()
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
    expect(await lastSent(fake)).toContain('Write the scene now. The scene card has one beat:\n- Mara meets Tobin at the Gilded Eel.')
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
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await useWriter(win, fake)
    await writeOldText(win, sceneId)

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
    expect(await lastSent(fake)).not.toContain('## The scene so far')

    // The next beat carries on from the beats below the break, not from Adam's text above it.
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('Beat 3 of 3')
    const sent = await lastSent(fake)
    expect(sent).toContain('## The scene so far')
    expect(sent).not.toContain(OLD[0])
    await expect(prose(win).locator('hr')).toHaveCount(1)

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

    // Stop keeps the words so far, and the bar pauses on the next beat.
    await barButton(win, 'Stop').click()
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect.poll(async () => (await ended(win)).map((e) => e.status)).toEqual(['stopped'])
    const kept = await paragraphs(win)
    expect(kept).toBeGreaterThan(0)

    // Esc stops a beat too.
    await barButton(win, 'Write the next beat').click()
    await expect(status(win)).toHaveText('Writing beat 2 of 3…')
    await expect.poll(() => paragraphs(win)).toBeGreaterThan(kept)
    await win.keyboard.press('Escape')
    await expect(status(win)).toHaveText('Beat 3 of 3')
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
    await expect(status(win)).toHaveText('All 3 beats are written')
    await expect(barButton(win, 'Write it again')).toBeEnabled()
    await barButton(win, 'Finish').click()
    await expect(bar(win)).toHaveCount(0)
  } finally {
    await fake.close()
  }
})

test('Replace it: the first beat takes the place of the scene’s text, one Ctrl+Z puts the text back, and the bar asks again before the first beat', async ({
  launch
}) => {
  const fake = await fakeProvider({ words: 40 })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Alpha')
    const { sceneId } = await firstScene(win)
    await setBeats(win, sceneId, BEATS)
    await useWriter(win, fake)
    await writeOldText(win, sceneId)

    // Replace it: the first beat is the whole page, as for Generate (the old text isn't sent, and is kept with the beat).
    await beatsButton(win).click()
    await win.getByRole('button', { name: 'Replace it', exact: true }).click()
    await expect(status(win)).toHaveText('Beat 2 of 3')
    await expect(prose(win)).not.toContainText(OLD[0])
    await expect(prose(win).locator('p').first()).toContainText('The rain had not let up')
    await expect(prose(win).locator('hr')).toHaveCount(0)
    expect(await lastSent(fake)).not.toContain(OLD[0])
    await expect.poll(async () => (await lastRecord(win))?.replacedText?.text).toBe(OLD.join('\n\n'))
    const [first] = await records(win)
    expect(first.job).toBe('beat')

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
  } finally {
    await fake.close()
  }
})
