// Who says each line, and how, made as a draft is written and shown on request (Adam, 2 October 2026), against the
// fake AI (tests/fake-provider) and the fake speech server (tests/fake-speech):
//
//  - With read aloud on, Generate writes a draft, and the writer says who says each line and how as it writes (tags
//    taken out of the text); the AI's marks for the rest (the narration) are made in the background as it lands,
//    without pressing Listen.
//  - "Show speakers and tone" is off at first: nothing shows. Turned on beside Listen, each paragraph shows who says it
//    and how, small and faint above it, without changing the words, the layout or the page's width.
//  - The same switch in Settings › Read aloud and dictation turns them off again.
//  - A label that starts with a character from the world has their name to click: it opens their read-aloud voice.
import type { Page } from '@playwright/test'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

interface FakeSpeech {
  url: string
  close(): Promise<void>
}

const load = <T>(file: string): Promise<T> => import(pathToFileURL(join(__dirname, file)).href) as Promise<T>

async function startSpeech(): Promise<FakeSpeech> {
  const { startFakeSpeech } = await load<{ startFakeSpeech(o: object): Promise<FakeSpeech> }>('../fake-speech/server.mjs')
  return startFakeSpeech({})
}

const prose = (win: Page) => win.locator('.scene-prose')
const generateButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Generate', exact: true })
const speakersButton = (win: Page) => win.locator('main header').getByRole('button', { name: 'Speakers and tone' })
const labelled = (win: Page) => win.locator('.scene-prose p[data-speaker-label]')

/** Every label on the page, as drawn (the paragraph's ::after), in order. */
const labels = (win: Page): Promise<string[]> =>
  labelled(win).evaluateAll((els) =>
    els.map((el) => {
      // (Run in the window: the tests' own types have no DOM.)
      const style = (globalThis as unknown as { getComputedStyle(e: unknown, pseudo: string): { content: string } }).getComputedStyle
      const drawn = style(el, '::after').content
      return drawn && drawn !== 'none' ? (el.getAttribute('data-speaker-label') ?? '') : ''
    })
  )

/** The Read aloud AI calls this world has made (the marker's second calls are 'speech' records; Drafts never lists them). */
const readAloudCalls = async (win: Page): Promise<number> =>
  (await invoke(win, 'getUsage', { period: 'all-time', scope: 'world' })).jobs.find((j) => j.key === 'speech')?.calls ?? 0

/** Where each paragraph sits on the page, and how wide the page is. */
const layout = (win: Page): Promise<{ tops: number[]; width: number }> =>
  prose(win).evaluate((el) => ({
    tops: [...el.querySelectorAll('p')].map((p) => Math.round(p.getBoundingClientRect().top)),
    width: Math.round(el.getBoundingClientRect().width)
  }))

test('a draft is marked as it is written, and "Show speakers and tone" shows who says each paragraph and how', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the harbour ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, markSpeakers: true } })
    await useFakeModel(win, fake)
    // Off at first.
    expect((await invoke(win, 'getSettings')).speech.showSpeakers).toBe(false)

    // Generate: the draft streams into the page.
    await prose(win).click()
    await generateButton(win).click()
    await expect(prose(win)).toContainText('"You came," he said', { timeout: 30_000 })
    await expect(generateButton(win)).toBeEnabled({ timeout: 30_000 })
    const words = await prose(win).innerText()
    const before = await layout(win)

    // Its marks were made in the background, without Listen: the labels come as soon as they are asked for.
    await expect(labelled(win)).toHaveCount(0)
    await expect(speakersButton(win)).toHaveAttribute('aria-pressed', 'false')
    await speakersButton(win).click()
    await expect(speakersButton(win)).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await labels(win)).length, { timeout: 30_000 }).toBe(await prose(win).locator('p').count())
    const shown = await labels(win)
    // The narration's mood is the marker's (the fake marks narration "hushed and steady").
    expect(shown[0]).toBe('Narrator · hushed and steady')
    // Who says each line, and how, came from the writer itself as it wrote (its tags never reach the page), and the
    // marker wasn't asked about those lines again (it would have said "quiet and wary" or "bright and quick").
    expect(shown.some((l) => l.includes('Tobin · dry, a little amused') && l.includes('Mara · flat and certain'))).toBe(true)
    expect(shown.join('\n')).not.toMatch(/quiet and wary|bright and quick/)
    expect(words).not.toContain('{')

    // Never part of the text, and nothing on the page moved.
    expect(await prose(win).innerText()).toBe(words)
    expect(await layout(win)).toEqual(before)
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    expect(JSON.stringify((await invoke(win, 'getScene', sceneId)).doc)).not.toContain('·')
    // One quick call marked the narration, in the background as the draft landed.
    expect(await readAloudCalls(win)).toBe(1)
    // The draft's record says how well the writer tagged it.
    const records = await invoke(win, 'listGenerations', sceneId)
    const draft = await invoke(win, 'getGeneration', records.find((g) => g.job === 'draft')!.id)
    expect(draft.params.speakerTags).toEqual({ quotes: 2, tagged: 2, toned: 2, moods: 0, dropped: 0 })
    // Settings has the same switch: turned off there, the labels go.
    await openSettings(win, 'Read aloud and dictation')
    await win.getByRole('button', { name: 'More', exact: true }).click()
    const option = win.getByRole('switch', { name: 'Show speakers and tone' })
    await expect(option).toBeChecked()
    await option.click()
    await expect(option).not.toBeChecked()
    expect((await invoke(win, 'getSettings')).speech.showSpeakers).toBe(false)
    await expect(labelled(win)).toHaveCount(0)
  } finally {
    await speech.close()
    await fake.close()
  }
})

test('a variant put into the scene keeps who its writer said says each line, and how', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the harbour ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, markSpeakers: true, showSpeakers: true } })
    await useFakeModel(win, fake)

    await win.getByRole('button', { name: 'Variants', exact: true }).click()
    await win.getByRole('radio', { name: 'Two' }).click()
    await win.getByRole('button', { name: 'Write two variants' }).click()
    await expect(win.getByRole('button', { name: 'New variants' })).toBeVisible({ timeout: 30_000 })
    await win.getByRole('region', { name: 'Variant 2', exact: true }).getByRole('button', { name: 'Use this one' }).click()
    await expect(prose(win)).toContainText('"You came," he said', { timeout: 30_000 })

    await expect.poll(async () => (await labels(win)).length, { timeout: 30_000 }).toBe(await prose(win).locator('p').count())
    const shown = await labels(win)
    expect(shown[0]).toBe('Narrator · hushed and steady')
    expect(shown.some((l) => l.includes('Tobin · dry, a little amused'))).toBe(true)
    expect(shown.join('\n')).not.toMatch(/quiet and wary|bright and quick/)
  } finally {
    await speech.close()
    await fake.close()
  }
})

test('words Adam types himself get who says each line and how, without Listen', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the harbour ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, markSpeakers: true } })
    await useFakeModel(win, fake)

    await prose(win).click()
    for (const [i, para] of ['The ferry was late again.', '"You came," Tobin said.', '"I said I would."'].entries()) {
      if (i) await win.keyboard.press('Enter')
      await win.keyboard.type(para)
    }
    await speakersButton(win).click()
    // Every paragraph is marked in the background and shows its speaker with a tone: Adam's own words need the AI.
    await expect.poll(async () => (await labels(win)).filter((l) => l.includes(' · ')).length, { timeout: 30_000 }).toBe(3)
    expect(await readAloudCalls(win)).toBeGreaterThan(0)
    expect((await labels(win))[0]).toBe('Narrator · hushed and steady')

    // An edit loses its paragraph's label, and it comes back a few seconds after typing stops.
    await win.keyboard.press('Control+End')
    await win.keyboard.type(' Mara looked away.')
    await expect.poll(async () => (await labels(win)).length).toBe(2)
    await expect.poll(async () => (await labels(win)).filter((l) => l.includes(' · ')).length, { timeout: 30_000 }).toBe(3)
  } finally {
    await speech.close()
    await fake.close()
  }
})

test('a thought in italics is its thinker’s, and "Show speakers and tone" says it is a thought', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the harbour ferry.' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, markSpeakers: true } })
    await useFakeModel(win, fake)

    await prose(win).click()
    await win.keyboard.type('"You came," Tobin said.')
    await win.keyboard.press('Enter')
    await win.keyboard.press('Control+i')
    await win.keyboard.type('Not again,')
    await win.keyboard.press('Control+i')
    await win.keyboard.type(' Mara thought.')
    await speakersButton(win).click()
    await expect.poll(async () => (await labels(win)).filter((l) => l.includes(' · ')).length, { timeout: 30_000 }).toBe(2)
    // The thought is Mara's, read in her voice; the label says what it is (the fake director notes it "small and inward").
    expect((await labels(win))[1]).toBe('Mara · thought · small and inward')
  } finally {
    await speech.close()
    await fake.close()
  }
})

test('a speaker’s name above their line opens their read-aloud voice', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the harbour ferry.' })
    const tobin = await invoke(win, 'createEntry', 'character', { name: 'Tobin', summary: 'A ferryman.' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, markSpeakers: true, showSpeakers: true } })
    await useFakeModel(win, fake)

    await prose(win).click()
    await generateButton(win).click()
    await expect(prose(win)).toContainText('"You came," he said', { timeout: 30_000 })
    await expect(generateButton(win)).toBeEnabled({ timeout: 30_000 })

    // The line Tobin starts is labelled with his name, which takes the mouse; the narrator's label doesn't.
    const his = win.locator('.scene-prose p[data-speaker-name="Tobin"]').first()
    await expect(his).toBeVisible({ timeout: 30_000 })
    await expect(his).toHaveAttribute('data-speaker-entry', tobin.id)
    await expect(win.locator('.scene-prose p[data-speaker-label^="Narrator"][data-speaker-name]')).toHaveCount(0)
    const cursor = await his.evaluate(
      (el) =>
        (globalThis as unknown as { getComputedStyle(e: unknown, p: string): { cursor: string } }).getComputedStyle(el, '::before').cursor
    )
    expect(cursor).toBe('pointer')

    // Clicking his name opens his page at his Read-aloud voice.
    const box = (await his.boundingBox())!
    await win.mouse.click(box.x + 8, box.y - 6)
    const voice = win.getByRole('region', { name: 'Read-aloud voice' })
    await expect(voice).toBeInViewport()
    await expect(win.getByRole('textbox', { name: 'Name' })).toHaveValue('Tobin')
    await expect(voice.getByLabel('How they sound')).toBeFocused()
  } finally {
    await speech.close()
    await fake.close()
  }
})
