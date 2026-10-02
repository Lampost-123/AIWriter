// The speech engine (milestone 4): the local speech server for reading aloud and dictation. Owned by the
// Speech engine part; see src/shared/contracts/speech.ts and docs/ARCHITECTURE.md, "Milestone 4".
//
// This connects the pieces to the app: Settings (settings.json), the Hugging Face key (secrets.ts), the
// window (speech:status), and the server's source wherever AI Write is installed. "Start with AI Write"
// downloads the server the first time and starts it hidden; it stops as the app quits.
//
// For the app's tests, AIWRITE_FAKE_SPEECH_INSTALL names a script run in place of every download step,
// AIWRITE_FAKE_SPEECH_RUN one run in place of the server (tests/fake-speech/), AIWRITE_FAKE_SPEECH_PYTHON
// ('missing' or 'manual') pretends Python isn't here, and AIWRITE_FAKE_SPEECH_GPU names the graphics card.
import { app, BrowserWindow, dialog, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { lstat, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { DictationModel, SpeechDownloadKind, SpeechStatus, SpeechStorage } from '@shared/contracts/speech'
import { emit } from '../events'
import { userDataDir } from '../paths'
import { getSecret, hasSecret, setSecret } from '../secrets'
import { getSettings, updateSettings } from '../settings'
import { renameRetry, UserError } from '../util'
import { Downloads } from './downloads'
import { installedNow, readManifest, writeManifest, type SpeechManifest } from './installed'
import { findMCreader, mcreaderVoicesIn } from './mcreader'
import { PYTHON_PAGE, type Failure } from './output'
import { speechPaths, venvPython, type SpeechPaths } from './paths'
import { DROP_ENV, planFor, pythonStep, stepEnv, type Step } from './plan'
import { childEnv } from './processes'
import { StepRunner } from './runner'
import { askToShutDown, fetchHealth, freePort, listenOn, logTail, pickDictation, portFree, ServerProcess } from './server'
import { setStarting } from './starting'
import { cleanHuggingFaceKey, HF_KEY_SECRET as HF_KEY } from './hfkey'
import { buildStatus, startProblem, type Health } from './status'
import { findNvidia, findPythons, findWinget, pickPython, PREFER, realSystem, type FoundPython } from './system'
import { normaliseAddress, speechBase } from './url'

/** How long a start may take before AI Write says so (the first start can be slow while antivirus checks the files). */
const START_WAIT_MS = 90_000
/** How often AI Write asks the server how it is (what is loaded changes as models are let go). */
const POLL_MS = 10_000
/** Removed downloads are kept aside this long, for Undo, then deleted. */
const KEEP_REMOVED_MS = 120_000

const fake = {
  install: (): string => process.env.AIWRITE_FAKE_SPEECH_INSTALL ?? '',
  run: (): string => process.env.AIWRITE_FAKE_SPEECH_RUN ?? '',
  python: (): string => process.env.AIWRITE_FAKE_SPEECH_PYTHON ?? '',
  gpu: (): string | undefined => process.env.AIWRITE_FAKE_SPEECH_GPU
}

// ---------------------------------------------------------------------------------------------
// Where things are

/** The server's Python source: beside the app when installed (electron-builder.yml, extraResources), else in the project. */
const sourceDir = (): string => (app.isPackaged ? join(process.resourcesPath, 'speech-server') : join(app.getAppPath(), 'speech-server'))

const manifestFile = (): string => join(userDataDir(), 'speech', 'installed.json')

function paths(manifest: SpeechManifest = readManifest(manifestFile())): SpeechPaths {
  return speechPaths(userDataDir(), sourceDir(), manifest.voices?.from === 'mcreader' ? manifest.voices.root : null)
}

const speechSettings = () => getSettings().speech

/** The address in use: Settings' own when it's on this computer, else AI Write's own server's. */
const address = (): string => speechBase(speechSettings()?.serverUrl)

// ---------------------------------------------------------------------------------------------
// State

const server = new ServerProcess()
let health: Health | null = null
let starting: Promise<void> | null = null
let stopping = false
/** The server AI Write started has answered since it was started (so an exit is a crash, not a failed start). */
let answered = false
let problem = ''
let nvidia: string | null = null
let lookingForCard: Promise<void> | null = null
let mcreader: string | null | undefined
let pythons: FoundPython[] | null = null
let poll: ReturnType<typeof setInterval> | null = null
let removed: { dir: string; runServer: boolean; timer: ReturnType<typeof setTimeout> } | null = null
let emitTimer: ReturnType<typeof setTimeout> | null = null
let lastEmit = 0

function status(): SpeechStatus {
  const s = speechSettings()
  const manifest = readManifest(manifestFile())
  const p = paths(manifest)
  return buildStatus({
    managed: !!s?.runServer,
    starting: !!starting || (!!s?.runServer && downloads.pending('server')),
    health,
    problem,
    installed: installedNow(p, manifest),
    nvidia,
    mcreader: mcreader ?? null,
    download: downloads.current,
    queued: [...downloads.queue],
    hfKey: hasSecret(HF_KEY),
    folder: p.home,
    address: address()
  })
}

/** Tells the window, at most five times a second (downloads report often). */
function changed(): void {
  const send = (): void => {
    emitTimer = null
    lastEmit = Date.now()
    emit('speech:status', status())
  }
  const wait = 200 - (Date.now() - lastEmit)
  if (wait <= 0 && !emitTimer) send()
  else if (!emitTimer) emitTimer = setTimeout(send, Math.max(0, wait))
}

/** Asks the server how it is; tells the window when that changed. */
async function refresh(timeoutMs = 1500): Promise<Health | null> {
  const before = JSON.stringify(health)
  const h = await fetchHealth(address(), timeoutMs)
  health = h
  if (h) problem = ''
  if (JSON.stringify(h) !== before) changed()
  return h
}

function lookForCard(): void {
  if (nvidia !== null || lookingForCard) return
  lookingForCard = (async () => {
    const forced = fake.gpu()
    nvidia = forced !== undefined ? forced : await findNvidia(realSystem()).catch(() => '')
    changed()
  })().finally(() => {
    lookingForCard = null
  })
}

function lookForMCreader(): void {
  const s = realSystem()
  // The app's tests only look where MCREADER_TTS_DIR says, never in the real home folder.
  mcreader = findMCreader(s.env, homedir(), s.platform, !fake.install())
}

// ---------------------------------------------------------------------------------------------
// Downloads

const pythonMissing = (): Failure => {
  const winget = fake.python() === 'missing' ? process.execPath : fake.python() === 'manual' ? null : findWinget(realSystem())
  if (winget) {
    return {
      error: 'The speech engine runs on Python, which isn’t on this computer yet. AI Write can install it with Windows’ own installer.',
      need: 'python',
      link: ''
    }
  }
  return {
    error:
      process.platform === 'win32'
        ? 'The speech engine runs on Python, which isn’t on this computer yet. Install Python 3.13 from python.org (tick “Add python.exe to PATH”), then Try again.'
        : 'The speech engine runs on Python 3.10 to 3.13, and none was found. Install Python 3.13 (from python.org or your system’s packages), then Try again.',
    need: 'python-manual',
    link: PYTHON_PAGE
  }
}

async function detectPythons(): Promise<FoundPython[]> {
  if (fake.install()) {
    const installed = existsSync(join(userDataDir(), 'fake-python'))
    return fake.python() && !installed ? [] : [{ path: process.execPath, version: [3, 13, 0] }]
  }
  if (!pythons || pythons.length === 0) pythons = await findPythons(realSystem())
  return pythons
}

/** An environment that is there and whose Python runs. */
async function venvWorks(python: string): Promise<boolean> {
  if (!existsSync(python)) return false
  if (fake.install()) return true
  const { code } = await realSystem().run(python, ['-c', 'import sys'], 30_000)
  return code === 0
}

/** In the app's tests, every step runs the fake install script instead (with the same labels and order). */
function fakeSteps(kind: SpeechDownloadKind | 'python', steps: Step[]): Step[] {
  return steps.map((s) => ({
    ...s,
    command: process.execPath,
    args: [fake.install(), kind, s.id],
    env: { ...s.env, ELECTRON_RUN_AS_NODE: '1' }
  }))
}

let usedPython = ''

async function plan(kind: SpeechDownloadKind): Promise<{ steps: Step[] } | { failure: Failure }> {
  const p = paths()
  const breezePython = venvPython(join(p.home, 'venvs', 'breeze'))
  const serverVenv = await venvWorks(p.python)
  const breezeVenv = kind === 'voices' ? await venvWorks(breezePython) : false
  let basePython: string | null = null
  if ((kind === 'server' && !serverVenv) || (kind === 'voices' && !breezeVenv)) {
    const found = pickPython(await detectPythons(), PREFER[kind === 'server' ? 'server' : 'voices'])
    if (!found) return { failure: pythonMissing() }
    basePython = found.path
    if (kind === 'server') usedPython = found.path
  }
  if (kind !== 'server' && kind !== 'voices' && !serverVenv) {
    return {
      failure: {
        error: 'The speech engine itself isn’t downloaded yet. Turn on “Start with AI Write” to download it, then try this again.',
        need: null,
        link: ''
      }
    }
  }
  const hfKey = kind === 'voices' ? getSecret(HF_KEY) : null
  const steps = planFor(kind, { paths: p, platform: process.platform, basePython, serverVenv, breezeVenv, hfKey })
  return { steps: fake.install() ? fakeSteps(kind, steps) : steps }
}

function runner(steps: Step[], onUpdate: ConstructorParameters<typeof StepRunner>[0]['onUpdate']): StepRunner {
  const p = paths()
  for (const dir of [p.home, p.logs, join(p.cache, 'tmp')]) mkdirSync(dir, { recursive: true })
  const log = join(p.logs, 'install.log')
  try {
    // Keep the log to a sensible size: the previous one is kept beside it.
    if (statSync(log).size > 5e6) renameSync(log, `${log}.1`)
  } catch {
    /* no log yet */
  }
  const key = getSecret(HF_KEY)
  return new StepRunner({
    steps,
    cwd: p.home,
    env: childEnv(DROP_ENV, { ...stepEnv(p), AIWRITE_SPEECH_HOME: p.home }),
    log: (text) => {
      try {
        appendFileSync(log, text)
      } catch {
        /* the log is a help, never a reason to stop */
      }
    },
    secrets: key ? [key] : [],
    onUpdate
  })
}

async function finished(kind: SpeechDownloadKind, result: { gpu: string | null }): Promise<void> {
  const file = manifestFile()
  const manifest = readManifest(file)
  const at = new Date().toISOString()
  const before = paths(manifest)
  if (kind === 'server') manifest.server = { at, python: usedPython }
  else if (kind === 'voices') manifest.voices = { at, from: 'own', root: before.home, gpu: result.gpu ?? '' }
  else manifest[kind] = { at }
  writeManifest(file, manifest)
  if (kind === 'voices' && result.gpu !== null && !nvidia) nvidia = result.gpu
  // pip's downloads and the steps' leftovers aren't needed once it worked.
  void rm(join(before.cache, 'pip'), { recursive: true, force: true }).catch(() => undefined)
  void rm(join(before.cache, 'tmp'), { recursive: true, force: true }).catch(() => undefined)

  const s = speechSettings()
  if (kind === 'server' && s.runServer) void ensureRunning()
  // The server was running MCreader's copy: it runs AI Write's own from now on.
  else if (kind === 'voices' && before.breezeRoot !== before.home) void restart()
  else if ((kind === 'parakeet' || kind === 'whisper') && s.dictationEngine === kind && health) void useDictation(kind)
  // The server sees new files as they arrive: ask it again now rather than at the next check.
  else void refresh()
}

const downloads = new Downloads({ plan, runner, finished, changed })

// ---------------------------------------------------------------------------------------------
// The server

function launch(p: SpeechPaths, host: string, port: number) {
  const env = {
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    PYTHONPYCACHEPREFIX: join(p.cache, 'pycache'),
    AIWRITE_SPEECH_HOME: p.home,
    AIWRITE_BREEZE_ROOT: p.breezeRoot,
    AIWRITE_DICTATION: speechSettings().dictationEngine,
    AIWRITE_PARENT_PID: String(process.pid),
    AIWRITE_APP_VERSION: app.getVersion(),
    AIWRITE_SPEECH_IDLE_UNLOAD: '300',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1'
  }
  if (fake.run()) {
    return {
      command: process.execPath,
      args: [fake.run(), '--port', String(port)],
      cwd: p.home,
      env: childEnv(DROP_ENV, { ...env, ELECTRON_RUN_AS_NODE: '1' }),
      logFile: join(p.logs, 'server.log')
    }
  }
  return {
    command: existsSync(p.serve) ? p.serve : p.python,
    args: [join(p.source, 'run.py'), '--host', host, '--port', String(port), '--preload', 'none'],
    cwd: p.source,
    env: childEnv(DROP_ENV, env),
    logFile: join(p.logs, 'server.log')
  }
}

server.onExit(() => {
  health = null
  if (!stopping) {
    problem = answered
      ? 'The speech engine stopped unexpectedly. Check to start it again.'
      : startProblem(logTail(join(paths().logs, 'server.log')), listenOn(address()).port)
  }
  answered = false
  changed()
})

/** "Start with AI Write" is on: makes sure the server answers, downloading it first if it never was. */
function ensureRunning(): Promise<void> {
  if (!speechSettings().runServer) return Promise.resolve()
  if (starting) return starting
  starting = (async () => {
    // After `starting` is set, so the window hears "Starting".
    await null
    problem = ''
    changed()
    if (await refresh()) return
    const p = paths()
    if (!installedNow(p, readManifest(p.manifest)).server) {
      // The first time: download it; it starts when the download finishes.
      if (!downloads.pending('server')) downloads.start('server')
      return
    }
    if (!server.running) {
      let { host, port } = listenOn(address())
      if (!(await portFree(host, port))) {
        // Another program has the port (it isn't answering as a speech server): use the next free one, and keep Settings in step.
        const other = await freePort(host, port + 1, port + 40)
        if (other === null) {
          problem = startProblem('address already in use', port)
          return
        }
        port = other
        updateSettings({ speech: { serverUrl: `http://${host === '::1' ? '[::1]' : '127.0.0.1'}:${port}/v1` } })
      }
      mkdirSync(p.logs, { recursive: true })
      answered = false
      try {
        server.start(launch(p, host, port))
      } catch {
        problem = 'The speech engine couldn’t be started. Remove its downloads in More and download it again.'
        return
      }
    }
    const until = Date.now() + START_WAIT_MS
    while (Date.now() < until && server.running) {
      await new Promise((r) => setTimeout(r, 250))
      if (await refresh(1000)) {
        answered = server.running
        syncDictation()
        return
      }
    }
    if (server.running) problem = 'The speech engine is taking a long time to start. Check again in a moment.'
  })()
    .catch((e: unknown) => {
      console.warn('[speech] could not start the speech server', e)
      problem =
        'The speech engine couldn’t be started. Check again; if it keeps happening, remove its downloads in More and download it again.'
    })
    .finally(() => {
      starting = null
      setStarting(null)
      changed()
    })
  setStarting(starting)
  return starting
}

/** Stops the server AI Write started: politely (it unloads its models), then by force. A server it didn't start is left alone. */
async function stopServer(): Promise<void> {
  await starting?.catch(() => undefined)
  if (!server.running) return
  stopping = true
  try {
    await askToShutDown(address())
    for (let i = 0; i < 20 && server.running; i++) await new Promise((r) => setTimeout(r, 250))
    server.stop()
  } finally {
    stopping = false
  }
  health = null
  problem = ''
  changed()
}

async function restart(): Promise<void> {
  if (!server.running) return
  await stopServer()
  await ensureRunning()
}

/** The server is running another dictation model than the one picked: pick it there too. */
function syncDictation(): void {
  const picked = speechSettings().dictationEngine
  if (picked !== 'none' && health?.dictation && health.dictation.engine !== picked) void useDictation(picked)
}

async function useDictation(engine: 'none' | DictationModel): Promise<void> {
  const r = await pickDictation(address(), engine)
  if (!r.ok && r.detail) console.warn('[speech] the server could not load', engine, r.detail)
  await refresh()
}

function startPolling(): void {
  if (poll) return
  poll = setInterval(() => {
    if (starting || stopping) return
    void refresh()
  }, POLL_MS)
  poll.unref?.()
}

/** Deletes downloads removed earlier (Remove downloads) that Undo can no longer bring back. */
function deleteRemoved(): void {
  let names: string[] = []
  try {
    names = readdirSync(userDataDir()).filter((n) => n.startsWith('speech-removed-'))
  } catch {
    return
  }
  for (const n of names) {
    const dir = join(userDataDir(), n)
    if (removed?.dir === dir) continue
    void rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }
}

// ---------------------------------------------------------------------------------------------
// What the app calls

/** Called once at startup (src/main/index.ts): starts the speech server when "Start with AI Write" is on. */
export function initSpeech(): void {
  deleteRemoved()
  lookForMCreader()
  startPolling()
  if (speechSettings().runServer) void ensureRunning()
  else void refresh()
}

/** Called as the app quits, after the world has closed: stops the speech server it started and any download. */
export function stopSpeech(): void {
  if (poll) clearInterval(poll)
  poll = null
  stopping = true
  downloads.cancel()
  server.stop()
}

export async function getSpeechStatus(): Promise<SpeechStatus> {
  lookForCard()
  if (!starting) await refresh()
  return status()
}

export async function checkSpeech(): Promise<SpeechStatus> {
  lookForMCreader()
  nvidia = null
  lookForCard()
  if (starting) return status()
  const h = await refresh(3000)
  if (!h && speechSettings().runServer && !downloads.busy) void ensureRunning()
  return status()
}

export async function setSpeechStartWithApp(on: boolean): Promise<SpeechStatus> {
  updateSettings({ speech: { runServer: on } })
  if (on) {
    void ensureRunning()
    // Show "Starting" (or the download) at once.
    await new Promise((r) => setTimeout(r, 0))
  } else {
    if (downloads.busy && downloads.current?.kind === 'server') downloads.cancel()
    else if (downloads.queue.includes('server')) downloads.cancel()
    problem = ''
    await stopServer()
    await refresh()
  }
  return status()
}

export async function setSpeechServerUrl(input: string): Promise<SpeechStatus> {
  const url = normaliseAddress(input)
  if (url === speechSettings().serverUrl) return checkSpeech()
  const ours = server.running
  if (ours) await stopServer()
  updateSettings({ speech: { serverUrl: url } })
  health = null
  problem = ''
  if (speechSettings().runServer) void ensureRunning()
  else await refresh()
  return status()
}

export async function setDictationEngine(engine: 'none' | DictationModel): Promise<SpeechStatus> {
  if (engine !== 'none' && engine !== 'parakeet' && engine !== 'whisper') throw new UserError('Pick Parakeet, Whisper or None.')
  updateSettings({ speech: { dictationEngine: engine } })
  const p = paths()
  const installed = installedNow(p, readManifest(p.manifest))
  if (engine !== 'none' && !installed[engine]) {
    await downloadSpeech(engine)
    return status()
  }
  if (health?.dictation) void useDictation(engine)
  return status()
}

export async function downloadSpeech(kind: SpeechDownloadKind): Promise<SpeechStatus> {
  if (!['server', 'voices', 'parakeet', 'whisper'].includes(kind)) throw new UserError('That isn’t something to download.')
  const p = paths()
  const installed = installedNow(p, readManifest(p.manifest))
  // The voices and dictation run in the server, so it comes first.
  if (kind !== 'server' && !installed.server && !downloads.pending('server')) downloads.start('server')
  downloads.start(kind)
  return status()
}

export async function cancelSpeechDownload(): Promise<SpeechStatus> {
  downloads.cancel()
  return status()
}

export async function dismissSpeechDownload(): Promise<SpeechStatus> {
  downloads.dismiss()
  return status()
}

export async function installPython(): Promise<SpeechStatus> {
  if (downloads.busy) return status()
  const fakeWinget = fake.install() && fake.python() === 'missing'
  const winget = fakeWinget ? process.execPath : findWinget(realSystem())
  if (!winget)
    throw new UserError('Windows’ installer isn’t available here. Install Python 3.13 from python.org, then Try again.', 'python-manual')
  const steps = fakeWinget ? fakeSteps('python', [pythonStep(winget)]) : [pythonStep(winget)]
  downloads.startWith('server', steps, () => {
    pythons = null
    if (fakeWinget) writeFileSync(join(userDataDir(), 'fake-python'), '')
    downloads.start('server')
  })
  return status()
}

async function useVoicesFrom(tts: string): Promise<SpeechStatus> {
  const file = manifestFile()
  const manifest = readManifest(file)
  manifest.voices = { at: new Date().toISOString(), from: 'mcreader', root: tts, gpu: manifest.voices?.gpu ?? '' }
  mkdirSync(join(userDataDir(), 'speech'), { recursive: true })
  writeManifest(file, manifest)
  // The server reads where Breeze is as it starts.
  if (server.running) void restart()
  changed()
  return status()
}

export async function useMCreaderVoices(): Promise<SpeechStatus> {
  if (mcreader === undefined) lookForMCreader()
  if (!mcreader)
    throw new UserError('MCreader v2’s voices weren’t found on this computer. Find its folder in More, or download the voices.')
  return useVoicesFrom(mcreader)
}

export async function findMCreaderVoices(): Promise<SpeechStatus> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  const opts = { title: 'Find MCreader v2’s folder', properties: ['openDirectory' as const] }
  const picked = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (picked.canceled || !picked.filePaths[0]) return status()
  const tts = mcreaderVoicesIn(picked.filePaths[0])
  if (!tts) {
    throw new UserError(
      'MCreader v2’s voices aren’t complete in that folder. Pick MCreader v2’s own folder (the one with “tts” inside), after its voices have downloaded there.'
    )
  }
  mcreader = tts
  return useVoicesFrom(tts)
}

export async function setHuggingFaceKey(input: string | null): Promise<SpeechStatus> {
  setSecret(HF_KEY, input === null ? null : cleanHuggingFaceKey(input) || null)
  return status()
}

/** Bytes in files under `dir`, not following links (Hugging Face's cache links snapshots to its files). */
async function folderBytes(dir: string): Promise<number> {
  let total = 0
  let entries: import('node:fs').Dirent[] = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isSymbolicLink()) continue
    if (e.isDirectory()) total += await folderBytes(full)
    else {
      try {
        total += (await lstat(full)).size
      } catch {
        /* gone meanwhile */
      }
    }
  }
  return total
}

export async function getSpeechStorage(): Promise<SpeechStorage> {
  const p = paths()
  const [all, breezeEnv, breezeModels, hf, parakeet, whisper] = await Promise.all([
    folderBytes(p.home),
    folderBytes(join(p.home, 'venvs', 'breeze')),
    folderBytes(join(p.home, 'models', 'breeze')),
    folderBytes(join(p.home, 'models', 'hf')),
    folderBytes(p.parakeet),
    folderBytes(p.whisper)
  ])
  const voices = breezeEnv + breezeModels + hf
  return {
    folder: p.home,
    parts: [
      { kind: 'server', bytes: Math.max(0, all - voices - parakeet - whisper) },
      { kind: 'voices', bytes: voices },
      { kind: 'parakeet', bytes: parakeet },
      { kind: 'whisper', bytes: whisper }
    ],
    total: all
  }
}

export async function showSpeechFolder(): Promise<void> {
  const home = paths().home
  mkdirSync(home, { recursive: true })
  const error = await shell.openPath(home)
  if (error) throw new UserError('The speech folder couldn’t be opened.')
}

export async function removeSpeechDownloads(): Promise<SpeechStatus> {
  const home = paths().home
  if (!existsSync(home)) return status()
  downloads.cancel()
  downloads.dismiss()
  await stopServer()
  const dir = join(userDataDir(), `speech-removed-${Date.now()}`)
  try {
    // Moved aside first (at once, whatever its size), so Undo can put it back; deleted a little later.
    await renameRetry(home, dir, 24, 250)
  } catch (e) {
    console.warn('[speech] could not move the speech folder aside', e)
    throw new UserError('Some of the downloads are still in use. Wait a moment, then try again.', 'speech-in-use')
  }
  const runServer = speechSettings().runServer
  updateSettings({ speech: { runServer: false } })
  if (removed) clearTimeout(removed.timer)
  removed = {
    dir,
    runServer,
    timer: setTimeout(() => {
      removed = null
      void rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
    }, KEEP_REMOVED_MS)
  }
  health = null
  problem = ''
  await refresh()
  changed()
  return status()
}

export async function undoRemoveSpeechDownloads(): Promise<SpeechStatus> {
  const r = removed
  if (!r || !existsSync(r.dir)) throw new UserError('It’s too late to undo that: the downloads were already deleted.')
  clearTimeout(r.timer)
  removed = null
  const home = paths().home
  if (downloads.busy) downloads.cancel()
  // Only made since (a log or an empty folder): the removed downloads take its place.
  if (existsSync(home)) rmSync(home, { recursive: true, force: true })
  await renameRetry(r.dir, home, 24, 250)
  updateSettings({ speech: { runServer: r.runServer } })
  if (r.runServer) void ensureRunning()
  changed()
  return status()
}
