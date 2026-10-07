// The speech engine (milestone 4): the local speech server for reading aloud and dictation. Owned by the
// Speech engine part; see src/shared/contracts/speech.ts and docs/ARCHITECTURE.md, "Milestone 4".
//
// This connects the pieces to the app: Settings (settings.json), the Hugging Face key (secrets.ts), the
// window (speech:status), and the server's source wherever AI Write is installed. "Start with AI Write"
// downloads the server the first time and starts it hidden; it stops as the app quits.
//
// For the app's tests, AIWRITE_FAKE_SPEECH_INSTALL names a script run in place of every download step,
// AIWRITE_FAKE_SPEECH_RUN one run in place of the server (tests/fake-speech/), AIWRITE_FAKE_SPEECH_PYTHON
// ('missing' or 'manual') pretends Python isn't here, AIWRITE_FAKE_SPEECH_GPU names the graphics card (with
// AIWRITE_FAKE_SPEECH_GPU_MEMORY its memory in MiB and AIWRITE_FAKE_SPEECH_GPU_CAP its compute capability), and
// AIWRITE_FAKE_SPEECH_FREE_GB is the free disk space.
import { app, shell } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { lstat, readdir, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import type { DictationModel, SpeechDownloadKind, SpeechStatus, SpeechStorage } from '@shared/contracts/speech'
import { emit } from '../events'
import { userDataDir } from '../paths'
import { getSecret, hasSecret, setSecret } from '../secrets'
import { getSettings, updateSettings } from '../settings'
import { renameRetry, UserError } from '../util'
import { speechFetch } from './client'
import { Downloads } from './downloads'
import { installedNow, readManifest, writeManifest } from './installed'
import { PYTHON_PAGE, type Failure } from './output'
import {
  breezeMark,
  checkWeightsDir,
  clapWeightsDir,
  soundMark,
  soundWeightsDir,
  speechPaths,
  studioDir,
  studioMark,
  venvPython,
  type SpeechPaths
} from './paths'
import { DROP_ENV, planFor, pythonStep, stepEnv, type Step } from './plan'
import { childEnv } from './processes'
import { StepRunner } from './runner'
import { askToShutDown, fetchHealth, freePort, listenOn, logTail, pickDictation, portFree, ServerProcess } from './server'
import { setStarting } from './starting'
import { cleanHuggingFaceKey, HF_KEY_SECRET as HF_KEY } from './hfkey'
import { buildStatus, DOWNLOAD_AGAIN, startProblem, type Health } from './status'
import { findCard, findPythons, findWinget, freeSpace, pickPython, PREFER, realSystem, type FoundPython, type GraphicsCard } from './system'
import { normaliseAddress, speechBase } from './url'

/** How long a start may take before AI Write says so (the first start can be slow while antivirus checks the files). */
const START_WAIT_MS = 90_000
/** How often AI Write asks the server how it is (what is loaded changes as models are let go). */
const POLL_MS = 10_000
/** Removed downloads, and a removed Hugging Face key, are kept this long for Undo; then they are gone. */
const KEEP_REMOVED_MS = 120_000
/** How long picking a dictation model waits for the server to switch before answering (it carries on after). */
const SWITCH_WAIT_MS = 300

const fake = {
  install: (): string => process.env.AIWRITE_FAKE_SPEECH_INSTALL ?? '',
  run: (): string => process.env.AIWRITE_FAKE_SPEECH_RUN ?? '',
  python: (): string => process.env.AIWRITE_FAKE_SPEECH_PYTHON ?? '',
  gpu: (): string | undefined => process.env.AIWRITE_FAKE_SPEECH_GPU,
  number: (name: string): number | null => {
    const n = Number(process.env[name] ?? '')
    return process.env[name] && Number.isFinite(n) ? n : null
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------
// Where things are

/** The server's Python source: beside the app when installed (electron-builder.yml, extraResources), else in the project. */
const sourceDir = (): string => (app.isPackaged ? join(process.resourcesPath, 'speech-server') : join(app.getAppPath(), 'speech-server'))

const manifestFile = (): string => join(userDataDir(), 'speech', 'installed.json')

/** Always AI Write's own speech folder: it never uses another app's copy of the speech engine or its voices. */
const paths = (): SpeechPaths => speechPaths(userDataDir(), sourceDir())

const speechSettings = () => getSettings().speech

/** The address in use: Settings' own when it's on this computer, else AI Write's own server's. */
const address = (): string => speechBase(speechSettings()?.serverUrl)

// ---------------------------------------------------------------------------------------------
// State

const server = new ServerProcess()
let health: Health | null = null
let starting: Promise<void> | null = null
/** Counts starts: stopping the server (or a newer start) makes an older start give up at its next step. */
let startGen = 0
/** Counts stops: an answer to a question asked before the latest stop is old news. */
let stopGen = 0
let stopping = false
/** The server AI Write started has answered since it was started (so an exit is a crash, not a failed start). */
let answered = false
/** Why the server isn't running when it should be, and whether downloading it again is the fix. */
let problem = ''
let problemRepair = false
/** The server has been asked how it is at least once (Settings then answers at once and asks again meanwhile). */
let checked = false
let nvidia: string | null = null
/** The card's memory and compute capability, for what the voices need (Settings); null when not known. */
let card: Pick<GraphicsCard, 'memoryMb' | 'computeCap'> = { memoryMb: null, computeCap: null }
let lookingForCard: Promise<void> | null = null
/** Free bytes on the disk the speech folder is on, for what the voices need; null when not known. */
let space: number | null = null
let poll: ReturnType<typeof setInterval> | null = null
/** Environments to set up afresh at their next download: the speech engine asked for again (the repair), or a check step that failed. */
const rebuild = new Set<'server' | 'voices' | 'sounds'>()
let removed: { dir: string; runServer: boolean; timer: ReturnType<typeof setTimeout> } | null = null
/** The Hugging Face key just removed, for Undo: only ever in the main process's memory, never shown or logged. */
let removedKey: { key: string; timer: ReturnType<typeof setTimeout> } | null = null
let emitTimer: ReturnType<typeof setTimeout> | null = null
let lastEmit = 0

function setProblem(text = '', repair = false): void {
  problem = text
  problemRepair = !!text && repair
}

function status(): SpeechStatus {
  const s = speechSettings()
  const manifest = readManifest(manifestFile())
  const p = paths()
  return buildStatus({
    managed: !!s?.runServer,
    starting: !!starting || (!!s?.runServer && downloads.pending('server')),
    health,
    problem,
    repair: problemRepair,
    picked: s?.dictationEngine ?? 'none',
    installed: installedNow(p, manifest),
    nvidia,
    card,
    freeSpace: space,
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
  const asked = stopGen
  const before = JSON.stringify(health)
  const h = await fetchHealth(address(), timeoutMs)
  // The server was stopped while it answered: what it said no longer holds.
  if (asked !== stopGen) return health
  health = h
  checked = true
  if (h) setProblem()
  if (JSON.stringify(h) !== before) changed()
  return h
}

/**
 * Looks for an NVIDIA card (and its memory) once; `again` looks afresh (Check) but keeps what was found until
 * there's an answer, so nothing flickers. Never throws: what can't be found stays unknown.
 */
function lookForCard(again = false): Promise<void> {
  if (lookingForCard) return lookingForCard
  if (nvidia !== null && !again) return Promise.resolve()
  lookingForCard = (async () => {
    const forced = fake.gpu()
    const found: GraphicsCard | null =
      forced !== undefined
        ? {
            name: forced,
            memoryMb: fake.number('AIWRITE_FAKE_SPEECH_GPU_MEMORY'),
            computeCap: fake.number('AIWRITE_FAKE_SPEECH_GPU_CAP')
          }
        : await findCard(realSystem()).catch(() => null)
    const next = found?.name ?? nvidia ?? ''
    const nextCard = found ? { memoryMb: found.memoryMb, computeCap: found.computeCap } : card
    if (next !== nvidia || JSON.stringify(nextCard) !== JSON.stringify(card)) {
      nvidia = next
      card = nextCard
      changed()
    }
  })().finally(() => {
    lookingForCard = null
  })
  return lookingForCard
}

/** Measures the free space where the voices would go (cheap: one statfs). Tells the window when it moved by a GB or more. */
async function lookForSpace(): Promise<void> {
  const forced = fake.number('AIWRITE_FAKE_SPEECH_FREE_GB')
  let next: number | null = null
  try {
    next = forced !== null ? forced * 1024 ** 3 : await freeSpace(paths().home, statfs)
  } catch {
    next = null
  }
  const gb = (n: number | null): number | null => (n === null ? null : Math.round(n / 1024 ** 3))
  const moved = gb(next) !== gb(space)
  space = next
  if (moved) changed()
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

/** The Pythons on this computer, looked for afresh each time an environment is made (one may have been installed or removed since). */
async function detectPythons(): Promise<FoundPython[]> {
  if (fake.install()) {
    const installed = existsSync(join(userDataDir(), 'fake-python'))
    return fake.python() && !installed ? [] : [{ path: process.execPath, version: [3, 13, 0] }]
  }
  return findPythons(realSystem())
}

/**
 * An environment that is there, whose Python runs and has its package installer: one stopped while it was
 * being made has none, and is then made afresh rather than failing at "Updating Python’s package installer".
 */
async function venvWorks(python: string): Promise<boolean> {
  if (!existsSync(python)) return false
  if (fake.install()) return true
  const { code } = await realSystem().run(python, ['-I', '-m', 'pip', '--version'], 60_000)
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
  const manifest = readManifest(manifestFile())
  const p = paths()
  const fresh = (kind === 'server' || kind === 'voices' || kind === 'sounds') && rebuild.has(kind)
  // The server runs from its environment, so it stops while that is set up afresh (it starts again after).
  if (kind === 'server' && fresh) await stopServer()
  if (kind === 'voices') {
    // AI Write's own copy counts as downloaded again only once this download's last step has checked it.
    rmSync(breezeMark(p.home), { force: true })
    // The voices' worker runs from their environment: the server lets go of it first.
    if (fresh && health) {
      await speechFetch('/unload', { method: 'POST', timeoutMs: 15_000 }).catch(() => undefined)
    }
  }
  if (kind === 'sounds') {
    // The same for the sound effects: they count again once this download's last step has checked them, and the
    // server lets go of their worker before its environment is set up afresh.
    rmSync(soundMark(p.home), { force: true })
    if (fresh && health) {
      await speechFetch('/unload', { method: 'POST', timeoutMs: 15_000 }).catch(() => undefined)
    }
  }
  if (kind === 'studio') {
    // They count again once this download's last step has checked them. They are fetched with the voices' environment.
    rmSync(studioMark(p.home), { force: true })
    if (installedNow(p, manifest).voices !== 'own') {
      return { failure: { error: 'Download the voices first; the studio voices are read by them.', need: null, link: '' } }
    }
  }
  const breezePython = venvPython(join(p.home, 'venvs', 'breeze'))
  const serverVenv = kind === 'server' && fresh ? false : await venvWorks(p.python)
  const breezeVenv = kind === 'voices' && !fresh ? await venvWorks(breezePython) : false
  const soundVenv = kind === 'sounds' && !fresh ? await venvWorks(p.soundPython) : false
  let basePython: string | null = null
  if ((kind === 'server' && !serverVenv) || (kind === 'voices' && !breezeVenv) || (kind === 'sounds' && !soundVenv)) {
    const found = pickPython(await detectPythons(), PREFER[kind === 'server' ? 'server' : kind === 'voices' ? 'voices' : 'sounds'])
    if (!found) return { failure: pythonMissing() }
    basePython = found.path
    if (kind === 'server') usedPython = found.path
  }
  if (kind !== 'server' && kind !== 'voices' && kind !== 'sounds' && !serverVenv) {
    return {
      failure: {
        error: 'The speech engine itself isn’t downloaded yet. Turn on “Start with AI Write” to download it, then try this again.',
        need: null,
        link: ''
      }
    }
  }
  if ((kind === 'parakeet' || kind === 'whisper') && installedNow(p, manifest)[kind]) {
    // Downloaded already: this is the repair Settings offers when it couldn't be loaded. The server (starting
    // again after its own environment was set up afresh) lets go of it, and its files are fetched afresh.
    if (starting) await starting
    if (health?.dictation?.engine === kind) await pickDictation(address(), 'none', 15_000)
    try {
      await rm(kind === 'parakeet' ? p.parakeet : p.whisper, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
    } catch {
      const name = kind === 'parakeet' ? 'Parakeet' : 'Whisper'
      return { failure: { error: `Some of ${name}’s files are still in use. Wait a moment, then Try again.`, need: null, link: '' } }
    }
  }
  const installed = installedNow(p, manifest)
  // Only the downloads with a weights step from Hugging Face get the key (and only that step is given it, plan.ts).
  const hfKey = kind === 'voices' || kind === 'sounds' ? getSecret(HF_KEY) : null
  const steps = planFor(kind, {
    paths: p,
    platform: process.platform,
    basePython,
    serverVenv,
    breezeVenv,
    soundVenv,
    hfKey,
    // Set up afresh, the server's environment gets the dictation engines back too.
    dictation: (['parakeet', 'whisper'] as const).filter((m) => installed[m])
  })
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
  const before = paths()
  if (kind === 'server') manifest.server = { at, python: usedPython || manifest.server?.python || '' }
  else if (kind === 'voices') manifest.voices = { at, from: 'own', root: before.home, gpu: result.gpu ?? '' }
  else manifest[kind] = { at }
  writeManifest(file, manifest)
  // Set up afresh: the repair, or Try again after its check failed.
  const afresh = (kind === 'server' || kind === 'voices' || kind === 'sounds') && rebuild.delete(kind)
  if (kind === 'voices' && result.gpu !== null && !nvidia) nvidia = result.gpu
  // pip's and Hugging Face's downloads and the steps' leftovers aren't needed once it worked.
  for (const dir of ['pip', 'hf', 'tmp']) void rm(join(before.cache, dir), { recursive: true, force: true }).catch(() => undefined)

  const s = speechSettings()
  // The speech engine is (again) ready to start; or it was stopped while its environment was set up afresh.
  if (kind === 'server' || (s.runServer && !server.running && !health)) {
    if (s.runServer) void ensureRunning()
    else void refresh()
  }
  // Their environment was set up afresh: the server starts afresh too, rather than going on saying why the old
  // one couldn't load them.
  else if ((kind === 'voices' || kind === 'sounds') && afresh) void restart()
  else if ((kind === 'parakeet' || kind === 'whisper') && s.dictationEngine === kind && health) void useDictation(kind)
  // The server sees new files as they arrive: ask it again now rather than at the next check.
  else void refresh()
}

/**
 * A download stopped on a problem. Its environment didn't check out: Try again sets it up afresh. Not when only files
 * were missing (the check said so): Try again fetches those, and the environment stays.
 */
function failed(kind: SpeechDownloadKind, stepId: string, failure?: Failure): void {
  if (failure?.keepEnvironment) return
  if (stepId === 'check' && (kind === 'server' || kind === 'voices' || kind === 'sounds')) rebuild.add(kind)
}

const downloads = new Downloads({ plan, runner, finished, failed, changed })

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
    if (answered) setProblem('The speech engine stopped unexpectedly. Check to start it again.')
    else {
      const why = startProblem(logTail(join(paths().logs, 'server.log')), listenOn(address()).port)
      setProblem(why.text, why.repair)
    }
  }
  answered = false
  changed()
})

/** "Start with AI Write" is on: makes sure the server answers, downloading it first if it never was. */
function ensureRunning(): Promise<void> {
  if (!speechSettings().runServer) return Promise.resolve()
  if (starting) return starting
  const gen = ++startGen
  // Stopping the server, or a newer start, ends this one at its next step.
  const live = (): boolean => gen === startGen
  const run = (async () => {
    // After `starting` is set, so the window hears "Starting".
    await null
    setProblem()
    changed()
    if ((await refresh()) || !live()) return
    const p = paths()
    if (!installedNow(p, readManifest(p.manifest)).server) {
      // The first time: download it; it starts when the download finishes.
      if (!downloads.pending('server')) downloads.start('server')
      return
    }
    // Being set up afresh: it starts when that finishes.
    if (downloads.pending('server')) return
    if (!server.running) {
      let { host, port } = listenOn(address())
      if (!(await portFree(host, port))) {
        // Another program has the port (it isn't answering as a speech server): use the next free one, and keep Settings in step.
        const other = await freePort(host, port + 1, port + 40)
        if (!live()) return
        if (other === null) {
          const why = startProblem('address already in use', port)
          setProblem(why.text, why.repair)
          return
        }
        port = other
        updateSettings({ speech: { serverUrl: `http://${host === '::1' ? '[::1]' : '127.0.0.1'}:${port}/v1` } })
      }
      if (!live()) return
      mkdirSync(p.logs, { recursive: true })
      answered = false
      try {
        server.start(launch(p, host, port))
      } catch {
        setProblem('Part of the speech engine is missing. Download it again below (about 150 MB); the voices are kept.', true)
        return
      }
    }
    const until = Date.now() + START_WAIT_MS
    while (Date.now() < until && server.running && live()) {
      await sleep(250)
      if (!live()) return
      if (await refresh(1000)) {
        if (!live()) return
        answered = server.running
        syncDictation()
        return
      }
    }
    if (live() && server.running) setProblem('The speech engine is taking a long time to start. Check again in a moment.')
  })()
    .catch((e: unknown) => {
      console.warn('[speech] could not start the speech server', e)
      if (live()) setProblem(`The speech engine couldn’t be started. Check again; if it keeps happening, ${DOWNLOAD_AGAIN}.`, true)
    })
    .finally(() => {
      if (starting === run) {
        starting = null
        setStarting(null)
      }
      changed()
    })
  starting = run
  setStarting(run)
  return run
}

/**
 * Stops the server AI Write started: politely when it answers (it unloads its models), else at once. A start
 * under way gives up at its next step, without being waited for. A server AI Write didn't start is left alone.
 */
async function stopServer(): Promise<void> {
  stopGen++
  if (starting) {
    startGen++
    starting = null
    setStarting(null)
  }
  if (!server.running) return
  stopping = true
  try {
    if (answered) {
      await askToShutDown(address())
      for (let i = 0; i < 20 && server.running; i++) await sleep(250)
    }
    server.stop()
  } finally {
    stopping = false
  }
  answered = false
  health = null
  setProblem()
  changed()
}

async function restart(): Promise<void> {
  if (!server.running) return
  await stopServer()
  await ensureRunning()
}

/** The server is running another dictation model than the one picked, which is downloaded: it switches too. */
function syncDictation(): void {
  const picked = speechSettings().dictationEngine
  if (picked === 'none' || !health?.dictation || health.dictation.engine === picked) return
  const p = paths()
  if (installedNow(p, readManifest(p.manifest))[picked]) void useDictation(picked)
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

/** Deletes removed downloads once Undo can no longer bring them back. */
function deleteLater(dir: string): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    if (removed?.dir === dir) removed = null
    void rm(dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }, KEEP_REMOVED_MS)
}

// ---------------------------------------------------------------------------------------------
// What the app calls

/** Called once at startup (src/main/index.ts): starts the speech server when "Start with AI Write" is on. */
export function initSpeech(): void {
  deleteRemoved()
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

/** The voices are downloaded on this computer (read aloud is set up), whether or not the server runs now. Never throws. */
export function voicesInstalled(): boolean {
  try {
    return installedNow(paths(), readManifest(manifestFile())).voices !== null
  } catch {
    return false
  }
}

/** The studio voices' folder (with their index.json) when they are downloaded on this computer, else null. Never throws. */
export function studioVoicesDir(): string | null {
  try {
    const p = paths()
    return installedNow(p, readManifest(manifestFile())).studio ? studioDir(p.home) : null
  } catch {
    return null
  }
}

/** The sound effects are downloaded on this computer, whether or not the server runs now. Never throws. */
export function soundsInstalled(): boolean {
  try {
    return !!installedNow(paths(), readManifest(manifestFile())).sounds
  } catch {
    return false
  }
}

/** What the speech server last said about making sounds and timing words (it is asked every 10 seconds). */
export interface SoundsServerState {
  /** It can make sounds now (the sound effects are downloaded there; they load with the first one asked for). */
  ready: boolean
  /** The sound effects model is in memory now. */
  loaded: boolean
  /**
   * The sound effects can sit beside the voices on the graphics card now: both are loaded, or the one that isn't
   * would fit. When false, a sound asked for while the voices are reading waits (the server answers 503 with
   * `x-sound-retry: 1` rather than push them out), so sounds are best made before the reading reaches them.
   */
  beside: boolean
  /** The dictation model that times the words of a spoken clip (POST /v1/align), or null when there is none. */
  aligner: DictationModel | null
}

/** The speech server's latest word on sounds and word timing; null while it isn't answering. */
export function soundsServerState(): SoundsServerState | null {
  const h = health
  if (!h) return null
  return { ready: !!h.sounds?.ready, loaded: !!h.sounds?.loaded, beside: !!h.sounds?.beside, aligner: h.aligner ?? null }
}

export async function getSpeechStatus(): Promise<SpeechStatus> {
  const first = nvidia === null
  const looking = Promise.all([lookForCard(), lookForSpace()])
  // The first time, what the voices need is said with the answer (briefly waited for), so Settings doesn't jump.
  if (first) await Promise.race([looking, sleep(3000)])
  // Once the server has been asked, Settings gets what is known at once; a change since arrives as speech:status.
  if (!starting) {
    if (checked) void refresh()
    else await refresh()
  }
  return status()
}

export async function checkSpeech(): Promise<SpeechStatus> {
  void lookForCard(true)
  void lookForSpace()
  if (starting) return status()
  const h = await refresh(3000)
  if (!h && speechSettings().runServer && !downloads.pending('server')) void ensureRunning()
  return status()
}

export async function setSpeechStartWithApp(on: boolean): Promise<SpeechStatus> {
  updateSettings({ speech: { runServer: on } })
  if (on) {
    void ensureRunning()
    // Show "Starting" (or the download) at once.
    await sleep(0)
  } else {
    // Its download was for starting it (and what waits behind it needs it); set up afresh, it only waits.
    if (downloads.busy && downloads.current?.kind === 'server') downloads.cancel()
    else downloads.unqueue('server')
    setProblem()
    await stopServer()
    await refresh()
  }
  return status()
}

export async function setSpeechServerUrl(input: string): Promise<SpeechStatus> {
  const url = normaliseAddress(input)
  if (url === speechSettings().serverUrl) return checkSpeech()
  await stopServer()
  updateSettings({ speech: { serverUrl: url } })
  health = null
  setProblem()
  if (speechSettings().runServer) void ensureRunning()
  else await refresh()
  return status()
}

export async function setDictationEngine(engine: 'none' | DictationModel): Promise<SpeechStatus> {
  if (engine !== 'none' && engine !== 'parakeet' && engine !== 'whisper') throw new UserError('Pick Parakeet, Whisper or None.')
  updateSettings({ speech: { dictationEngine: engine } })
  // The other model is no longer wanted: its download waiting is dropped, and one that stopped stops showing.
  for (const other of ['parakeet', 'whisper'] as const) {
    if (other === engine) continue
    downloads.unqueue(other)
    if (downloads.current?.kind === other && !downloads.busy) downloads.dismiss()
  }
  const p = paths()
  const installed = installedNow(p, readManifest(p.manifest))
  if (engine !== 'none' && !installed[engine]) {
    await downloadSpeech(engine)
    return status()
  }
  if (health?.dictation) {
    // Usually quick; loading a model can take a few seconds, and the window hears when it's done.
    await Promise.race([useDictation(engine), sleep(SWITCH_WAIT_MS)])
    await refresh()
  }
  return status()
}

export async function downloadSpeech(kind: SpeechDownloadKind): Promise<SpeechStatus> {
  if (!['server', 'voices', 'parakeet', 'whisper', 'sounds', 'studio'].includes(kind)) throw new UserError('That isn’t something to download.')
  const p = paths()
  const installed = installedNow(p, readManifest(p.manifest))
  if (kind === 'server') {
    // Downloaded already: this is the repair. Its environment is set up afresh; the voices and dictation models are kept.
    if (installed.server && !downloads.pending('server')) rebuild.add('server')
    setProblem()
  } else if (!installed.server && !downloads.pending('server')) {
    // The voices and dictation run in the server, so it comes first; and it starts once downloaded, unless another
    // speech server already answers here.
    if (!speechSettings().runServer && !health) updateSettings({ speech: { runServer: true } })
    downloads.start('server')
  } else if (!downloads.pending(kind)) {
    // Downloaded already: the repair Settings offers when it couldn't be loaded. The voices' environment is set
    // up afresh (the voices themselves are kept). A dictation model's engine comes back with the speech engine's
    // environment set up afresh (the server stops meanwhile), then the model is fetched again (plan()).
    if (kind === 'voices' && installed.voices === 'own') rebuild.add('voices')
    // The same for the sound effects: their environment set up afresh, their models kept.
    if (kind === 'sounds' && installed.sounds) rebuild.add('sounds')
    if ((kind === 'parakeet' || kind === 'whisper') && installed[kind] && !downloads.pending('server')) {
      rebuild.add('server')
      downloads.start('server')
    }
  }
  // The studio voices are read by the voices: those download first when they aren't here yet.
  if (kind === 'studio' && installed.voices !== 'own' && !downloads.pending('voices')) downloads.start('voices')
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
    if (fakeWinget) writeFileSync(join(userDataDir(), 'fake-python'), '')
    downloads.start('server')
  })
  return status()
}

export async function setHuggingFaceKey(input: string | null): Promise<SpeechStatus> {
  const key = input === null ? null : cleanHuggingFaceKey(input) || null
  const before = key ? null : getSecret(HF_KEY)
  setSecret(HF_KEY, key)
  if (removedKey) clearTimeout(removedKey.timer)
  removedKey = null
  if (before) {
    // Removed: kept a little while for Undo, then forgotten.
    const timer = setTimeout(() => {
      if (removedKey?.timer === timer) removedKey = null
    }, KEEP_REMOVED_MS)
    timer.unref?.()
    removedKey = { key: before, timer }
  }
  return status()
}

export async function undoRemoveHuggingFaceKey(): Promise<SpeechStatus> {
  const r = removedKey
  if (!r) {
    // A key saved since is the one kept.
    if (hasSecret(HF_KEY)) return status()
    throw new UserError('It’s too late to undo that. Paste the key again from Hugging Face.')
  }
  clearTimeout(r.timer)
  removedKey = null
  setSecret(HF_KEY, r.key)
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
  const [all, breezeEnv, breezeModels, hf, parakeet, whisper, soundEnv, soundModels, soundWeights, clapWeights, library, checker] = await Promise.all([
    folderBytes(p.home),
    folderBytes(join(p.home, 'venvs', 'breeze')),
    folderBytes(join(p.home, 'models', 'breeze')),
    folderBytes(join(p.home, 'models', 'hf')),
    folderBytes(p.parakeet),
    folderBytes(p.whisper),
    folderBytes(join(p.home, 'venvs', 'sound')),
    folderBytes(join(p.home, 'models', 'sound')),
    folderBytes(soundWeightsDir(p.home)),
    folderBytes(clapWeightsDir(p.home)),
    folderBytes(studioDir(p.home)),
    folderBytes(checkWeightsDir(p.home))
  ])
  // The sound effects' models share the Hugging Face cache (models/hf) with the voices.
  const sounds = soundEnv + soundModels + soundWeights + clapWeights
  const voices = breezeEnv + breezeModels + Math.max(0, hf - soundWeights - clapWeights - checker)
  // The studio voices, and the word check's listener in the same cache.
  const studio = library + checker
  return {
    folder: p.home,
    parts: [
      { kind: 'server', bytes: Math.max(0, all - voices - sounds - studio - parakeet - whisper) },
      { kind: 'voices', bytes: voices },
      { kind: 'parakeet', bytes: parakeet },
      { kind: 'whisper', bytes: whisper },
      { kind: 'sounds', bytes: sounds },
      { kind: 'studio', bytes: studio }
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
  rebuild.clear()
  const runServer = speechSettings().runServer
  updateSettings({ speech: { runServer: false } })
  if (removed) {
    // Removed before as well: Undo brings back only the latest, so the earlier ones go now.
    clearTimeout(removed.timer)
    void rm(removed.dir, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined)
  }
  removed = { dir, runServer, timer: deleteLater(dir) }
  health = null
  setProblem()
  await refresh()
  changed()
  return status()
}

export async function undoRemoveSpeechDownloads(): Promise<SpeechStatus> {
  const r = removed
  if (!r || !existsSync(r.dir)) throw new UserError('It’s too late to undo that: the downloads were already deleted.')
  // Kept aside until they're back in place.
  clearTimeout(r.timer)
  try {
    // Anything started since (a download, the server) lets go of the speech folder first.
    downloads.cancel()
    downloads.dismiss()
    await stopServer()
    const home = paths().home
    // Only made since (a log, a download just begun): the removed downloads take its place.
    if (existsSync(home)) await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
    await renameRetry(r.dir, home, 24, 250)
  } catch (e) {
    console.warn('[speech] could not put the speech folder back', e)
    // Undo can be tried again while they're kept aside.
    if (removed === r) r.timer = deleteLater(r.dir)
    throw new UserError('Some of the speech files are still in use. Wait a moment, then try again.', 'speech-in-use')
  }
  if (removed === r) removed = null
  rebuild.clear()
  updateSettings({ speech: { runServer: r.runServer } })
  health = null
  setProblem()
  if (r.runServer) void ensureRunning()
  else void refresh()
  changed()
  return status()
}
