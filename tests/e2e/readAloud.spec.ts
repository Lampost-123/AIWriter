// Reading aloud (milestone 4), the way Adam uses it, against the fake speech server (tests/fake-speech) and the
// fake AI (tests/fake-provider):
//
//  - Turning it on loads the voices and the narrator says it is ready. A character gets a voice from Suggest and a
//    way to say her name. Ctrl+L reads from the cursor: the bar says who is speaking, the highlight moves sentence by
//    sentence, Ctrl+L pauses and carries on, her line is read in her own voice, Ctrl+Shift+Space stops, Carry on and
//    Close, and reading on to the end of the story.
//  - The player bar: Next line and Back one line step through the lines (the highlight and "Paragraph 2 of 5"
//    follow), the speed list is heard and saved, and Emotion and tone says Off, then On once turned on from the bar
//    (and Settings says so beside Mark who says what).
//  - Settings: the narrator's voices with Hear, Sample, picking another voice and the saved audio; Listen from here
//    reads from the selected words in the voice picked.
//  - Editing while it reads: the next lines are read as they now stand. Keep reading goes on into the next scene.
//  - The bar names the chapter and scene it reads ("Chapter 1 · Scene 1"), and the binder marks that scene and its
//    chapter with a speaker, moving with Keep reading into the next chapter.
//  - Mark who says what: the AI's notes on each line reach the voice and the bar ("Mara · quiet and wary"), and
//    keep ahead of the reading to the end of a long scene.
//  - A line the rules can't place (someone outside the cast) is marked by the AI, with no voices of their own.
//  - A line the voice can't read stays lit, with Try again and Skip this line.
//  - The speech engine not running, then its voices not ready: plain words, with the way to fix it.
//  - A character's Read-aloud voice box sits near the top of their page, read aloud on or off; off, it says so with
//    Turn on read aloud, and their voice can be described ahead of time.
//  - Settings › Read aloud › Cast: the sample world's characters with their voices; a voice picked there is saved and
//    shows on their page (Open page); Give everyone without a voice a voice (with the studio voices), and Undo. The
//    palette opens the cast, and a character's voice from their page.
import type { Page } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { binder, createWorldFromWelcome, expect, invoke, newDataDir, openSettings, startFake, test, useFakeModel } from './helpers'

// These tests type straight quotes and look for them as typed (smart punctuation is Writing by hand's).
test.use({ smartPunctuation: false })

interface FakeSpeech {
  url: string
  close(): Promise<void>
}

/** One request the fake speech server was asked to speak. */
interface Spoken {
  input: string
  voice?: string
  voice_design?: string
  delivery?: string
}

/** Loads one of the tests' fake servers (plain JavaScript modules, without types). */
const load = <T>(file: string): Promise<T> => import(pathToFileURL(join(__dirname, file)).href) as Promise<T>

async function startSpeech(options: { voicesNotReady?: boolean } = {}): Promise<FakeSpeech> {
  const { startFakeSpeech } = await load<{ startFakeSpeech(o: object): Promise<FakeSpeech> }>('../fake-speech/server.mjs')
  return startFakeSpeech(options)
}

/** What the fake speech server has been asked to say so far. */
async function spoken(speech: FakeSpeech): Promise<Spoken[]> {
  const res = await fetch(`${speech.url.replace(/\/v1$/, '')}/__spoken`)
  return (await res.json()) as Spoken[]
}

const prose = (win: Page) => win.locator('.scene-prose')
const readingBar = (win: Page) => win.getByRole('region', { name: 'Reading aloud' })
const highlight = (win: Page) => win.locator('.scene-prose .aw-reading')
const sceneRow = (win: Page) => binder(win).locator('[data-row]', { hasText: 'Scene 1' }).first()

/** The words highlighted now (the highlight may be in pieces, around a name's underline). */
const lit = (win: Page): Promise<string> => highlight(win).evaluateAll((els) => els.map((el) => el.textContent ?? '').join(''))

/**
 * From now on, notes every 30 ms which words are highlighted and what the reading bar says (each change once), so a
 * test can check the order things were read in without having to catch each short line as it goes by. (Run in the
 * window, so written as a script.)
 */
const watchReading = (win: Page): Promise<unknown> =>
  win.evaluate(`(() => {
    if (window.__reading) clearInterval(window.__reading.timer)
    const seen = { lit: [], bar: [], timer: 0 }
    const note = (list, v) => {
      if (v && list[list.length - 1] !== v) list.push(v)
    }
    seen.timer = setInterval(() => {
      note(seen.lit, [...document.querySelectorAll('.scene-prose .aw-reading')].map((el) => el.textContent || '').join(''))
      note(seen.bar, document.querySelector('[role="region"][aria-label="Reading aloud"] p')?.textContent || '')
    }, 30)
    window.__reading = seen
  })()`)

/** What watchReading has seen so far. */
const seen = (win: Page): Promise<{ lit: string[]; bar: string[] }> =>
  win.evaluate('({ lit: [...(window.__reading?.lit ?? [])], bar: [...(window.__reading?.bar ?? [])] })')

/** The first highlight that starts with these words, or -1. */
const litAt = (list: string[], words: string): number => list.findIndex((t) => t.trimStart().startsWith(words))

const SCENE = [
  'The lamps along the harbour wall went out one by one, and the last of the fishing boats nosed in against the stones. Nobody on the quay looked up.',
  '"Get out of the rain before the whole harbour sees you standing there like a lost gull," said Mara.',
  'Tobin pulled his collar up and followed her down the slick steps to the water. The ferry was waiting, its one lamp swinging.',
  'They crossed in silence while the town shrank behind them into a smear of yellow windows and wet slate roofs.',
  'On the far side a cart stood ready, the horse steaming in the cold and the driver asleep under a sheet of oilcloth.',
  'The door closed behind them, and for the first time in three days the fire was warm.'
]

test('Ctrl+L reads from the cursor with the narrator and Mara in her own voice; pause, carry on, stop and close', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await startFake()
  const speech = await startSpeech()
  const { SUGGESTED_VOICE } = await load<{ SUGGESTED_VOICE: string }>('../fake-provider/m4/readAloud.mjs')
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    const mara = await invoke(win, 'createEntry', 'character', {
      name: 'Mara',
      summary: 'Runs the harbour ferry. Thirty-four, sharp-tongued.'
    })
    // Every word read, "said Mara" too (Skip ‘he said’ is off), so Say it as is heard on her name.
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, skipSpeechTags: false } })
    await useFakeModel(win, fake)

    // Turning read aloud on: the voices load, and the narrator says it is ready.
    await openSettings(win, 'Read aloud and dictation')
    const on = win.getByRole('switch', { name: 'Read scenes aloud' })
    await on.click()
    await expect(on).toBeChecked()
    await expect.poll(async () => (await spoken(speech)).map((s) => s.input), { timeout: 30_000 }).toContain('Ready when you are.')
    await expect(win.getByText('The voices are ready.')).toBeVisible()
    await expect(win.getByRole('radiogroup', { name: "Narrator's voice" }).getByRole('radio')).toHaveCount(9)

    // Mara's page: Suggest describes her voice, and nothing is kept until Use this.
    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await win.locator('[data-entry]').filter({ hasText: 'Mara' }).first().click()
    const voiceBox = win.getByRole('region', { name: 'Read-aloud voice' })
    await expect(voiceBox).toBeVisible()
    await voiceBox.getByRole('button', { name: 'Suggest' }).click()
    await expect(voiceBox.getByText(SUGGESTED_VOICE)).toBeVisible()
    expect((await invoke(win, 'getEntryReadAloud', mara.id)).voice.design).toBe('')
    await voiceBox.getByRole('button', { name: 'Use this' }).click()
    await expect(voiceBox.getByLabel('How they sound')).toHaveValue(SUGGESTED_VOICE)
    await expect.poll(async () => (await invoke(win, 'getEntryReadAloud', mara.id)).voice.design).toBe(SUGGESTED_VOICE)
    // Hear: a line in her new voice.
    await voiceBox.getByRole('button', { name: 'Hear' }).click()
    await expect.poll(async () => (await spoken(speech)).some((s) => s.voice_design === SUGGESTED_VOICE)).toBe(true)
    // Say it as: how the voice says her name (the page keeps it as written).
    await voiceBox.getByLabel('Say it as').fill('MAH-ra')
    await expect.poll(async () => (await invoke(win, 'getEntryReadAloud', mara.id)).say).toBe('MAH-ra')

    // The scene: Ctrl+L from the top reads it in order, the narrator first, then Mara.
    await sceneRow(win).click()
    await prose(win).click()
    for (const [i, para] of SCENE.entries()) {
      if (i) await win.keyboard.press('Enter')
      await win.keyboard.type(para)
    }
    await win.keyboard.press('Control+Home')
    await watchReading(win)
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })
    await expect(win.getByRole('button', { name: 'Listen' })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(async () => (await seen(win)).bar.some((b) => b.startsWith('Mara')), { timeout: 30_000 }).toBe(true)

    // Ctrl+L pauses: the highlight stays where it is until Ctrl+L carries on.
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Paused')
    const held = await lit(win)
    expect(held).not.toBe('')
    await win.waitForTimeout(1500)
    expect(await lit(win)).toBe(held)
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).not.toContainText('Paused')
    await expect.poll(async () => litAt((await seen(win)).lit, 'They crossed in silence'), { timeout: 30_000 }).toBeGreaterThan(-1)

    // Ctrl+Shift+Space stops; the bar stays, to carry on from there.
    await win.keyboard.press('Control+Shift+Space')
    await expect(readingBar(win)).toContainText('Stopped.')
    await expect(highlight(win)).toHaveCount(0)
    await expect(win.getByRole('button', { name: 'Listen' })).toHaveAttribute('aria-pressed', 'false')

    // The highlight went through the scene sentence by sentence, in order.
    const order = (await seen(win)).lit
    const steps = [
      'The lamps along the harbour wall',
      'Nobody on the quay looked up.',
      '"Get out of the rain',
      'said Mara.',
      'Tobin pulled his collar up',
      'The ferry was waiting',
      'They crossed in silence'
    ].map((words) => litAt(order, words))
    expect(steps[0]).toBe(0)
    for (let i = 1; i < steps.length; i++) expect(steps[i], `highlight ${i + 1} of ${steps.length}`).toBeGreaterThan(steps[i - 1])
    expect(litAt(order, 'The door closed behind them')).toBe(-1)
    // Who the bar said was speaking, in order.
    const who = (await seen(win)).bar.map((b) => b.split(' · ')[0])
    expect(who.indexOf('Narrator')).toBeLessThan(who.indexOf('Mara'))
    expect(who.lastIndexOf('Narrator')).toBeGreaterThan(who.indexOf('Mara'))

    // Her line was read in the voice Suggest described; the narration in the narrator's voice, with her name said
    // the way Say it as gives it.
    const said = await spoken(speech)
    const line = said.find((s) => s.input.startsWith('Get out of the rain'))
    expect(line?.voice_design).toBe(SUGGESTED_VOICE)
    const narration = said.find((s) => s.input.startsWith('The lamps along the harbour wall'))
    expect(narration?.voice).toBe('narrator')
    expect(narration?.voice_design).toBeUndefined()
    expect(said.map((s) => s.input)).toContain('said MAH-ra.')
    await expect(prose(win)).toContainText('said Mara.')

    // Carry on reads again from the line it stopped at; the bar's Stop and Close end it.
    await readingBar(win).getByRole('button', { name: 'Carry on' }).click()
    await expect(highlight(win).first()).toBeVisible({ timeout: 30_000 })
    await readingBar(win)
      .getByRole('button', { name: /^Stop reading/ })
      .click()
    await expect(readingBar(win)).toContainText('Stopped.')
    await readingBar(win).getByRole('button', { name: 'Close' }).click()
    await expect(readingBar(win)).toBeHidden()

    // From the cursor in the last paragraph: just that, then the bar says the story is read, and goes by itself.
    await prose(win).locator('p').nth(5).click()
    await watchReading(win)
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Read to the end of the story.', { timeout: 30_000 })
    const last = (await seen(win)).lit
    expect(litAt(last, 'The door closed behind them')).toBe(0)
    expect(litAt(last, 'On the far side')).toBe(-1)
    await expect(readingBar(win)).toBeHidden({ timeout: 10_000 })
  } finally {
    await speech.close()
    await fake.close()
  }
})

/** Five paragraphs of one long sentence each (each a line of about four seconds at 0.75×), starting "Part n." */
const PARTS = Array.from(
  { length: 5 },
  (_, i) =>
    `Part ${i + 1}. The tide crept in over the stones of the old harbour wall while the gulls argued above the boats and the lamps came on one by one along the quay.`
)

test('the player bar: Next line and Back one line, the speed, and Emotion and tone', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, speed: 0.75 } })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    await prose(win).click()
    for (const [i, para] of PARTS.entries()) {
      if (i) await win.keyboard.press('Enter')
      await win.keyboard.type(para)
    }
    await win.keyboard.press('Control+Home')
    await win.keyboard.press('Control+l')
    const bar = readingBar(win)
    await expect(bar).toContainText('Narrator', { timeout: 30_000 })
    await expect(bar).toContainText('Paragraph 1 of 5')
    await expect.poll(() => lit(win)).toMatch(/^Part 1\./)
    await expect(bar.getByRole('button', { name: /^Pause/ })).toBeVisible()
    await expect(bar.getByRole('button', { name: 'Speed: 0.75×' })).toBeVisible()

    // Next line: on to the next paragraph's line at once; again; then Back one line reads the one before again.
    await bar.getByRole('button', { name: 'Next line' }).click()
    await expect.poll(() => lit(win)).toMatch(/^Part 2\./)
    await expect(bar).toContainText('Paragraph 2 of 5')
    await bar.getByRole('button', { name: 'Next line' }).click()
    await expect.poll(() => lit(win)).toMatch(/^Part 3\./)
    await bar.getByRole('button', { name: 'Back one line' }).click()
    await expect.poll(() => lit(win)).toMatch(/^Part 2\./)
    await expect(bar).toContainText('Paragraph 2 of 5')
    // Paused, Next line carries on with the next line.
    await win.keyboard.press('Control+l')
    await expect(bar).toContainText('Paused')
    await bar.getByRole('button', { name: 'Next line' }).click()
    await expect.poll(() => lit(win)).toMatch(/^Part 3\./)
    await expect(bar).not.toContainText('Paused')

    // The speed: a short list, heard at once and saved as the read-aloud speed.
    await bar.getByRole('button', { name: 'Speed: 0.75×' }).click()
    await win.getByRole('menuitemradio', { name: '1.5×' }).click()
    await expect(bar.getByRole('button', { name: 'Speed: 1.5×' })).toBeVisible()
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.speed).toBe(1.5)

    // Stopped, the big button carries on and the steps wait for a line.
    await win.keyboard.press('Control+Shift+Space')
    await expect(bar).toContainText('Stopped.')
    await expect(bar.getByRole('button', { name: 'Next line' })).toBeDisabled()
    await expect(bar.getByRole('button', { name: 'Carry on' })).toBeEnabled()

    // Emotion and tone: Off, says what it does, and turns on from the bar; Settings says so beside its switch.
    const tone = bar.getByRole('button', { name: 'Emotion and tone: Off' })
    await expect(tone).toBeVisible()
    await expect(tone).toHaveAttribute('title', /^Emotion and tone: Off\./)
    await tone.click()
    const panel = win.getByRole('dialog')
    await panel.getByRole('switch', { name: 'Emotion and tone' }).click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.markSpeakers).toBe(true)
    await expect(bar.getByRole('button', { name: 'Emotion and tone: On' })).toBeVisible()
    await expect(panel.getByRole('switch', { name: 'Sighs and laughs' })).not.toBeChecked()
    await panel.getByRole('button', { name: 'Open settings' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'Read aloud and dictation' })).toBeVisible()
    await expect(win.getByRole('switch', { name: 'Mark who says what' })).toBeChecked()
    await expect(win.getByText('Emotion and tone: On', { exact: true })).toBeVisible()
    await expect(win.getByText('Sighs and laughs: Off', { exact: true })).toBeVisible()
  } finally {
    await speech.close()
  }
})

test('Settings: Hear a voice, Sample, pick the narrator, clear saved audio; Listen from here reads in that voice', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    await win.reload()
    await expect(prose(win)).toBeVisible()

    await openSettings(win, 'Read aloud and dictation')
    const voices = win.getByRole('radiogroup', { name: "Narrator's voice" })
    const voice = (name: string) => voices.getByRole('radio', { name, exact: true })
    await expect(voices.getByRole('radio')).toHaveCount(9)
    await expect(voice('Narrator')).toHaveAttribute('aria-checked', 'true')
    await expect(voice('Narrator')).toContainText('Suggested')
    await expect(voice('storyteller')).toContainText('Your clip')

    // Hear: the sample sentence in that voice, without picking it.
    await voices.getByRole('button', { name: 'Hear Deep narrator' }).click()
    await expect
      .poll(async () => (await spoken(speech)).some((s) => s.voice === 'narrator-deep' && s.input.startsWith('The rain had not stopped')))
      .toBe(true)
    await expect(voice('Narrator')).toHaveAttribute('aria-checked', 'true')

    // Sample: the sentence typed, read as reading will sound (Enter plays it, and adds no new line).
    await win.getByLabel('Sample sentence').fill('The tide came in over the causeway at dusk.')
    await win.getByLabel('Sample sentence').press('Enter')
    await expect(win.getByLabel('Sample sentence')).toHaveValue('The tide came in over the causeway at dusk.')
    await expect
      .poll(async () =>
        (await spoken(speech)).some((s) => s.voice === 'narrator' && s.input === 'The tide came in over the causeway at dusk.')
      )
      .toBe(true)
    await expect(win.getByRole('button', { name: 'Sample', exact: true })).toBeVisible({ timeout: 30_000 })
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.sample).toBe('The tide came in over the causeway at dusk.')

    // Picking another narrator.
    await voice('Bright narrator').click()
    await expect(voice('Bright narrator')).toHaveAttribute('aria-checked', 'true')
    await expect(voice('Narrator')).toHaveAttribute('aria-checked', 'false')
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.narratorVoice).toBe('narrator-bright')
    // From the keyboard: the list is one stop for Tab, and the arrow keys move and pick.
    await expect(voice('Bright narrator')).toHaveAttribute('tabindex', '0')
    await expect(voice('Narrator')).toHaveAttribute('tabindex', '-1')
    await expect(voices.getByRole('button', { name: 'Hear Deep narrator' })).toHaveAttribute('tabindex', '-1')
    await voice('Bright narrator').focus()
    await win.keyboard.press('ArrowDown')
    await expect(voice('Young woman')).toBeFocused()
    await expect(voice('Young woman')).toHaveAttribute('aria-checked', 'true')
    await win.keyboard.press('ArrowUp')
    await expect(voice('Bright narrator')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.narratorVoice).toBe('narrator-bright')

    // More: the saved audio, and Clear.
    await win.getByRole('button', { name: 'More', exact: true }).click()
    await expect(win.getByRole('heading', { name: 'Dialogue and characters' })).toBeVisible()
    await expect(win.getByText(/^[1-9]\d* clips?$/)).toBeVisible()
    await win.getByRole('button', { name: 'Clear', exact: true }).click()
    await expect(win.getByText('Saved audio cleared.')).toBeVisible()
    await expect(win.getByText('0 clips', { exact: true })).toBeVisible()

    // Listen from here, over selected words: reading starts at the first of them, in the voice picked.
    await sceneRow(win).click()
    await prose(win).click()
    await win.keyboard.type('The ferry was late again. Mara counted the lamps on the far shore, one by one, and waited.')
    await win.keyboard.press('Control+Home')
    for (let i = 0; i < 'The ferry was late again. '.length; i++) await win.keyboard.press('ArrowRight')
    for (let i = 0; i < 'Mara'.length; i++) await win.keyboard.press('Shift+ArrowRight')
    const selected = win.getByRole('toolbar', { name: 'Selected words' })
    await watchReading(win)
    await selected.getByRole('button', { name: 'Listen from here' }).click()
    await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })
    await expect.poll(async () => (await seen(win)).lit[0] ?? '').toMatch(/^Mara counted the lamps/)
    await expect.poll(async () => (await spoken(speech)).find((s) => s.input.startsWith('Mara counted'))?.voice).toBe('narrator-bright')
    expect((await spoken(speech)).some((s) => s.input.startsWith('The ferry was late'))).toBe(false)
    // The selected words' toolbar can float over the reading bar on a shorter window (CI): let go of the selection first.
    await win.keyboard.press('End')
    await expect(selected).toBeHidden()
    await readingBar(win).getByRole('button', { name: 'Close' }).click()
    await expect(readingBar(win)).toBeHidden()
  } finally {
    await speech.close()
  }
})

test('editing while it reads: the next lines are read as they now stand; Keep reading goes on into the next scene', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    const [story] = await invoke(win, 'listStories')
    const { chapters } = await invoke(win, 'getOutline', story.id)
    const morning = await invoke(win, 'createScene', chapters[0].id, { title: 'Morning' })
    await invoke(win, 'saveSceneText', morning.id, null, 'Morning came grey over the water.')
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    await win.reload()
    await expect(prose(win)).toBeVisible()

    await sceneRow(win).click()
    await prose(win).click()
    await win.keyboard.type(SCENE[0])
    await win.keyboard.press('Enter')
    await win.keyboard.type('Nobody looked up.')
    await win.keyboard.press('Control+Home')
    await watchReading(win)
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })
    // While the first line plays, Adam adds to the next paragraph (its first words are already prepared).
    await win.keyboard.press('Control+End')
    await win.keyboard.type(' Not even the gulls.')

    // The end of the scene: on into the next one by itself, read from its top.
    await expect(readingBar(win)).toContainText('Read to the end of the story.', { timeout: 30_000 })
    await expect(prose(win)).toContainText('Morning came grey over the water.')
    const { lit: order, bar } = await seen(win)
    expect(litAt(order, 'The lamps along the harbour wall')).toBe(0)
    expect(litAt(order, 'Not even the gulls.')).toBeGreaterThan(litAt(order, 'Nobody looked up.'))
    expect(litAt(order, 'Morning came grey')).toBeGreaterThan(litAt(order, 'Not even the gulls.'))
    expect(bar).toContain('On to “Morning”…')
    expect((await spoken(speech)).some((s) => s.input.includes('Not even the gulls.'))).toBe(true)
  } finally {
    await speech.close()
  }
})

test('the bar names the chapter and scene being read, and the binder marks them as reading moves on', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    const [story] = await invoke(win, 'listStories')
    const crossing = await invoke(win, 'createChapter', story.id, { title: 'The Crossing' })
    const ferry = await invoke(win, 'createScene', crossing.id, { title: 'The Ferry' })
    await invoke(win, 'saveSceneText', ferry.id, null, SCENE.slice(2).join('\n\n'))
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    await win.reload()
    await expect(prose(win)).toBeVisible()

    const chapterRow = (title: string) => binder(win).locator('[data-row="chapter"]', { hasText: title })
    const ferryRow = binder(win).locator('[data-row="scene"]', { hasText: 'The Ferry' })
    const marks = binder(win).locator('[data-playing]')

    await sceneRow(win).click()
    await prose(win).click()
    await win.keyboard.type(SCENE[0])
    await win.keyboard.press('Enter')
    await win.keyboard.type(SCENE[1])
    await win.keyboard.press('Control+Home')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Paused')

    // The bar names what it reads; the binder marks the scene (a speaker over its status dot) and its chapter.
    const place = readingBar(win).getByRole('button', { name: 'Chapter 1 · Scene 1' })
    await expect(place).toBeVisible()
    await expect(sceneRow(win).locator('[data-playing]')).toHaveAttribute('title', 'Reading aloud, paused')
    await expect(chapterRow('Chapter 1').locator('[data-playing]')).toBeVisible()
    await expect(marks).toHaveCount(2)
    // Clicking the name keeps the scene open, with the line being read in view.
    await place.click()
    await expect(prose(win)).toContainText(SCENE[1])
    await expect(highlight(win).first()).toBeInViewport()

    // Keep reading goes on into the next chapter: the bar and the marks go with it.
    await readingBar(win)
      .getByRole('button', { name: /^Carry on/ })
      .click()
    const next = readingBar(win).getByRole('button', { name: 'Chapter 2 · The Ferry' })
    await expect(next).toBeVisible({ timeout: 30_000 })
    // The chapter's own title is in its tooltip.
    await expect(next).toHaveAttribute('title', /^Chapter 2: The Crossing · The Ferry[.,]/)
    await expect(ferryRow.locator('[data-playing]')).toHaveAttribute('title', 'Playing aloud')
    await expect(chapterRow('The Crossing').locator('[data-playing]')).toBeVisible()
    await expect(marks).toHaveCount(2)

    // Stopped, nothing is marked as playing.
    await win.keyboard.press('Control+Shift+Space')
    await expect(readingBar(win)).toContainText('Stopped.')
    await expect(marks).toHaveCount(0)
  } finally {
    await speech.close()
  }
})

test('another scene opened while it reads: it reads on unseen, Ctrl+L and stop work there, the highlight is back in its scene, and its end stops there', async ({
  launch
}) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    const [story] = await invoke(win, 'listStories')
    const { chapters, scenes } = await invoke(win, 'getOutline', story.id)
    const morning = await invoke(win, 'createScene', chapters[0].id, { title: 'Morning' })
    await invoke(win, 'saveSceneText', scenes[0].id, null, SCENE.join('\n\n'))
    await invoke(win, 'saveSceneText', morning.id, null, 'Morning came grey over the water.')
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    const morningRow = binder(win).locator('[data-row="scene"]', { hasText: 'Morning' })
    const place = readingBar(win).getByRole('button', { name: 'Chapter 1 · Scene 1' })

    await sceneRow(win).click()
    await expect(prose(win)).toContainText(SCENE[0])
    await prose(win).click()
    await win.keyboard.press('Control+Home')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })
    await expect(highlight(win).first()).toBeVisible()

    // Another scene: the reading goes on (its next lines are asked for), named in the bar, with nothing lit in that page.
    const asked = (await spoken(speech)).length
    await morningRow.click()
    await expect(prose(win)).toContainText('Morning came grey over the water.')
    await expect(place).toBeVisible()
    await expect.poll(async () => (await spoken(speech)).length, { timeout: 30_000 }).toBeGreaterThan(asked)
    await expect(highlight(win)).toHaveCount(0)

    // Ctrl+L pauses and carries on from there.
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Paused')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).not.toContainText('Paused')

    // The scene's name in the bar goes back to it: the line being read is lit again, further on than the first.
    await place.click()
    await expect(prose(win)).toContainText(SCENE[0])
    await expect(highlight(win).first()).toBeVisible()
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Paused')
    expect(await lit(win)).not.toContain('The lamps along the harbour wall')

    // Its end while Adam is in another scene: it stops there, and Keep reading doesn't open the next scene.
    await morningRow.click()
    await expect(prose(win)).toContainText('Morning came grey over the water.')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Read to the end of the scene.', { timeout: 30_000 })
    await expect(prose(win)).toContainText('Morning came grey over the water.')
    expect((await spoken(speech)).some((s) => s.input.includes('Morning came grey'))).toBe(false)

    // The stop shortcut works from another scene too.
    await sceneRow(win).click()
    await expect(prose(win)).toContainText(SCENE[0])
    await prose(win).click()
    await win.keyboard.press('Control+Home')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })
    await morningRow.click()
    await expect(prose(win)).toContainText('Morning came grey over the water.')
    await win.keyboard.press('Control+Shift+Space')
    await expect(readingBar(win)).toContainText('Stopped.')
  } finally {
    await speech.close()
  }
})

test('Mark who says what: the AI notes who says each line and how, and the bar shows it', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, markSpeakers: true } })
    await useFakeModel(win, fake)

    await prose(win).click()
    await win.keyboard.type(SCENE[0])
    await win.keyboard.press('Enter')
    await win.keyboard.type(SCENE[1])
    await win.keyboard.press('Control+Home')
    await watchReading(win)
    await win.keyboard.press('Control+l')
    // The lines are read with the AI's notes (the fake's tones), the narration's as well as Mara's.
    await expect
      .poll(async () => (await seen(win)).bar.some((b) => /^Mara · (quiet and wary|bright and quick)$/.test(b)), { timeout: 30_000 })
      .toBe(true)
    // The narration keeps its feeling but never slows down (the fake marks it slow).
    expect((await seen(win)).bar).toContain('Narrator · hushed and steady')
    expect((await seen(win)).bar.some((b) => /^Narrator .*slow/.test(b))).toBe(false)
    // The note went to the voice with her line.
    const line = (await spoken(speech)).find((s) => s.input.startsWith('Get out of the rain'))
    expect(line?.delivery).toMatch(/^(quiet and wary|bright and quick)$/)
  } finally {
    await speech.close()
    await fake.close()
  }
})

/** A long scene: ten paragraphs of about 840 characters, each starting "Part n." (8,400 characters in all). */
const LONG = Array.from({ length: 10 }, (_, i) =>
  `Part ${i + 1}. ${'The tide crept in over the stones while the gulls argued on the harbour wall below. '.repeat(10)}`.trim()
)

test('Mark who says what keeps its notes ahead of the reading, to the end of a long scene', async ({ launch }) => {
  test.setTimeout(180_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    const [story] = await invoke(win, 'listStories')
    const { chapters } = await invoke(win, 'getOutline', story.id)
    const long = await invoke(win, 'createScene', chapters[0].id, { title: 'The long crossing' })
    await invoke(win, 'saveSceneText', long.id, null, LONG.join('\n\n'))
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true, markSpeakers: true, speed: 2 } })
    await useFakeModel(win, fake)

    await binder(win).locator('[data-row]', { hasText: 'The long crossing' }).first().click()
    await expect(prose(win)).toContainText('Part 10.')
    await prose(win).click()
    await win.keyboard.press('Control+Home')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText('Narrator', { timeout: 30_000 })
    // Far past the part noted as reading started (about 4,000 characters), each paragraph is still read with the
    // AI's note on it: the notes kept ahead of the reading.
    await expect.poll(async () => (await spoken(speech)).some((s) => s.input.startsWith('Part 9.')), { timeout: 120_000 }).toBe(true)
    await win.keyboard.press('Control+Shift+Space')
    const said = await spoken(speech)
    for (const n of [2, 5, 7, 8, 9]) {
      expect(said.find((s) => s.input.startsWith(`Part ${n}.`))?.delivery, `Part ${n}`).toBe('hushed and steady')
    }
  } finally {
    await speech.close()
    await fake.close()
  }
})

test('a line the rules can’t place is marked by the AI, with no voices of their own', async ({ launch }) => {
  test.setTimeout(120_000)
  const fake = await startFake()
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'createEntry', 'character', { name: 'Mara' })
    await invoke(win, 'createEntry', 'character', { name: 'Tobin' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    await useFakeModel(win, fake)

    await prose(win).click()
    const lines = [
      SCENE[0],
      '"Get out of the rain," said Mara.',
      '"I was waiting for you," Tobin snapped.',
      '"Fine," someone muttered from the dark.',
      'Nobody answered, and the rain came down harder on the slate roofs.'
    ]
    for (const [i, para] of lines.entries()) {
      if (i) await win.keyboard.press('Enter')
      await win.keyboard.type(para)
    }
    await win.keyboard.press('Control+Home')
    await watchReading(win)
    await win.keyboard.press('Control+l')
    // The rules give the exchange its speakers; someone outside it is nobody's turn, and the AI says who.
    await expect.poll(async () => (await seen(win)).bar.some((b) => b.startsWith('A stranger')), { timeout: 30_000 }).toBe(true)
    const who = (await seen(win)).bar.map((b) => b.split(' · ')[0])
    expect(who.indexOf('Mara')).toBeGreaterThan(-1)
    expect(who.indexOf('Tobin')).toBeGreaterThan(who.indexOf('Mara'))
    expect(who.indexOf('A stranger')).toBeGreaterThan(who.indexOf('Tobin'))
  } finally {
    await speech.close()
    await fake.close()
  }
})

test('a line the voice can’t read stays lit, to try again or skip', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    await prose(win).click()
    await win.keyboard.type('The ferry was late again.')
    await win.keyboard.press('Enter')
    await win.keyboard.type('The engine coughed twice. Then it FAIL-SPEECH stalled out on the black water.')
    await win.keyboard.press('Enter')
    await win.keyboard.type('Mara counted the lamps on the far shore.')
    await win.keyboard.press('Control+Home')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText("The voice couldn't read this line.", { timeout: 30_000 })
    // The line it couldn't read is lit, all of it (both sentences, as Skip this line skips both), so it is clear which.
    await expect.poll(() => lit(win)).toBe('The engine coughed twice. Then it FAIL-SPEECH stalled out on the black water.')
    await expect(readingBar(win).getByRole('button', { name: 'Try again' })).toBeVisible()

    // Skip this line: reading carries on after it, to the end, and the line isn't asked for again.
    const failing = async (): Promise<number> => (await spoken(speech)).filter((s) => s.input.includes('FAIL-SPEECH')).length
    const tries = await failing()
    await watchReading(win)
    await readingBar(win).getByRole('button', { name: 'Skip this line' }).click()
    await expect(readingBar(win)).toContainText('Read to the end of the story.', { timeout: 30_000 })
    const after = (await seen(win)).lit
    expect(litAt(after, 'Mara counted the lamps')).toBeGreaterThan(-1)
    expect(after.findIndex((l, i) => i > 0 && l.trimStart().startsWith('The engine coughed'))).toBe(-1)
    expect((await spoken(speech)).some((s) => s.input.startsWith('Mara counted the lamps'))).toBe(true)
    expect(await failing()).toBe(tries)
  } finally {
    await speech.close()
  }
})

test('the speech engine not running, then its voices not ready: plain words, and the way to fix it', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech({ voicesNotReady: true })
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    // Nothing answers at this address.
    await invoke(win, 'updateSettings', { speech: { serverUrl: 'http://127.0.0.1:9/v1', readAloud: true } })
    await win.reload()
    await expect(prose(win)).toBeVisible()
    await prose(win).click()
    await win.keyboard.type('The ferry was late again.')
    await win.keyboard.press('Control+l')
    await expect(readingBar(win)).toContainText("The speech engine isn't running.", { timeout: 30_000 })
    await expect(highlight(win)).toHaveCount(0)
    await readingBar(win).getByRole('button', { name: 'Open speech settings' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'Read aloud and dictation' })).toBeVisible()
    await expect(win.getByText("The speech engine isn't running. Start it above, then try again.")).toBeVisible()

    // The engine starts, but its voices can't load yet: Try again lists them, and Hear says what is wrong.
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url } })
    await win.getByRole('button', { name: 'Try again' }).click()
    await expect(win.getByRole('radiogroup', { name: "Narrator's voice" }).getByRole('radio')).toHaveCount(9)
    await expect(win.getByText("The speech engine isn't running. Start it above, then try again.")).toBeHidden()
    await win.getByRole('button', { name: 'Hear Deep narrator' }).click()
    await expect(
      win.getByText("The voices aren't ready yet. Download them above, or check the speech engine there, then try again.")
    ).toBeVisible()

    // Back in the scene, Try again in the bar reads again, and says the voices aren't ready.
    await sceneRow(win).click()
    await expect(readingBar(win)).toContainText("The speech engine isn't running.")
    await readingBar(win).getByRole('button', { name: 'Try again' }).click()
    await expect(readingBar(win)).toContainText("The voices aren't ready yet.", { timeout: 30_000 })
    await expect(readingBar(win).getByRole('button', { name: 'Open speech settings' })).toBeVisible()
  } finally {
    await speech.close()
  }
})

// ---------- A character's voice: on their page and in the Cast ----------

const voiceBox = (win: Page) => win.getByRole('region', { name: 'Read-aloud voice' })
const castList = (win: Page) => win.getByRole('list', { name: 'Cast' })
const castRow = (win: Page, name: string) => castList(win).locator('li', { hasText: name })

/** Opens the sample world (Gullhaven: Wren Halloway, Edric Halloway, Ansel Crane and Iska Vey) in the window. */
async function sampleWorld(win: Page): Promise<void> {
  await expect(win.getByRole('heading', { name: 'Create a world' })).toBeVisible()
  await invoke(win, 'openSampleWorld')
  await win.reload()
  await expect(win.locator('.scene-prose')).toContainText('A hundred and twelve steps to the lamp room.')
}

/** The sample world's characters by name. */
async function characters(win: Page): Promise<Record<string, string>> {
  return Object.fromEntries((await invoke(win, 'listEntries', 'character')).map((e) => [e.name, e.id]))
}

/**
 * A data folder whose speech folder has the voices and the two made-up studio voices (Clara and Arthur) "downloaded",
 * as tests/fake-speech/install.mjs leaves them, so Give everyone a voice has studio voices to give.
 */
function withStudioVoices(): string {
  const dataDir = newDataDir()
  const home = join(dataDir, 'app', 'speech')
  const touch = (...parts: string[]): void => {
    const file = join(home, ...parts)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '')
  }
  touch('venvs', 'breeze', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
  touch('models', 'breeze', 'code', 'breeze_infer', '__init__.py')
  touch('models', 'breeze', '.ready')
  touch('models', 'hf', 'hub', 'models--BreezeBlue--breeze-tts-2', 'snapshots', 'fake', 'config.json')
  touch('voices', 'library', '.ready')
  const index = [
    { id: 'p001', gender: 'female', age: '26-35', hz: 210, moods: ['anger', 'whisper'], name: 'Clara', pitch: 'mid' },
    { id: 'p002', gender: 'male', age: '46-55', hz: 110, moods: ['anger', 'whisper'], name: 'Arthur', pitch: 'low' }
  ]
  writeFileSync(join(home, 'voices', 'library', 'index.json'), JSON.stringify(index))
  const at = new Date().toISOString()
  writeFileSync(join(home, 'installed.json'), JSON.stringify({ voices: { at, from: 'own', root: home, gpu: '' }, studio: { at } }))
  return dataDir
}

const top = async (el: ReturnType<Page['locator']>): Promise<number> => (await el.boundingBox())!.y

test('a character’s voice box is near the top of their page, with read aloud off or on', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await createWorldFromWelcome(win, 'Harbour')
    const mara = await invoke(win, 'createEntry', 'character', { name: 'Mara', summary: 'Runs the harbour ferry.' })
    await invoke(win, 'createEntry', 'place', { name: 'The Quay' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url } })
    expect((await invoke(win, 'getSettings')).speech.readAloud).toBe(false)

    // Read aloud is off, and Mara's page still has her voice box, under her description and above the sections.
    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await win.locator('[data-entry]').filter({ hasText: 'Mara' }).first().click()
    const box = voiceBox(win)
    await expect(box).toBeVisible()
    await expect(box.getByRole('heading', { name: 'Read-aloud voice' })).toBeVisible()
    await expect(box).toContainText('Read aloud is off. Describe or pick Mara’s voice now')
    expect(await top(box)).toBeGreaterThan(await top(win.getByLabel('Description', { exact: true })))
    expect(await top(box)).toBeLessThan(await top(win.getByRole('button', { name: /^Basics/ })))
    expect(await top(box)).toBeLessThan(await top(win.getByText('Private notes (never sent to the AI)')))
    // Hear and Listen wait for read aloud; her voice can be described now, ready for it.
    await expect(box.getByRole('button', { name: 'Hear' })).toHaveCount(0)
    await box.getByLabel('How they sound').fill('A low, quick voice with a harbour burr.')
    await expect
      .poll(async () => (await invoke(win, 'getEntryReadAloud', mara.id)).voice.design)
      .toBe('A low, quick voice with a harbour burr.')

    // Turn on read aloud, from her page: on, and the box has Hear.
    await box.getByRole('button', { name: 'Turn on read aloud' }).click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.readAloud).toBe(true)
    await expect(box).not.toContainText('Read aloud is off')
    await expect(box.getByRole('button', { name: 'Hear' })).toBeEnabled()
    await expect(box.getByLabel('How they sound')).toHaveValue('A low, quick voice with a harbour burr.')

    // A place has no voice of its own: its "Say it as" stays at the foot of its page.
    await binder(win).getByRole('button', { name: 'Places' }).click()
    await win.locator('[data-entry]').filter({ hasText: 'The Quay' }).first().click()
    const said = win.getByRole('region', { name: 'Read aloud', exact: true })
    await expect(said).toBeVisible()
    expect(await top(said)).toBeGreaterThan(await top(win.getByLabel('Description', { exact: true })))
    await expect(voiceBox(win)).toHaveCount(0)
  } finally {
    await speech.close()
  }
})

test('the Cast in Settings: every character and their voice; a voice picked there shows on their page', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch()
    await sampleWorld(win)
    const ids = await characters(win)
    await invoke(win, 'setEntryReadAloud', ids['Iska Vey'], { voice: { design: 'Husky and quick, never still.', voice: '' }, say: '' })
    await invoke(win, 'setEntryReadAloud', ids['Ansel Crane'], { voice: { design: '', voice: 'old-man' }, say: '' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    // The window reads the settings afresh.
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()

    // The palette's Read-aloud cast opens it.
    await win.keyboard.press('Control+K')
    await win.keyboard.type('read-aloud cast')
    await expect(win.getByRole('dialog', { name: 'Search' }).getByRole('option', { selected: true })).toContainText('Read-aloud cast')
    await win.keyboard.press('Enter')
    await expect(win.getByRole('heading', { level: 1, name: 'Read aloud and dictation' })).toBeVisible()
    await expect(win.getByRole('heading', { name: 'Cast', exact: true })).toBeInViewport()

    // Each of the sample world's characters, by name, with the voice their lines are read in.
    await expect(castList(win).locator('li')).toHaveCount(4)
    await expect(castList(win).locator('li p:first-child')).toHaveText(['Ansel Crane', 'Edric Halloway', 'Iska Vey', 'Wren Halloway'])
    await expect(castRow(win, 'Ansel Crane').locator('[data-cast-voice]')).toHaveText('Old man')
    await expect(castRow(win, 'Iska Vey').locator('[data-cast-voice]')).toHaveText('Made from their description')
    await expect(castRow(win, 'Wren Halloway').locator('[data-cast-voice]')).toHaveText('Dialogue voice')
    // Without the studio voices, nobody can be given one here.
    await expect(win.getByRole('button', { name: 'Give everyone without a voice a voice' })).toBeDisabled()
    await expect(win.getByText('Needs the studio voices')).toBeVisible()
    // Hear plays a line in their voice.
    await castRow(win, 'Ansel Crane').getByRole('button', { name: 'Hear Ansel Crane' }).click()
    await expect.poll(async () => (await spoken(speech)).some((s) => s.voice === 'old-man')).toBe(true)

    // A voice picked for Wren is saved at once, as on her page.
    await castRow(win, 'Wren Halloway').getByRole('combobox', { name: 'Wren Halloway’s voice' }).click()
    await win.getByRole('option', { name: /^Young woman/ }).click()
    await expect(castRow(win, 'Wren Halloway').locator('[data-cast-voice]')).toHaveText('Young woman')
    await expect.poll(async () => (await invoke(win, 'getEntryReadAloud', ids['Wren Halloway'])).voice.voice).toBe('young-woman')

    // Open page: her page, at her voice, with the voice picked there too.
    await castRow(win, 'Wren Halloway').getByRole('button', { name: 'Open page' }).click()
    const box = voiceBox(win)
    await expect(box).toBeInViewport()
    await expect(box.getByRole('combobox', { name: 'Or a voice from the list' })).toContainText('Young woman')
    await expect(box.getByLabel('How they sound')).toBeFocused()

    // From her page, the palette offers Set Wren Halloway’s voice.
    await win.keyboard.press('Control+K')
    await win.keyboard.type('voice')
    await expect(win.getByRole('dialog', { name: 'Search' }).getByRole('option', { name: /Set Wren Halloway’s voice/ })).toBeVisible()
    await win.keyboard.press('Escape')
  } finally {
    await speech.close()
  }
})

test('Give everyone without a voice a voice: each gets a studio voice, the Cast says so, and Undo takes them back', async ({ launch }) => {
  test.setTimeout(120_000)
  const speech = await startSpeech()
  try {
    const { win } = await launch({ dataDir: withStudioVoices() })
    await sampleWorld(win)
    const ids = await characters(win)
    // Iska is described and Ansel has a voice picked: those stay theirs.
    await invoke(win, 'setEntryReadAloud', ids['Iska Vey'], { voice: { design: 'Husky and quick, never still.', voice: '' }, say: '' })
    await invoke(win, 'setEntryReadAloud', ids['Ansel Crane'], { voice: { design: '', voice: 'old-man' }, say: '' })
    await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url, readAloud: true } })
    // The window reads the settings afresh.
    await win.reload()
    await expect(win.locator('.scene-prose')).toBeVisible()
    expect((await invoke(win, 'getSpeechStatus')).installed.studio).toBe(true)

    await openSettings(win, 'Read aloud and dictation')
    await expect(castList(win).locator('li')).toHaveCount(4)
    await expect(win.getByText('2 characters have no voice yet')).toBeVisible()
    await win.getByRole('button', { name: 'Give everyone without a voice a voice' }).click()

    // Wren and Edric each got one of the two studio voices; the Cast says who got which, and that the app gave them.
    const given = win.getByRole('status').filter({ hasText: 'Given voices' })
    await expect(given).toBeVisible()
    const wren = (await invoke(win, 'getEntryReadAloud', ids['Wren Halloway'])).voice.voice
    const edric = (await invoke(win, 'getEntryReadAloud', ids['Edric Halloway'])).voice.voice
    expect([wren, edric].sort()).toEqual(['clip:library/p001.wav', 'clip:library/p002.wav'])
    const name = (id: string): string => (id === 'clip:library/p001.wav' ? 'Clara' : 'Arthur')
    await expect(given).toContainText(`Wren Halloway: ${name(wren)}`)
    await expect(given).toContainText(`Edric Halloway: ${name(edric)}`)
    await expect(castRow(win, 'Wren Halloway').locator('[data-cast-voice]')).toHaveText(`Auto: ${name(wren)} (studio voice)`)
    await expect(castRow(win, 'Iska Vey').locator('[data-cast-voice]')).toHaveText('Made from their description')
    await expect(castRow(win, 'Ansel Crane').locator('[data-cast-voice]')).toHaveText('Old man')
    await expect(win.getByText('Everyone here has a voice of their own.')).toBeVisible()
    await expect(win.getByRole('button', { name: 'Give everyone without a voice a voice' })).toBeDisabled()

    // Undo: they are back to the dialogue voice.
    await given.getByRole('button', { name: 'Undo' }).click()
    await expect(given).toBeHidden()
    await expect(castRow(win, 'Wren Halloway').locator('[data-cast-voice]')).toHaveText('Dialogue voice')
    expect((await invoke(win, 'getEntryReadAloud', ids['Edric Halloway'])).voice.voice).toBe('')
  } finally {
    await speech.close()
  }
})
