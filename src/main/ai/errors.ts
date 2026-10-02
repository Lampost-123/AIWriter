// Turns what went wrong talking to a provider into plain words with a next
// step. Pure: every message Adam can see from the model connection is here.

import type { ProviderKind } from '@shared/types'
import { isLocalUrl } from '@shared/urls'

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

const SETTINGS = 'Settings › Models'

/** The provider as Adam knows it. */
export const providerWho = (p: Pick<ProviderRef, 'name' | 'kind'>): string => (p.kind === 'openrouter' ? 'OpenRouter' : p.name.trim() || 'The provider')

export { isLocalUrl }

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

/**
 * The model doesn't take `max_tokens` and wants `max_completion_tokens` instead
 * (OpenAI's reasoning models: o-series, GPT-5). Asking again with the other name fixes it.
 */
export function looksLikeTokenParamRejected(status: number, msg: string): boolean {
  if (status !== 400 && status !== 422) return false
  return /use ['"`]?max_completion_tokens|['"`]?max_tokens['"`]? (is )?(not supported|unsupported)|unsupported parameter:? ['"`]?max_tokens/i.test(msg)
}

/**
 * The model doesn't take the creativity settings (temperature / top_p): reasoning
 * models and some newer models set their own. Asking again without them fixes it.
 */
export function looksLikeSamplingRejected(status: number, msg: string): boolean {
  if (status !== 400 && status !== 422) return false
  return /\b(temperature|top_p)\b/i.test(msg) && /unsupported|not supported|does not support|doesn't support|deprecated|cannot both|can't both|only one|only the default|not allowed|not permitted|invalid/i.test(msg)
}

/** The provider is complaining about the name or value of a setting, not about lengths. */
const isParameterComplaint = (msg: string): boolean =>
  /unsupported parameter|unsupported value|not supported with this model|use ['"`]?max_completion_tokens/i.test(msg)

/** The message is about how much the model may write in one reply (max_tokens), not about the briefing. */
const mentionsReplyLimit = (msg: string): boolean =>
  !isParameterComplaint(msg) &&
  /max_tokens|max_completion_tokens|max_output_tokens|maximum (allowed )?(number of )?(output|completion) tokens|(output|completion) tokens/i.test(msg)

/**
 * The provider turned the request down because of the reply limit, or because
 * the briefing plus the reply doesn't fit: asking again with a smaller
 * max_tokens can help.
 */
export function looksLikeReplyLimitRejected(status: number, msg: string): boolean {
  // OpenRouter: "This request requires more credits, or fewer max_tokens. You requested up to 16384 tokens, but can only afford 5000."
  if (status === 402) return /fewer max_tokens|can only afford/i.test(msg)
  if (status !== 400 && status !== 413 && status !== 422) return false
  if (isParameterComplaint(msg)) return false
  return mentionsReplyLimit(msg) || looksLikeContextTooLong(msg)
}

export const looksLikeRefusal = (msg: string): boolean => /moderation|flagged|content (policy|filter|management)|safety|refus/i.test(msg)

/** The provider turned the key down (or there is none). */
export const isKeyFailure = (f: Failure | null | undefined): boolean =>
  !!f && f.type === 'http' && (f.status === 401 || (f.status === 403 && !looksLikeRefusal(f.message)))

const quoted = (msg: string): string => (msg ? ` It said: “${msg.replace(/[.\s]+$/, '')}”.` : '')

/**
 * One plain-words sentence (or two) saying what happened and what to do next.
 * During a draft the message shows in the editor, so it points to Settings >
 * Models. Testing a connection or loading a model list happens on that page,
 * so there it points to the button on the page instead.
 */
export function describeFailure(f: Failure, p: ProviderRef, ctx: { during: During; modelId?: string } = { during: 'draft' }): string {
  const who = providerWho(p)
  const local = isLocalUrl(p.baseUrl)
  const onPage = ctx.during !== 'draft'
  const checkUrl = p.kind === 'openrouter' ? 'Try again in a moment.' : onPage ? 'Click Edit and check the base URL; it usually ends in /v1.' : `Check the base URL in ${SETTINGS}; it usually ends in /v1.`
  switch (f.type) {
    case 'refused':
      return onPage ? 'This model turned the request down. Try another model.' : `This model refused the scene. Try another model in ${SETTINGS}.`
    case 'empty':
      return onPage ? `${who} sent back an empty reply. Try again, or try another model.` : `${who} sent back an empty draft. Try again, or pick another writer model in ${SETTINGS}.`
    case 'dropped':
      return `The connection to ${who} dropped before the draft was finished. The text that arrived is kept.`
    case 'timeout':
      return local
        ? `${who} didn't answer in time. If the model is still loading, wait a moment and try again.`
        : `${who} didn't answer in time. Try again in a moment.`
    case 'bad-response':
      return `${who} answered with something AI Write couldn't read. ${checkUrl}`
    case 'network':
      return describeNetwork(f.code, p, who, local, onPage)
    case 'http':
      return describeStatus(f.status, f.message, p, who, local, ctx)
  }
}

function describeNetwork(code: string | null, p: ProviderRef, who: string, local: boolean, onPage: boolean): string {
  const c = (code ?? '').toUpperCase()
  const baseUrl = p.baseUrl
  const fixUrl = p.kind === 'openrouter' ? '' : onPage ? ' Click Edit and check the base URL.' : ` Check the base URL in ${SETTINGS}.`
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
    if (p.kind === 'openrouter') return `Couldn't find ${host}. Check your internet connection, then try again.`
    return onPage
      ? `Couldn't find ${host}. Check your internet connection; if it's working, click Edit and check the base URL.`
      : `Couldn't find ${host}. Check your internet connection, and the base URL in ${SETTINGS}.`
  }
  if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c)) {
    return `${who}'s security certificate wasn't accepted, so AI Write didn't connect.${fixUrl || ' Try again later.'}`
  }
  if (c === 'ECONNREFUSED') return `${who} refused the connection at ${baseUrl}.${fixUrl || ' Try again in a moment.'}`
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
  const onPage = ctx.during !== 'draft'
  const model = ctx.modelId ? `“${ctx.modelId}”` : 'that model'
  // On Settings › Models the next step is a button on the page; elsewhere it's the page itself.
  const otherModel = onPage ? 'Click Change and pick another writer model.' : `Pick another writer model in ${SETTINGS}.`
  if (status === 401 || (status === 403 && !looksLikeRefusal(msg))) {
    if (!onPage) {
      if (!p.hasKey) return `${who} needs an API key. Add one in ${SETTINGS}.`
      return `${who} didn't accept your API key. Check it in ${SETTINGS}.`
    }
    if (p.kind === 'openrouter') {
      return p.hasKey ? "OpenRouter didn't accept this key. Copy it again from openrouter.ai/keys and click Replace key." : 'OpenRouter needs an API key. Paste it above.'
    }
    return p.hasKey ? `${who} didn't accept this API key. Click Edit and paste it again.` : `${who} needs an API key. Click Edit and paste it.`
  }
  if (status === 403) return onPage ? 'This model turned the request down. Try another model.' : `This model refused the scene. Try another model in ${SETTINGS}.`
  if (status === 402) {
    if (onPage) {
      return p.kind === 'openrouter'
        ? 'Your OpenRouter credit has run out. Top up at openrouter.ai/credits, then test again.'
        : `${who} says your account is out of credit. Top up there, then test again.`
    }
    return p.kind === 'openrouter'
      ? 'Your OpenRouter credit has run out. Top up, or switch the writer model in Settings.'
      : `${who} says your account is out of credit. Top up there, or switch the writer model in Settings.`
  }
  if (status === 404) {
    if (ctx.during !== 'models' && (p.kind === 'openrouter' || /model/i.test(msg))) {
      return `${who} doesn't have a model called ${model}. ${otherModel}`
    }
    if (p.kind === 'openrouter') return `OpenRouter couldn't find what AI Write asked for. Try again in a moment.`
    return onPage
      ? `${who} has no AI service at ${p.baseUrl}. Click Edit and check the base URL; it usually ends in /v1.`
      : `${who} has no AI service at ${p.baseUrl}. Check the base URL in ${SETTINGS}; it usually ends in /v1.`
  }
  if (status === 408 || status === 504 || status === 524) {
    return local
      ? `${who} didn't answer in time. If the model is still loading, wait a moment and try again.`
      : `${who} didn't answer in time. Try again in a moment.`
  }
  if (looksLikeTokenParamRejected(status, msg) || looksLikeSamplingRejected(status, msg)) {
    return `This model doesn't accept one of the settings AI Write sent. ${otherModel}`
  }
  if (!onPage && (status === 400 || status === 422) && mentionsReplyLimit(msg) && !/context (length|window|size)|maximum context/i.test(msg)) {
    return `This model can't write that much in one reply. Lower the length in the draft options, or pick another writer model in ${SETTINGS}.`
  }
  if (!onPage && (status === 413 || ((status === 400 || status === 422) && looksLikeContextTooLong(msg)))) {
    // The window holds the briefing and the reply together, so the length asked for counts too.
    return `The briefing and the length you asked for are too much for this model together. Lower the length in the draft options, shorten the scene card, or pick a model that can read more in ${SETTINGS}.`
  }
  if ((status === 400 || status === 422) && looksLikeRefusal(msg)) {
    return onPage ? 'This model turned the request down. Try another model.' : `This model refused the scene. Try another model in ${SETTINGS}.`
  }
  if (status === 400 || status === 422 || status === 413) {
    return onPage ? `${who} couldn't handle the request.${quoted(msg)} Try another model.` : `${who} couldn't handle the request.${quoted(msg)} Try another model in ${SETTINGS}.`
  }
  if (status === 429) {
    if (/upstream|temporarily rate-limited/i.test(msg)) {
      return onPage ? 'This model is busy right now. Wait a minute and try again.' : `This model is busy right now. Wait a minute and try again, or pick another writer model in ${SETTINGS}.`
    }
    return `${who} is limiting how many requests you can send right now. Wait a minute, then try again.`
  }
  if (status >= 500) {
    return onPage ? `${who} is having trouble right now. Try again in a few minutes.` : `${who} is having trouble right now. Try again in a few minutes, or switch the writer model in ${SETTINGS}.`
  }
  return onPage ? `${who} sent back an error (${status}).${quoted(msg)} Try again in a moment.` : `${who} sent back an error (${status}).${quoted(msg)} Check ${SETTINGS}, then try again.`
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
