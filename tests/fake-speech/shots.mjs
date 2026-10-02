// Screenshots of Settings › Read aloud and dictation's speech engine parts, in the real built app with the
// fake speech server and fake downloads (nothing is fetched, no Python). For checking the look by eye.
//
//   npm run build
//   xvfb-run -a -s "-screen 0 1440x900x24" node tests/fake-speech/shots.mjs /tmp/m4-shots/speech
//   xvfb-run -a -s "-screen 0 1440x900x24" node tests/fake-speech/shots.mjs /tmp/m4-shots/speech python
//
// The first run goes from Not running through each download to everything ready, then More. The second
// ("python") starts without Python, installs it, and uses a copy of MCreader v2's voices.
import { _electron as electron } from '@playwright/test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const shots = process.argv[2] ?? join(tmpdir(), 'aiwrite-speech-shots')
const flow = process.argv[3] === 'python' ? 'python' : 'main'
mkdirSync(shots, { recursive: true })
const dir = mkdtempSync(join(tmpdir(), 'aiwrite-speech-'))
const controlFile = join(dir, 'control.json')
const setControl = (c) => writeFileSync(controlFile, JSON.stringify(c))
setControl({})

/** A folder with what MCreader v2's tts folder has once its voices are downloaded (empty files). */
function fakeMCreader() {
  const tts = join(dir, 'mcreader-v2', 'tts')
  const touch = (...parts) => {
    mkdirSync(join(tts, ...parts.slice(0, -1)), { recursive: true })
    writeFileSync(join(tts, ...parts), '')
  }
  touch('venvs', 'breeze', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']))
  touch('models', 'breeze', 'code', 'breeze_infer', '__init__.py')
  touch('models', 'hf', 'hub', 'models--BreezeBlue--breeze-tts-2', 'snapshots', 'fake', 'config.json')
  return tts
}

const app = await electron.launch({
  args: ['.', '--no-sandbox'],
  cwd: resolve(here, '..', '..'),
  env: {
    ...process.env,
    AIWRITE_DATA_DIR: dir,
    AIWRITE_FAKE_SPEECH_INSTALL: join(here, 'install.mjs'),
    AIWRITE_FAKE_SPEECH_RUN: join(here, 'server.mjs'),
    AIWRITE_FAKE_SPEECH_CONTROL: controlFile,
    AIWRITE_FAKE_SPEECH_PYTHON: flow === 'python' ? 'missing' : '',
    AIWRITE_FAKE_SPEECH_GPU: 'NVIDIA GeForce RTX 4090',
    MCREADER_TTS_DIR: flow === 'python' ? fakeMCreader() : join(dir, 'no-mcreader')
  }
})
const win = await app.firstWindow()
win.on('pageerror', (e) => console.log('pageerror:', e.message))
win.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text()))

const invoke = async (method, ...args) => {
  const res = await win.evaluate(([m, a]) => window.aiwrite.invoke(m, ...a), [method, args])
  if (!res.ok) throw new Error(`${method}: ${res.error.message}`)
  return res.value
}
const size = (w, h) => app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
const theme = async (t) => {
  await invoke('updateSettings', { theme: t })
  await win.evaluate((t) => (document.documentElement.dataset.theme = t), t)
}
const shot = async (name) => {
  await win.waitForTimeout(400)
  await win.screenshot({ path: join(shots, `${name}.png`) })
  console.log('shot', name)
}
/** Scrolls Settings' page so the heading `text` is near the top. */
const scrollTo = async (text) => {
  await win
    .getByRole('heading', { name: text, exact: true })
    .first()
    .evaluate((el) => el.scrollIntoView({ block: 'start' }))
}
/** Closes the toasts showing, so they don't cover the next shot. */
const toasts = async () => {
  const close = win.locator('div.fixed.bottom-4.right-4 button[aria-label="Dismiss"]')
  while ((await close.count()) > 0) await close.first().click()
}

async function openSettings() {
  await win.waitForSelector('text=Create a world', { timeout: 20000 })
  await win.fill('input', 'The Northern Reaches')
  await win.click('button:has-text("Create world")')
  await win.waitForTimeout(800)
  await size(1280, 800)
  await win.getByRole('button', { name: 'Settings', exact: true }).click()
  await win.getByRole('navigation').getByRole('button', { name: 'Read aloud and dictation' }).click()
  await win.waitForSelector('text=Speech engine')
  await win.waitForTimeout(600)
}

async function main() {
  await shot('01-not-running-light-1280')
  await theme('dark')
  await shot('02-not-running-dark-1280')
  await theme('sepia')
  await shot('03-not-running-sepia-1280')
  await theme('light')

  // Start with AI Write: the server downloads (fake), then starts (the fake server).
  setControl({ 'server:packages': 'slow' })
  await win.getByRole('switch').first().click()
  await win.waitForSelector('text=Downloading the speech engine', { timeout: 10000 })
  await win.waitForTimeout(2500)
  await shot('04-server-downloading-light-1280')
  await theme('dark')
  await shot('05-server-downloading-dark-1280')
  await theme('light')
  await win.getByRole('button', { name: 'Cancel' }).click()
  await win.waitForSelector('text=stopped', { timeout: 10000 })
  await shot('06-server-cancelled-light-1280')
  setControl({ 'server:packages': 'fail' })
  await win.getByRole('button', { name: 'Try again' }).click()
  await win.waitForSelector('text=didn’t finish', { timeout: 15000 })
  await shot('07-server-failed-light-1280')
  await theme('dark')
  await shot('08-server-failed-dark-1280')
  await theme('light')
  setControl({})
  await win.getByRole('button', { name: 'Try again' }).click()
  await win.waitForSelector('text=Connected', { timeout: 30000 })
  await win.waitForTimeout(800)
  await shot('09-connected-light-1280')
  await theme('dark')
  await shot('10-connected-dark-1280')
  await theme('light')
  await toasts()

  // The voices: a slow download, and the licence step.
  setControl({ 'voices:torch': 'slow' })
  await win.getByRole('button', { name: 'Download the voices' }).click()
  await win.waitForSelector('text=Downloading PyTorch', { timeout: 10000 })
  await win.waitForTimeout(3000)
  await scrollTo('Voices')
  await shot('11-voices-downloading-light-1280')
  await win.getByRole('button', { name: 'Cancel' }).click()
  setControl({ 'voices:weights': 'licence' })
  await win.getByRole('button', { name: 'Try again' }).click()
  await win.waitForSelector('text=Hugging Face asks', { timeout: 20000 })
  await scrollTo('Voices')
  await shot('12-voices-licence-light-1280')
  await theme('dark')
  await shot('13-voices-licence-dark-1280')
  await theme('light')
  setControl({})
  await win.getByLabel('Hugging Face key').fill('hf_shotsFakeKey0123456789')
  await win.getByRole('button', { name: 'Save key and try again' }).click()
  await win.waitForSelector('text=The voices are downloaded', { timeout: 20000 })
  await scrollTo('Voices')
  await shot('14-voices-downloaded-toast-light-1280')
  await toasts()

  // Dictation: Whisper, picked and downloaded.
  setControl({ 'whisper:model': 'slow' })
  await win.getByRole('radio', { name: /Whisper/ }).click()
  await win.waitForSelector('text=Downloading Whisper’s English model', { timeout: 15000 })
  await win.waitForTimeout(2500)
  await scrollTo('Dictation')
  await shot('15-whisper-downloading-light-1280')
  await size(960, 600)
  await scrollTo('Dictation')
  await shot('16-whisper-downloading-light-960')
  await theme('dark')
  await shot('17-whisper-downloading-dark-960')
  await theme('light')
  setControl({})
  await win.getByRole('button', { name: 'Cancel' }).click()
  await win.getByRole('button', { name: 'Try again' }).click()
  await win.waitForSelector('text=Whisper is downloaded', { timeout: 20000 })
  await toasts()
  await win.waitForTimeout(1500)
  await scrollTo('Speech engine')
  await shot('18-all-ready-light-960')
  await theme('dark')
  await shot('19-all-ready-dark-960')
  await theme('sepia')
  await shot('20-all-ready-sepia-960')
  await theme('light')

  // More: the address, the key, where things are kept.
  await size(1280, 800)
  await win.getByRole('button', { name: 'More', exact: true }).click()
  await win.waitForTimeout(500)
  await scrollTo('Server address')
  await shot('21-more-light-1280')
  await theme('dark')
  await shot('22-more-dark-1280')
  await theme('light')
  await win.getByRole('textbox', { name: 'Server address' }).fill('http://192.168.1.4:8766/v1')
  await win.getByRole('button', { name: 'Check this address' }).click()
  await win.waitForSelector('text=isn’t on this computer', { timeout: 10000 })
  await scrollTo('Server address')
  await shot('23-more-address-refused-light-1280')
  await size(960, 600)
  await scrollTo('Server address')
  await shot('24-more-light-960')
  await theme('dark')
  await shot('25-more-dark-960')
  await theme('sepia')
  await shot('26-more-sepia-960')
  await theme('light')
  await size(1280, 800)
  await win.getByRole('button', { name: 'Remove downloads' }).click()
  await win.waitForSelector('text=Speech downloads removed', { timeout: 15000 })
  await scrollTo('Speech engine')
  await shot('27-removed-undo-light-1280')
}

async function python() {
  await scrollTo('Speech engine')
  await shot('30-mcreader-found-light-1280')
  await win.getByRole('switch').first().click()
  await win.waitForSelector('text=Install Python', { timeout: 15000 })
  await shot('31-python-missing-light-1280')
  await theme('dark')
  await shot('32-python-missing-dark-1280')
  await theme('light')
  setControl({ python: 'slow' })
  await win.getByRole('button', { name: 'Install Python' }).click()
  await win.waitForSelector('text=Installing Python', { timeout: 10000 })
  await win.waitForTimeout(2000)
  await shot('33-python-installing-light-1280')
  setControl({})
  await win.getByRole('button', { name: 'Cancel' }).click()
  await win.waitForSelector('text=stopped', { timeout: 10000 })
  await win.getByRole('button', { name: 'Try again' }).click()
  await win.waitForSelector('text=Install Python', { timeout: 15000 })
  await win.getByRole('button', { name: 'Install Python' }).click()
  await win.waitForSelector('text=Connected', { timeout: 30000 })
  await toasts()
  await win.getByRole('button', { name: 'Use MCreader’s copy' }).click()
  await win.waitForSelector('text=From ', { timeout: 15000 })
  await win.waitForTimeout(2500)
  await scrollTo('Speech engine')
  await shot('34-mcreader-copy-light-1280')
  await size(960, 600)
  await theme('dark')
  await scrollTo('Voices')
  await shot('35-mcreader-copy-dark-960')
  await theme('light')
}

try {
  await openSettings()
  if (flow === 'python') await python()
  else await main()
} catch (e) {
  console.log('FAILED:', e.message)
  await win.screenshot({ path: join(shots, `zz-failure-${flow}.png`) }).catch(() => undefined)
  process.exitCode = 1
} finally {
  await app.close().catch(() => undefined)
}
