// Who says each line, and how, made as a draft is written and shown on request (Adam, 2 October 2026), against the
// fake AI (tests/fake-provider) and the fake speech server (tests/fake-speech):
//
//  - With read aloud on, Generate writes a draft, and the writer says who says each line and how as it writes (tags
//    taken out of the text); the AI's marks for the rest (the narration) are made in the background as it lands,
//    without pressing Listen.
//  - "Show speakers and tone" is off at first: nothing shows. Turned on beside Listen, each paragraph shows who says it
//    and how, small and faint above it, without changing the words, the layout or the page's width.
//  - The same switch in Settings › Read aloud and dictation turns them off again.
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
    // The narration's mood came from the writer too (no second model was asked about it).
    expect(shown[0]).toBe('Narrator · low and watchful')
    // Who says each line, and how, came from the writer itself as it wrote (its tags never reach the page).
    expect(shown.some((l) => l.includes('Tobin · dry, a little amused') && l.includes('Mara · flat and certain'))).toBe(true)
    expect(words).not.toContain('{')

    // Never part of the text, and nothing on the page moved.
    expect(await prose(win).innerText()).toBe(words)
    expect(await layout(win)).toEqual(before)
    const [story] = await invoke(win, 'listStories')
    const sceneId = (await invoke(win, 'getOutline', story.id)).scenes[0].id
    expect(JSON.stringify((await invoke(win, 'getScene', sceneId)).doc)).not.toContain('·')
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
