// Dictation (milestone 4): picking the hold-to-talk key in Settings (with the mouse or the keyboard),
// holding it to type what was said into the scene at the cursor (one Ctrl+Z takes it out, and the moment
// before the key went down is kept), into a scene card field, and with a window switch half way; the
// marker clear of the words in the middle of a paragraph; a Ctrl key that only listens on its own; the
// Quick start box's microphone button, and its words offered to copy when building starts first; the
// microphone Test with its level and try-it box, before and after the speech engine is ready; problems in
// plain words with Open Settings and Try again; the shortcuts list's line. Chromium's fake microphone
// (AIWRITE_FAKE_MIC=1: a beep every half second) does the talking, and the fake speech server
// (tests/fake-speech) writes it down.
import type { ElectronApplication, Page } from '@playwright/test'
import { binder, createWorldFromWelcome, expect, invoke, openSettings, startFake, test, useFakeModel } from './helpers'

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

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/** When the page saw a key go down and come up, by its own clock (ms). */
interface KeyTimes {
  down?: number
  up?: number
}

/** What these tests reach in the page itself, typed just enough: the tests are checked without the page's own types. */
interface InPage {
  document: {
    activeElement: { blur(): void } | null
    querySelector(selector: string): { firstChild: { textContent: string | null } | null } | null
    createRange(): {
      setStart(node: unknown, offset: number): void
      setEnd(node: unknown, offset: number): void
      selectNodeContents(node: unknown): void
      getClientRects(): ArrayLike<Box>
    }
  }
  getSelection(): { removeAllRanges(): void; addRange(range: unknown): void } | null
  dispatchEvent(event: unknown): boolean
  addEventListener(type: 'keydown' | 'keyup', listener: (e: { code: string; timeStamp: number }) => void, capture: boolean): void
  Event: new (type: string) => unknown
  keyTimes?: KeyTimes
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

/**
 * Looking at the level meter often: the fake microphone beeps every half second and the level falls away
 * between beeps, so a look every second (what a poll slows to) can keep landing between them.
 */
const LEVEL_POLL = { timeout: 5000, intervals: [50] }

/** Holds a key for a while (long enough for the fake microphone's beeps) and lets go. */
async function hold(win: Page, key: string, ms = 1300): Promise<void> {
  await win.keyboard.down(key)
  await expect(marker(win)).toContainText('Listening')
  await win.waitForTimeout(ms)
  await win.keyboard.up(key)
}

/**
 * Notes when the page sees the key `code` first go down and come up, as dictation does; the function it
 * gives back says how long, in seconds, it was held.
 */
async function timeHold(win: Page, code: string): Promise<() => Promise<number>> {
  await win.evaluate((code) => {
    const w = globalThis as unknown as InPage
    const times: KeyTimes = (w.keyTimes = {})
    w.addEventListener('keydown', (e) => (e.code === code && times.down === undefined ? (times.down = e.timeStamp) : undefined), true)
    w.addEventListener('keyup', (e) => (e.code === code && times.up === undefined ? (times.up = e.timeStamp) : undefined), true)
  }, code)
  return async () => {
    const t = await win.evaluate(() => (globalThis as unknown as InPage).keyTimes)
    expect(t?.down !== undefined && t.up !== undefined).toBe(true)
    return (t!.up! - t!.down!) / 1000
  }
}

/** The words of each line of the scene's first paragraph, as boxes on the screen, top to bottom. */
const lineBoxes = (win: Page): Promise<Box[]> =>
  win.evaluate(() => {
    const w = globalThis as unknown as InPage
    const range = w.document.createRange()
    range.selectNodeContents(w.document.querySelector('.scene-prose p'))
    const lines: Box[] = []
    for (const r of Array.from(range.getClientRects())) {
      const line = lines.find((l) => Math.abs(l.top - r.top) < 2)
      if (line) Object.assign(line, { left: Math.min(line.left, r.left), right: Math.max(line.right, r.right) })
      else lines.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom })
    }
    return lines.sort((a, b) => a.top - b.top)
  })

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
    // With a key picked, the microphone is kept ready, so the moment before the key goes down is there to keep.
    await win.waitForTimeout(1000)
    const heldFor = await timeHold(win, 'F9')

    await win.keyboard.down('F9')
    await expect(marker(win)).toContainText('Listening')
    // The marker sits just after the end of the cursor's line (the last of its paragraph), over the page.
    const box = (await marker(win).boundingBox())!
    const [words] = await lineBoxes(win)
    expect(box.x).toBeGreaterThanOrEqual(words.right)
    expect(box.x).toBeLessThan(words.right + 12)
    expect(Math.abs(box.y + box.height / 2 - (words.top + words.bottom) / 2)).toBeLessThan(3)
    await win.waitForTimeout(1300)
    await win.keyboard.up('F9')
    await expect(marker(win)).toContainText('Writing it down')
    await expect(prose(win)).toHaveText('She lit the lamp. The lantern flickered twice.')
    await expect(marker(win)).toHaveCount(0)

    // What was sent: 16 kHz mono 16-bit, as long as the key was held with the 0.45 s before it went down
    // and 0.25 s after it came up (the last word on its way), after 0.3 s of quiet put in front. Without
    // the moment before, it would be 0.45 s shorter.
    const sent = await recordings(speech)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ sampleRate: 16000, channels: 1, bits: 16 })
    const held = await heldFor()
    expect(held).toBeGreaterThan(1.2)
    const expected = 0.3 + 0.45 + held + 0.25
    expect(sent[0].seconds).toBeGreaterThan(expected - 0.2)
    expect(sent[0].seconds).toBeLessThan(expected + 0.2)
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

test('in the middle of a paragraph the marker shows small, in the gap between the lines, clear of the words', async ({ launch }) => {
  const speech = await startSpeech({ dictation: 'slowly', dictationDelayMs: 400 })
  try {
    const { app, win } = await setUp(launch, speech)
    await makeDictationReady(app)
    await win.keyboard.type(
      'The ferry rocked against the pier while the gulls wheeled overhead, and Brann counted the coins twice before ' +
        'he looked up at the gate. Nobody came. The lamps along the harbour wall were lit one by one, and still he ' +
        'waited, his hat in his hands, listening for the bell.'
    )
    await pickKey(win, 'F9', 'F9')
    const lines = await lineBoxes(win)
    expect(lines.length).toBeGreaterThanOrEqual(3)
    // The cursor in the middle of the second line, at the start of a word.
    const [above, middle] = lines
    await win.mouse.click((middle.left + middle.right) / 2, (middle.top + middle.bottom) / 2)
    await win.keyboard.press('Control+ArrowLeft')
    const caret = await win.evaluate(() => {
      const w = globalThis as unknown as { getSelection(): { getRangeAt(i: number): { getBoundingClientRect(): Box } } }
      return w.getSelection().getRangeAt(0).getBoundingClientRect()
    })

    await win.keyboard.down('F9')
    await expect(marker(win)).toContainText('Listening')
    await expect(marker(win)).toHaveAttribute('data-small', 'true')
    // Over the cursor, its middle in the gap between the words of the line above and those of the cursor's line.
    const box = (await marker(win).boundingBox())!
    expect(box.height).toBeLessThanOrEqual(16)
    expect(Math.abs(box.x + box.width / 2 - caret.left)).toBeLessThan(3)
    const centre = box.y + box.height / 2
    expect(centre).toBeGreaterThan(above.bottom - 1)
    expect(centre).toBeLessThan(middle.top + 1)
    await win.waitForTimeout(1300)
    await win.keyboard.up('F9')
    await expect(marker(win)).toContainText('Writing it down')
    await expect(marker(win)).toHaveAttribute('data-small', 'true')
    await expect(prose(win)).toContainText(' slowly ')
    await expect(marker(win)).toHaveCount(0)
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
  const fake = await startFake()
  try {
    const { app, win } = await setUp(launch, speech)
    await useFakeModel(win, fake)
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

    // Building starts while it listens: the box can't be typed in while the character is built, so what
    // was said is offered to copy instead, never lost.
    options.dictation = 'Missing two fingers.'
    await mic.click()
    await expect(marker(win)).toContainText('Listening')
    await win.waitForTimeout(1300)
    await main(win).getByRole('button', { name: 'Build the character' }).click()
    await expect(
      win.getByText("The box your words were for can't take them now, so here they are to copy: “Missing two fingers.”")
    ).toBeVisible()
    await expect(notes).toHaveValue('Tall and quiet. A ferryman who owes the Duke money.')
    await win.getByRole('button', { name: 'Copy', exact: true }).click()
    await expect(win.getByText('Copied. Paste them where you like.')).toBeVisible()
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('Missing two fingers.')
    await expect(marker(win)).toHaveCount(0)
  } finally {
    await fake.close()
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
    // Said plainly, with the way to the fix, and Try again for once it is fixed.
    const problem = win.getByText('No dictation model is loaded. Pick one in Settings, then try again.')
    await expect(problem).toBeVisible()
    await expect(prose(win)).toHaveText('Night fell')
    await win.getByRole('button', { name: 'Open Settings' }).click()
    await expect(win.getByRole('heading', { level: 1, name: 'Read aloud and dictation' })).toBeVisible()
    // The message stays, so Try again is still there once the fix is made.
    await expect(problem).toBeVisible()
    delete options.dictationFail
    await win.getByRole('button', { name: 'Try again' }).click()
    await expect(problem).toHaveCount(0)
    await settingsButton(win).click()
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

    // The key can be picked from the keyboard too: Enter or Space on the button starts picking, and again
    // stops it, as on any button, without being taken for the key or refused.
    const waiting = 'Press the key you want to hold while you talk. Esc clears it.'
    await win.getByRole('button', { name: 'Pick a key' }).focus()
    for (const key of ['Enter', 'Space']) {
      await win.keyboard.press(key)
      await expect(keyBox(win)).toHaveText('Press a key…')
      await expect(win.getByText(waiting)).toBeVisible()
      await expect(win.getByRole('button', { name: 'Cancel' })).toBeFocused()
      await win.keyboard.press(key)
      await expect(keyBox(win)).toHaveText('None')
      await expect(win.getByText(/^No key yet\./)).toBeVisible()
    }
    await win.keyboard.press('Enter')
    await win.keyboard.press('F8')
    await expect(keyBox(win)).toHaveText('F8')
    await expect(win.getByText('Hold F8 and talk, then let go.')).toBeVisible()

    // Until the speech engine is ready, Settings says so plainly, with the way to it.
    await expect(win.getByText("Dictation needs the speech engine, which isn't running.")).toBeVisible()
    await expect(win.getByRole('button', { name: 'Go to the speech engine' })).toBeVisible()

    // The Test still shows the level then, and says that was all it could test, and why. The line about
    // the Test keeps its room, so nothing below it moves as it changes.
    await main(win).getByRole('button', { name: 'More', exact: true }).click()
    const meter = win.getByRole('meter', { name: 'Microphone level' })
    const line = win.getByTestId('microphone-test-line')
    const tryIt = win.getByText('Try it', { exact: true })
    const below = async (): Promise<number> => (await tryIt.boundingBox())!.y - (await line.boundingBox())!.y
    const room = await below()
    await expect(line).toHaveText('Click Test and say a sentence or two.')
    await expect(meter).toHaveAttribute('aria-valuenow', '0')
    await win.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(line).toHaveText('Listening. Say a sentence or two, then click Stop.')
    await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), LEVEL_POLL).toBeGreaterThan(30)
    expect(await below()).toBe(room)
    await win.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(line).toHaveText(
      /^Only the level was tested\. Your words can be written down once the speech engine is running\.\s*Go to the speech engine$/
    )
    await expect(line.getByRole('button', { name: 'Go to the speech engine' })).toBeVisible()
    await expect(meter).toHaveAttribute('aria-valuenow', '0')
    expect(await below()).toBe(room)
    expect(await recordings(speech)).toHaveLength(0)

    // Once the speech engine is ready, none of that holds any more, and it goes.
    await makeDictationReady(app)
    await expect(win.getByRole('button', { name: 'Go to the speech engine' })).toHaveCount(0)
    await expect(line).toHaveText('Click Test and say a sentence or two.')

    await win.getByRole('button', { name: 'Test', exact: true }).click()
    await expect(line).toHaveText('Listening. Say a sentence or two, then click Stop.')
    await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow')), LEVEL_POLL).toBeGreaterThan(30)
    await win.waitForTimeout(600)
    await win.getByRole('button', { name: 'Stop', exact: true }).click()
    await expect(win.getByLabel('Try it')).toHaveValue('Testing, one, two, three.')
    await expect(line).toHaveText("That's what the microphone heard. If a word came out wrong, try again a little closer to it.")
    await expect(meter).toHaveAttribute('aria-valuenow', '0')
    expect(await below()).toBe(room)

    // The microphones on this computer can be picked; the computer's default is first.
    await win.getByLabel('Listen with').click()
    await expect(win.getByRole('option', { name: "The computer's default" })).toBeVisible()
    await win.getByRole('option', { name: 'Fake Audio Input 1' }).click()
    await expect.poll(async () => (await invoke(win, 'getSettings')).speech.microphone).not.toBe('')
  } finally {
    await speech.close()
  }
})
