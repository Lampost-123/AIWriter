// The chat eval's harness: the app's own main-process code in plain Node (as the trap harness runs it: the stand-in
// for Electron, a throwaway data folder), with the invented world (world.ts) seeded into a fresh world, and Ask the
// world asked through its real handler (src/main/ipc/ask.ts askWorld) exactly as the window asks it. The model behind
// it is a pluggable backend:
//   fake        the fake provider (tests/fake-provider): plumbing only, never a score
//   bridge      the file bridge (bridge.mjs): a person or a Claude session answers each request from files
//   openrouter  a real model on OpenRouter; refuses unless AIWRITE_CHAT_EVAL_PAID=yes and a cost cap are set
// Every request the app sends is captured on its way out (the whole body), so the report can count requests, nudges
// and tool results, and look for story-point leaks in exactly what the model was shown.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { AgentStep } from '@shared/types'
import type { Proposal } from '@shared/contracts/ask'
import { appEvents } from '../traps/fakeElectron'
import { pickFlash } from '../traps/models'
import { CHAPTERS, ENTRIES, SCENES, STORIES, plainText } from './world'
import { firstQuestion, type Scenario } from './scenarios'

export type Backend = 'fake' | 'bridge' | 'openrouter'

export interface EvalConfig {
  backend: Backend
  /** The checkout whose app code runs (the alias '@app/' points there: --root). */
  root: string
  harnessRoot: string
  /** Report folder (never written over). */
  out: string
  /** Scenario ids to run; null: all 40. */
  only: string[] | null
  /** The bridge's folder (pending/, done/, answered/). */
  bridgeDir: string
  /** OpenRouter model id; null: DeepSeek Flash from OpenRouter's list (as the trap harness picks it). */
  model: string | null
  /** Hard cap in USD for a paid run (AIWRITE_CHAT_EVAL_MAX_USD). */
  maxUsd: number | null
  paid: boolean
  apiKey: string | null
  label: string
  keep: boolean
  /** The AIWRITE_EXP_* switches in effect (passed through to the app's code; recorded in the report). */
  switches: Record<string, string>
  log: (line: string) => void
}

export function configFromEnv(env = process.env): EvalConfig {
  const harnessRoot = resolve(__dirname, '..', '..')
  const b = env.CHAT_EVAL_BACKEND
  const backend: Backend = b === 'bridge' || b === 'openrouter' ? b : 'fake'
  const max = Number(env.AIWRITE_CHAT_EVAL_MAX_USD)
  return {
    backend,
    root: resolve(env.TRAPS_ROOT || harnessRoot),
    harnessRoot,
    out: resolve(env.CHAT_EVAL_OUT || join(harnessRoot, '..', 'AIWriter-chat-results', `${new Date().toISOString().slice(0, 10)}-${backend}`)),
    only: env.CHAT_EVAL_SCENARIOS ? env.CHAT_EVAL_SCENARIOS.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean) : null,
    bridgeDir: resolve(env.CHAT_EVAL_BRIDGE_DIR || join(harnessRoot, '..', 'AIWriter-chat-results', 'bridge')),
    model: env.CHAT_EVAL_MODEL?.trim() || null,
    maxUsd: Number.isFinite(max) && max > 0 ? max : null,
    paid: env.AIWRITE_CHAT_EVAL_PAID === 'yes',
    apiKey: env.OPENROUTER_API_KEY?.trim() || null,
    label: env.CHAT_EVAL_LABEL?.trim() || '',
    keep: env.CHAT_EVAL_KEEP === '1',
    switches: Object.fromEntries(Object.entries(env).filter(([k, v]) => k.startsWith('AIWRITE_EXP_') && v != null) as [string, string][]),
    log: (line) => console.log(`[chat-eval] ${line}`)
  }
}

/** A paid run only with both locks open, never in CI. Throws (before any network call) otherwise. */
export function paidGuard(cfg: Pick<EvalConfig, 'backend' | 'paid' | 'maxUsd' | 'apiKey'>, env = process.env): void {
  if (cfg.backend !== 'openrouter') return
  if (!cfg.paid) throw new Error('A real-model run costs money: it runs only with AIWRITE_CHAT_EVAL_PAID=yes set.')
  if (cfg.maxUsd == null) throw new Error('A real-model run needs a cost cap: set AIWRITE_CHAT_EVAL_MAX_USD (or --max-usd) to a number of dollars.')
  if (!cfg.apiKey) throw new Error('A real-model run needs OPENROUTER_API_KEY in the environment.')
  if (env.CI) throw new Error('A real-model run never runs in CI.')
}

export function git(root: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

// ---------- What the app sends ----------

/** One request the app sent to the model, as sent. */
export interface SentRequest {
  at: number
  body: {
    messages: { role: string; content: unknown; tool_call_id?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }[]
    tools?: unknown[]
    tool_choice?: unknown
  }
}

let capture: SentRequest[] | null = null
/** USD so far (a paid run), and the cap. */
const spend = { usd: 0, cap: Infinity, stopped: false, priceIn: 0, priceOut: 0 }

async function readUsage(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
  }
  for (const line of buf.split('\n')) {
    if (!line.startsWith('data: ') || !line.includes('"usage"')) continue
    try {
      const u = (JSON.parse(line.slice(6)) as { usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number } }).usage
      if (!u) continue
      spend.usd += u.cost ?? (u.prompt_tokens ?? 0) * spend.priceIn + (u.completion_tokens ?? 0) * spend.priceOut
    } catch {
      /* not usage */
    }
  }
}

/** fetch with every chat request captured; a paid run's requests checked against the cap first. */
function tapped(next: typeof fetch, paid: boolean): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!/chat\/completions\/?$/.test(url) || typeof init?.body !== 'string') return next(input, init)
    const body = JSON.parse(init.body) as SentRequest['body'] & { max_tokens?: number; max_completion_tokens?: number }
    capture?.push({ at: Date.now(), body })
    if (!paid) return next(input, init)
    const worst = spend.usd + (init.body.length / 4) * spend.priceIn + (body.max_tokens ?? body.max_completion_tokens ?? 2000) * spend.priceOut
    if (spend.stopped || worst > spend.cap) {
      spend.stopped = true
      return new Response(JSON.stringify({ error: { code: 402, message: `The chat eval's cost cap ($${spend.cap}) would be passed; nothing more is sent.` } }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    const res = await next(input, init)
    if (!res.body) return res
    const [a, b] = res.body.tee()
    void readUsage(b).catch(() => undefined)
    return new Response(a, { status: res.status, statusText: res.statusText, headers: res.headers })
  }) as typeof fetch
}

// ---------- Task ends ----------

const ended = new Map<string, unknown>()
const waiters = new Map<string, (p: unknown) => void>()
appEvents.on('event:task:done', (p: { taskId: string }) => {
  const w = waiters.get(p.taskId)
  if (w) {
    waiters.delete(p.taskId)
    w(p)
  } else ended.set(p.taskId, p)
})
function taskDone(taskId: string, limitMs: number): Promise<{ status: string; error: string | null }> {
  const had = ended.get(taskId)
  if (had) {
    ended.delete(taskId)
    return Promise.resolve(had as { status: string; error: string | null })
  }
  return new Promise((res, rej) => {
    const timer = setTimeout(() => {
      waiters.delete(taskId)
      rej(new Error(`No answer for ${taskId} in ${Math.round(limitMs / 60_000)} minutes`))
    }, limitMs)
    waiters.set(taskId, (p) => {
      clearTimeout(timer)
      res(p as { status: string; error: string | null })
    })
  })
}

// ---------- The page's own matching (renderer code, loaded by path: it isn't part of the main-process build) ----------

export interface PageCode {
  schema: Schema
  findTextRange(doc: PMNode, quote: string): { from: number; to: number } | null
  findTextRangeAfter(doc: PMNode, quote: string, after: number): { from: number; to: number } | null
  /** The scene's plain text as the editor saves it. */
  sceneText(doc: PMNode): string
}

export async function pageCode(): Promise<PageCode> {
  const spec = (p: string): string => `@app/renderer/src/features/editor/${p}`
  const { getSchema } = (await import(/* @vite-ignore */ '@tiptap/core')) as { getSchema(ext: unknown[]): Schema }
  const ext = (await import(/* @vite-ignore */ spec('extensions'))) as { sceneExtensions(): unknown[] }
  const find = (await import(/* @vite-ignore */ spec('findText'))) as Pick<PageCode, 'findTextRange' | 'findTextRangeAfter'>
  const stream = (await import(/* @vite-ignore */ spec('streamDoc'))) as Pick<PageCode, 'sceneText'>
  return { schema: getSchema(ext.sceneExtensions()), findTextRange: find.findTextRange, findTextRangeAfter: find.findTextRangeAfter, sceneText: stream.sceneText }
}

/** A scene's editor document (JSON) from its paragraphs: '\n' inside a paragraph is a line break. */
export function sceneDoc(key: string, paragraphs: string[]): { type: 'doc'; content: unknown[] } {
  return {
    type: 'doc',
    content: paragraphs.map((p, i) => ({
      type: 'paragraph',
      attrs: { pid: `${key}${String(i).padStart(3, '0')}`.slice(0, 8) },
      content: p.split('\n').flatMap((line, j) => [...(j ? [{ type: 'hardBreak' }] : []), ...(line ? [{ type: 'text', text: line }] : [])])
    }))
  }
}

// ---------- Opening the app ----------

export interface EvalApp {
  db: Database.Database
  storyA: string
  storyB: string
  /** Scene ids by world.ts key. */
  scenes: Map<string, string>
  model: string
  providerName: string
  page: PageCode
  ask: (typeof import('@app/main/ipc/ask'))['askHandlers']
  EditorAgent: (typeof import('@app/main/ask/agent'))['EditorAgent']
  prefs: () => import('@shared/types').WritingPrefs
  spent: () => number
  stopped: () => boolean
  close(): Promise<void>
}

export async function openEvalApp(cfg: EvalConfig, opts: { network: boolean } = { network: true }): Promise<EvalApp> {
  paidGuard(cfg)
  const dataDir = mkdtempSync(join(tmpdir(), 'aiwrite-chat-eval-'))
  process.env.AIWRITE_DATA_DIR = dataDir
  process.env.AIWRITE_SEARCH_MODEL_AUTO = 'off'
  process.env.AIWRITE_KEEPER_QUIET_MS = String(6 * 60 * 60_000)
  const realFetch = globalThis.fetch
  let stopServer: (() => Promise<void>) | null = null
  let world: typeof import('@app/main/world') | null = null
  const close = async (): Promise<void> => {
    try {
      world?.closeWorld()
    } catch (e) {
      console.warn('Could not close the eval world', e)
    }
    globalThis.fetch = realFetch
    await stopServer?.()
    if (cfg.keep) cfg.log(`data folder kept at ${dataDir}`)
    else rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }
  try {
    globalThis.fetch = tapped(realFetch, cfg.backend === 'openrouter')
    const settings = await import('@app/main/settings')
    const providers = await import('@app/main/ai/providers')
    world = await import('@app/main/world')
    const { initAi } = await import('@app/main/ai')
    const { askHandlers } = await import('@app/main/ipc/ask')
    const { EditorAgent } = await import('@app/main/ask/agent')
    const repo = await import('@app/main/db/repo')
    const memory = await import('@app/main/db/memory')
    const { emptySceneCard } = await import('@shared/defaults')

    // The provider and the chat model, as Settings › Models would have them (chat is "Same as the writer model").
    let model = 'none'
    let providerName = 'none'
    if (opts.network) {
      const big = { contextLength: 1_048_576, promptPrice: null, completionPrice: null, maxOutput: null, sampling: null }
      if (cfg.backend === 'fake') {
        const { startFakeProvider } = await import('../fake-provider/server.mjs')
        const fake = await startFakeProvider({ delayMs: 0, words: 120 })
        stopServer = () => fake.close()
        const p = providers.saveProvider({ kind: 'custom', name: 'Fake', baseUrl: fake.url, apiKey: 'chat-eval-fake' })
        model = 'fake/chat'
        providerName = 'fake provider (plumbing only)'
        settings.updateSettings({ models: { writer: { providerId: p.id, modelId: model, label: model, ...big } } } as never)
      } else if (cfg.backend === 'bridge') {
        const { startBridge, BRIDGE_MODEL } = await import('./bridge.mjs')
        const bridge = await startBridge({ dir: cfg.bridgeDir, seqPrefix: `${cfg.label || 'run'}-`, log: cfg.log })
        stopServer = () => bridge.close()
        const p = providers.saveProvider({ kind: 'custom', name: 'Bridge', baseUrl: bridge.url, apiKey: 'chat-eval-bridge' })
        model = BRIDGE_MODEL
        providerName = `file bridge (${cfg.bridgeDir}): a stand-in, not a real model`
        settings.updateSettings({ models: { writer: { providerId: p.id, modelId: model, label: model, ...big } } } as never)
      } else {
        const p = providers.saveProvider({ kind: 'openrouter', name: 'OpenRouter', baseUrl: '', apiKey: cfg.apiKey! })
        const listed = await providers.listModels(p.id)
        const id = cfg.model ?? pickFlash(listed.map((m) => m.id), 'openrouter')
        const m = listed.find((x) => x.id === id)
        if (!id || !m) throw new Error(`OpenRouter doesn't list ${id ?? 'a DeepSeek Flash model'}; name one with --model.`)
        spend.cap = cfg.maxUsd!
        spend.priceIn = m.promptPrice ?? 0
        spend.priceOut = m.completionPrice ?? 0
        model = m.id
        providerName = 'OpenRouter (paid)'
        settings.updateSettings({
          models: {
            writer: { providerId: p.id, modelId: m.id, label: m.name, contextLength: m.contextLength, promptPrice: m.promptPrice, completionPrice: m.completionPrice, maxOutput: m.maxOutput ?? null, sampling: m.sampling ?? null }
          }
        } as never)
      }
    }
    initAi()

    // The world: story A (the open story), story B (a story of its own), the entries, the hidden one, the scenes.
    world.createWorld('Saltreach (chat eval)')
    const db = world.db()
    const storyA = repo.listStories(db)[0]
    repo.updateStory(db, storyA.id, { title: STORIES.A.title, premise: STORIES.A.premise })
    const storyB = repo.createStory(db, { title: STORIES.B.title, startStoryId: null })
    repo.updateStory(db, storyB.id, { premise: STORIES.B.premise })
    const entryIds = new Map<string, string>()
    const makeEntry = (key: string, sceneId: string | null): void => {
      const e = ENTRIES.find((x) => x.key === key)!
      const input = { name: e.name, aliases: e.aliases ?? [], summary: e.summary, description: e.description }
      const made = e.storyB
        ? repo.createEntry(db, e.kind, input, { origin: 'adam', originStoryId: storyB.id })
        : sceneId
          ? repo.createEntry(db, e.kind, input, { origin: 'text', originStoryId: storyA.id, originSceneId: sceneId })
          : repo.createEntry(db, e.kind, input)
      entryIds.set(key, made.id)
      if (e.hidden) memory.setPin(db, made.id, 'world', null, 'hide')
    }
    for (const e of ENTRIES) if (!e.firstAt) makeEntry(e.key, null)

    const scenes = new Map<string, string>()
    const chapters = new Map<string, string>()
    const first = repo.getOutline(db, storyA.id)
    let firstSceneUsed = false
    for (const s of SCENES) {
      const storyId = s.story === 'A' ? storyA.id : storyB.id
      const chKey = `${s.story}${s.chapter}`
      let chapterId = chapters.get(chKey)
      if (!chapterId) {
        const title = CHAPTERS[s.story][s.chapter]
        const c = s.story === 'A' && s.chapter === 0 ? first.chapters[0] : repo.createChapter(db, storyId, { title })
        repo.updateChapter(db, c.id, { title })
        chapterId = c.id
        chapters.set(chKey, chapterId)
      }
      const sceneId = s.story === 'A' && !firstSceneUsed ? first.scenes[0].id : repo.createScene(db, chapterId, { title: s.title }).id
      if (s.story === 'A') firstSceneUsed = true
      repo.updateScene(db, sceneId, { title: s.title })
      const id = (k: string): string | null => entryIds.get(k) ?? null
      repo.updateSceneCard(db, sceneId, {
        ...emptySceneCard(),
        povId: id(s.card.pov),
        presentIds: s.card.present.map(id).filter((x): x is string => !!x),
        locationId: id(s.card.location),
        when: s.card.when ?? '',
        goal: s.card.goal
      })
      repo.saveSceneText(db, sceneId, sceneDoc(s.key, s.paragraphs), plainText(s.paragraphs))
      scenes.set(s.key, sceneId)
    }
    for (const e of ENTRIES) if (e.firstAt) makeEntry(e.key, scenes.get(e.firstAt)!)

    const page = await pageCode()
    // The saved text must be what the editor would save from the same document.
    for (const s of SCENES) {
      const doc = page.schema.nodeFromJSON(sceneDoc(s.key, s.paragraphs))
      if (page.sceneText(doc) !== plainText(s.paragraphs)) throw new Error(`Scene ${s.key}: the saved text isn't what the editor would save.`)
    }
    cfg.log(`world seeded: ${SCENES.length} scenes, ${ENTRIES.length} entries; backend ${cfg.backend}, model ${model}`)
    return {
      db,
      storyA: storyA.id,
      storyB: storyB.id,
      scenes,
      model,
      providerName,
      page,
      ask: askHandlers,
      EditorAgent,
      prefs: () => settings.getWritingPrefs(),
      spent: () => spend.usd,
      stopped: () => spend.stopped,
      close
    }
  } catch (e) {
    await close()
    throw e
  }
}

// ---------- One scenario ----------

export interface ProposalCheck {
  id: string
  kind: string
  /** Text and passage proposals: the page's own matcher finds its words in the scene (Apply would work). */
  applies: boolean | null
  /** It changes the paragraph the scenario meant (Outcome.touches), when it names one. */
  onTarget: boolean | null
  summary: string
}

export interface TurnResult {
  scenario: string
  group: string
  turn: number
  question: string
  expect: Scenario['turns'][number]['expect']
  status: string
  error: string | null
  answer: string
  proposals: Proposal[]
  checks: ProposalCheck[]
  steps: AgentStep[]
  /** Requests sent for this turn (each look-up is one more). */
  requests: number
  /** The app sent PROPOSE_NOW back (the answer had no proposals and claimed or was asked for changes). */
  nudged: boolean
  /**
   * Every tool call answered and its result as the model was shown it, in full (from the requests as sent; the last
   * request's own tool calls, if it made any, never got answers and aren't here).
   */
  toolResults: { tool: string; arguments: string; content: string }[]
  /** The system message as sent with the first request (the briefing). */
  system: string
  promptTokens: number | null
  cachedTokens: number | null
  completionTokens: number | null
  cost: number | null
  wallMs: number
}

const NUDGE_START = '[AI Write, not the writer] Your answer gives'

function checkProposal(app: EvalApp, p: Proposal, touches: string | undefined): ProposalCheck {
  const base = { id: p.id, kind: p.kind }
  if (p.kind !== 'text' && p.kind !== 'passage') return { ...base, applies: null, onTarget: null, summary: JSON.stringify(p).slice(0, 300) }
  const scene = (app.db.prepare('SELECT doc_json FROM scenes WHERE id = ?').get(p.sceneId) as { doc_json: string | null } | undefined)?.doc_json
  const doc = app.page.schema.nodeFromJSON(JSON.parse(scene ?? '{"type":"doc","content":[]}'))
  let from: number | null = null
  let to: number | null = null
  if (p.kind === 'text') {
    const r = app.page.findTextRange(doc, p.find)
    if (r) [from, to] = [r.from, r.to]
  } else {
    const a = app.page.findTextRange(doc, p.start)
    const b = a ? app.page.findTextRangeAfter(doc, p.end, a.from) : null
    if (a && b) [from, to] = [a.from, b.to]
  }
  const applies = from != null
  let onTarget: boolean | null = null
  if (touches) {
    const t = app.page.findTextRange(doc, touches)
    if (t && from != null && to != null) {
      const [pa, pb] = [doc.resolve(from).index(0), doc.resolve(to).index(0)]
      const pt = doc.resolve(t.from).index(0)
      onTarget = pt >= pa && pt <= pb
    } else onTarget = false
  }
  const summary = p.kind === 'text' ? `find “${p.find.slice(0, 120)}” → “${p.replace.slice(0, 160)}”` : `rewrite “${p.start.slice(0, 60)}” … “${p.end.slice(0, 60)}” → ${p.replace.length} chars`
  return { ...base, applies, onTarget, summary }
}

/** Runs a scenario's turns in one chat, in order. */
export async function runScenario(app: EvalApp, s: Scenario, limitMs = 90 * 60_000): Promise<TurnResult[]> {
  const out: TurnResult[] = []
  let chatId: string | null = null
  const sceneId = s.scene ? (app.scenes.get(s.scene) ?? null) : null
  for (let i = 0; i < s.turns.length; i++) {
    const question = i === 0 ? firstQuestion(s) : s.turns[i].ask
    const taskId = `eval-${s.id}-${i + 1}-${Date.now()}`
    const sent: SentRequest[] = []
    capture = sent
    const t0 = Date.now()
    let status = 'error'
    let error: string | null = null
    let generationId = ''
    try {
      const turn = await app.ask.askWorld({ taskId, chatId, question, storyId: app.storyA, sceneId })
      chatId = turn.chatId
      generationId = turn.generationId
      const done = await taskDone(taskId, limitMs)
      status = done.status
      error = done.error
    } catch (e) {
      error = (e as Error)?.message ?? String(e)
    }
    capture = null
    const wallMs = Date.now() - t0
    const row = generationId
      ? (app.db.prepare('SELECT response, prompt_tokens, completion_tokens, cost, params_json FROM generations WHERE id = ?').get(generationId) as
          | { response: string; prompt_tokens: number | null; completion_tokens: number | null; cost: number | null; params_json: string }
          | undefined)
      : undefined
    const params = row ? (JSON.parse(row.params_json) as { steps?: AgentStep[]; proposals?: Proposal[]; cachedTokens?: number }) : {}
    const proposals = params.proposals ?? []
    const expect = s.turns[i].expect
    const touches = expect.do === 'propose' ? expect.touches : undefined
    const seen = new Map<string, { tool: string; arguments: string; content: string }>()
    for (const r of sent) {
      const calls = new Map<string, { name: string; arguments: string }>()
      for (const m of r.body.messages) for (const c of m.tool_calls ?? []) calls.set(c.id, c.function)
      for (const m of r.body.messages) {
        if (m.role !== 'tool' || !m.tool_call_id || seen.has(m.tool_call_id)) continue
        const c = calls.get(m.tool_call_id)
        seen.set(m.tool_call_id, { tool: c?.name ?? '?', arguments: c?.arguments ?? '', content: String(m.content ?? '') })
      }
    }
    const sys = sent[0]?.body.messages.find((m) => m.role === 'system')?.content
    out.push({
      scenario: s.id,
      group: s.group,
      turn: i + 1,
      question,
      expect,
      status,
      error,
      answer: row?.response ?? '',
      proposals,
      checks: proposals.map((p) => checkProposal(app, p, touches)),
      steps: params.steps ?? [],
      requests: sent.length,
      nudged: sent.some((r) => r.body.messages.some((m) => m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(NUDGE_START))),
      toolResults: [...seen.values()],
      system: typeof sys === 'string' ? sys : '',
      promptTokens: row?.prompt_tokens ?? null,
      cachedTokens: params.cachedTokens ?? null,
      completionTokens: row?.completion_tokens ?? null,
      cost: row?.cost ?? null,
      wallMs
    })
    if (app.stopped()) break
  }
  return out
}
