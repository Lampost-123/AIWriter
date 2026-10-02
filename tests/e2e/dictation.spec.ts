// Dictation (milestone 4): picking the hold-to-talk key in Settings, holding it to type what was said
// into the scene at the cursor (one Ctrl+Z takes it out), into a scene card field, and with a window
// switch half way; a Ctrl key that only listens on its own; the Quick start box's microphone button;
// the microphone Test with its level and try-it box; problems in plain words with Try again; the
// shortcuts list's line. Chromium's fake microphone (AIWRITE_FAKE_MIC=1: a beep every half second)
// does the talking, and the fake speech server (tests/fake-speech) writes it down.
import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

interface Heard {
  bytes: number
  sampleRate: number
  channels: number
  bits: number
  seconds: number
  peak: number
}
interface FakeSpeech {
  url: string
  close(): Promise<void>
}
/** What the fake speech server answers (read on every recording, so a test can change it as it goes). */
interface SpeechOptions {
  dictation?: string | string[]
  dictationDelayMs?: number
  dictationFail?: { status: number; detail: string }
}

// The fake speech server, loaded without types: its typings belong to the speech engine part.
const FAKE_SPEECH: string = '../fake-speech/server.mjs'

async function startSpeech(options: SpeechOptions): Promise<FakeSpeech> {
  const { startFakeSpeech } = (await import(FAKE_SPEECH)) as { startFakeSpeech: (o: SpeechOptions) => Promise<FakeSpeech> }
  return startFakeSpeech(options)
}

/** The recordings the fake speech server was sent. */
const recordings = async (speech: FakeSpeech): Promise<Heard[]> =>
  (await fetch(`${speech.url.replace(/\/v1$/, '')}/__dictation`)).json() as Promise<Heard[]>

/**
 * The speech engine says dictation is ready (as the real one does once Parakeet or Whisper is loaded),
 * from now on: the speech engine itself is another part's, and here it stands in for a server that has
 * a dictation model.
 */
async function makeDictationReady(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow, ipcMain }) => {
    const ready = { server: 'connected', voicesReady: false, dictationReady: true }
    ipcMain.removeHandler('api:getSpeechStatus')
    ipcMain.handle('api:getSpeechStatus', () => ({ ok: true, value: ready }))
    for (const w of BrowserWindow.getAllWindows()) {
      const wc = w.webContents
      const send = wc.send.bind(wc)
      wc.send = (channel: string, ...args: unknown[]) =>
        send(channel, ...(channel === 'event:speech:status' ? [{ ...(args[0] as object), ...ready }] : args))
      wc.send('event:speech:status', ready)
    }
  })
}

/** Starts the app with the fake microphone, makes a world, and points dictation at the fake speech server. */
async function setUp(
  launch: (o?: { env?: Record<string, string> }) => Promise<{ app: ElectronApplication; win: Page }>,
  speech: FakeSpeech
) {
  const { app, win } = await launch({ env: { AIWRITE_FAKE_MIC: '1' } })
  await createWorldFromWelcome(win, 'Dictation')
  await invoke(win, 'updateSettings', { speech: { serverUrl: speech.url } })
  return { app, win }
}

/** What these tests reach in the page itself, typed just enough: the tests are checked without the page's own types. */
interface InPage {
  document: {
    activeElement: { blur(): void } | null
    querySelector(selector: string): { firstChild: { textContent: string | null } | null } | null
    createRange(): { setStart(node: unknown, offset: number): void; setEnd(node: unknown, offset: number): void }
  }
  getSelection(): { removeAllRanges(): void; addRange(range: unknown): void } | null
  dispatchEvent(event: unknown): boolean
  Event: new (type: string) => unknown
}

/** Nothing in the page has the keyboard (so ? opens the shortcuts list). */
const blurAll = (win: Page) => win.evaluate(() => (globalThis as unknown as InPage).document.activeElement?.blur())

/** The window goes to the back, or comes to the front again, as when Adam switches to another app and back. */
const windowEvent = (win: Page, type: 'blur' | 'focus') =>
  win.evaluate((type) => {
    const w = globalThis as unknown as InPage
    w.dispatchEvent(new w.Event(type))
  }, type)

const prose = (win: Page) => win.locator('.scene-prose')
const marker = (win: Page) => win.locator('[data-dictation-marker]')
const keyBox = (win: Page) => win.getByTestId('dictation-key')
const main = (win: Page) => win.locator('main')
const settingsButton = (win: Page) => win.getByRole('button', { name: 'Settings', exact: true })

/** Picks the hold-to-talk key in Settings › Read aloud and dictation, then goes back to the page. */
async function pickKey(win: Page, key: string, shown: string): Promise<void> {
  await openSettings(win, 'Read aloud and dictation')
  await win.getByRole('button', { name: /^(Pick a key|Change)$/ }).click()
  await expect(keyBox(win)).toHaveText('Press a key…')
  await win.keyboard.press(key)
  await expect(keyBox(win)).toHaveText(shown)
  await settingsButton(win).click()
  await expect(prose(win)).toBeVisible()
}

/** Holds a key for a while (long enough for the fake microphone's beeps) and lets go. */
async function hold(win: Page, key: string, ms = 1300): Promise<void> {
  await win.keyboard.down(key)
  await expect(marker(win)).toContainText('Listening')
  await win.waitForTimeout(ms)
  await win.keyboard.up(key)
}

test('holding the dictation key types what was said at the cursor, and one Ctrl+Z takes it out', async ({ launch }) => {
  const options: SpeechOptions = { dictation: 'The lantern flickered twice.', dictationDelayMs: 600 }
  const speech = await startSpeech(options)
  try {
    const { app, win } = await setUp(launch, speech)
    await makeDictationReady(app)
    await expect(prose(win)).toBeFocused()
    await win.keyboard.type('She lit the lamp.')

    // The shortcuts list says where to pick the key until there is one.
    await blurAll(win)
    await win.keyboard.press('?')
    const list = win.getByRole('dialog', { name: 'Keyboard shortcuts' })
    await expect(list.getByRole('listitem').filter({ hasText: 'Speak instead of typing' })).toContainText(
      'Pick a key in Settings › Read aloud and dictation'
    )
    await win.keyboard.press('Escape')

    await pickKey(win, 'F9', 'F9')
    await prose(win).click()
    await win.keyboard.press('Control+End')

    await win.keyboard.down('F9')
    await expect(marker(win)).toContainText('Listening')
    // The marker sits by the cursor's line, over the page.
    const box = await marker(win).boundingBox()
    const page = await prose(win).boundingBox()
    expect(box && page && box.y < page.y + page.height && box.x >= page.x - 20).toBe(true)
    await win.waitForTimeout(1300)
    await win.keyboard.up('F9')
    await expect(marker(win)).toContainText('Writing it down')
    await expect(prose(win)).toHaveText('She lit the lamp. The lantern flickered twice.')
    await expect(marker(win)).toHaveCount(0)

    // What was sent: 16 kHz mono 16-bit, as long as the key was held, with the moment before it.
    const sent = await recordings(speech)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ sampleRate: 16000, channels: 1, bits: 16 })
    expect(sent[0].seconds).toBeGreaterThan(1.6)
    expect(sent[0].seconds).toBeLessThan(4)
    expect(sent[0].peak).toBeGreaterThan(0.1)

    // Typing carries on after the words, and one Ctrl+Z takes out just them.
    await win.keyboard.press('Control+z')
    await expect(prose(win)).toHaveText('She lit the lamp.')
    await win.keyboard.press('Control+y')
    await expect(prose(win)).toHaveText('She lit the lamp. The lantern flickered twice.')

    // Words over a selection take its place, with the spaces they need.
    options.dictation = 'guttered'
    await win.evaluate(() => {
      const w = globalThis as unknown as InPage
      const text = w.document.querySelector('.scene-prose p')!.firstChild!
      const at = text.textContent!.indexOf('flickered')
      const range = w.document.createRange()
      range.setStart(text, at)
      range.setEnd(text, at + 'flickered'.length)
      const sel = w.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await hold(win, 'F9')
    await expect(prose(win)).toHaveText('She lit the lamp. The lantern guttered twice.')
    const [story] = await invoke(win, 'listStories')
    const { scenes } = await invoke(win, 'getOutline', story.id)
    await expect.poll(async () => (await invoke(win, 'getScene', scenes[0].id)).text).toBe('She lit the lamp. The lantern guttered twice.')

    // Switching to another window while the key is held stops and types what was said.
    options.dictation = 'Then it went out.'
    await win.keyboard.press('Control+End')
    await win.keyboard.down('F9')
    await expect(marker(win)).toContainText('Listening')
    await win.waitForTimeout(1300)
    await windowEvent(win, 'blur')
    await expect(prose(win)).toHaveText('She lit the lamp. The lantern guttered twice. Then it went out.')
    await win.keyboard.up('F9')
    await windowEvent(win, 'focus')
    expect(await recordings(speech)).toHaveLength(3)

    // The shortcuts list shows the key picked.
    await blurAll(win)
    await win.keyboard.press('?')
    const line = list.getByRole('listitem').filter({ hasText: 'Speak instead of typing' })
    await expect(line).toContainText('F9')
    await expect(line).not.toContainText('Pick a key')
    await win.keyboard.press('Escape')
  } finally {
    await speech.close()
  }
})

test('a Ctrl key only listens when pressed on its own, so Ctrl+C still copies', async ({ launch }) => {
  const options: SpeechOptions = { dictation: 'and the door creaked' }
  const speech = await startSpeech(options)
  try {
    const { app, win } = await setUp(launch, speech)
    await makeDictationReady(app)
    await win.keyboard.type('The house was quiet')
    await pickKey(win, 'ControlRight', 'Right Ctrl')
    await prose(win).click()
    await win.keyboard.press('Control+End')

    // Right Ctrl with C: a copy, not dictation.
    await win.keyboard.press('Shift+Home')
    await win.keyboard.down('ControlRight')
    await win.keyboard.press('c')
    await win.waitForTimeout(400)
    await win.keyboard.up('ControlRight')
    await expect(marker(win)).toHaveCount(0)
    await win.waitForTimeout(500)
    expect(await recordings(speech)).toHaveLength(0)
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('The house was quiet')

    // On its own, it listens.
    await win.keyboard.press('End')
    await hold(win, 'ControlRight')
    await expect(prose(win)).toHaveText('The house was quiet and the door creaked')
    expect(await recordings(speech)).toHaveLength(1)
  } finally {
    await speech.close()
  }
})

test('dictation goes into a scene card field, and Ctrl+Z there takes it out', async ({ launch }) => {
  const options: SpeechOptions = { dictation: 'the hidden door' }
  const speech = await startSpeech(options)
  try {
    const { app, win } = await setUp(launch, speech)
    await makeDictationReady(app)
    await pickKey(win, 'F9', 'F9')

    const card = win.getByRole('tabpanel', { name: 'Scene card' })
    const goal = card.getByLabel('Goal')
    await goal.click()
    await win.keyboard.type('Find')
    await hold(win, 'F9')
    await expect(goal).toHaveValue('Find the hidden door')
    // It is saved, as typing is.
    const [story] = await invoke(win, 'listStories')
    const { scenes } = await invoke(win, 'getOutline', story.id)
    await expect.poll(async () => (await invoke(win, 'getScene', scenes[0].id)).card.goal).toBe('Find the hidden door')
    await expect(goal).toBeFocused()
    await win.keyboard.press('Control+z')
    await expect(goal).toHaveValue('Find')
  } finally {
    await speech.close()
  }
})

test('the Quick start box has a microphone button: one click listens, the next puts the words in', async ({ launch }) => {
  const options: SpeechOptions = { dictation: 'A ferryman who owes the Duke money.', dictationDelayMs: 500 }
  const speech = await startSpeech(options)
  try {
    const { app, win } = await setUp(launch, speech)
    await binder(win).getByRole('button', { name: 'Characters' }).click()
    await main(win)
      .getByRole('button', { name: /^Quick start (an? \w+ )?from a few notes$/ })
      .click()
    const notes = main(win).getByLabel('What you know about them')
    await expect(notes).toBeVisible()
    // Not until dictation can be used.
    const mic = main(win).getByRole('button', { name: /^Speak instead of typing/ })
    await expect(mic).toHaveCount(0)
    await makeDictationReady(app)
    await expect(mic).toBeVisible()

    await notes.fill('Tall and quiet.')
    await mic.click()
    await expect(marker(win)).toContainText('Listening')
    const stop = main(win).getByRole('button', { name: 'Stop, and put in what you said' })
    await expect(stop).toHaveAttribute('aria-pressed', 'true')
    await win.waitForTimeout(1300)
    await stop.click()
    await expect(marker(win)).toContainText('Writing it down')
    await expect(notes).toHaveValue('Tall and quiet. A ferryman who owes the Duke money.')
    await expect(mic).toBeVisible()
    await expect(marker(win)).toHaveCount(0)
  } finally {
    await speech.close()
  }
})

test('a problem writing it down is said plainly, and Try again still puts the words in', async ({ launch }) => {
  const options: SpeechOptions = { dictation: 'and the rain came', dictationFail: { status: 503, detail: 'No dictation model is loaded.' } }
  const speech = await startSpeech(options)
  try {
    const { app, win } = await setUp(launch, speech)
    await makeDictationReady(app)
    await win.keyboard.type('Night fell')
    await pickKey(win, 'F9', 'F9')
    await prose(win).click()
    await win.keyboard.press('Control+End')

    await hold(win, 'F9')
    const problem = win.getByText(/Dictation isn't ready yet: no dictation model is loaded\./)
    await expect(problem).toBeVisible()
    await expect(prose(win)).toHaveText('Night fell')
    delete options.dictationFail
    await win.getByRole('button', { name: 'Try again' }).click()
    await expect(prose(win)).toHaveText('Night fell and the rain came')
  } finally {
    await speech.close()
  }
})

test('the microphone Test shows a live level and writes what it heard in the try-it box', async ({ launch }) => {
  const options: SpeechOptions = { dictation: 'Testing, one, two, three.' }
  const speech = await startSpeech(options)
  try {
    const { app, win } = await setUp(launch, speech)
    await openSettings(win, 'Read aloud and dictation')
    // Until the speech engine is ready, Settings says so plainly, with the way to it.
    await expect(win.getByText("Dictation needs the speech engine, which isn't running.")).toBeVisible()
    await expect(win.getByRole('button', { name: 'Go to the speech engine' })).toBeVisible()
    await makeDictationReady(app)
    await expect(win.getByRole('button', { name: 'Go to the speech engine' })).toHaveCount(0)

    await main(win).getByRole('button', { name: 'More', exact: true }).click()
    const meter = win.getByRole('meter', { name: 'Microphone level' })
    await expect(meter).toHaveAttribute('aria-valuenow', '0')
    await win.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(win.getByText('Listening. Say a sentence or two, then click Stop.')).toBeVisible()
    await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), { timeout: 5000 }).toBeGreaterThan(30)
    await win.waitForTimeout(600)
    await win.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(win.getByLabel('Try it')).toHaveValue('Testing, one, two, three.')
    await expect(meter).toHaveAttribute('aria-valuenow', '0')

    // The microphones on this computer can be picked; the computer's default is first.
    await win.getByLabel('Listen with').click()
    await expect(win.getByRole('option', { name: "The computer's default" })).toBeVisible()
    await win.getByRole('option', { name: 'Fake Audio Input 1' }).click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.microphone).not.toBe('')
  } finally {
    await speech.close()
  }
})
