// Turns what went wrong talking to a provider into plain words with a next
// step. Pure: every message Adam can see from the model connection is here.

import type { ProviderKind } from '@shared/types'

export interface ProviderRef {
  name: string
  kind: ProviderKind
  baseUrl: string
  hasKey: boolean
}

export type Failure =
  /** The server answered with an error status (or an error object mid-stream). */
  | { type: 'http'; status: number; message: string }
  /** No connection: refused, DNS, TLS, reset before anything arrived. */
  | { type: 'network'; code: string | null; message: string }
  | { type: 'timeout' }
  /** The model refused (content filter / moderation). */
  | { type: 'refused' }
  /** The model finished without writing anything. */
  | { type: 'empty' }
  /** The connection dropped after text had started arriving. */
  | { type: 'dropped' }
  /** The server answered with something that isn't the expected API. */
  | { type: 'bad-response'; message: string }

export type During = 'draft' | 'models' | 'test'

const SETTINGS = 'Settings > Models'

/** The provider as Adam knows it. */
export const providerWho = (p: Pick<ProviderRef, 'name' | 'kind'>): string => (p.kind === 'openrouter' ? 'OpenRouter' : p.name.trim() || 'The provider')

/** True for a server on this computer or the local network (LM Studio, Ollama...). */
export function isLocalUrl(url: string): boolean {
  let host: string
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '')
  } catch {
    return false
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === '::1' || host === '0.0.0.0') return true
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254)
}

/** Pulls the human part out of an error body: OpenAI-style JSON, plain text or HTML. */
export function extractProviderMessage(body: string): string {
  const text = body.trim()
  if (!text) return ''
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const err = j.error
    if (typeof err === 'string') return clip(err)
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      if (typeof e.message === 'string' && e.message) return clip(e.message)
    }
    for (const k of ['message', 'detail', 'error_description']) {
      if (typeof j[k] === 'string' && j[k]) return clip(j[k] as string)
    }
    return clip(text)
  } catch {
    return clip(text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '))
  }
}

function clip(s: string, n = 220): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t
}

export const looksLikeContextTooLong = (msg: string): boolean =>
  /context (length|window|size)|maximum context|too many tokens|too long|token limit|max(imum)?[_ ]?(prompt )?tokens|reduce the length|exceeds the (model|maximum|limit)|input is too large/i.test(msg)

export const looksLikeRefusal = (msg: string): boolean => /moderation|flagged|content (policy|filter|management)|safety|refus/i.test(msg)

const quoted = (msg: string): string => (msg ? ` It said: “${msg.replace(/[.\s]+$/, '')}”.` : '')

/** One plain-words sentence (or two) saying what happened and what to do next. */
export function describeFailure(f: Failure, p: ProviderRef, ctx: { during: During; modelId?: string } = { during: 'draft' }): string {
  const who = providerWho(p)
  const local = isLocalUrl(p.baseUrl)
  switch (f.type) {
    case 'refused':
      return `This model refused the scene. Try another model in ${SETTINGS}.`
    case 'empty':
      return `${who} sent back an empty draft. Try again, or pick another writer model in ${SETTINGS}.`
    case 'dropped':
      return `The connection to ${who} dropped before the draft was finished. The text that arrived is kept.`
    case 'timeout':
      return local
        ? `${who} didn't answer in time. If the model is still loading, wait a moment and try again.`
        : `${who} didn't answer in time. Try again in a moment.`
    case 'bad-response':
      return `${who} answered with something AI Write couldn't read. Check the base URL in ${SETTINGS}; it usually ends in /v1.`
    case 'network':
      return describeNetwork(f.code, who, p.baseUrl, local)
    case 'http':
      return describeStatus(f.status, f.message, p, who, local, ctx)
  }
}

function describeNetwork(code: string | null, who: string, baseUrl: string, local: boolean): string {
  const c = (code ?? '').toUpperCase()
  if (local && (c === 'ECONNREFUSED' || c === 'ECONNRESET' || c === 'EHOSTUNREACH' || c === '' || c === 'UND_ERR_SOCKET')) {
    return `Couldn't reach ${who} at ${baseUrl}. If it runs on this computer (like LM Studio or Ollama), check that it's open and its server is started.`
  }
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') {
    let host = baseUrl
    try {
      host = new URL(baseUrl).host
    } catch {
      /* keep the URL */
    }
    return `Couldn't find ${host}. Check your internet connection, and the base URL in ${SETTINGS}.`
  }
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c)) {
    return `${who}'s security certificate wasn't accepted, so AI Write didn't connect. Check the base URL in ${SETTINGS}.`
  }
  if (c === 'ECONNREFUSED') return `${who} refused the connection at ${baseUrl}. Check the base URL in ${SETTINGS}.`
  return `Couldn't connect to ${who}. Check your internet connection, then try again.`
}

function describeStatus(
  status: number,
  msg: string,
  p: ProviderRef,
  who: string,
  local: boolean,
  ctx: { during: During; modelId?: string }
): string {
  const model = ctx.modelId ? `“${ctx.modelId}”` : 'that model'
  if (status === 401 || (status === 403 && !looksLikeRefusal(msg))) {
    if (!p.hasKey) return `${who} needs an API key. Add one in ${SETTINGS}.`
    return `${who} didn't accept your API key. Check it in ${SETTINGS}.`
  }
  if (status === 403) return `This model refused the scene. Try another model in ${SETTINGS}.`
  if (status === 402) {
    return p.kind === 'openrouter'
      ? 'Your OpenRouter credit has run out. Top up, or switch the writer model in Settings.'
      : `${who} says your account is out of credit. Top up there, or switch the writer model in Settings.`
  }
  if (status === 404) {
    if (ctx.during !== 'models' && (p.kind === 'openrouter' || /model/i.test(msg))) {
      return `${who} doesn't have a model called ${model}. Pick another writer model in ${SETTINGS}.`
    }
    return `${who} has no AI service at ${p.baseUrl}. Check the base URL in ${SETTINGS}; it usually ends in /v1.`
  }
  if (status === 408 || status === 504 || status === 524) {
    return local
      ? `${who} didn't answer in time. If the model is still loading, wait a moment and try again.`
      : `${who} didn't answer in time. Try again in a moment.`
  }
  if (status === 413 || ((status === 400 || status === 422) && looksLikeContextTooLong(msg))) {
    return `The briefing is too long for this model. Pick a model that can read more in ${SETTINGS}, or shorten the scene card.`
  }
  if ((status === 400 || status === 422) && looksLikeRefusal(msg)) {
    return `This model refused the scene. Try another model in ${SETTINGS}.`
  }
  if (status === 400 || status === 422) {
    return `${who} couldn't handle the request.${quoted(msg)} Try another model in ${SETTINGS}.`
  }
  if (status === 429) {
    if (/upstream|temporarily rate-limited/i.test(msg)) {
      return `This model is busy right now. Wait a minute and try again, or pick another writer model in ${SETTINGS}.`
    }
    return `${who} is limiting how many requests you can send right now. Wait a minute, then try again.`
  }
  if (status >= 500) {
    return `${who} is having trouble right now. Try again in a few minutes, or switch the writer model in ${SETTINGS}.`
  }
  return `${who} sent back an error (${status}).${quoted(msg)} Check ${SETTINGS}, then try again.`
}

/** The short reason shown while retrying. */
export function retryReason(cause: { status?: number; network?: boolean; timeout?: boolean }, p: Pick<ProviderRef, 'name' | 'kind'>): string {
  const who = providerWho(p)
  if (cause.status === 429) return `${who} is busy`
  if (cause.timeout) return `${who} is slow to answer`
  if (cause.network) return `Couldn't reach ${who}`
  return `${who} had a hiccup`
}

/** Reads the error code out of a Node fetch failure ("fetch failed" hides it in `cause`). */
export function networkCode(err: unknown): string | null {
  let e: unknown = err
  for (let i = 0; i < 4 && e && typeof e === 'object'; i++) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && code) return code
    e = (e as { cause?: unknown }).cause
  }
  return null
}
