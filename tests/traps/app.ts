// The app, opened for a trap run or for writing the story: its own main-process code (settings, providers, world,
// memory keeper, drafting) in plain Node, with a stand-in for Electron (fakeElectron.ts) and a throwaway data folder,
// so what is measured is what Adam gets. App code is imported through '@app/...', which the trap config points at the
// checkout being run (--root).

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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
  /** Save the world as it stands just before the first probe scene, beside the report, for --from-world. */
  saveWorld: boolean
  /** Start from a saved world (a world-before-*.db from an earlier run of the same checkout and story): no memory build. */
  fromWorld: string | null
  /** The hard token budget: no call is sent once it would be passed. */
  maxIn: number
  maxOut: number
  log: (line: string) => void
}

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
    saveWorld: env.TRAPS_SAVE_WORLD !== '0',
    fromWorld: env.TRAPS_FROM_WORLD?.trim() ? resolve(env.TRAPS_FROM_WORLD.trim()) : null,
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
function standInWriter(body: string): Response {
  const content = contentOf(body)
  const asks = [...content.matchAll(/Make sure this happens([^:]*):\s*(.*?)(?=\s*Make sure this happens|\n|"|$)/g)].map((m) => ({ when: m[1], what: m[2].trim() }))
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
    if (body.includes('Make sure this happens')) return standInWriter(body)
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
  /** Saves the world as it stands (a consistent copy of its database). */
  snapshot(file: string): Promise<void>
  save(sceneKey: string, sceneId: string, paragraphs: string[]): void
  memoryIdle(): Promise<void>
  leave(sceneId: string): Promise<void>
  askJudge(probe: { facts: string[]; checks: Check[] }, text: string): Promise<SampleResult['judge'] & { answers: JudgeAnswer[] | null }>
  usage(): { byJob: Record<string, Usage>; judge: Usage; total: Usage }
  close(): Promise<void>
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

  /** Tokens used so far: every call the app made is a generation record (its own count, else its text at 4 a token). */
  const used = (): { in: number; out: number } => {
    let inT = judgeUsage.promptTokens
    let outT = judgeUsage.completionTokens
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

  const close = async (): Promise<void> => {
    try {
      world?.closeWorld()
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
    cfg.log(`writer ${writer.modelId}, memory ${memory.modelId}, judge ${judge.modelId}; budget ${cfg.maxIn.toLocaleString('en-GB')} tokens in, ${cfg.maxOut.toLocaleString('en-GB')} out`)

    // The app as it starts: drafting, and the memory keeper (which registers the catch-up before a draft).
    initAi()
    keeper.initKeeper()
    if (worldFile) {
      // A copy of the saved world, opened as Adam would open a world in his library.
      const folder = join(settings.getSettings().libraryPath, 'Saved trap world')
      mkdirSync(folder, { recursive: true })
      copyFileSync(worldFile, join(folder, 'world.db'))
      const found = world.listWorlds().find((w) => resolve(w.folder) === resolve(folder))
      if (!found) throw new Error(`Couldn't open the saved world ${worldFile}.`)
      world.openWorld(found.id)
    } else world.createWorld(worldName)
    const db = world.db()
    dbRef = db
    // Only this run's calls count (a saved world holds the records of the run that built it).
    sinceRow = (db.prepare('SELECT COALESCE(MAX(rowid), 0) AS m FROM generations').get() as { m: number }).m

    // Adam's codex and the story's frame (a saved world has them already).
    const entryIds = new Map<string, string>()
    if (worldFile) {
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
    const id = (k: string): string => {
      const v = entryIds.get(k)
      if (!v) throw new Error(`The story's codex has no entry "${k}".`)
      return v
    }
    const story = repo.listStories(db)[0]
    if (!worldFile) repo.updateStory(db, story.id, { title: data.story.title, premise: data.story.premise })
    const first = repo.getOutline(db, story.id)
    // A saved world goes on where it stopped: its chapters (in order) and scenes are there already.
    const chapterIds: string[] = worldFile ? first.chapters.map((c) => c.id) : []
    let firstUsed = !!worldFile
    const existing = worldFile ? first.chapters.flatMap((c) => first.scenes.filter((x) => x.chapterId === c.id)).map((x) => ({ id: x.id, title: x.title })) : []

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

    /** Saves the scene's words as the window does (the memory keeper hears of the save). */
    const save = (sceneKey: string, sceneId: string, paragraphs: string[]): void => {
      keeper.sceneSaved(sceneId, repo.saveSceneText(db, sceneId, sceneDoc(sceneKey, paragraphs), paragraphs.join('\n\n')))
    }
    const memoryIdle = async (): Promise<void> => {
      await keeper.currentKeeper()?.whenIdle()
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
        if (answers) return { status: 'ok', raw, answers }
      }
      return { status: raw ? 'unreadable' : 'failed', raw, answers: null }
    }

    /**
     * Every call the app made is a generation record in the world. Check and repair's calls are memory-model calls
     * ('memory' records); they are counted on their own, by the marker their request starts with.
     */
    const usage = (): { byJob: Record<string, Usage>; judge: Usage; total: Usage } => {
      const byJob: Record<string, Usage> = {}
      const rows = db
        .prepare(
          `SELECT CASE WHEN instr(messages_json, '[AIWRITE-REPAIR v') > 0 THEN 'repair' ELSE job END AS job, COUNT(*) AS calls,
             COALESCE(SUM(prompt_tokens), 0) AS p, COALESCE(SUM(completion_tokens), 0) AS c, SUM(cost) AS cost,
             COALESCE(SUM(CASE WHEN json_valid(params_json) THEN json_extract(params_json, '$.cachedTokens') END), 0) AS k
           FROM generations WHERE rowid > ? GROUP BY 1 ORDER BY 1`
        )
        .all(sinceRow) as { job: string; calls: number; p: number; c: number; cost: number | null; k: number }[]
      for (const r of rows) byJob[r.job] = { calls: r.calls, promptTokens: r.p, cachedTokens: r.k, completionTokens: r.c, cost: r.cost }
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
      db,
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
      existing,
      snapshot,
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

