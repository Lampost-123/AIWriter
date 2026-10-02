// The OpenAI-compatible chat client: streams a reply with Node's fetch, keeps
// every piece of text that arrives, retries rate limits and server errors
// before any text has arrived, and never throws: the outcome says what
// happened in plain words. No Electron imports, so it is tested against the
// fake provider in tests/fake-provider.

import type { ChatMessage, ProviderKind } from '@shared/types'
import {
  describeFailure,
  extractProviderMessage,
  looksLikeContextTooLong,
  looksLikeReplyLimitRejected,
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
}

export interface StreamOutcome {
  status: 'complete' | 'stopped' | 'error'
  /** All scene text received (kept whatever happened). */
  text: string
  /** Plain-words message when status is 'error'. */
  error: string | null
  failure: Failure | null
  promptTokens: number | null
  completionTokens: number | null
  /** USD, when the provider reports it. */
  cost: number | null
  finishReason: string | null
  retries: number
  /** The max_tokens the reply was finally asked with. */
  maxTokens: number
}

type Attempt =
  | { kind: 'ok' }
  | { kind: 'stopped' }
  | { kind: 'fail'; failure: Failure; retry: RetryCause | null; retryAfterMs: number | null; rejectedUsageOption?: boolean }

type UsageMode = 'openrouter' | 'stream_options' | 'none'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

export async function streamChat(o: StreamChatOptions): Promise<StreamOutcome> {
  const doFetch = o.fetchImpl ?? fetch
  const ref = refOf(o.target)
  const headersTimeout = o.headersTimeoutMs ?? 120_000
  const idleTimeout = o.idleTimeoutMs ?? 90_000
  const s = {
    text: '',
    promptTokens: null as number | null,
    completionTokens: null as number | null,
    cost: null as number | null,
    finishReason: null as string | null
  }
  let filter = new ThinkFilter()
  let usageMode: UsageMode = o.target.kind === 'openrouter' ? 'openrouter' : 'stream_options'
  let retries = 0
  let maxTokens = o.body.max_tokens

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
      completionTokens: s.completionTokens,
      cost: s.cost,
      finishReason: s.finishReason,
      retries,
      maxTokens
    }
  }

  /** Handles one parsed stream object. Returns a failure to stop on, or null to go on. */
  const handle = (obj: unknown): Attempt | null => {
    if (!obj || typeof obj !== 'object') return null
    const j = obj as Record<string, unknown>
    const usage = j.usage as Record<string, unknown> | undefined
    if (usage && typeof usage === 'object') {
      s.promptTokens = num(usage.prompt_tokens) ?? num(usage.input_tokens) ?? s.promptTokens
      s.completionTokens = num(usage.completion_tokens) ?? num(usage.output_tokens) ?? s.completionTokens
      s.cost = num(usage.cost) ?? s.cost
    }
    const choice = Array.isArray(j.choices) ? (j.choices[0] as Record<string, unknown> | undefined) : undefined
    if (choice) {
      const delta = choice.delta as Record<string, unknown> | undefined
      // Only the visible reply counts; reasoning / thinking fields are ignored on purpose.
      if (delta && typeof delta.content === 'string' && delta.content) emit(delta.content)
      else if (!delta && choice.message && typeof (choice.message as Record<string, unknown>).content === 'string') {
        emit((choice.message as Record<string, unknown>).content as string)
      }
      if (typeof choice.finish_reason === 'string' && choice.finish_reason) s.finishReason = choice.finish_reason
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
      const payload: Record<string, unknown> = { ...o.body, max_tokens: maxTokens, stream: true }
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
        const rejectedUsageOption =
          usageMode === 'stream_options' && (res.status === 400 || res.status === 422) && !looksLikeContextTooLong(message) && !looksLikeReplyLimitRejected(res.status, message)
        return {
          kind: 'fail',
          failure: { type: 'http', status: res.status, message },
          retry: { kind: 'status', status: res.status },
          retryAfterMs: parseRetryAfter(res.headers.get('retry-after')),
          rejectedUsageOption
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
      if (!s.text.trim()) return finish('error', { type: 'empty' })
      return finish('complete', null)
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
