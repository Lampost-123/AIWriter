// The chat eval's harness: the app's own main-process code in plain Node (as the trap harness runs it: the stand-in
// for Electron, a throwaway data folder), with the invented world (world.ts) seeded into a fresh world, and Ask the
// world asked through its real handler (src/main/ipc/ask.ts askWorld) exactly as the window asks it. The model behind
// it is a pluggable backend:
//   fake        the fake provider (tests/fake-provider): plumbing only, never a score
//   bridge      the file bridge (bridge.mjs): a person or a Claude session answers each request from files
//   openrouter  a real model on OpenRouter; refuses unless AIWRITE_CHAT_EVAL_PAID=yes and a cost cap are set
//   deepseek    a real model on DeepSeek's own API (DEEPSEEK_API_KEY), with the same locks
// Every request the app sends is captured on its way out (the whole body), so the report can count requests, nudges
// and tool results, and look for story-point leaks in exactly what the model was shown; every reply is read as it
// streams back (the tools the model called, ask_user and propose_draft included, which may end the turn).
// Phase 1: story C (bigWorld.ts, a 30-60k-token briefing) is seeded only when a scenario asks in it, and a scenario's
// earlier turns are seeded into its chat as 'chat' generation records, exactly as the app stores them.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type Database from 'better-sqlite3'
import type { Node as PMNode, Schema } from '@tiptap/pm/model'
import type { AgentStep } from '@shared/types'
import type { Proposal } from '@shared/contracts/ask'
import { CHAT_SWITCHES, chatSwitchOn, chatSwitchVar } from '@shared/askIntent'
import { appEvents } from '../traps/fakeElectron'
import { pickFlash } from '../traps/models'
import { CHAPTERS, ENTRIES, SCENES, STORIES, plainText } from './world'
import { C_CHAPTERS, C_CHAPTER_SUMMARIES, C_EARLIER, C_EMPTY, C_ENTRIES, C_OPEN, STORY_C, type BigScene } from './bigWorld'
import { firstQuestion, type Scenario } from './scenarios'

export type Backend = 'fake' | 'bridge' | 'openrouter' | 'deepseek'

/** A backend that calls a real, paid model. */
export const isPaid = (b: Backend): boolean => b === 'openrouter' || b === 'deepseek'

/** DeepSeek's own API: its Flash model, and its price per token in USD (OpenRouter's list price, to be safe). */
const DEEPSEEK = { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', priceIn: 0.3e-6, priceOut: 1.2e-6, contextLength: 1_048_576 }

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
  /**
   * The switches in effect, recorded in the report: every chat overhaul switch (AIWRITE_EXP_CHAT_*) as on or off,
   * whether set or left at its default (on), and any other AIWRITE_EXP_* as set.
   */
  switches: Record<string, string>
  /** The AIWRITE_EXP_* variables actually set in the environment (passed through to the app's code). */
  switchesSet: Record<string, string>
  log: (line: string) => void
}

/** The AIWRITE_EXP_* variables set in an environment. */
const expVars = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(Object.entries(env).filter(([k, v]) => k.startsWith('AIWRITE_EXP_') && v != null) as [string, string][])

/** The switches in effect (EvalConfig.switches): each chat switch on or off, defaults included, then the other ones set. */
export function effectiveSwitches(env: NodeJS.ProcessEnv): Record<string, string> {
  const chat = Object.fromEntries(CHAT_SWITCHES.map((n) => [chatSwitchVar(n), chatSwitchOn(env[chatSwitchVar(n)]) ? 'on' : 'off']))
  return { ...chat, ...Object.fromEntries(Object.entries(expVars(env)).filter(([k]) => !(k in chat))) }
}

export function configFromEnv(env = process.env): EvalConfig {
  const harnessRoot = resolve(__dirname, '..', '..')
  const b = env.CHAT_EVAL_BACKEND
  const backend: Backend = b === 'bridge' || b === 'openrouter' || b === 'deepseek' ? b : 'fake'
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
    apiKey: (backend === 'deepseek' ? env.DEEPSEEK_API_KEY : env.OPENROUTER_API_KEY)?.trim() || null,
    label: env.CHAT_EVAL_LABEL?.trim() || '',
    keep: env.CHAT_EVAL_KEEP === '1',
    switches: effectiveSwitches(env),
    switchesSet: expVars(env),
    log: (line) => console.log(`[chat-eval] ${line}`)
  }
}

/** A paid run only with both locks open, never in CI. Throws (before any network call) otherwise. */
export function paidGuard(cfg: Pick<EvalConfig, 'backend' | 'paid' | 'maxUsd' | 'apiKey'>, env = process.env): void {
  if (!isPaid(cfg.backend)) return
  if (!cfg.paid) throw new Error('A real-model run costs money: it runs only with AIWRITE_CHAT_EVAL_PAID=yes set.')
  if (cfg.maxUsd == null) throw new Error('A real-model run needs a cost cap: set AIWRITE_CHAT_EVAL_MAX_USD (or --max-usd) to a number of dollars.')
  if (!cfg.apiKey) throw new Error(`A real-model run needs ${cfg.backend === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'OPENROUTER_API_KEY'} in the environment.`)
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

/** One request the app sent to the model, as sent, and what came back (read from the stream as it passed). */
export interface SentRequest {
  at: number
  body: {
    messages: { role: string; content: unknown; tool_call_id?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }[]
    tools?: unknown[]
    tool_choice?: unknown
  }
  reply?: Promise<Reply | null>
}

/** A streamed reply as the model sent it: its words and the tools it called. */
export interface Reply {
  content: string
  toolCalls: { name: string; arguments: string }[]
  finish: string | null
}

type ReplyChunk = {
  usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
  choices?: {
    delta?: { content?: unknown; tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[] }
    message?: { content?: unknown; tool_calls?: { index?: number; function?: { name?: string; arguments?: string } }[] }
    finish_reason?: string | null
  }[]
}

/** Reads a streamed (SSE) reply: words, tool calls (the name, then the arguments in pieces), and usage (a paid run's spend). */
async function readReply(stream: ReadableStream<Uint8Array>, paid: boolean): Promise<Reply> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
  }
  const out: Reply = { content: '', toolCalls: [], finish: null }
  const byIndex = new Map<number, { name: string; arguments: string }>()
  // A server that ignored stream: true sends one JSON body.
  const lines = buf.trim().startsWith('{') ? [`data: ${buf.trim()}`] : buf.split('\n')
  for (const line of lines) {
    if (!line.startsWith('data: ') || line.startsWith('data: [DONE]')) continue
    let j: ReplyChunk
    try {
      j = JSON.parse(line.slice(6)) as ReplyChunk
    } catch {
      continue
    }
    if (j.usage && paid) spend.usd += j.usage.cost ?? (j.usage.prompt_tokens ?? 0) * spend.priceIn + (j.usage.completion_tokens ?? 0) * spend.priceOut
    for (const c of j.choices ?? []) {
      if (c.finish_reason) out.finish = c.finish_reason
      const d = c.delta ?? c.message
      if (!d) continue
      if (typeof d.content === 'string') out.content += d.content
      ;(d.tool_calls ?? []).forEach((t, i) => {
        const k = t.index ?? i
        const had = byIndex.get(k) ?? { name: '', arguments: '' }
        if (t.function?.name) had.name += t.function.name
        if (t.function?.arguments) had.arguments += t.function.arguments
        byIndex.set(k, had)
      })
    }
  }
  out.toolCalls = [...byIndex.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v)
  return out
}

let capture: SentRequest[] | null = null
/** USD so far (a paid run), and the cap. */
const spend = { usd: 0, cap: Infinity, stopped: false, priceIn: 0, priceOut: 0 }

/** fetch with every chat request captured (and its reply read as it streams by); a paid run's requests checked against the cap first. */
function tapped(next: typeof fetch, paid: boolean): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (!/chat\/completions\/?$/.test(url) || typeof init?.body !== 'string') return next(input, init)
    const body = JSON.parse(init.body) as SentRequest['body'] & { max_tokens?: number; max_completion_tokens?: number }
    const req: SentRequest = { at: Date.now(), body }
    capture?.push(req)
    const worst = spend.usd + (init.body.length / 4) * spend.priceIn + (body.max_tokens ?? body.max_completion_tokens ?? 2000) * spend.priceOut
    if (paid && (spend.stopped || worst > spend.cap)) {
      spend.stopped = true
      return new Response(JSON.stringify({ error: { code: 402, message: `The chat eval's cost cap ($${spend.cap}) would be passed; nothing more is sent.` } }), {
        status: 402,
        headers: { 'Content-Type': 'application/json' }
      })
    }
    const res = await next(input, init)
    if (!res.body) return res
    const [a, b] = res.body.tee()
    req.reply = readReply(b, paid).catch(() => null)
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
  /** Story C (the big briefing: bigWorld.ts), when a scenario needed it seeded. */
  storyC: string | null
  /** Scene ids by world.ts key (and bigWorld.ts's, when story C was seeded). */
  scenes: Map<string, string>
  model: string
  providerName: string
  page: PageCode
  ask: (typeof import('@app/main/ipc/ask'))['askHandlers']
  EditorAgent: (typeof import('@app/main/ask/agent'))['EditorAgent']
  prefs: () => import('@shared/types').WritingPrefs
  /** A new chat in a story with earlier turns already in it, stored as the app stores them; returns its id. */
  seedChat: (storyId: string, history: NonNullable<Scenario['history']>) => string
  spent: () => number
  stopped: () => boolean
  close(): Promise<void>
}

export async function openEvalApp(cfg: EvalConfig, opts: { network: boolean; big?: boolean } = { network: true }): Promise<EvalApp> {
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
    globalThis.fetch = tapped(realFetch, isPaid(cfg.backend))
    const settings = await import('@app/main/settings')
    const providers = await import('@app/main/ai/providers')
    world = await import('@app/main/world')
    const { initAi } = await import('@app/main/ai')
    const { askHandlers } = await import('@app/main/ipc/ask')
    const { EditorAgent } = await import('@app/main/ask/agent')
    const repo = await import('@app/main/db/repo')
    const memory = await import('@app/main/db/memory')
    const gens = await import('@app/main/db/generations')
    const chats = await import('@app/main/ask/chats')
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
      } else if (cfg.backend === 'deepseek') {
        const p = providers.saveProvider({ kind: 'custom', name: 'DeepSeek', baseUrl: DEEPSEEK.baseUrl, apiKey: cfg.apiKey! })
        const id = cfg.model ?? DEEPSEEK.model
        spend.cap = cfg.maxUsd!
        spend.priceIn = DEEPSEEK.priceIn
        spend.priceOut = DEEPSEEK.priceOut
        model = id
        providerName = 'DeepSeek API (paid)'
        settings.updateSettings({
          models: {
            writer: { providerId: p.id, modelId: id, label: id, contextLength: DEEPSEEK.contextLength, promptPrice: DEEPSEEK.priceIn, completionPrice: DEEPSEEK.priceOut, maxOutput: null, sampling: null }
          }
        } as never)
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

    // Story C, the big briefing (only when a scenario asks in it): hundreds of entries of its own, ninety summarised
    // scenes before the open one, a long open scene, and an empty last scene with a card. A story of its own, so
    // stories A and B (and the core scenarios' briefings) never see any of it.
    let storyC: string | null = null
    if (opts.big) {
      const c = repo.createStory(db, { title: STORY_C.title, startStoryId: null })
      repo.updateStory(db, c.id, { premise: STORY_C.premise })
      storyC = c.id
      for (const e of C_ENTRIES)
        repo.createEntry(db, e.kind, { name: e.name, aliases: e.aliases ?? [], summary: e.summary, description: e.description }, { origin: 'adam', originStoryId: c.id })
      const outline = repo.getOutline(db, c.id)
      const chapterIds: string[] = []
      for (let i = 0; i < C_CHAPTERS.length; i++) {
        const ch = i === 0 && outline.chapters[0] ? outline.chapters[0] : repo.createChapter(db, c.id, { title: C_CHAPTERS[i], afterId: chapterIds.at(-1) ?? null })
        repo.updateChapter(db, ch.id, { title: C_CHAPTERS[i] })
        memory.putSummary(db, { level: 'chapter', targetId: ch.id, text: C_CHAPTER_SUMMARIES[i], origin: 'adam' })
        chapterIds.push(ch.id)
      }
      let reuse: string | null = outline.scenes[0]?.id ?? null
      const lastIn = new Map<string, string>()
      const id = (k: string): string | null => entryIds.get(k) ?? null
      for (const s of [...C_EARLIER, C_OPEN, C_EMPTY] as BigScene[]) {
        const chapterId = chapterIds[s.chapter]
        let sceneId: string
        if (reuse && s.chapter === 0) {
          sceneId = reuse
          reuse = null
        } else sceneId = repo.createScene(db, chapterId, { title: s.title, afterId: lastIn.get(chapterId) ?? null }).id
        lastIn.set(chapterId, sceneId)
        repo.updateScene(db, sceneId, { title: s.title })
        if (s.card)
          repo.updateSceneCard(db, sceneId, {
            ...emptySceneCard(),
            povId: id(s.card.pov),
            presentIds: s.card.present.map(id).filter((x): x is string => !!x),
            locationId: id(s.card.location),
            when: s.card.when ?? '',
            goal: s.card.goal,
            ...(s.card.beats ? { beats: s.card.beats } : {})
          })
        if (s.paragraphs.length) repo.saveSceneText(db, sceneId, sceneDoc(s.key, s.paragraphs), plainText(s.paragraphs))
        if (s.summary) memory.putSummary(db, { level: 'scene', targetId: sceneId, text: s.summary, origin: 'adam' })
        scenes.set(s.key, sceneId)
      }
    }

    const page = await pageCode()
    // The saved text must be what the editor would save from the same document.
    for (const s of [...SCENES, ...(opts.big ? [C_OPEN] : [])]) {
      const doc = page.schema.nodeFromJSON(sceneDoc(s.key, s.paragraphs))
      if (page.sceneText(doc) !== plainText(s.paragraphs)) throw new Error(`Scene ${s.key}: the saved text isn't what the editor would save.`)
    }
    cfg.log(
      `world seeded: ${SCENES.length} scenes, ${ENTRIES.length} entries${opts.big ? `; story C (big briefing): ${C_EARLIER.length + 2} scenes, ${C_ENTRIES.length} entries` : ''}; backend ${cfg.backend}, model ${model}`
    )
    return {
      db,
      storyA: storyA.id,
      storyB: storyB.id,
      storyC,
      scenes,
      model,
      providerName,
      page,
      ask: askHandlers,
      EditorAgent,
      prefs: () => settings.getWritingPrefs(),
      seedChat: (storyId, history) => {
        const chatId = chats.newChatId(storyId)
        // Earlier turns, a minute apart, ending an hour ago (the chat is read oldest first by created_at).
        const start = Date.now() - 60 * 60_000 - history.length * 60_000
        history.forEach((h, i) => {
          const id = `seed-${chatId.split(':')[1]}-${i}`
          const proposals: Proposal[] = (h.proposals ?? []).map((p, k) => {
            const sceneId = scenes.get(p.scene)!
            const sceneLabel = SCENES.find((x) => x.key === p.scene)?.title ?? p.scene
            return { id: String(k + 1), status: p.status, why: 'As asked.', kind: 'text', sceneId, sceneLabel, find: p.find, replace: p.replace }
          })
          gens.insertGeneration(db, {
            id,
            sceneId: '',
            job: 'chat',
            providerId: 'seed',
            providerName: 'Seeded history',
            modelId: model,
            params: { temperature: 0.8, top_p: 0.95, max_tokens: 1500, chatId, ...(proposals.length ? { proposals } : {}) } as never,
            direction: h.q,
            blocks: [],
            messages: [],
            budget: { contextLength: 1_048_576, reserved: 1500, available: 1_047_076, used: 0 },
            entries: [],
            createdAt: new Date(start + i * 60_000).toISOString()
          })
          gens.finishGeneration(db, id, {
            status: 'complete',
            error: null,
            response: h.a,
            promptTokens: null,
            completionTokens: null,
            cost: null,
            finishedAt: new Date(start + i * 60_000 + 20_000).toISOString()
          })
        })
        return chatId
      },
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
  // ----- Phase 1 (older reports lack these: the scores treat a missing one as unknown) -----
  /** The story it was asked in: A (the small world) or C (the big briefing). */
  story?: 'A' | 'C'
  /** Earlier turns seeded into the chat before the first question. */
  history?: number
  /** Characters of the system message (the briefing) and of every message, in the turn's first request. */
  systemChars?: number
  promptChars?: number
  /** Every tool the model called this turn, in order, with its arguments (read from the replies as they streamed). */
  toolCalls?: { name: string; arguments: string }[]
  /** The tool_choice each request forced (anything but none / "auto"), e.g. "required" or "propose_changes". */
  forced?: string[]
  /** The intent the app recorded on the turn (params.intent), when it records one. */
  intent?: string | null
}

/** The tool_choice a request forced, or null ("auto", "none" or none sent). */
export function forcedChoice(choice: unknown): string | null {
  if (choice == null || choice === 'auto' || choice === 'none') return null
  if (typeof choice === 'string') return choice
  const name = (choice as { function?: { name?: string } }).function?.name
  return name ?? JSON.stringify(choice)
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
  const storyId = s.big ? app.storyC : app.storyA
  if (!storyId) throw new Error(`${s.id} is asked in story C, which wasn't seeded (open the app with big: true).`)
  const sceneId = s.scene ? (app.scenes.get(s.scene) ?? null) : null
  if (s.scene && !sceneId) throw new Error(`${s.id}: no scene ${s.scene} in the eval world.`)
  let chatId: string | null = s.history?.length ? app.seedChat(storyId, s.history) : null
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
      const turn = await app.ask.askWorld({ taskId, chatId, question, storyId, sceneId })
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
    // The replies have finished streaming by now (the task is done); a stuck one is given up on after 30 s.
    const replies = await Promise.all(sent.map((r) => Promise.race([r.reply ?? Promise.resolve(null), new Promise<null>((res) => setTimeout(() => res(null), 30_000).unref())])))
    const row = generationId
      ? (app.db.prepare('SELECT response, prompt_tokens, completion_tokens, cost, params_json FROM generations WHERE id = ?').get(generationId) as
          | { response: string; prompt_tokens: number | null; completion_tokens: number | null; cost: number | null; params_json: string }
          | undefined)
      : undefined
    const params = row ? (JSON.parse(row.params_json) as { steps?: AgentStep[]; proposals?: Proposal[]; cachedTokens?: number; intent?: unknown }) : {}
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
      wallMs,
      story: s.big ? 'C' : 'A',
      history: i === 0 ? (s.history?.length ?? 0) : (s.history?.length ?? 0) + i,
      systemChars: typeof sys === 'string' ? sys.length : 0,
      promptChars: (sent[0]?.body.messages ?? []).reduce((a, m) => a + (typeof m.content === 'string' ? m.content.length : JSON.stringify(m.content ?? '').length), 0),
      toolCalls: replies.some((r) => r)
        ? replies.flatMap((r) => r?.toolCalls ?? [])
        : (params.steps ?? []).map((st) => ({ name: st.tool, arguments: st.arguments })),
      forced: sent.map((r) => forcedChoice(r.body.tool_choice)).filter((c): c is string => !!c),
      intent: typeof params.intent === 'string' ? params.intent : null
    })
    if (app.stopped()) break
  }
  return out
}
