// The OpenAI-compatible chat client: streams a reply with Node's fetch, keeps
// every piece of text that arrives, retries rate limits and server errors
// before any text has arrived, and never throws: the outcome says what
// happened in plain words. No Electron imports, so it is tested against the
// fake provider in tests/fake-provider.

import type { ChatMessage, ProviderKind, ThinkingLevel } from '@shared/types'
import {
  describeFailure,
  extractProviderMessage,
  looksLikeContextTooLong,
  looksLikeReplyLimitRejected,
  looksLikeSamplingRejected,
  looksLikeTokenParamRejected,
  networkCode,
  retryReason,
  type Failure,
  type ProviderRef
} from './errors'
import { parseRetryAfter, retryDelay, shouldRetry, type RetryCause } from './retry'
import { parsePayload, SseParser } from './sse'
import { ThinkFilter } from './think'

export interface ChatTarget {
  name: string
  kind: ProviderKind
  baseUrl: string
  apiKey: string | null
}

export interface ChatBody {
  model: string
  messages: ChatMessage[]
  temperature: number
  top_p: number
  max_tokens: number
}

export const APP_REFERER = 'https://github.com/lampost-123/aiwriter'
export const APP_TITLE = 'AI Write'

export function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

export function requestHeaders(t: Pick<ChatTarget, 'kind' | 'apiKey'>, json = true): Record<string, string> {
  const h: Record<string, string> = {}
  if (json) h['Content-Type'] = 'application/json'
  if (t.apiKey) h.Authorization = `Bearer ${t.apiKey}`
  if (t.kind === 'openrouter') {
    h['HTTP-Referer'] = APP_REFERER
    h['X-Title'] = APP_TITLE
  }
  return h
}

const refOf = (t: ChatTarget): ProviderRef => ({ name: t.name, kind: t.kind, baseUrl: t.baseUrl, hasKey: !!t.apiKey })

/** Waits, or resolves false straight away if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false)
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// ---------- Streaming ----------

export interface StreamChatOptions {
  target: ChatTarget
  body: ChatBody
  signal: AbortSignal
  /** Called with each piece of scene text (thinking already removed). */
  onText: (text: string) => void
  onRetry?: (info: { attempt: number; waitMs: number; reason: string }) => void
  fetchImpl?: typeof fetch
  /** Waits before each retry (tests make these short). */
  delays?: number[]
  /** How long to wait for the server to start answering. */
  headersTimeoutMs?: number
  /** How long the stream may stay silent before giving up. */
  idleTimeoutMs?: number
  /**
   * A smaller max_tokens to ask with once if the provider rejects `body.max_tokens`
   * (some models can't write that much in one reply).
   */
  fallbackMaxTokens?: number
  /** How to word the request at first; by default, what this session has learnt about the model. */
  startParams?: SentParams
  /**
   * A bigger reply limit to ask with once when the model finished without a visible word because its
   * thinking used up the limit (most providers count thinking against max_tokens). A model seen doing
   * that is asked with this limit from the start for the rest of the session.
   */
  thinkingRoom?: number
  /**
   * How much the model is asked to think (Settings › Models). Left out or 'auto', nothing is asked.
   * A model that turns the level down is asked the next way, or not at all (see THINKING_EFFORTS).
   */
  thinking?: ThinkingLevel
}

/** How the request had to be worded for this model (some models reject max_tokens, temperature or top_p). */
export interface SentParams {
  /** The name the reply limit was sent under. */
  tokenParam: 'max_tokens' | 'max_completion_tokens'
  /** False when the model doesn't take temperature / top_p, so they were left out. */
  sampling: boolean
}

const DEFAULT_PARAMS: SentParams = { tokenParam: 'max_tokens', sampling: true }

/** What worked for each model this session, so later drafts are worded right the first time. */
const paramsByModel = new Map<string, SentParams>()
const paramKey = (t: Pick<ChatTarget, 'baseUrl'>, model: string): string => `${t.baseUrl.replace(/\/+$/, '')}\n${model}`

/** The request wording that works for this model, as far as this session knows. */
export const knownParams = (t: Pick<ChatTarget, 'baseUrl'>, model: string): SentParams => paramsByModel.get(paramKey(t, model)) ?? DEFAULT_PARAMS
export function rememberParams(t: Pick<ChatTarget, 'baseUrl'>, model: string, p: SentParams): void {
  paramsByModel.set(paramKey(t, model), p)
}
/**
 * The efforts to ask with for each thinking level, in order: OpenRouter's `reasoning.effort`, or
 * `reasoning_effort` for other servers. A model that can't turn its thinking off is asked for as
 * little as it can ('low'); one that takes none of them is asked nothing.
 */
export const THINKING_EFFORTS: Record<ThinkingLevel, string[]> = { auto: [], off: ['none', 'low'], low: ['low'], medium: ['medium'], high: ['high'] }
/** Efforts each model has turned down this session. */
const rejectedEfforts = new Map<string, Set<string>>()
/** Models seen using up their whole reply limit thinking. */
const thinkers = new Set<string>()

/** The effort to ask this model with for a level, as far as this session knows; null to ask nothing. */
export const thinkingEffort = (t: Pick<ChatTarget, 'baseUrl'>, model: string, level: ThinkingLevel | undefined): string | null =>
  THINKING_EFFORTS[level ?? 'auto'].find((e) => !rejectedEfforts.get(paramKey(t, model))?.has(e)) ?? null

/** The level an effort stands for, for "What the AI saw". */
export const levelOfEffort = (effort: string | null): Exclude<ThinkingLevel, 'auto'> | undefined =>
  effort === 'none' ? 'off' : effort === 'low' || effort === 'medium' || effort === 'high' ? effort : undefined

/** For tests. */
export const forgetParams = (): void => {
  paramsByModel.clear()
  rejectedEfforts.clear()
  thinkers.clear()
}

export interface StreamOutcome {
  status: 'complete' | 'stopped' | 'error'
  /** All scene text received (kept whatever happened). */
  text: string
  /** Plain-words message when status is 'error'. */
  error: string | null
  failure: Failure | null
  promptTokens: number | null
  /** Of the prompt tokens, how many the provider read from its cache (billed for less), when it says. */
  cachedTokens: number | null
  completionTokens: number | null
  /** USD, when the provider reports it. */
  cost: number | null
  finishReason: string | null
  retries: number
  /** The max_tokens the reply was finally asked with. */
  maxTokens: number
  /** The model stopped because it reached the reply limit, so the scene ends early (the text is kept). */
  cutOff: boolean
  /** How the reply limit and creativity settings were finally sent. */
  sentParams: SentParams
  /** The thinking effort finally asked for; null when nothing was asked. */
  effort: string | null
}

type Attempt =
  | { kind: 'ok' }
  | { kind: 'stopped' }
  | {
      kind: 'fail'
      failure: Failure
      retry: RetryCause | null
      retryAfterMs: number | null
      rejectedUsageOption?: boolean
      rejectedThinkingOption?: boolean
    }

type UsageMode = 'openrouter' | 'stream_options' | 'none'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** The visible text in a delta or message: a string, or (from some servers) a list of parts. */
function visibleText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((p: unknown) => {
      const part = (p ?? {}) as { type?: unknown; text?: unknown }
      // 'text' or 'output_text'; never a thinking part.
      return typeof part.text === 'string' && /text$/.test(String(part.type ?? 'text')) ? part.text : ''
    })
    .join('')
}

/** Whether a delta or message carries the model's thinking (which is never shown). */
function hasThinking(d: Record<string, unknown>): boolean {
  return (
    (typeof d.reasoning === 'string' && d.reasoning !== '') ||
    (typeof d.reasoning_content === 'string' && d.reasoning_content !== '') ||
    (Array.isArray(d.reasoning_details) && d.reasoning_details.length > 0)
  )
}

/**
 * Of the prompt tokens, how many came from the provider's cache: OpenAI's and OpenRouter's
 * `prompt_tokens_details.cached_tokens`, or DeepSeek's `prompt_cache_hit_tokens`.
 */
export function cachedOf(usage: Record<string, unknown>): number | null {
  const details = usage.prompt_tokens_details as Record<string, unknown> | undefined
  return (details && typeof details === 'object' ? num(details.cached_tokens) : null) ?? num(usage.prompt_cache_hit_tokens)
}

/**
 * Whether the model caches a repeated prompt only where the request marks it. Claude does (through
 * OpenRouter, which passes the marks on). OpenAI, DeepSeek, Grok and Gemini 2.5 and later cache on their
 * own: the briefing is sent with what stays the same first (SEND_ORDER in context.ts), so they reuse it.
 */
export const marksCache = (t: Pick<ChatTarget, 'kind'>, model: string): boolean =>
  t.kind === 'openrouter' && /^anthropic\//i.test(model)

/**
 * The messages as sent. For a model that caches only where asked, the system message and the part of
 * a message that stays the same (`cacheUpTo`) are marked (Claude takes four marks; at most two are
 * used). A cached part costs a tenth to read again within five minutes, and a quarter more the first
 * time, so only what is likely to be sent again is marked. `cacheUpTo` itself is never sent.
 */
export function sentMessages(t: Pick<ChatTarget, 'kind'>, model: string, messages: ChatMessage[]): unknown[] {
  const mark = marksCache(t, model)
  return messages.map(({ cacheUpTo, ...m }) => {
    if (!mark || !m.content) return m
    const cut = m.role === 'system' ? m.content.length : Math.min(cacheUpTo ?? 0, m.content.length)
    if (cut <= 0) return m
    const parts: Record<string, unknown>[] = [{ type: 'text', text: m.content.slice(0, cut), cache_control: { type: 'ephemeral' } }]
    if (cut < m.content.length) parts.push({ type: 'text', text: m.content.slice(cut) })
    return { ...m, content: parts }
  })
}

export async function streamChat(o: StreamChatOptions): Promise<StreamOutcome> {
  const doFetch = o.fetchImpl ?? fetch
  const ref = refOf(o.target)
  const headersTimeout = o.headersTimeoutMs ?? 120_000
  const idleTimeout = o.idleTimeoutMs ?? 90_000
  const s = {
    text: '',
    promptTokens: null as number | null,
    cachedTokens: null as number | null,
    completionTokens: null as number | null,
    cost: null as number | null,
    finishReason: null as string | null,
    /** The model sent thinking (never shown). */
    thought: false
  }
  /** What an earlier try that came back empty already cost (a model that used up its limit thinking is still billed). */
  const spent = { completionTokens: 0, cost: 0, any: false }
  let filter = new ThinkFilter()
  let usageMode: UsageMode = o.target.kind === 'openrouter' ? 'openrouter' : 'stream_options'
  let retries = 0
  let maxTokens = o.body.max_tokens
  let sent: SentParams = { ...(o.startParams ?? knownParams(o.target, o.body.model)) }
  const modelKey = paramKey(o.target, o.body.model)
  let effort = thinkingEffort(o.target, o.body.model, o.thinking)
  let triedThinkingRoom = false
  if (o.thinkingRoom && o.thinkingRoom > maxTokens && thinkers.has(modelKey)) {
    maxTokens = o.thinkingRoom
    triedThinkingRoom = true
  }

  const emit = (raw: string): void => {
    const t = filter.push(raw)
    if (!t) return
    s.text += t
    o.onText(t)
  }

  const finish = (status: StreamOutcome['status'], failure: Failure | null): StreamOutcome => {
    const rest = filter.end()
    if (rest) {
      s.text += rest
      o.onText(rest)
    }
    let error = failure ? describeFailure(failure, ref, { during: 'draft', modelId: o.body.model }) : null
    // Whatever went wrong, the text that already arrived stays in the scene; say so.
    if (error && s.text.trim() && failure?.type !== 'dropped') error += ' The text that arrived is kept.'
    return {
      status,
      text: s.text,
      error,
      failure,
      promptTokens: s.promptTokens,
      cachedTokens: s.cachedTokens,
      completionTokens: spent.any ? (s.completionTokens ?? 0) + spent.completionTokens : s.completionTokens,
      cost: spent.any && (s.cost != null || spent.cost > 0) ? (s.cost ?? 0) + spent.cost : s.cost,
      finishReason: s.finishReason,
      retries,
      maxTokens,
      cutOff: status === 'complete' && (s.finishReason === 'length' || s.finishReason === 'max_tokens'),
      sentParams: { ...sent },
      effort
    }
  }

  /** Handles one parsed stream object. Returns a failure to stop on, or null to go on. */
  const handle = (obj: unknown): Attempt | null => {
    if (!obj || typeof obj !== 'object') return null
    const j = obj as Record<string, unknown>
    const usage = j.usage as Record<string, unknown> | undefined
    if (usage && typeof usage === 'object') {
      s.promptTokens = num(usage.prompt_tokens) ?? num(usage.input_tokens) ?? s.promptTokens
      s.cachedTokens = cachedOf(usage) ?? s.cachedTokens
      s.completionTokens = num(usage.completion_tokens) ?? num(usage.output_tokens) ?? s.completionTokens
      s.cost = num(usage.cost) ?? s.cost
    }
    const choice = Array.isArray(j.choices) ? (j.choices[0] as Record<string, unknown> | undefined) : undefined
    if (choice) {
      const delta = choice.delta as Record<string, unknown> | undefined
      const part = delta ?? (choice.message as Record<string, unknown> | undefined)
      // Only the visible reply counts; reasoning / thinking fields are never shown, only noted.
      if (part && typeof part === 'object') {
        const text = visibleText(part.content)
        if (text) emit(text)
        if (hasThinking(part)) s.thought = true
      }
      if (typeof choice.finish_reason === 'string' && choice.finish_reason) s.finishReason = choice.finish_reason
    }
    // A server that gave up before writing anything, without saying why: a server error, tried again.
    if (!j.error && s.finishReason === 'error' && !s.text) {
      const message = 'The model stopped with an error before writing anything.'
      return { kind: 'fail', failure: { type: 'http', status: 502, message }, retry: { kind: 'status', status: 502 }, retryAfterMs: null }
    }
    if (j.error) {
      const e = j.error as Record<string, unknown> | string
      const status = typeof e === 'object' ? (num(Number(e.code)) ?? num(e.status) ?? 500) : 500
      const message = typeof e === 'string' ? e : typeof e.message === 'string' ? e.message : ''
      const failure: Failure = status >= 100 && status < 600 ? { type: 'http', status, message } : { type: 'http', status: 500, message }
      return { kind: 'fail', failure, retry: { kind: 'status', status: failure.status }, retryAfterMs: null }
    }
    return null
  }

  const attemptOnce = async (): Promise<Attempt> => {
    // How the last try ended says nothing about this one.
    s.finishReason = null
    s.thought = false
    const ctl = new AbortController()
    let timedOut = false
    const onAbort = (): void => ctl.abort()
    o.signal.addEventListener('abort', onAbort, { once: true })
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = (ms: number): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timedOut = true
        ctl.abort()
      }, ms)
    }
    const failFromThrow = (e: unknown): Attempt => {
      if (o.signal.aborted) return { kind: 'stopped' }
      if (timedOut) return { kind: 'fail', failure: s.text ? { type: 'dropped' } : { type: 'timeout' }, retry: { kind: 'timeout' }, retryAfterMs: null }
      if (s.text) return { kind: 'fail', failure: { type: 'dropped' }, retry: null, retryAfterMs: null }
      return { kind: 'fail', failure: { type: 'network', code: networkCode(e), message: String((e as Error)?.message ?? e) }, retry: { kind: 'network' }, retryAfterMs: null }
    }
    arm(headersTimeout)
    try {
      const { max_tokens: _limit, temperature, top_p, ...rest } = o.body
      const payload: Record<string, unknown> = { ...rest, messages: sentMessages(o.target, rest.model, rest.messages), stream: true }
      payload[sent.tokenParam] = maxTokens
      if (sent.sampling) Object.assign(payload, { temperature, top_p })
      // OpenRouter's own way of asking every model; other servers take OpenAI's.
      if (effort && o.target.kind === 'openrouter') payload.reasoning = { effort }
      else if (effort) payload.reasoning_effort = effort
      if (usageMode === 'openrouter') payload.usage = { include: true }
      if (usageMode === 'stream_options') payload.stream_options = { include_usage: true }
      let res: Response
      try {
        res = await doFetch(endpoint(o.target.baseUrl, 'chat/completions'), {
          method: 'POST',
          headers: { ...requestHeaders(o.target), Accept: 'text/event-stream' },
          body: JSON.stringify(payload),
          signal: ctl.signal
        })
      } catch (e) {
        return failFromThrow(e)
      }

      if (!res.ok) {
        let bodyText = ''
        try {
          bodyText = await res.text()
        } catch {
          /* the status says enough */
        }
        if (o.signal.aborted) return { kind: 'stopped' }
        const message = extractProviderMessage(bodyText)
        const unexplained =
          (res.status === 400 || res.status === 422) &&
          !looksLikeContextTooLong(message) &&
          !looksLikeReplyLimitRejected(res.status, message) &&
          !looksLikeTokenParamRejected(res.status, message) &&
          !looksLikeSamplingRejected(res.status, message)
        return {
          kind: 'fail',
          failure: { type: 'http', status: res.status, message },
          retry: { kind: 'status', status: res.status },
          retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
          rejectedUsageOption: unexplained && usageMode === 'stream_options',
          rejectedThinkingOption: unexplained && effort != null
        }
      }

      const type = res.headers.get('content-type') ?? ''
      if (type.includes('application/json')) {
        // The server ignored stream: true and sent the whole reply at once.
        let j: unknown
        try {
          j = await res.json()
        } catch (e) {
          return failFromThrow(e)
        }
        const r = handle(j)
        if (r) return r
        return { kind: 'ok' }
      }
      if (!res.body) return { kind: 'fail', failure: { type: 'bad-response', message: 'No body' }, retry: null, retryAfterMs: null }

      arm(idleTimeout)
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      const parser = new SseParser()
      let done = false
      const take = (events: string[]): Attempt | null => {
        for (const ev of events) {
          const p = parsePayload(ev)
          for (const obj of p.objects) {
            const r = handle(obj)
            if (r) return r
          }
          if (p.done) {
            done = true
            return null
          }
        }
        return null
      }
      try {
        while (!done) {
          const { value, done: ended } = await reader.read()
          arm(idleTimeout)
          if (ended) {
            const r = take([...parser.push(decoder.decode()), ...parser.end()])
            if (r) return r
            break
          }
          const r = take(parser.push(decoder.decode(value, { stream: true })))
          if (r) return r
        }
      } catch (e) {
        return failFromThrow(e)
      } finally {
        reader.cancel().catch(() => undefined)
      }
      if (!done && !s.finishReason && !s.text) {
        // The stream closed without a word or a sign that it had finished.
        return { kind: 'fail', failure: { type: 'network', code: null, message: 'closed' }, retry: { kind: 'network' }, retryAfterMs: null }
      }
      return { kind: 'ok' }
    } finally {
      if (timer) clearTimeout(timer)
      o.signal.removeEventListener('abort', onAbort)
    }
  }

  let triedWithoutUsage = false
  let triedSmallerReply = false
  let triedTokenParam = false
  let triedNoSampling = false
  for (;;) {
    if (o.signal.aborted) return finish('stopped', null)
    const r = await attemptOnce()
    if (r.kind === 'stopped') return finish('stopped', null)
    if (r.kind === 'ok') {
      if (s.finishReason === 'content_filter') return finish('error', { type: 'refused' })
      const rest = filter.end()
      if (rest) {
        s.text += rest
        o.onText(rest)
      }
      if (!s.text.trim()) {
        // Nothing to show. When the model was thinking, or stopped at the reply limit, its thinking
        // used up the limit: ask once more with room to think and still answer, and remember the model.
        const thinking = s.thought || filter.sawThinking || s.finishReason === 'length' || s.finishReason === 'max_tokens'
        if (thinking && !triedThinkingRoom && o.thinkingRoom && o.thinkingRoom > maxTokens) {
          triedThinkingRoom = true
          thinkers.add(modelKey)
          maxTokens = o.thinkingRoom
          spent.any = true
          spent.completionTokens += s.completionTokens ?? 0
          spent.cost += s.cost ?? 0
          Object.assign(s, { text: '', completionTokens: null, cost: null, finishReason: null, thought: false })
          filter = new ThinkFilter()
          continue
        }
        return finish('error', thinking ? { type: 'empty', thinking: true } : { type: 'empty' })
      }
      return finish('complete', null)
    }
    // A model that can't take the thinking level the way it was asked: ask the next way (for Off,
    // 'none' then 'low'), or not at all, and remember it for this model. A server that may be turning
    // down the usage option instead is asked without that first, unless it names the thinking.
    if (
      r.rejectedThinkingOption &&
      effort &&
      (!r.rejectedUsageOption || triedWithoutUsage || (r.failure.type === 'http' && /reason|effort|think/i.test(r.failure.message)))
    ) {
      const turnedDown = rejectedEfforts.get(modelKey) ?? new Set<string>()
      turnedDown.add(effort)
      rejectedEfforts.set(modelKey, turnedDown)
      effort = thinkingEffort(o.target, o.body.model, o.thinking)
      continue
    }
    // Some models (OpenAI's reasoning models, for one) want the reply limit under another
    // name, or set their own creativity. Ask once more the way they want; remember it.
    if (!triedTokenParam && sent.tokenParam === 'max_tokens' && r.failure.type === 'http' && looksLikeTokenParamRejected(r.failure.status, r.failure.message)) {
      triedTokenParam = true
      sent = { ...sent, tokenParam: 'max_completion_tokens' }
      rememberParams(o.target, o.body.model, sent)
      continue
    }
    if (!triedNoSampling && sent.sampling && r.failure.type === 'http' && looksLikeSamplingRejected(r.failure.status, r.failure.message)) {
      triedNoSampling = true
      sent = { ...sent, sampling: false }
      rememberParams(o.target, o.body.model, sent)
      continue
    }
    if (
      !triedSmallerReply &&
      o.fallbackMaxTokens &&
      maxTokens > o.fallbackMaxTokens &&
      r.failure.type === 'http' &&
      looksLikeReplyLimitRejected(r.failure.status, r.failure.message)
    ) {
      // The model can't write that much in one go (or the briefing plus the reply is too long): ask with the plain reply room.
      triedSmallerReply = true
      maxTokens = o.fallbackMaxTokens
      continue
    }
    if (r.rejectedUsageOption && !triedWithoutUsage) {
      // Some servers reject stream_options: ask once more without it (usage then isn't reported).
      triedWithoutUsage = true
      usageMode = 'none'
      continue
    }
    if (r.retry && shouldRetry(r.retry, { textReceived: s.text.length > 0, retriesDone: retries })) {
      retries++
      const wait = retryDelay(retries, r.retryAfterMs, o.delays)
      const cause = r.retry
      o.onRetry?.({
        attempt: retries,
        waitMs: wait,
        reason: retryReason(
          { status: cause.kind === 'status' ? cause.status : undefined, network: cause.kind === 'network', timeout: cause.kind === 'timeout' },
          ref
        )
      })
      if (!s.text) filter = new ThinkFilter()
      if (!(await sleep(wait, o.signal))) return finish('stopped', null)
      continue
    }
    return finish('error', r.failure)
  }
}

// ---------- Plain JSON requests (model lists, connection tests) ----------

export type JsonResult = { ok: true; json: unknown; status: number; ms: number } | { ok: false; failure: Failure; status: number | null; ms: number }

export async function requestJson(
  target: ChatTarget,
  path: string,
  opts: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<JsonResult> {
  const doFetch = opts.fetchImpl ?? fetch
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 20_000)
  const started = Date.now()
  try {
    let res: Response
    try {
      res = await doFetch(endpoint(target.baseUrl, path), {
        method: opts.method ?? 'GET',
        headers: requestHeaders(target, opts.body !== undefined),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctl.signal
      })
    } catch (e) {
      const ms = Date.now() - started
      if (ctl.signal.aborted) return { ok: false, failure: { type: 'timeout' }, status: null, ms }
      return { ok: false, failure: { type: 'network', code: networkCode(e), message: String((e as Error)?.message ?? e) }, status: null, ms }
    }
    let text = ''
    try {
      text = await res.text()
    } catch {
      if (ctl.signal.aborted) return { ok: false, failure: { type: 'timeout' }, status: res.status, ms: Date.now() - started }
    }
    const ms = Date.now() - started
    if (!res.ok) return { ok: false, failure: { type: 'http', status: res.status, message: extractProviderMessage(text) }, status: res.status, ms }
    try {
      return { ok: true, json: JSON.parse(text), status: res.status, ms }
    } catch {
      return { ok: false, failure: { type: 'bad-response', message: text.slice(0, 120) }, status: res.status, ms }
    }
  } finally {
    clearTimeout(timer)
  }
}
