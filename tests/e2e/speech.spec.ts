// App tests for the speech engine (milestone 4): its status in Settings › Read aloud and dictation, the
// server address and Check, and the one-click downloads with their steps, progress, Cancel and Try again.
// Nothing is downloaded and no Python runs: every download step runs tests/fake-speech/install.mjs
// (AIWRITE_FAKE_SPEECH_INSTALL), and the server AI Write starts is tests/fake-speech/server.mjs
// (AIWRITE_FAKE_SPEECH_RUN), which reads what the fake downloads left in the speech folder and, like the real
// one, refuses requests a web page could send (so every request AI Write makes must say it's AI Write's).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { Locator, Page, TestInfo } from '@playwright/test'
import type { FakeSpeech, FakeSpeechOptions } from '../fake-speech/server.mjs'
import { closeWindow, createWorldFromWelcome, expect, invoke, openSettings, test } from './helpers'

const FAKE = resolve(__dirname, '..', 'fake-speech')
const KEY = 'hf_E2eTestKeyThatStaysSecret0123456789'
const WRONG_KEY = 'hf_E2eTestKeyHuggingFaceTurnsDown98765'

/** Starts a fake speech server of the test's own (loaded as the app's tests load the fake AI server). */
async function startFakeSpeech(options: FakeSpeechOptions): Promise<FakeSpeech> {
  const fake = await import('../fake-speech/server.mjs')
  return fake.startFakeSpeech(options)
}

/** A port nothing listens on, so no other speech server on this computer is found by chance. */
function unusedPort(): Promise<number> {
  return new Promise((done) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => done(port))
    })
  })
}

/** The fake downloads and server, and a control file saying how each step behaves (install.mjs) and how the server starts (server.mjs). */
function fakes(testInfo: TestInfo, extra: Record<string, string> = {}) {
  const control = testInfo.outputPath('control.json')
  mkdirSync(dirname(control), { recursive: true })
  const set = (c: Record<string, string>): void => writeFileSync(control, JSON.stringify(c))
  set({})
  return {
    env: {
      AIWRITE_FAKE_SPEECH_INSTALL: join(FAKE, 'install.mjs'),
      AIWRITE_FAKE_SPEECH_RUN: join(FAKE, 'server.mjs'),
      AIWRITE_FAKE_SPEECH_OPTIONS: JSON.stringify({ guard: true }),
      AIWRITE_FAKE_SPEECH_CONTROL: control,
      AIWRITE_FAKE_SPEECH_GPU: 'NVIDIA GeForce RTX 4090',
      MCREADER_TTS_DIR: '',
      ...extra
    },
    set
  }
}

/** Settings' speech engine section (the everyday one, above More). */
const engine = (win: Page): Locator =>
  win
    .locator('section')
    .filter({ has: win.getByRole('heading', { level: 2, name: 'Speech engine', exact: true }) })
    .first()

/** One of the facts at the top: Voices, Dictation or Runs on. */
const fact = (win: Page, label: string): Locator =>
  engine(win)
    .locator('dl > div')
    .filter({ has: win.locator('dt', { hasText: label }) })
    .locator('dd')

/** Opens Settings › Read aloud and dictation in a new world, with the speech server's address where nothing answers. */
async function openSpeech(win: Page): Promise<string> {
  await createWorldFromWelcome(win, 'The Northern Reaches')
  const address = `http://127.0.0.1:${await unusedPort()}/v1`
  await invoke(win, 'updateSettings', { speech: { serverUrl: address } })
  await openSettings(win, 'Read aloud and dictation')
  await expect(engine(win).getByText('Not running', { exact: true })).toBeVisible()
  return address
}

const answers = (address: string): Promise<boolean> =>
  fetch(`${address}/health`, { signal: AbortSignal.timeout(1000) }).then(
    (r) => r.ok,
    () => false
  )

/** What AI Write asked its own (fake) server so far. */
const asked = async (address: string): Promise<{ method: string; path: string; ours: boolean }[]> =>
  (await (await fetch(`${address.replace(/\/v1$/, '')}/__requests`)).json()) as { method: string; path: string; ours: boolean }[]

/** A copy of MCreader v2's tts folder (empty files): its environment and code, and its weights, complete or not. */
function mcreaderCopy(tts: string, complete: boolean): void {
  const touch = (text: string, ...parts: string[]): void => {
    mkdirSync(join(tts, ...parts.slice(0, -1)), { recursive: true })
    writeFileSync(join(tts, ...parts), text)
  }
  touch('', 'venvs', 'breeze', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
  touch('', 'models', 'breeze', 'code', 'breeze_infer', '__init__.py')
  const snapshot = ['models', 'hf', 'hub', 'models--BreezeBlue--breeze-tts-2', 'snapshots', 'abc']
  // Hugging Face fetches the small files first.
  touch('{}', ...snapshot, 'config.json')
  if (!complete) return
  for (const f of ['tokenizer.json', 'tokenizer_config.json']) touch('{}', ...snapshot, f)
  touch('', ...snapshot, 'audio_tokenizer', 'model.safetensors')
  touch(
    JSON.stringify({ weight_map: { a: 'model-00001-of-00002.safetensors', b: 'model-00002-of-00002.safetensors' } }),
    ...snapshot,
    'model.safetensors.index.json'
  )
  for (const f of ['model-00001-of-00002.safetensors', 'model-00002-of-00002.safetensors']) touch('', ...snapshot, f)
}

test('shows Not running, then what is ready once the address is a speech server’s; Check asks again', async ({ launch }, testInfo) => {
  const options: FakeSpeechOptions = { voices: true, parakeet: false, whisper: true, dictationEngine: 'none', device: 'CPU' }
  const fake = await startFakeSpeech(options)
  try {
    const { win } = await launch({ env: fakes(testInfo).env })
    const nowhere = await openSpeech(win)
    const section = engine(win)
    await expect(section.getByText(`Nothing answers at ${nowhere}.`, { exact: false })).toBeVisible()
    await expect(fact(win, 'Voices')).toHaveText('Not downloaded')
    await expect(fact(win, 'Dictation')).toHaveText('Not picked')
    await expect(fact(win, 'Runs on')).toHaveText('NVIDIA GeForce RTX 4090')

    await win.getByRole('button', { name: 'More', exact: true }).click()
    const address = win.getByRole('textbox', { name: 'Server address' })
    await expect(address).toHaveValue(nowhere)

    // Only on this computer.
    await address.fill('http://192.168.1.4:8766/v1')
    await win.getByRole('button', { name: 'Check this address' }).click()
    await expect(win.getByText('That address isn’t on this computer. Use localhost, 127.0.0.1 or ::1', { exact: false })).toBeVisible()
    expect((await invoke(win, 'getSettings')).speech.serverUrl).toBe(nowhere)
    // Not an address at all.
    await address.fill('not an address')
    await win.getByRole('button', { name: 'Check this address' }).click()
    await expect(win.getByText('That isn’t an address. Type one like http://127.0.0.1:8766/v1.', { exact: true })).toBeVisible()

    // Typed without http:// or /v1: tidied, kept, and checked.
    await address.fill(fake.url.replace('http://', '').replace('/v1', ''))
    await win.getByRole('button', { name: 'Check this address' }).click()
    await expect(section.getByText('Connected', { exact: true })).toBeVisible()
    await expect(address).toHaveValue(fake.url)
    expect((await invoke(win, 'getSettings')).speech.serverUrl).toBe(fake.url)
    await expect(fact(win, 'Voices')).toHaveText('Ready')
    await expect(fact(win, 'Runs on')).toHaveText('Processor')
    await expect(fact(win, 'Dictation')).toHaveText('Not picked')
    const status = await invoke(win, 'getSpeechStatus')
    expect(status).toMatchObject({ server: 'connected', voicesReady: true, dictationReady: false, device: 'Processor', managed: false })

    // Check asks the server again.
    options.voices = false
    await section.getByRole('button', { name: 'Check', exact: true }).click()
    await expect(fact(win, 'Voices')).toHaveText('Not downloaded')

    // A server AI Write didn't start is never stopped by it; when it stops by itself, Check says so.
    await fake.close()
    await section.getByRole('button', { name: 'Check', exact: true }).click()
    await expect(section.getByText('Not running', { exact: true })).toBeVisible()
    await expect(section.getByText(`Nothing answers at ${fake.url}.`, { exact: false })).toBeVisible()
    // What it runs on stays known while nothing answers.
    await expect(fact(win, 'Runs on')).toHaveText('NVIDIA GeForce RTX 4090')
  } finally {
    await fake.close()
  }
})

test('downloads the speech engine step by step: Cancel stops it, Try again carries on, then it runs until AI Write quits', async ({
  launch
}, testInfo) => {
  const fake = fakes(testInfo)
  fake.set({ 'server:packages': 'slow' })
  const { app, win, dataDir } = await launch({ env: fake.env })
  const address = await openSpeech(win)
  const section = engine(win)

  // Start with AI Write: the first time, the server downloads.
  await section.getByRole('switch', { name: 'Start with AI Write' }).click()
  await expect(section.getByText('Starting', { exact: true })).toBeVisible()
  await expect(section.getByText('Downloading the speech engine', { exact: true })).toBeVisible()
  await expect(section.getByText('Step 3 of 4')).toBeVisible()
  const bar = section.getByRole('progressbar', { name: 'Download progress' })
  await expect.poll(async () => Number((await bar.getAttribute('aria-valuenow')) ?? 0)).toBeGreaterThan(0)
  await expect(section.getByText(/ of about 40 MB$/)).toBeVisible()
  await expect(section.getByText(/^(Still downloading server|Downloading fake_server)/)).toBeVisible()
  expect((await invoke(win, 'getSettings')).speech.runServer).toBe(true)

  // Cancel stops it, and says Try again carries on.
  await section.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(section.getByText('Download of the speech engine stopped. Try again carries on from where it can.')).toBeVisible()
  await expect(section.getByText('Not running', { exact: true })).toBeVisible()
  await expect(section.getByText('It starts once the speech engine is downloaded.')).toBeVisible()

  // Try again; this time the internet drops: the problem in plain words, and Try again.
  fake.set({ 'server:packages': 'offline' })
  await section.getByRole('button', { name: 'Try again' }).click()
  await expect(section.getByText('Couldn’t reach the internet to download it. Check the connection, then Try again.')).toBeVisible()
  await expect(section.getByText(/Traceback|ERROR:/)).toHaveCount(0)

  // And then it works, and the server starts.
  fake.set({})
  await section.getByRole('button', { name: 'Try again' }).click()
  await expect(win.getByText('The speech engine is downloaded.')).toBeVisible()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()
  await expect(fact(win, 'Runs on')).toHaveText('NVIDIA GeForce RTX 4090')
  await expect(fact(win, 'Voices')).toHaveText('Not downloaded')
  expect(await answers(address)).toBe(true)
  const log = readFileSync(join(dataDir, 'app', 'speech', 'logs', 'install.log'), 'utf8')
  expect(log).toContain('Downloading the speech engine (packages)')

  // Dictation: picking Whisper downloads it, and the server loads it.
  await section.getByRole('radio', { name: 'Whisper' }).click()
  await expect(win.getByText('Whisper is downloaded.')).toBeVisible()
  await expect(fact(win, 'Dictation')).toHaveText(/^Whisper, (ready|loaded)$/)
  await expect.poll(async () => (await invoke(win, 'getSpeechStatus')).dictationReady).toBe(true)
  expect((await invoke(win, 'getSettings')).speech.dictationEngine).toBe('whisper')

  // Parakeet picked while Whisper runs: until Parakeet is all there, dictation isn't ready, and the fact is about
  // Parakeet (never "Parakeet, loaded" for the Whisper the server still holds).
  fake.set({ 'parakeet:model': 'slow' })
  await section.getByRole('radio', { name: 'Parakeet' }).click()
  await expect(section.getByText('Downloading Parakeet’s English model', { exact: true })).toBeVisible()
  await expect(fact(win, 'Dictation')).toHaveText('Parakeet, downloading')
  expect((await invoke(win, 'getSpeechStatus')).dictationReady).toBe(false)
  // Stopped while it unpacks: nothing of it counts as downloaded.
  await section.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(section.getByText('Download of Parakeet stopped. Try again carries on from where it can.')).toBeVisible()
  await expect(fact(win, 'Dictation')).toHaveText('Parakeet, not downloaded')
  let status = await invoke(win, 'getSpeechStatus')
  expect(status).toMatchObject({ dictationReady: false, installed: { parakeet: false, whisper: true } })

  // Back to Whisper: the stopped Parakeet download isn't offered any more, and dictation is ready again.
  await section.getByRole('radio', { name: 'Whisper' }).click()
  await expect(fact(win, 'Dictation')).toHaveText(/^Whisper, (ready|loaded)$/)
  await expect(section.getByText('Download of Parakeet stopped.', { exact: false })).toHaveCount(0)
  await expect.poll(async () => (await invoke(win, 'getSpeechStatus')).dictationReady).toBe(true)
  status = await invoke(win, 'getSpeechStatus')
  expect(status.download).toBeNull()

  // Everything AI Write asked of its server that changes something said it was AI Write's (a web page can't).
  const posts = (await asked(address)).filter((r) => r.method === 'POST')
  expect(posts.length).toBeGreaterThan(0)
  expect(posts.every((r) => r.ours)).toBe(true)

  // AI Write quits: the server it started stops with it.
  await closeWindow(app)
  await expect.poll(() => answers(address), { timeout: 10_000 }).toBe(false)
})

test('picking a dictation model first downloads the engine, and turns Start with AI Write on so it runs', async ({ launch }, testInfo) => {
  const fake = fakes(testInfo)
  fake.set({ 'server:packages': 'slow' })
  const { win } = await launch({ env: fake.env })
  await openSpeech(win)
  const section = engine(win)
  const start = section.getByRole('switch', { name: 'Start with AI Write' })
  await expect(start).not.toBeChecked()

  await section.getByRole('radio', { name: 'Parakeet' }).click()
  await expect(section.getByText('Downloading the speech engine', { exact: true })).toBeVisible()
  await expect(section.getByText('Waiting for the speech engine to finish. Parakeet downloads next.', { exact: true })).toBeVisible()
  await expect(start).toBeChecked()
  expect((await invoke(win, 'getSettings')).speech.runServer).toBe(true)
  await section.getByRole('button', { name: 'Download the voices' }).click()
  await expect(
    section.getByText('Waiting for the speech engine to finish. The voices download after Parakeet.', { exact: true })
  ).toBeVisible()

  // Cancel stops them all; Parakeet's own button carries on, the engine first.
  await section.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(section.getByText('Waiting for', { exact: false })).toHaveCount(0)
  fake.set({})
  await section.getByRole('button', { name: 'Download Parakeet (about 1 GB)' }).click()
  await expect(win.getByText('The speech engine is downloaded.')).toBeVisible()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()
  await expect(win.getByText('Parakeet is downloaded.')).toBeVisible()
  await expect(fact(win, 'Dictation')).toHaveText(/^Parakeet, (ready|loaded)$/)
  await expect.poll(async () => (await invoke(win, 'getSpeechStatus')).dictationReady).toBe(true)
})

test('offers to download the speech engine again when part of it is missing, keeping the rest; a slow start never holds up Stop', async ({
  launch
}, testInfo) => {
  const fake = fakes(testInfo)
  const { win, dataDir } = await launch({ env: fake.env })
  await openSpeech(win)
  const section = engine(win)
  const start = section.getByRole('switch', { name: 'Start with AI Write' })
  await start.click()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()
  await section.getByRole('radio', { name: 'Whisper' }).click()
  await expect(win.getByText('Whisper is downloaded.')).toBeVisible()

  // Part of the engine goes missing (antivirus, a broken update): it stops as it starts.
  fake.set({ run: 'broken' })
  await start.click()
  await expect(section.getByText('Not running', { exact: true })).toBeVisible()
  await start.click()
  await expect(
    section.getByText('Part of the speech engine is missing. Download it again below (about 150 MB); the voices are kept.', { exact: true })
  ).toBeVisible()

  // One click: its environment is set up afresh (the dictation engine with it), and it starts.
  fake.set({})
  await section.getByRole('button', { name: 'Download the speech engine again' }).click()
  await expect(win.getByText('The speech engine is downloaded.')).toBeVisible()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()
  await expect(section.getByText('Part of the speech engine is missing.', { exact: false })).toHaveCount(0)
  const log = readFileSync(join(dataDir, 'app', 'speech', 'logs', 'install.log'), 'utf8')
  expect(log.match(/Setting up Python for the speech engine \(venv\)/g)).toHaveLength(2)
  // What was downloaded besides is kept.
  await expect(fact(win, 'Dictation')).toHaveText(/^Whisper, (ready|loaded)$/)
  expect((await invoke(win, 'getSpeechStatus')).installed.whisper).toBe(true)

  // A start that takes its time (antivirus checking the files the first time) never holds up turning it off.
  fake.set({ run: 'slow' })
  await start.click()
  await expect(section.getByText('Not running', { exact: true })).toBeVisible()
  await start.click()
  await expect(section.getByText('Starting the speech engine. It runs hidden and takes a few seconds.')).toBeVisible()
  const before = Date.now()
  await start.click()
  await expect(section.getByText('Not running', { exact: true })).toBeVisible({ timeout: 5000 })
  await expect(start).not.toBeChecked()
  expect(Date.now() - before).toBeLessThan(5000)
})

test('installs Python with one click when it isn’t on the computer', async ({ launch }, testInfo) => {
  const fake = fakes(testInfo, { AIWRITE_FAKE_SPEECH_PYTHON: 'missing' })
  const { win } = await launch({ env: fake.env })
  await openSpeech(win)
  const section = engine(win)

  await section.getByRole('switch', { name: 'Start with AI Write' }).click()
  await expect(
    section.getByText(
      'The speech engine runs on Python, which isn’t on this computer yet. AI Write can install it with Windows’ own installer.'
    )
  ).toBeVisible()

  fake.set({ python: 'slow' })
  await section.getByRole('button', { name: 'Install Python' }).click()
  await expect(section.getByText('Installing Python with Windows’ installer', { exact: true })).toBeVisible()
  await section.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(section.getByText('Download of the speech engine stopped.', { exact: false })).toBeVisible()

  // Try again: Python still isn't there, so it asks again; this time it installs, and the server follows.
  fake.set({})
  await section.getByRole('button', { name: 'Try again' }).click()
  await section.getByRole('button', { name: 'Install Python' }).click()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()
  await expect(win.getByText('The speech engine is downloaded.')).toBeVisible()
})

test('never counts voices stopped part way as downloaded', async ({ launch }, testInfo) => {
  const fake = fakes(testInfo)
  const { win } = await launch({ env: fake.env })
  await openSpeech(win)
  const section = engine(win)
  await section.getByRole('switch', { name: 'Start with AI Write' }).click()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()

  // Stopped while the weights download: their small files are there already, but the voices aren't.
  fake.set({ 'voices:weights': 'slow' })
  await section.getByRole('button', { name: 'Download the voices' }).click()
  await expect(section.getByText('Downloading the voices', { exact: true })).toBeVisible()
  await section.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(section.getByText('Download of the voices stopped. Try again carries on from where it can.')).toBeVisible()
  await section.getByRole('button', { name: 'Check', exact: true }).click()
  await expect(fact(win, 'Voices')).toHaveText('Not downloaded')
  expect(await invoke(win, 'getSpeechStatus')).toMatchObject({ voicesReady: false, installed: { voices: null } })

  // Try again finishes them.
  fake.set({})
  await section.getByRole('button', { name: 'Try again' }).click()
  await expect(win.getByText('The voices are downloaded.')).toBeVisible()
  await expect(fact(win, 'Voices')).toHaveText(/^Ready/)
  expect(await invoke(win, 'getSpeechStatus')).toMatchObject({ voicesReady: true, installed: { voices: 'own' } })
})

test('uses MCreader’s copy of the voices once it is complete, so the 12 GB isn’t downloaded twice', async ({ launch }, testInfo) => {
  const mcreader = mkdtempSync(join(tmpdir(), 'aiwrite-mcreader-'))
  const tts = join(mcreader, 'mcreader-v2', 'tts')
  mcreaderCopy(tts, false)
  try {
    const { win, dataDir } = await launch({ env: fakes(testInfo, { MCREADER_TTS_DIR: tts }).env })
    await openSpeech(win)
    const section = engine(win)
    // Still downloading in MCreader (or stopped there part way): not offered.
    await expect(section.getByRole('button', { name: 'Download the voices' })).toBeVisible()
    await expect(section.getByRole('button', { name: 'Use MCreader’s copy' })).toHaveCount(0)

    mcreaderCopy(tts, true)
    await section.getByRole('button', { name: 'Check', exact: true }).click()
    await section.getByRole('button', { name: 'Use MCreader’s copy' }).click()
    await expect(section.getByText(`From ${tts}`)).toBeVisible()
    await expect(fact(win, 'Voices')).toHaveText('MCreader’s copy')
    await expect(section.getByRole('button', { name: 'Download AI Write’s own copy' })).toBeVisible()

    // The server runs Breeze from MCreader's folder.
    await section.getByRole('switch', { name: 'Start with AI Write' }).click()
    await expect(section.getByText('Connected', { exact: true })).toBeVisible()
    await expect(fact(win, 'Voices')).toHaveText(/^Ready/)
    // Nothing of the voices was downloaded into AI Write's own folder.
    expect(existsSync(join(dataDir, 'app', 'speech', 'venvs'))).toBe(false)
  } finally {
    rmSync(mcreader, { recursive: true, force: true })
  }
})

test('remembers MCreader’s folder when it was found by hand', async ({ launch }, testInfo) => {
  const mcreader = mkdtempSync(join(tmpdir(), 'aiwrite-mcreader-'))
  const tts = join(mcreader, 'Apps', 'MCreader v2', 'tts')
  mcreaderCopy(tts, true)
  try {
    // Not where the search looks.
    const { app, win } = await launch({ env: fakes(testInfo).env })
    await openSpeech(win)
    const section = engine(win)
    await expect(section.getByRole('button', { name: 'Use MCreader’s copy' })).toHaveCount(0)
    await win.getByRole('button', { name: 'More', exact: true }).click()
    // The folder picker answers with MCreader's own folder.
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as unknown as typeof dialog.showOpenDialog
    }, dirname(tts))
    await win.getByRole('button', { name: 'Find its folder…' }).click()
    await expect(section.getByText(`From ${tts}`)).toBeVisible()
    await expect(fact(win, 'Voices')).toHaveText('MCreader’s copy')
    await expect(win.getByRole('button', { name: 'Find its folder…' })).toHaveCount(0)

    // Check looks again, and still knows where it is.
    expect((await invoke(win, 'checkSpeech')).mcreader).toEqual({ folder: tts })
    await section.getByRole('button', { name: 'Check', exact: true }).click()
    await expect(section.getByText(`From ${tts}`)).toBeVisible()
    await expect(win.getByRole('button', { name: 'Find its folder…' })).toHaveCount(0)
  } finally {
    rmSync(mcreader, { recursive: true, force: true })
  }
})

test('asks for the voices’ licence with a link and a key box; the key is kept like the AI keys and only the download gets it', async ({
  launch
}, testInfo) => {
  const fake = fakes(testInfo)
  const { win, dataDir } = await launch({ env: fake.env })
  await openSpeech(win)
  const section = engine(win)
  await section.getByRole('switch', { name: 'Start with AI Write' }).click()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()

  // Hugging Face wants the licence accepted first.
  fake.set({ 'voices:weights': 'refused' })
  await section.getByRole('button', { name: 'Download the voices' }).click()
  await expect(section.getByText('Hugging Face asks for the voices’ licence to be accepted before they can download.')).toBeVisible()
  await expect(section.getByRole('link', { name: 'the voices’ page on Hugging Face' })).toHaveAttribute(
    'href',
    'https://huggingface.co/BreezeBlue/breeze-tts-2'
  )
  await expect(section.getByRole('link', { name: 'Make a key on Hugging Face' })).toHaveAttribute(
    'href',
    'https://huggingface.co/settings/tokens'
  )
  // One way on: saving a key. No second download button, and no Try again that would stop the same way.
  await expect(section.getByRole('button', { name: 'Download the voices' })).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Try again', exact: true })).toHaveCount(0)
  await expect(section.getByRole('button', { name: 'Dismiss' })).toBeVisible()

  await section.getByLabel('Hugging Face key').fill('not a key')
  await section.getByRole('button', { name: 'Save key and try again' }).click()
  await expect(section.getByText('That doesn’t look like a Hugging Face key.', { exact: false })).toBeVisible()

  // A key Hugging Face turns down (mistyped, deleted, no read access): it says so, and asks for a new one.
  await section.getByLabel('Hugging Face key').fill(WRONG_KEY)
  await section.getByRole('button', { name: 'Save key and try again' }).click()
  await expect(section.getByText('Hugging Face didn’t accept the saved key.', { exact: true })).toBeVisible()
  await expect(section.getByText('Hugging Face asks for the voices’ licence', { exact: false })).toHaveCount(0)
  await expect(section.getByRole('link', { name: 'Make a new key on Hugging Face' })).toHaveAttribute(
    'href',
    'https://huggingface.co/settings/tokens'
  )
  // A key it takes, from an account that hasn't accepted the licence yet: the licence again, and now (with a
  // key saved) a Try again for once it is accepted.
  fake.set({ 'voices:weights': 'gated' })
  await section.getByLabel('New Hugging Face key').fill(KEY)
  await section.getByRole('button', { name: 'Save key and try again' }).click()
  await expect(section.getByText('Hugging Face asks for the voices’ licence to be accepted before they can download.')).toBeVisible()
  await expect(section.getByText('A Hugging Face key is saved on this computer, encrypted.')).toBeVisible()
  fake.set({})
  await section.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(win.getByText('The voices are downloaded.')).toBeVisible()
  await expect(section.getByText('Downloaded', { exact: true })).toBeVisible()
  await expect(fact(win, 'Voices')).toHaveText(/^Ready/)

  // The key: in the keys file only, given to the download (install.mjs fails any other step that gets it),
  // and hidden in the log even though the step printed it.
  const app = join(dataDir, 'app')
  const keys = (): string[] => Object.keys(JSON.parse(readFileSync(join(app, 'keys.json'), 'utf8')))
  expect(keys()).toContain('speech:huggingface')
  expect(readFileSync(join(app, 'settings.json'), 'utf8')).not.toContain(KEY)
  expect(existsSync(join(app, 'speech', 'models', 'hf', 'key-was-given'))).toBe(true)
  const log = readFileSync(join(app, 'speech', 'logs', 'install.log'), 'utf8')
  expect(log).toContain('Signed in to Hugging Face with ••••')
  expect(log).not.toContain(KEY)
  expect(log).not.toContain(WRONG_KEY)
  const status = await invoke(win, 'getSpeechStatus')
  expect(status.hfKey).toBe(true)
  expect(JSON.stringify(status)).not.toContain(KEY)

  // More: the key can be removed, with Undo.
  await win.getByRole('button', { name: 'More', exact: true }).click()
  await expect(win.getByText('A Hugging Face key is saved on this computer, encrypted.')).toBeVisible()
  await win.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(win.getByText('Hugging Face key removed.')).toBeVisible()
  expect(keys()).not.toContain('speech:huggingface')
  await win.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(win.getByText('A Hugging Face key is saved on this computer, encrypted.')).toBeVisible()
  expect(keys()).toContain('speech:huggingface')
  expect(readFileSync(join(app, 'settings.json'), 'utf8')).not.toContain(KEY)

  // The downloads too, with Undo.
  await win.getByRole('button', { name: 'Remove downloads' }).click()
  await expect(win.getByText('Speech downloads removed.')).toBeVisible()
  await expect(section.getByText('Not running', { exact: true })).toBeVisible()
  await expect(fact(win, 'Voices')).toHaveText('Not downloaded')
  await expect(section.getByRole('switch', { name: 'Start with AI Write' })).not.toBeChecked()
  await win.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(section.getByRole('switch', { name: 'Start with AI Write' })).toBeChecked()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()
  await expect(fact(win, 'Voices')).toHaveText(/^Ready/)

  // Removed twice (downloaded again in between): only the latest is kept for Undo; the first goes at once.
  const removedFolders = (): string[] => readdirSync(app).filter((n) => n.startsWith('speech-removed-'))
  await win.getByRole('button', { name: 'Remove downloads' }).click()
  await expect(win.getByText('Speech downloads removed.')).toBeVisible()
  await expect(section.getByText('Not running', { exact: true })).toBeVisible()
  expect(removedFolders()).toHaveLength(1)
  await section.getByRole('switch', { name: 'Start with AI Write' }).click()
  await expect(section.getByText('Connected', { exact: true })).toBeVisible()
  await expect(win.getByRole('button', { name: 'Remove downloads' })).toBeEnabled()
  await win.getByRole('button', { name: 'Remove downloads' }).click()
  await expect(section.getByText('Not running', { exact: true })).toBeVisible()
  await expect.poll(removedFolders).toHaveLength(1)
})
