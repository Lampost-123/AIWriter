// The app, opened for a trap run or for writing the story: its own main-process code (settings, providers, world,
// memory keeper, drafting) in plain Node, with a stand-in for Electron (fakeElectron.ts) and a throwaway data folder,
// so what is measured is what Adam gets. App code is imported through '@app/...', which the trap config points at the
// checkout being run (--root).

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { appEvents } from './fakeElectron'
import { Budget, DEFAULT_BUDGET } from './budget'
import { JUDGE_MARKER, judgeMessages, readJudgeReply, type ChatMessage, type JudgeAnswer } from './judge'
import { DEEPSEEK_BASE_URL, KEY_VARIABLE, pickFlash, type TrapProvider } from './models'
import type { Fix } from './page'
import type { SampleResult, Usage } from './score'
import type { Check } from './story'
import type { StoryData, StoryScene } from './storyData'

// ---------- Settings ----------

export interface TrapsConfig {
  /** The checkout whose app code runs (the trap config's alias points there too). */
  root: string
  /** The harness's own checkout. */
  harnessRoot: string
  /** Use the fake provider (tests/fake-provider) and stand-ins: a check of the harness, never a score. */
  fake: boolean
  /** DeepSeek's own API (the default) or OpenRouter. */
  provider: TrapProvider
  /** The provider's API key, from DEEPSEEK_API_KEY or OPENROUTER_API_KEY only (real runs only). Never printed. */
  apiKey: string | null
  /** Another address for the provider (to check the harness against a local fake server); null: the provider's own. */
  baseUrl: string | null
  /**
   * USD per million tokens in (cache misses), in from the provider's cache, and out, for an estimated cost when the
   * provider reports none. DeepSeek's chat prices by default, as an estimate; null: tokens only.
   */
  prices: { in: number; cached: number; out: number } | null
  /** Model ids; null picks DeepSeek Flash from the provider's list. The judge defaults to the memory model. */
  writer: string | null
  memory: string | null
  judge: string | null
  samples: number
  /** Probe ids to run (null: all). */
  probes: string[] | null
  words: { generate: number; addBelow: number; beatScene: number }
  /** Where the report goes (a folder), or for writing the story, the story file. */
  out: string | null
  /** Keep the throwaway data folder (the world database, with "What the AI saw" for every call). */
  keep: boolean
  /** Which story: 'v3' (the written story, the default) or 'v2' (story.ts). */
  story: 'v2' | 'v3'
  /** The written story's file (version 3). */
  storyFile: string
  /** A partly written story to carry on from (writing only). */
  resume: string | null
  /**
   * Step 5's search model for "Find by meaning": a folder holding the model's files as downloaded (config.json,
   * vocab.txt, onnx/model.onnx and/or model.safetensors), copied into the run's app data folder; 'none' for none (keyword
   * search, sticky entries and what was said only). Never downloaded.
   */
  searchModel: string
  /** Save the world as it stands just before the first probe scene, beside the report, for --from-world. */
  saveWorld: boolean
  /** Start from a saved world (a world-before-*.db from an earlier run of the same checkout and story): no memory build. */
  fromWorld: string | null
  /** 4: chains in one scene (the default, story version 3 only); 3: probes v3, one passage each. */
  probesVersion: 3 | 4
  /** The hard token budget: no call is sent once it would be passed. */
  maxIn: number
  maxOut: number
  log: (line: string) => void
}

/** Where the search model was downloaded and checked once, on Adam's computer (a scratch folder; read only). */
const DEFAULT_SEARCH_MODEL = join(tmpdir(), 'claude', 'C--Users-adox1-Documents-AI-Write', '7636dc9a-3a6e-4087-bc5d-e50d78d3e334', 'scratchpad', 'bge-test')

const num = (v: string | undefined, fallback: number): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** The settings from the environment (the cli sets these from its flags). */
export function configFromEnv(env = process.env): TrapsConfig {
  const harnessRoot = resolve(__dirname, '..', '..')
  const provider: TrapProvider = env.TRAPS_PROVIDER === 'openrouter' ? 'openrouter' : 'deepseek'
  const price = (v: string | undefined, fallback: number): number => (v != null && v.trim() !== '' && Number(v) >= 0 ? Number(v) : fallback)
  return {
    root: resolve(env.TRAPS_ROOT || harnessRoot),
    harnessRoot,
    fake: env.TRAPS_FAKE === '1',
    provider,
    apiKey: env[KEY_VARIABLE[provider]]?.trim() || null,
    baseUrl: env.TRAPS_BASE_URL?.trim() || null,
    prices: { in: price(env.TRAPS_PRICE_IN, 0.28), cached: price(env.TRAPS_PRICE_CACHED, 0.028), out: price(env.TRAPS_PRICE_OUT, 0.42) },
    writer: env.TRAPS_WRITER_MODEL?.trim() || null,
    memory: env.TRAPS_MEMORY_MODEL?.trim() || null,
    judge: env.TRAPS_JUDGE_MODEL?.trim() || null,
    samples: num(env.TRAPS_SAMPLES, 3),
    probes: env.TRAPS_PROBES ? env.TRAPS_PROBES.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null,
    words: { generate: num(env.TRAPS_WORDS, 600), addBelow: num(env.TRAPS_ADD_WORDS, 400), beatScene: num(env.TRAPS_BEAT_SCENE_WORDS, 900) },
    out: env.TRAPS_OUT?.trim() || null,
    keep: env.TRAPS_KEEP === '1',
    story: env.TRAPS_STORY === 'v2' ? 'v2' : 'v3',
    storyFile: resolve(env.TRAPS_STORY_FILE?.trim() || join(harnessRoot, 'tests', 'traps', 'story-v3.json')),
    resume: env.TRAPS_RESUME?.trim() ? resolve(env.TRAPS_RESUME.trim()) : null,
    searchModel: env.TRAPS_SEARCH_MODEL?.trim() || DEFAULT_SEARCH_MODEL,
    saveWorld: env.TRAPS_SAVE_WORLD !== '0',
    fromWorld: env.TRAPS_FROM_WORLD?.trim() ? resolve(env.TRAPS_FROM_WORLD.trim()) : null,
    probesVersion: env.TRAPS_PROBES_VERSION === '3' || env.TRAPS_STORY === 'v2' ? 3 : 4,
    maxIn: num(env.TRAPS_MAX_TOKENS_IN, DEFAULT_BUDGET.in),
    maxOut: num(env.TRAPS_MAX_TOKENS_OUT, DEFAULT_BUDGET.out),
    log: (line) => console.log(`[traps] ${line}`)
  }
}

// ---------- Small helpers ----------

export function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

export const countWords = (s: string): number => (s.match(/\S+/g) ?? []).length

/** The checkout's branch (a checkout of a commit with no branch, an old release say, is named by its version), commit and version. */
export function checkout(root: string): { root: string; branch: string; commit: string; dirty: boolean; appVersion: string } {
  let appVersion = ''
  try {
    appVersion = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? ''
  } catch {
    /* not known */
  }
  const b = git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])
  return {
    root,
    branch: !b || b === 'HEAD' ? `detached-${appVersion || 'unknown'}` : b,
    commit: git(root, ['rev-parse', 'HEAD']) || 'unknown',
    // The app code only: the harness and its results don't change what is measured.
    dirty: git(root, ['status', '--porcelain', '--untracked-files=no', '--', 'src']) !== '',
    appVersion
  }
}

/** The editor document for a scene's paragraphs, each with a stable paragraph id (as the editor makes them). */
function sceneDoc(sceneKey: string, paragraphs: string[]): unknown {
  return {
    type: 'doc',
    content: paragraphs.map((text, i) => ({
      type: 'paragraph',
      attrs: { pid: pidOf(sceneKey, i) },
      content: [{ type: 'text', text }]
    }))
  }
}

export const pidOf = (sceneKey: string, i: number): string => `t${sceneKey}${String(i + 1).padStart(2, '0')}zzzz`.slice(0, 8)

/** Every draft and task end the app sends to its window, by record or task id (kept, so none is missed). */
const ended = new Map<string, unknown>()
const endWaiters = new Map<string, (payload: unknown) => void>()
function noteEnd(id: string, payload: unknown): void {
  const w = endWaiters.get(id)
  if (w) {
    endWaiters.delete(id)
    w(payload)
  } else ended.set(id, payload)
}
appEvents.on('event:generation:done', (p: { generationId: string }) => noteEnd(p.generationId, p))
appEvents.on('event:task:done', (p: { taskId: string }) => noteEnd(p.taskId, p))

export function whenEnded<T>(id: string, limitMs = 15 * 60_000): Promise<T> {
  const had = ended.get(id)
  if (had) {
    ended.delete(id)
    return Promise.resolve(had as T)
  }
  return new Promise<T>((res, rej) => {
    const timer = setTimeout(() => {
      endWaiters.delete(id)
      rej(new Error(`Nothing came back for ${id} in ${Math.round(limitMs / 60_000)} minutes`))
    }, limitMs)
    endWaiters.set(id, (p) => {
      clearTimeout(timer)
      res(p as T)
    })
  })
}

export const addUsage = (
  u: Usage,
  more: { promptTokens?: number | null; cachedTokens?: number | null; completionTokens?: number | null; cost?: number | null }
): void => {
  u.calls++
  u.promptTokens += more.promptTokens ?? 0
  u.cachedTokens = (u.cachedTokens ?? 0) + (more.cachedTokens ?? 0)
  u.completionTokens += more.completionTokens ?? 0
  if (more.cost != null) u.cost = (u.cost ?? 0) + more.cost
}
export const noUsage = (): Usage => ({ calls: 0, promptTokens: 0, completionTokens: 0, cost: null })

// ---------- Stand-ins for a fake run (never used for a real one) ----------

const sse = (reply: string, promptChars: number): Response => {
  const chunk = { choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }] }
  const usage = { choices: [], usage: { prompt_tokens: Math.ceil(promptChars / 4), completion_tokens: Math.ceil(reply.length / 4) } }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

const contentOf = (body: string): string => {
  const parsed = JSON.parse(body) as { messages: { content: unknown }[] }
  return parsed.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
}

/** The judge: readable stand-in answers (the fake provider would answer with prose). */
function standInJudge(body: string): Response {
  const content = contentOf(body)
  const passage = /"""\n([\s\S]*?)\n"""/.exec(content)?.[1] ?? ''
  const firstSentence = /[^.!?]+[.!?]/.exec(passage)?.[0]?.trim() ?? ''
  const ids = [...content.matchAll(/^([A-Z]\w*): /gm)].map((m) => m[1])
  const answers = ids.map((id, i) => ({ id, answer: ['no', 'yes', 'unclear'][i % 3], quote: i % 3 === 1 ? firstSentence : '' }))
  return sse(JSON.stringify({ answers }), content.length)
}

/**
 * Check and repair's claims: a slip on the first stage line that has the story's words, mending a word of the new
 * words' first sentence, and a slip on the first memory line, asked as a question.
 */
function standInRepair(body: string): Response {
  const content = contentOf(body)
  const words = /The new words \(check these\)\n"""\n([\s\S]*?)\n"""/.exec(content)?.[1] ?? ''
  const sentences = words.match(/[^.!?\n]+[.!?]/g)?.map((s) => s.trim()) ?? []
  const stage = /^- \[(W\d+)\] (?:([^·\n]+?) · )?([a-z ]+): .+? · words: ".*"$/m.exec(content)
  const codex = /^(?:### |- \[)(E\d+)\b/m.exec(content)
  const claims: Record<string, unknown>[] = []
  const first = sentences[0]
  const word = first?.match(/\b[a-z]{5,}\b/)?.[0]
  if (stage && first && word) {
    claims.push({ quote: first, who: stage[2] ?? '', about: 'where', line: stage[1], verdict: 'slip', why: 'A stand-in slip (fake run).', fix: { replace: word, with: word.toUpperCase() } })
  }
  if (codex && sentences[1]) {
    claims.push({ quote: sentences[1], who: '', about: 'other', line: codex[1], verdict: 'slip', why: 'A stand-in question (fake run).', question: 'Is this as the story has it? (fake run)' })
  }
  return sse(JSON.stringify({ claims }), content.length)
}

const FILLER = [
  'The wind moved over the heather and the light shifted slowly on the far hills.',
  'Wren watched the road ahead and counted the miles still to go.',
  'Ash hummed a drovers’ tune under his breath, and the sound kept them company.',
  'Clouds gathered in the west, grey and patient, and the air smelled of rain.',
  'Somewhere a curlew called, and another answered it from further off.',
  'They spoke little, and when they did it was of small things: food, the weather, the state of the road.'
]

/**
 * Writing the story in a fake run: a draft asked to make planted events happen ("Make sure this happens ...") gets
 * them, each in a sentence of its own (early ones first, a last-part one near the end), among plain sentences that
 * break nothing, at about the length asked.
 */
/** Directions a fake run's stand-in writer carries out word for word (a chain's: probes v4), set by the chain runner. */
export const standInDirections: string[] = []

function standInWriter(body: string): Response {
  const content = contentOf(body)
  const asks = [...content.matchAll(/Make sure this happens([^:]*):\s*(.*?)(?=\s*Make sure this happens|\n|"|$)/g)].map((m) => ({ when: m[1], what: m[2].trim() }))
  for (const d of standInDirections) if (content.includes(d)) asks.push({ when: 'early', what: d })
  const words = Number((/about ([\d,]+) words/.exec(content)?.[1] ?? '1500').replace(/,/g, '')) || 1500
  const paras = Math.max(4, Math.round(words / 90))
  const out: string[] = []
  for (let i = 0; i < paras; i++) out.push(Array.from({ length: 5 }, (_, j) => FILLER[(i + j) % FILLER.length]).join(' '))
  for (const a of asks) {
    const at = /early/.test(a.when) ? 0 : /last part/.test(a.when) ? out.length - 1 : Math.floor(out.length / 2)
    out[at] = `${a.what} ${out[at]}`
  }
  return sse(out.join('\n\n'), content.length)
}

/** fetch for a fake run: the stand-ins above, everything else on to the fake provider. */
function withStandIns(next: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    if (body.includes('[AIWRITE-REPAIR v')) return standInRepair(body)
    if (body.includes(JUDGE_MARKER)) return standInJudge(body)
    if (body.includes('Make sure this happens') || standInDirections.some((d) => body.includes(JSON.stringify(d).slice(1, -1)))) return standInWriter(body)
    return next(input, init)
  }) as typeof fetch
}

// ---------- Step 3's check and repair, when the checkout has it ----------
// Typed here, not imported: older checkouts don't have these files (contracts/repair.ts, features/repair/apply.ts).

export interface RepairFixLike extends Fix {
  why: string
}
export interface RepairModule {
  repairHandlers: {
    checkNewWords(input: {
      sceneId: string
      recordId: string
      paragraphs: { text: string; from: number; to: number }[]
      leadIn: string
    }): Promise<{ repairId: string | null; fixes: RepairFixLike[]; questions: number; claims: number; slips: number }>
    repairsApplied(repairId: string, applied: string[]): Promise<Record<string, string>> | Record<string, string>
  }
}
export interface LandedPartLike {
  pid: string | null
  text: string
  from: number
  to: number
}
export interface ApplyModule {
  landedParts(doc: PMNode, from: number, to: number): LandedPartLike[]
  fixesTr(state: EditorState, parts: LandedPartLike[], fixes: RepairFixLike[]): { tr: Transaction; made: { id: string }[] } | null
}

/** Step 5's retrieval (src/main/retrieval/index.ts), when the checkout has it. */
interface SearchStatusLike {
  state: string
  problem: string | null
  indexed: { done: number; total: number } | null
  engine?: string | null
}
interface RetrievalModule {
  initRetrieval(): void
  closeRetrieval?(): void
  searchModelStatus(): SearchStatusLike
  findByMeaningChanged(on: boolean): void
}
interface ModelFilesModule {
  SEARCH_MODEL: string
  SEARCH_MODEL_REVISION: string
  COMMON_FILES: { name: string; bytes: number }[]
  WEIGHTS: Record<'onnx' | 'ts', { name: string; bytes: number }>
  modelDir(userData: string): string
  writeManifest(dir: string, m: { model: string; revision: string; at: string }): void
}

/** What step 5 had for the run: its search model, and how much of the story it had read for meaning. */
export interface RecallState {
  /** The checkout has step 5. */
  available: boolean
  /** Finding by meaning was in use (the model was ready). */
  meaning: boolean
  /** The model's state as the app reports it ('ready', 'none', 'broken', 'starting'), and its engine. */
  state: string
  engine: string | null
  /** Passages read for meaning, of all the world's passages, when the probe began. */
  indexed: { done: number; total: number } | null
  /** Why finding by meaning wasn't in use, or anything worth knowing; null when all is well. */
  note: string | null
}

/**
 * The search model's files from `source`, into the app data folder as the app's own download leaves them (with its
 * installed.json), so the app finds it downloaded. Only files of the expected size are copied; nothing is downloaded.
 */
function installSearchModel(files: ModelFilesModule, userData: string, source: string): { ok: boolean; note: string } {
  if (!source || source === 'none') return { ok: false, note: 'No search model was given (--search-model none): keyword search, sticky entries and what was said only.' }
  const at = (name: string): string => join(source, ...name.split('/'))
  const fits = (f: { name: string; bytes: number }): boolean => {
    try {
      return statSync(at(f.name)).size === f.bytes
    } catch {
      return false
    }
  }
  const weights = (['onnx', 'ts'] as const).map((e) => files.WEIGHTS[e]).filter(fits)
  if (!files.COMMON_FILES.every(fits) || !weights.length) {
    return { ok: false, note: `The search model isn't in ${source} (its files are missing or not the right size): keyword search, sticky entries and what was said only.` }
  }
  const dir = files.modelDir(userData)
  for (const f of [...files.COMMON_FILES, ...weights]) {
    const to = join(dir, ...f.name.split('/'))
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(at(f.name), to)
  }
  files.writeManifest(dir, { model: files.SEARCH_MODEL, revision: files.SEARCH_MODEL_REVISION, at: new Date().toISOString() })
  return { ok: true, note: '' }
}

/** One of the app's modules (`src/<rel>.ts` in the checkout), or null when this checkout doesn't have it. */
async function optional<T>(root: string, rel: string): Promise<T | null> {
  if (!existsSync(join(root, 'src', `${rel}.ts`))) return null
  const spec = `@app/${rel}`
  return (await import(/* @vite-ignore */ spec)) as T
}

/**
 * Check and repair on for the run, whatever the app's default: Settings' checkNewWords ("Check new words straight
 * away") and any setting named for the repair that is off is turned on, and what was turned on is logged.
 */
function switchOnRepair(
  settings: { getSettings(): object; updateSettings(patch: never): unknown; getWritingPrefs?(): object; setWritingPrefs?(prefs: never): unknown },
  log: (line: string) => void
): void {
  const on = (o: object): Record<string, unknown> | null => {
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      if (!/repair/i.test(k) && k !== 'checkNewWords') continue
      if (v === false) patch[k] = true
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner = Object.fromEntries(Object.entries(v).filter(([, x]) => x === false).map(([ik]) => [ik, true]))
        if (Object.keys(inner).length) patch[k] = { ...v, ...inner }
      }
    }
    return Object.keys(patch).length ? patch : null
  }
  const s = on(settings.getSettings())
  if (s) {
    settings.updateSettings(s as never)
    log(`check and repair switched on in Settings: ${Object.keys(s).join(', ')}`)
  }
  const prefs = settings.getWritingPrefs?.()
  const p = prefs ? on(prefs) : null
  if (prefs && p && settings.setWritingPrefs) {
    settings.setWritingPrefs({ ...prefs, ...p } as never)
    log(`check and repair switched on in the writing preferences: ${Object.keys(p).join(', ')}`)
  }
}

// ---------- Opening the app ----------

/** The app, open on a fresh world with the story's codex. */
export interface App {
  db: Database.Database
  budget: Budget
  models: { writer: string; memory: string; judge: string }
  providerName: string
  gens: typeof import('@app/main/db/generations')
  aiHandlers: (typeof import('@app/main/ipc/ai'))['aiHandlers']
  beatsHandlers: (typeof import('@app/main/ipc/beats'))['beatsHandlers']
  startEdit: (typeof import('@app/main/edits'))['startEdit']
  /** Step 3's check and repair and the page's code for it, when the checkout has them. */
  repairMod: RepairModule | null
  applyMod: ApplyModule | null
  /** Makes the scene (and its chapter) with its card, as the story reaches it; returns its id. */
  makeScene(s: Pick<StoryScene, 'key' | 'chapter' | 'title' | 'card'>): string
  /** The scene card's beats, as Adam would change them. */
  setBeats(sceneId: string, beats: string[]): void
  /** A saved world's scenes, by title, in story order (empty for a new world). */
  existing: { id: string; title: string }[]
  /** Waits until the memory keeper is idle and no call is unfinished (what follows a read included). */
  quiet(limitMs?: number): Promise<void>
  /** Adam pauses in a scene: the memory reads it now (the quiet timer's read) and all that follows a read finishes. */
  pause(sceneId: string): Promise<void>
  /** Opens a fresh copy of a saved world in place of the open one; the calls so far still count. */
  reopen(file: string): Promise<void>
  /** Saves the world as it stands (a consistent copy of its database). */
  snapshot(file: string): Promise<void>
  /**
   * Step 5: brings the search index up to date with the scenes and waits (at most `limitMs`) until the search model has
   * read every passage, so a probe's briefing really searches by meaning; says how it stands.
   */
  recallReady(limitMs?: number): Promise<RecallState>
  save(sceneKey: string, sceneId: string, paragraphs: string[]): void
  memoryIdle(): Promise<void>
  leave(sceneId: string): Promise<void>
  askJudge(probe: { facts: string[]; checks: Check[] }, text: string): Promise<SampleResult['judge'] & { answers: JudgeAnswer[] | null }>
  usage(): { byJob: Record<string, Usage>; judge: Usage; total: Usage }
  /** The newest record's row so far, to find the records a step makes. */
  lastRow(): number
  /** The records made since a row, each with what it was (the writer's draft, a plan, a repair, the memory...). */
  recordsSince(row: number): CallRecord[]
  /** A record's request and reply. */
  record(id: string): { messages: string; response: string } | null
  /** A consistent copy of the world's database (every record, with what was sent and what came back), as evidence. */
  saveEvidence(file: string): Promise<void>
  close(): Promise<void>
}

/** One model call the app made, as recorded in the world. */
export interface CallRecord {
  id: string
  job: string
  /** What it was, from its job and the marker its request starts with. */
  kind: 'writer' | 'plan' | 'repair' | 'stand' | 'memory' | 'summary' | 'other'
}

/** What a record was, from its job and its request's marker. */
export function callKind(job: string, messages: string): CallRecord['kind'] {
  if (messages.includes('[AIWRITE-REPAIR v')) return 'repair'
  if (messages.includes('[AIWRITE-PLAN v')) return 'plan'
  if (messages.includes('[AIWRITE-CONTINUITY v')) return 'stand'
  if (job === 'draft' || job === 'beat' || messages.includes('[AIWRITE-EDIT v')) return 'writer'
  if (job === 'summary' || messages.includes('[AIWRITE-MEMORY-SUMMARY v')) return 'summary'
  if (job === 'memory') return 'memory'
  return 'other'
}

export async function openApp(
  cfg: TrapsConfig,
  data: Pick<StoryData, 'story' | 'chapters' | 'entries'>,
  worldName: string,
  /** A saved world to open in place of a new one (a copy is opened; the file is never changed). */
  worldFile: string | null = null
): Promise<App> {
  if (!cfg.fake && !cfg.apiKey) throw new Error(`No ${KEY_VARIABLE[cfg.provider]} in the environment: a real run needs it (or use --fake).`)
  if (!cfg.fake && process.env.CI) throw new Error('A real trap run never runs in CI.')
  const dataDir = mkdtempSync(join(tmpdir(), 'aiwrite-traps-'))
  process.env.AIWRITE_DATA_DIR = dataDir
  // The memory reads a scene when Adam leaves it (as the harness does), never on a timer in the middle of a probe.
  process.env.AIWRITE_KEEPER_QUIET_MS = String(6 * 60 * 60_000)
  const realFetch = globalThis.fetch
  let fake: { url: string; close(): Promise<void> } | null = null
  let world: typeof import('@app/main/world') | null = null
  let dbRef: Database.Database | null = null
  let sinceRow = 0
  const judgeUsage = noUsage()
  /** The calls of worlds this run has already closed (a chain reopens a saved world for each sample), by job. */
  const closedUsage: { job: string; calls: number; p: number; c: number; cost: number | null; k: number; i: number; o: number }[] = []

  /** Tokens used so far: every call the app made is a generation record (its own count, else its text at 4 a token). */
  const used = (): { in: number; out: number } => {
    let inT = judgeUsage.promptTokens + closedUsage.reduce((t, r) => t + r.i, 0)
    let outT = judgeUsage.completionTokens + closedUsage.reduce((t, r) => t + r.o, 0)
    if (dbRef?.open) {
      const r = dbRef
        .prepare(
          'SELECT COALESCE(SUM(COALESCE(prompt_tokens, length(messages_json) / 4)), 0) AS i, COALESCE(SUM(COALESCE(completion_tokens, length(response) / 4)), 0) AS o FROM generations WHERE rowid > ?'
        )
        .get(sinceRow) as { i: number; o: number }
      inT += r.i
      outT += r.o
    }
    return { in: Math.round(inT), out: Math.round(outT) }
  }
  const budget = new Budget(cfg.maxIn, cfg.maxOut, used)

  let closeRecall: (() => void) | null = null
  const close = async (): Promise<void> => {
    try {
      world?.closeWorld()
      closeRecall?.()
    } catch (e) {
      console.warn('Could not close the trap world', e)
    }
    globalThis.fetch = realFetch
    await fake?.close()
    if (cfg.keep) cfg.log(`data folder kept at ${dataDir}`)
    else rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }

  try {
    if (cfg.fake) {
      const { startFakeProvider } = await import('../fake-provider/server.mjs')
      fake = await startFakeProvider({ delayMs: 0, words: 220 })
      globalThis.fetch = budget.wrap(withStandIns(realFetch))
    } else globalThis.fetch = budget.wrap(realFetch)

    const settings = await import('@app/main/settings')
    const providers = await import('@app/main/ai/providers')
    world = await import('@app/main/world')
    const keeper = await import('@app/main/keeper')
    const { initAi } = await import('@app/main/ai')
    const { aiHandlers } = await import('@app/main/ipc/ai')
    const { beatsHandlers } = await import('@app/main/ipc/beats')
    const { startEdit } = await import('@app/main/edits')
    const repo = await import('@app/main/db/repo')
    const gens = await import('@app/main/db/generations')
    const { streamChat } = await import('@app/main/ai/client')
    const { emptySceneCard } = await import('@shared/defaults')
    // Step 3's check and repair, when this checkout has it (older ones run exactly as before), and the page's own code
    // for making its fixes.
    const repairMod = await optional<RepairModule>(cfg.root, 'main/ipc/repair')
    const applyMod = repairMod ? await optional<ApplyModule>(cfg.root, 'renderer/src/features/repair/apply') : null
    // Step 5 (recall by meaning): on for the run, with the search model copied in where the app keeps its download.
    const retrieval = await optional<RetrievalModule>(cfg.root, 'main/retrieval/index')
    let modelNote: string | null = null
    if (retrieval) {
      process.env.AIWRITE_RECALL = 'on'
      const files = await optional<ModelFilesModule>(cfg.root, 'main/retrieval/model/files')
      const { userDataDir } = await import('@app/main/paths')
      const got = files ? installSearchModel(files, userDataDir(), cfg.searchModel) : { ok: false, note: "This checkout's search model files aren't where the harness expects them." }
      if (!got.ok) modelNote = got.note
      cfg.log(`recall by meaning: found; ${got.ok ? `search model copied from ${cfg.searchModel}` : got.note}`)
    }
    if (repairMod) {
      // On for the run, whatever the app's default: AIWRITE_REPAIR=off turns it off for app tests.
      process.env.AIWRITE_REPAIR = 'on'
      cfg.log(`check and repair: found; fixes made with ${applyMod ? "the app's page code (apply.ts)" : 'a plain-text copy of it'}`)
    }

    // The provider and the models, as Settings › Models would have them: DeepSeek through the app's DeepSeek preset
    // (a custom, OpenAI-compatible provider), or OpenRouter. The fake run is a custom provider too.
    const provider = cfg.fake
      ? providers.saveProvider({ kind: 'custom', name: 'Fake', baseUrl: fake!.url, apiKey: 'traps-fake' })
      : cfg.provider === 'deepseek'
        ? providers.saveProvider({ kind: 'custom', name: 'DeepSeek', baseUrl: cfg.baseUrl ?? DEEPSEEK_BASE_URL, apiKey: cfg.apiKey! })
        : providers.saveProvider({ kind: 'openrouter', name: 'OpenRouter', baseUrl: '', apiKey: cfg.apiKey! })
    // The model list costs nothing.
    const listed = await providers.listModels(provider.id)
    const flash = (): string => {
      if (cfg.fake) return 'fake/writer'
      const found = pickFlash(
        listed.map((m) => m.id),
        cfg.provider
      )
      if (!found) {
        const ids = listed.map((m) => m.id).filter((id) => cfg.provider === 'deepseek' || id.startsWith('deepseek/'))
        throw new Error(`No DeepSeek Flash model in the provider's list; name one with --writer. Models listed: ${ids.join(', ') || 'none'}`)
      }
      return found
    }
    const choose = (id: string) => {
      const m = listed.find((x) => x.id === id)
      // A custom provider takes a model id typed in, as Settings › Models does; OpenRouter only what it lists.
      if (!m && provider.kind === 'openrouter') throw new Error(`OpenRouter doesn't list a model called "${id}".`)
      if (!m) return { providerId: provider.id, modelId: id, label: id, contextLength: null, promptPrice: null, completionPrice: null, maxOutput: null, sampling: null }
      return {
        providerId: provider.id,
        modelId: m.id,
        label: m.name,
        contextLength: m.contextLength,
        promptPrice: m.promptPrice,
        completionPrice: m.completionPrice,
        maxOutput: m.maxOutput ?? null,
        sampling: m.sampling ?? null
      }
    }
    const writer = choose(cfg.writer ?? flash())
    const memory = choose(cfg.memory ?? writer.modelId)
    const judge = choose(cfg.judge ?? memory.modelId)
    settings.updateSettings({ models: { writer, memory } })
    if (repairMod) switchOnRepair(settings, cfg.log)
    if (retrieval) settings.updateSettings({ findByMeaning: true } as never)
    cfg.log(`writer ${writer.modelId}, memory ${memory.modelId}, judge ${judge.modelId}; budget ${cfg.maxIn.toLocaleString('en-GB')} tokens in, ${cfg.maxOut.toLocaleString('en-GB')} out`)

    // The app as it starts: drafting, and the memory keeper (which registers the catch-up before a draft).
    initAi()
    keeper.initKeeper()
    retrieval?.initRetrieval()
    closeRecall = retrieval?.closeRetrieval ?? null
    // The open world, and what the harness keeps of it. A chain opens a fresh copy of a saved world for each sample
    // (reopen), so these change with it.
    let db = null as unknown as Database.Database
    let entryIds = new Map<string, string>()
    let story = null as unknown as ReturnType<typeof repo.listStories>[number]
    let first = null as unknown as ReturnType<typeof repo.getOutline>
    let chapterIds: string[] = []
    let firstUsed = false
    let existing: { id: string; title: string }[] = []
    let opened = 0

    /** Opens a world: a new one with the story's codex, or a copy of a saved one, opened as Adam opens a world in his library. */
    const bind = (file: string | null): void => {
      if (file) {
        const folder = join(settings.getSettings().libraryPath, `Saved trap world ${++opened}`)
        mkdirSync(folder, { recursive: true })
        copyFileSync(file, join(folder, 'world.db'))
        const found = world!.listWorlds().find((w) => resolve(w.folder) === resolve(folder))
        if (!found) throw new Error(`Couldn't open the saved world ${file}.`)
        world!.openWorld(found.id)
      } else world!.createWorld(worldName)
      db = world!.db()
      dbRef = db
      // Only this run's calls count (a saved world holds the records of the run that built it).
      sinceRow = (db.prepare('SELECT COALESCE(MAX(rowid), 0) AS m FROM generations').get() as { m: number }).m
      // Adam's codex and the story's frame (a saved world has them already).
      entryIds = new Map<string, string>()
      if (file) {
        const all = repo.listEntries(db)
        for (const e of data.entries) {
          const found = all.find((x) => x.name === e.name && x.kind === e.kind)
          if (found) entryIds.set(e.key, found.id)
        }
      } else {
        for (const e of data.entries) {
          const made = repo.createEntry(db, e.kind, { name: e.name, aliases: e.aliases ?? [], summary: e.summary, description: e.description ?? '', fields: e.fields ?? {} })
          entryIds.set(e.key, made.id)
        }
      }
      story = repo.listStories(db)[0]
      if (!file) repo.updateStory(db, story.id, { title: data.story.title, premise: data.story.premise })
      first = repo.getOutline(db, story.id)
      // A saved world goes on where it stopped: its chapters (in order) and scenes are there already.
      chapterIds = file ? first.chapters.map((c) => c.id) : []
      firstUsed = !!file
      existing = file ? first.chapters.flatMap((c) => first.scenes.filter((x) => x.chapterId === c.id)).map((x) => ({ id: x.id, title: x.title })) : []
    }
    bind(worldFile)
    const id = (k: string): string => {
      const v = entryIds.get(k)
      if (!v) throw new Error(`The story's codex has no entry "${k}".`)
      return v
    }

    /** The chapter and scene, made when the story reaches them (the writer never sees cards ahead of the scene). */
    const makeScene = (s: Pick<StoryScene, 'key' | 'chapter' | 'title' | 'card'>): string => {
      let chapterId = chapterIds[s.chapter]
      if (!chapterId) {
        const c = s.chapter === 0 ? first.chapters[0] : repo.createChapter(db, story.id, { title: data.chapters[s.chapter].title })
        repo.updateChapter(db, c.id, data.chapters[s.chapter])
        chapterId = chapterIds[s.chapter] = c.id
      }
      const sceneId = !firstUsed ? first.scenes[0].id : repo.createScene(db, chapterId, { title: s.title }).id
      firstUsed = true
      repo.updateScene(db, sceneId, { title: s.title })
      repo.updateSceneCard(db, sceneId, {
        ...emptySceneCard(),
        povId: id(s.card.pov),
        presentIds: s.card.present.map(id),
        locationId: id(s.card.location),
        when: s.card.when,
        beats: s.card.beats ?? [],
        goal: s.card.goal ?? '',
        conflict: s.card.conflict ?? '',
        outcome: s.card.outcome ?? '',
        mood: s.card.mood ?? ''
      })
      return sceneId
    }

    const setBeats = (sceneId: string, beats: string[]): void => {
      repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, beats })
    }
    const snapshot = async (file: string): Promise<void> => {
      await db.backup(file)
    }

    const recallReady = async (limitMs = 20 * 60_000): Promise<RecallState> => {
      if (!retrieval) return { available: false, meaning: false, state: 'none', engine: null, indexed: null, note: null }
      // As Adam turning "Find by meaning" on: the model starts when it is here, and the open world's index catches up.
      retrieval.findByMeaningChanged(true)
      const until = Date.now() + limitMs
      let st = retrieval.searchModelStatus()
      let steady = 0
      for (;;) {
        st = retrieval.searchModelStatus()
        const all = !!st.indexed && st.indexed.total > 0 && st.indexed.done >= st.indexed.total
        if (st.state === 'ready' && all) {
          if (++steady >= 2) break
        } else steady = 0
        // Nothing to wait for: no model, or one that couldn't start.
        if (st.state === 'none' || st.state === 'broken') break
        if (Date.now() > until) break
        await new Promise((r) => setTimeout(r, 1000))
      }
      const meaning = st.state === 'ready'
      const done = !!st.indexed && st.indexed.done >= st.indexed.total
      const note = meaning
        ? done
          ? null
          : `The search model hadn't read every passage in ${Math.round(limitMs / 60_000)} minutes (${st.indexed?.done ?? 0} of ${st.indexed?.total ?? '?'}).`
        : (modelNote ?? `Finding by meaning was off: the search model was ${st.state}${st.problem ? ` (${st.problem})` : ''}. Keyword search, sticky entries and what was said only.`)
      return { available: true, meaning, state: st.state, engine: st.engine ?? null, indexed: st.indexed, note }
    }

    /** Saves the scene's words as the window does (the memory keeper hears of the save). */
    const save = (sceneKey: string, sceneId: string, paragraphs: string[]): void => {
      keeper.sceneSaved(sceneId, repo.saveSceneText(db, sceneId, sceneDoc(sceneKey, paragraphs), paragraphs.join('\n\n')))
    }
    const memoryIdle = async (): Promise<void> => {
      await keeper.currentKeeper()?.whenIdle()
    }
    /**
     * The app gone quiet: the memory keeper idle and no call of the open world unfinished, three looks running (what
     * follows a read, like where things stand being brought up to date, starts just after it). At most `limitMs`.
     */
    const quiet = async (limitMs = 5 * 60_000): Promise<void> => {
      const until = Date.now() + limitMs
      let calm = 0
      while (Date.now() < until) {
        await memoryIdle()
        const open = (db.prepare('SELECT COUNT(*) AS n FROM generations WHERE finished_at IS NULL AND rowid > ?').get(sinceRow) as { n: number }).n
        if (open === 0) {
          if (++calm >= 3) return
        } else calm = 0
        await new Promise((r) => setTimeout(r, 400))
      }
    }
    /**
     * Adam pauses in the scene: as when his typing has stopped for a while, the memory reads the scene now (the quiet
     * timer's read, without the wait), and everything that follows a read finishes.
     */
    const pause = async (sceneId: string): Promise<void> => {
      keeper.currentKeeper()?.updateNow(sceneId)
      await quiet()
    }
    /** A fresh copy of a saved world in place of the open one (each chain sample starts from the same world). */
    const reopen = async (file: string): Promise<void> => {
      await quiet()
      closedUsage.push(...usageRows())
      world!.closeWorld()
      bind(file)
    }

    /** Adam leaves the scene: the memory reads it before the story goes on. */
    const leave = async (sceneId: string): Promise<void> => {
      keeper.currentKeeper()?.sceneLeft(sceneId)
      await memoryIdle()
    }

    const judgeTarget = providers.providerTarget(provider)
    /** The judge on a passage: the probe's facts and yes/no questions, nothing else. No questions, no call. */
    const askJudge = async (
      probe: { facts: string[]; checks: Check[] },
      text: string
    ): Promise<SampleResult['judge'] & { answers: JudgeAnswer[] | null }> => {
      if (!probe.checks.length) return { status: 'skipped', raw: '', answers: [] }
      const messages: ChatMessage[] = judgeMessages(probe, text)
      let raw = ''
      for (let attempt = 0; attempt < 2; attempt++) {
        if (budget.hit) break
        const o = await streamChat({
          target: judgeTarget,
          body: { model: judge.modelId, messages, temperature: 0, top_p: 1, max_tokens: 2000 },
          signal: new AbortController().signal,
          onText: () => {},
          thinking: 'off'
        })
        addUsage(judgeUsage, o)
        if (o.status !== 'complete') {
          raw = o.error ?? o.status
          continue
        }
        raw = o.text
        const answers = readJudgeReply(o.text)
        if (answers) return { status: 'ok', raw, answers, asked: messages[1].content }
      }
      return { status: raw ? 'unreadable' : 'failed', raw, answers: null, asked: messages[1].content }
    }

    /**
     * Every call the app made is a generation record in the world. Check and repair's calls are memory-model calls
     * ('memory' records); they are counted on their own, by the marker their request starts with.
     */
    /** The open world's calls since it was opened, by job (with the fallback counts the budget uses). */
    const usageRows = (): { job: string; calls: number; p: number; c: number; cost: number | null; k: number; i: number; o: number }[] =>
      db
        .prepare(
          `SELECT CASE WHEN instr(messages_json, '[AIWRITE-REPAIR v') > 0 THEN 'repair' WHEN instr(messages_json, '[AIWRITE-PLAN v') > 0 THEN 'plan' ELSE job END AS job, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens), 0) AS p, COALESCE(SUM(completion_tokens), 0) AS c, SUM(cost) AS cost,
             COALESCE(SUM(CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.cachedTokens') END), 0) AS k,
             COALESCE(SUM(COALESCE(prompt_tokens, length(messages_json) / 4)), 0) AS i, COALESCE(SUM(COALESCE(completion_tokens, length(response) / 4)), 0) AS o
           FROM generations WHERE rowid > ? GROUP BY 1 ORDER BY 1`
        )
        .all(sinceRow) as { job: string; calls: number; p: number; c: number; cost: number | null; k: number; i: number; o: number }[]
    const usage = (): { byJob: Record<string, Usage>; judge: Usage; total: Usage } => {
      const byJob: Record<string, Usage> = {}
      for (const r of [...closedUsage, ...usageRows()]) {
        const u = (byJob[r.job] ??= { calls: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, cost: null })
        u.calls += r.calls
        u.promptTokens += r.p
        u.cachedTokens = (u.cachedTokens ?? 0) + r.k
        u.completionTokens += r.c
        if (r.cost != null) u.cost = (u.cost ?? 0) + r.cost
      }
      const total = noUsage()
      for (const u of [...Object.values(byJob), judgeUsage]) {
        total.calls += u.calls
        total.promptTokens += u.promptTokens
        total.completionTokens += u.completionTokens
        total.cachedTokens = (total.cachedTokens ?? 0) + (u.cachedTokens ?? 0)
        if (u.cost != null) total.cost = (total.cost ?? 0) + u.cost
      }
      return { byJob, judge: judgeUsage, total }
    }

    return {
      get db() {
        return db
      },
      budget,
      models: { writer: writer.modelId, memory: memory.modelId, judge: judge.modelId },
      providerName: cfg.fake ? 'fake provider' : cfg.provider === 'deepseek' ? `DeepSeek API (${cfg.baseUrl ?? DEEPSEEK_BASE_URL})` : 'OpenRouter',
      gens,
      aiHandlers,
      beatsHandlers,
      startEdit,
      repairMod,
      applyMod,
      makeScene,
      setBeats,
      get existing() {
        return existing
      },
      snapshot,
      quiet,
      pause,
      reopen,
      recallReady,
      lastRow: () => (db.prepare('SELECT COALESCE(MAX(rowid), 0) AS m FROM generations').get() as { m: number }).m,
      recordsSince: (row: number) =>
        (db.prepare('SELECT id, job, messages_json AS m FROM generations WHERE rowid > ? ORDER BY rowid').all(row) as { id: string; job: string; m: string }[]).map(
          (r) => ({ id: r.id, job: r.job, kind: callKind(r.job, r.m) })
        ),
      record: (id: string) => {
        const r = db.prepare('SELECT messages_json AS m, response AS r FROM generations WHERE id = ?').get(id) as { m: string; r: string } | undefined
        return r ? { messages: r.m, response: r.r } : null
      },
      saveEvidence: async (file: string) => {
        await db.backup(file)
      },
      save,
      memoryIdle,
      leave,
      askJudge,
      usage,
      close
    }
  } catch (e) {
    await close()
    throw e
  }
}

