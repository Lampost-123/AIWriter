// Runs the trap story through the app's own code, as Adam would use it, and scores what the AI writes.
//
// The app's main-process code runs in plain Node with a stand-in for Electron (fakeElectron.ts) and a throwaway data
// folder: its real settings, providers, world, memory keeper and drafting. Scenes are written in order through the
// same calls the window makes (save, leave the scene so the memory reads it); at each probe the app is asked to write
// through the window's own entry points (Generate and Add below: the 'startDraft' handler; a beat: 'startBeat';
// Continue: 'startEdit'), so the briefing, the memory's catch-up and "where things stand" are exactly what Adam gets.
// What it writes is never saved into the story: the next scenes are always the story's own words.
//
// App code is imported through '@app/...', which the trap config points at the checkout being scored (--root), so
// the same harness scores main and a branch.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { appEvents } from './fakeElectron'
import { JUDGE_MARKER, judgeMessages, readJudgeReply, type ChatMessage } from './judge'
import { landedPage, mirrorFixes, paragraphsOf, wordsFrom, type Fix } from './page'
import {
  passagesMarkdown,
  reportMarkdown,
  scorePassage,
  summarise,
  summariseRepair,
  type ProbeResult,
  type RepairResult,
  type RunReport,
  type SampleResult,
  type Usage
} from './score'
import { DEEPSEEK_BASE_URL, KEY_VARIABLE, pickFlash, type TrapProvider } from './models'
import { CHAPTERS, ENTRIES, PROBES, SCENES, STORY, STORY_VERSION, type EntryKey, type Probe, type TrapScene } from './story'

// ---------- Step 3's check and repair, when the checkout has it ----------
// Typed here, not imported: older checkouts don't have these files (contracts/repair.ts, features/repair/apply.ts).

interface RepairFixLike extends Fix {
  why: string
}
interface RepairModule {
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
interface LandedPartLike {
  pid: string | null
  text: string
  from: number
  to: number
}
interface ApplyModule {
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
 * Check and repair on for the run, whatever the app's default: any setting named for it (Settings or the writing
 * preferences) that is off is turned on, and what was turned on is logged.
 */
function switchOnRepair(
  settings: {
    getSettings(): object
    updateSettings(patch: never): unknown
    getWritingPrefs?(): object
    setWritingPrefs?(prefs: never): unknown
  },
  log: (line: string) => void
): void {
  const on = (o: object): Record<string, unknown> | null => {
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) {
      // Step 3's own switch is Settings' checkNewWords ("Check new words straight away"); anything named for the repair too.
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

export interface TrapsConfig {
  /** The checkout whose app code runs (the trap config's alias points there too). */
  root: string
  /** The harness's own checkout. */
  harnessRoot: string
  /** Use the fake provider (tests/fake-provider) and a stand-in judge: a check of the harness, never a score. */
  fake: boolean
  /** DeepSeek's own API (the default) or OpenRouter. */
  provider: TrapProvider
  /** The provider's API key, from DEEPSEEK_API_KEY or OPENROUTER_API_KEY only (real runs only). Never printed. */
  apiKey: string | null
  /** Another address for the provider (to check the harness against a local fake server); null: the provider's own. */
  baseUrl: string | null
  /** USD per million tokens in and out, for an estimated cost when the provider reports none; null: tokens only. */
  prices: { in: number; out: number } | null
  /** Model ids; null picks DeepSeek Flash from the provider's list. The judge defaults to the memory model. */
  writer: string | null
  memory: string | null
  judge: string | null
  samples: number
  /** Probe ids to run (null: all). */
  probes: string[] | null
  words: { generate: number; addBelow: number; beatScene: number }
  out: string | null
  /** Keep the throwaway data folder (the world database, with "What the AI saw" for every call). */
  keep: boolean
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
  const priceIn = Number(env.TRAPS_PRICE_IN)
  const priceOut = Number(env.TRAPS_PRICE_OUT)
  return {
    root: resolve(env.TRAPS_ROOT || harnessRoot),
    harnessRoot,
    fake: env.TRAPS_FAKE === '1',
    provider,
    apiKey: env[KEY_VARIABLE[provider]]?.trim() || null,
    baseUrl: env.TRAPS_BASE_URL?.trim() || null,
    prices: priceIn >= 0 && priceOut >= 0 && env.TRAPS_PRICE_IN && env.TRAPS_PRICE_OUT ? { in: priceIn, out: priceOut } : null,
    writer: env.TRAPS_WRITER_MODEL?.trim() || null,
    memory: env.TRAPS_MEMORY_MODEL?.trim() || null,
    judge: env.TRAPS_JUDGE_MODEL?.trim() || null,
    samples: num(env.TRAPS_SAMPLES, 3),
    probes: env.TRAPS_PROBES ? env.TRAPS_PROBES.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null,
    words: { generate: num(env.TRAPS_WORDS, 600), addBelow: num(env.TRAPS_ADD_WORDS, 400), beatScene: num(env.TRAPS_BEAT_SCENE_WORDS, 900) },
    out: env.TRAPS_OUT?.trim() || null,
    keep: env.TRAPS_KEEP === '1',
    log: (line) => console.log(`[traps] ${line}`)
  }
}

// ---------- Small helpers ----------

function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const countWords = (s: string): number => (s.match(/\S+/g) ?? []).length

/** The editor document for a scene's paragraphs, each with a stable paragraph id (as the editor makes them). */
function sceneDoc(sceneKey: string, paragraphs: string[]): unknown {
  return {
    type: 'doc',
    content: paragraphs.map((text, i) => ({
      type: 'paragraph',
      attrs: { pid: `t${sceneKey}${String(i + 1).padStart(2, '0')}zzzz`.slice(0, 8) },
      content: [{ type: 'text', text }]
    }))
  }
}

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

function whenEnded<T>(id: string, limitMs = 15 * 60_000): Promise<T> {
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

/**
 * For a fake run: the judge's requests are answered here with readable stand-in answers (the fake provider would
 * answer them with prose); everything else goes on to the fake provider. Never used for a real run.
 */
function withStandInJudge(next: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const body = typeof init?.body === 'string' ? init.body : ''
    if (body.includes('[AIWRITE-REPAIR v')) return standInRepair(body)
    if (!body.includes(JUDGE_MARKER)) return next(input, init)
    const parsed = JSON.parse(body) as { messages: { content: unknown }[] }
    const content = parsed.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
    const passage = /"""\n([\s\S]*?)\n"""/.exec(content)?.[1] ?? ''
    const firstSentence = /[^.!?]+[.!?]/.exec(passage)?.[0]?.trim() ?? ''
    const ids = [...content.matchAll(/^([A-Z]\d+): /gm)].map((m) => m[1])
    const answers = ids.map((id, i) => ({ id, answer: ['no', 'yes', 'unclear'][i % 3], quote: i % 3 === 1 ? firstSentence : '' }))
    const chunk = { choices: [{ index: 0, delta: { content: JSON.stringify({ answers }) }, finish_reason: 'stop' }] }
    const usage = { choices: [], usage: { prompt_tokens: Math.ceil(content.length / 4), completion_tokens: 60 } }
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' }
    })
  }) as typeof fetch
}

const sse = (reply: string, promptChars: number): Response => {
  const chunk = { choices: [{ index: 0, delta: { content: reply }, finish_reason: 'stop' }] }
  const usage = { choices: [], usage: { prompt_tokens: Math.ceil(promptChars / 4), completion_tokens: Math.ceil(reply.length / 4) } }
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify(usage)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
}

/**
 * For a fake run on a checkout with check and repair: a stand-in for the memory model's claims, so fixes and questions
 * go through the whole path (the fake provider answers these with prose). A slip on the first stage line that has the
 * story's words, mending a word of the new words' first sentence, and a slip on the first memory line, asked as a
 * question.
 */
function standInRepair(body: string): Response {
  const parsed = JSON.parse(body) as { messages: { content: unknown }[] }
  const content = parsed.messages.map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))).join('\n')
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

const addUsage = (u: Usage, more: { promptTokens?: number | null; completionTokens?: number | null; cost?: number | null }): void => {
  u.calls++
  u.promptTokens += more.promptTokens ?? 0
  u.completionTokens += more.completionTokens ?? 0
  if (more.cost != null) u.cost = (u.cost ?? 0) + more.cost
}
const noUsage = (): Usage => ({ calls: 0, promptTokens: 0, completionTokens: 0, cost: null })

// ---------- The run ----------

export async function runTraps(cfg: TrapsConfig): Promise<{ report: RunReport; outDir: string }> {
  if (!cfg.fake && !cfg.apiKey) throw new Error(`No ${KEY_VARIABLE[cfg.provider]} in the environment: a real run needs it (or use --fake).`)
  if (!cfg.fake && process.env.CI) throw new Error('A real trap run never runs in CI.')
  const chosen = PROBES.filter((p) => !cfg.probes || cfg.probes.includes(p.id))
  if (!chosen.length) throw new Error(`No probe called ${cfg.probes?.join(', ')}. The probes are ${PROBES.map((p) => p.id).join(', ')}.`)
  const startedAt = new Date().toISOString()
  const dataDir = mkdtempSync(join(tmpdir(), 'aiwrite-traps-'))
  process.env.AIWRITE_DATA_DIR = dataDir
  // The memory reads a scene when Adam leaves it (as the harness does), never on a timer in the middle of a probe.
  process.env.AIWRITE_KEEPER_QUIET_MS = String(6 * 60 * 60_000)
  const realFetch = globalThis.fetch
  let fake: { url: string; close(): Promise<void> } | null = null
  let world: typeof import('@app/main/world') | null = null
  try {
    if (cfg.fake) {
      const { startFakeProvider } = await import('../fake-provider/server.mjs')
      fake = await startFakeProvider({ delayMs: 0, words: 220 })
      globalThis.fetch = withStandInJudge(realFetch)
    }
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
    cfg.log(`writer ${writer.modelId}, memory ${memory.modelId}, judge ${judge.modelId}, ${cfg.samples} samples per probe`)

    // The app as it starts: drafting, and the memory keeper (which registers the catch-up before a draft).
    initAi()
    keeper.initKeeper()
    world.createWorld('The Gannet (trap story)')
    const db = world.db()

    // Adam's codex and the story's frame.
    const entryIds = new Map<EntryKey, string>()
    for (const e of ENTRIES) {
      const made = repo.createEntry(db, e.kind, { name: e.name, aliases: e.aliases ?? [], summary: e.summary, description: e.description ?? '', fields: e.fields ?? {} })
      entryIds.set(e.key, made.id)
    }
    const id = (k: EntryKey): string => entryIds.get(k)!
    const story = repo.listStories(db)[0]
    repo.updateStory(db, story.id, { title: STORY.title, premise: STORY.premise })
    const first = repo.getOutline(db, story.id)
    const chapterIds: string[] = []
    const sceneIds = new Map<string, string>()

    /** The chapter and scene, made when the story reaches them (the writer never sees cards ahead of the scene). */
    const makeScene = (s: TrapScene): string => {
      let chapterId = chapterIds[s.chapter]
      if (!chapterId) {
        const c = s.chapter === 0 ? first.chapters[0] : repo.createChapter(db, story.id, { title: CHAPTERS[s.chapter].title })
        repo.updateChapter(db, c.id, CHAPTERS[s.chapter])
        chapterId = chapterIds[s.chapter] = c.id
      }
      const isFirst = s.key === SCENES[0].key
      const sceneId = isFirst ? first.scenes[0].id : repo.createScene(db, chapterId, { title: s.title }).id
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
      sceneIds.set(s.key, sceneId)
      return sceneId
    }

    /** Saves the scene's words as the window does (the memory keeper hears of the save). */
    const save = (s: TrapScene, sceneId: string, paragraphs: string[]): void => {
      keeper.sceneSaved(sceneId, repo.saveSceneText(db, sceneId, sceneDoc(s.key, paragraphs), paragraphs.join('\n\n')))
    }
    const memoryIdle = async (): Promise<void> => {
      await keeper.currentKeeper()?.whenIdle()
    }

    const judgeTarget = providers.providerTarget(provider)
    const judgeUsage = noUsage()
    const askJudge = async (probe: Probe, text: string): Promise<SampleResult['judge'] & { answers: ReturnType<typeof readJudgeReply> }> => {
      const messages: ChatMessage[] = judgeMessages(probe, text)
      let raw = ''
      for (let attempt = 0; attempt < 2; attempt++) {
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
     * Step 3's check and repair, the way the page does it as new words land (features/repair/repairRun.ts): the scene
     * saved with the new words in, the main side asked (one memory-model call), the fixes made in the page with the
     * app's own page code, the page telling which it made. Then the scene goes back to how it was before the words
     * landed, and the issues the repair raised are cleared, so every sample starts the same.
     */
    const repairLanded = async (scene: TrapScene, sceneId: string, before: string[], written: { generationId: string | null; text: string }): Promise<Omit<RepairResult, 'judge' | 'results'>> => {
      const nothing = { checked: false, claims: 0, slips: 0, fixes: [], questions: [], text: written.text }
      if (!repairMod || !written.generationId) return nothing
      const added = paragraphsOf(written.text)
      const all = [...before, ...added]
      const pid = (i: number): string => `t${scene.key}${String(i + 1).padStart(2, '0')}zzzz`.slice(0, 8)
      const issueIds = new Set((db.prepare('SELECT id FROM issues WHERE scene_id = ?').all(sceneId) as { id: string }[]).map((r) => r.id))
      save(scene, sceneId, all)
      try {
        const page = landedPage(before, added, pid)
        const parts = applyMod
          ? applyMod.landedParts(page.state.doc, page.from, page.state.doc.content.size)
          : added.map((text) => ({ pid: null, text, from: 0, to: text.length }))
        const outcome = await repairMod.repairHandlers.checkNewWords({
          sceneId,
          recordId: written.generationId,
          paragraphs: parts.map(({ text, from, to }) => ({ text, from, to })),
          leadIn: before.join('\n\n').slice(-1_500)
        })
        if (!outcome.repairId) return nothing
        let text = written.text
        let made: string[] = []
        if (outcome.fixes.length) {
          if (applyMod) {
            const got = applyMod.fixesTr(page.state, parts, outcome.fixes)
            if (got) {
              made = got.made.map((m) => m.id)
              text = wordsFrom(got.tr.doc, page.before)
            }
          } else {
            const got = mirrorFixes(parts, outcome.fixes)
            made = got.made
            text = got.texts.join('\n\n')
          }
          await repairMod.repairHandlers.repairsApplied(outcome.repairId, made)
        }
        const raised = (db.prepare('SELECT id, status, message FROM issues WHERE scene_id = ?').all(sceneId) as { id: string; status: string; message: string }[]).filter(
          (r) => !issueIds.has(r.id)
        )
        return {
          checked: true,
          claims: outcome.claims,
          slips: outcome.slips,
          fixes: outcome.fixes.map((f) => ({ was: f.was, now: f.now, why: f.why, made: made.includes(f.id) })),
          questions: raised.filter((r) => r.status === 'open').map((r) => r.message),
          text: made.length ? text : written.text
        }
      } finally {
        // Back as it was before the words landed, with nothing the repair raised left behind.
        const fresh = (db.prepare('SELECT id FROM issues WHERE scene_id = ?').all(sceneId) as { id: string }[]).map((r) => r.id).filter((x) => !issueIds.has(x))
        for (const x of fresh) db.prepare('DELETE FROM issues WHERE id = ?').run(x)
        save(scene, sceneId, before)
      }
    }

    /** One sample of a probe, through the window's own entry point. */
    const write = async (probe: Probe, sceneId: string, soFar: string, index: number): Promise<Omit<SampleResult, 'judge' | 'results' | 'index'>> => {
      const draft = async (generationId: string): Promise<Omit<SampleResult, 'judge' | 'results' | 'index'>> => {
        const done = await whenEnded<{ status: 'complete' | 'error' | 'stopped'; error: string | null }>(generationId)
        const text = gens.getGeneration(db, generationId).response
        return { status: done.status, error: done.error, generationId, text, words: countWords(text) }
      }
      const options = { targetWords: cfg.words.generate, creativity: 'balanced' as const, direction: '' }
      if (probe.kind === 'generate') return draft((await aiHandlers.startDraft(sceneId, options)).generationId)
      if (probe.kind === 'addBelow') return draft((await aiHandlers.startDraft(sceneId, { ...options, targetWords: cfg.words.addBelow, addBelow: true })).generationId)
      if (probe.kind === 'beat') {
        const started = await beatsHandlers.startBeat({
          sceneId,
          sessionId: `traps-${probe.id}-${index}`,
          index: probe.beat ?? 1,
          options: { ...options, targetWords: cfg.words.beatScene },
          steer: '',
          soFar,
          soFarEnds: 'with-beat'
        })
        return draft(started.generationId)
      }
      const taskId = `traps-${probe.id}-${index}-${Date.now()}`
      const started = await startEdit({ taskId, sceneId, tool: 'continue', selection: '', before: soFar, after: '', continueAs: 'paragraph' })
      if (!started.ok) return { status: 'error', error: started.problem, generationId: null, text: '', words: 0 }
      const done = await whenEnded<{ status: 'complete' | 'error' | 'stopped'; error: string | null; text: string }>(taskId)
      return { status: done.status, error: done.error, generationId: started.generationId, text: done.text, words: countWords(done.text) }
    }

    const probeResults: ProbeResult[] = []
    const lastScene = Math.max(...chosen.map((p) => SCENES.findIndex((s) => s.key === p.scene)))
    for (const [si, scene] of SCENES.entries()) {
      if (si > lastScene) break
      const sceneId = makeScene(scene)
      const here = chosen.filter((p) => p.scene === scene.key).sort((a, b) => a.paragraphs - b.paragraphs)
      for (const probe of here) {
        const soFarParas = scene.paragraphs.slice(0, probe.paragraphs)
        if (soFarParas.length) save(scene, sceneId, soFarParas)
        const soFar = soFarParas.join('\n\n')
        const result: ProbeResult = { id: probe.id, scene: scene.key, kind: probe.kind, asks: probe.asks, samples: [] }
        for (let i = 0; i < cfg.samples; i++) {
          await memoryIdle()
          cfg.log(`probe ${probe.id} (${probe.kind}, ${scene.title}) sample ${i + 1}/${cfg.samples}`)
          let written: Omit<SampleResult, 'judge' | 'results' | 'index'>
          try {
            written = await write(probe, sceneId, soFar, i)
          } catch (e) {
            written = { status: 'error', error: e instanceof Error ? e.message : String(e), generationId: null, text: '', words: 0 }
          }
          if (written.status !== 'complete' || !written.text.trim()) {
            cfg.log(`  not written: ${written.error ?? written.status}`)
            result.samples.push({ ...written, status: written.status === 'complete' ? 'error' : written.status, error: written.error ?? 'Nothing was written.', index: i, judge: { status: 'skipped', raw: '' }, results: [] })
            continue
          }
          const j = await askJudge(probe, written.text)
          const results = scorePassage(probe, written.text, j.answers)
          const sample: SampleResult = { ...written, index: i, judge: { status: j.status, raw: j.raw }, results }
          cfg.log(`  ${written.words} words; ${results.map((r) => `${r.id} ${r.verdict}`).join(', ')}`)
          if (repairMod) {
            let landed: Omit<RepairResult, 'judge' | 'results'>
            try {
              landed = await repairLanded(scene, sceneId, soFarParas, written)
            } catch (e) {
              cfg.log(`  check and repair failed: ${e instanceof Error ? e.message : String(e)}`)
              landed = { checked: false, claims: 0, slips: 0, fixes: [], questions: [], text: written.text }
            }
            // The repaired passage is judged again only when the page changed it.
            const again = landed.text !== written.text ? await askJudge(probe, landed.text) : null
            sample.repair = {
              ...landed,
              judge: again ? { status: again.status, raw: again.raw } : sample.judge,
              results: again ? scorePassage(probe, landed.text, again.answers) : results
            }
            cfg.log(
              `  repair: ${landed.checked ? `${landed.claims} claims, ${landed.fixes.length} fixes (${landed.fixes.filter((f) => f.made).length} made), ${landed.questions.length} questions` : 'checked nothing'}${again ? `; after: ${sample.repair.results.map((r) => `${r.id} ${r.verdict}`).join(', ')}` : ''}`
            )
          }
          result.samples.push(sample)
        }
        probeResults.push(result)
      }
      // The scene as Adam wrote it; leaving it, the memory reads it before the story goes on.
      if (scene.paragraphs.length) {
        save(scene, sceneId, scene.paragraphs)
        keeper.currentKeeper()?.sceneLeft(sceneId)
        await memoryIdle()
      }
    }
    await memoryIdle()

    // Every call the app made is a generation record in the world. Check and repair's calls are memory-model calls
    // ('memory' records); they are counted on their own, by the marker their request starts with.
    const byJob: Record<string, Usage> = {}
    const rows = db
      .prepare(
        `SELECT CASE WHEN instr(messages_json, '[AIWRITE-REPAIR v') > 0 THEN 'repair' ELSE job END AS job, COUNT(*) AS calls,
           COALESCE(SUM(prompt_tokens), 0) AS p, COALESCE(SUM(completion_tokens), 0) AS c, SUM(cost) AS cost
         FROM generations GROUP BY 1 ORDER BY 1`
      )
      .all() as { job: string; calls: number; p: number; c: number; cost: number | null }[]
    for (const r of rows) byJob[r.job] = { calls: r.calls, promptTokens: r.p, completionTokens: r.c, cost: r.cost }
    const total = noUsage()
    for (const u of [...Object.values(byJob), judgeUsage]) {
      total.calls += u.calls
      total.promptTokens += u.promptTokens
      total.completionTokens += u.completionTokens
      if (u.cost != null) total.cost = (total.cost ?? 0) + u.cost
    }

    let appVersion = ''
    try {
      appVersion = (JSON.parse(readFileSync(join(cfg.root, 'package.json'), 'utf8')) as { version?: string }).version ?? ''
    } catch {
      /* not known */
    }
    const report: RunReport = {
      storyVersion: STORY_VERSION,
      startedAt,
      finishedAt: new Date().toISOString(),
      fake: cfg.fake,
      tested: {
        root: cfg.root,
        // A checkout of a commit with no branch (an old release, say) is named by the app's version.
        branch: ((b) => (!b || b === 'HEAD' ? `detached-${appVersion || 'unknown'}` : b))(git(cfg.root, ['rev-parse', '--abbrev-ref', 'HEAD'])),
        commit: git(cfg.root, ['rev-parse', 'HEAD']) || 'unknown',
        dirty: git(cfg.root, ['status', '--porcelain', '--untracked-files=no']) !== '',
        appVersion
      },
      harness: { root: cfg.harnessRoot, commit: git(cfg.harnessRoot, ['rev-parse', 'HEAD']) || 'unknown' },
      provider: cfg.fake ? 'fake provider' : cfg.provider === 'deepseek' ? `DeepSeek API (${cfg.baseUrl ?? DEEPSEEK_BASE_URL})` : 'OpenRouter',
      prices: cfg.prices,
      models: { writer: writer.modelId, memory: memory.modelId, judge: judge.modelId },
      samples: cfg.samples,
      words: cfg.words,
      probes: probeResults,
      usage: { byJob, judge: judgeUsage, total },
      summary: summarise(probeResults),
      ...(repairMod ? { repaired: summariseRepair(probeResults) } : {})
    }

    const stamp = startedAt.slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1-')
    const outDir =
      cfg.out ??
      join(cfg.harnessRoot, 'traps-results', `${stamp}-${report.tested.branch.replace(/[^\w.-]+/g, '-')}-${report.tested.commit.slice(0, 7)}${cfg.fake ? '-fake' : ''}`)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
    writeFileSync(join(outDir, 'report.md'), reportMarkdown(report))
    writeFileSync(join(outDir, 'passages.md'), passagesMarkdown(report))
    cfg.log(`report written to ${outDir}`)
    return { report, outDir }
  } finally {
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
}
