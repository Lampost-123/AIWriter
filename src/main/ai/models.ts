// Pure helpers for providers and their model lists.

import type { ModelInfo, ProviderKind } from '@shared/types'

const price = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  // OpenRouter marks variable-price routers with -1.
  return Number.isFinite(n) && n >= 0 ? n : null
}

const positiveInt = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/**
 * Reads a GET /models reply. OpenRouter gives each model's context length and
 * prices (USD per token, as strings); other providers usually give only ids.
 */
export function parseModelList(json: unknown, kind: ProviderKind): ModelInfo[] {
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object'
      ? ((json as Record<string, unknown>).data ?? (json as Record<string, unknown>).models)
      : null
  if (!Array.isArray(list)) return []
  const seen = new Set<string>()
  const out: ModelInfo[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const m = raw as Record<string, unknown>
    const id = typeof m.id === 'string' ? m.id : typeof m.name === 'string' && kind !== 'openrouter' ? m.name : null
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = typeof m.name === 'string' && m.name.trim() && kind === 'openrouter' ? m.name.trim() : id
    if (kind === 'openrouter') {
      const pricing = (m.pricing ?? {}) as Record<string, unknown>
      const top = (m.top_provider ?? {}) as Record<string, unknown>
      out.push({
        id,
        name,
        contextLength: positiveInt(m.context_length) ?? positiveInt(top.context_length),
        promptPrice: price(pricing.prompt),
        completionPrice: price(pricing.completion)
      })
    } else {
      // Some servers (Groq, Mistral, LM Studio...) say how much a model can read; use it when given.
      out.push({
        id,
        name,
        contextLength: positiveInt(m.context_length) ?? positiveInt(m.context_window) ?? positiveInt(m.max_context_length) ?? null,
        promptPrice: null,
        completionPrice: null
      })
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/**
 * Tidies a base URL Adam typed: adds http:// for a local address or https://
 * otherwise when the scheme is missing, and drops trailing slashes and a
 * pasted "/chat/completions". Returns null when it can't be a web address.
 */
export function normalizeBaseUrl(input: string): string | null {
  let s = input.trim()
  if (!s) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const local = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|\[?::1\]?)/i.test(s)
    s = `${local ? 'http' : 'https'}://${s}`
  }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (!u.hostname) return null
  u.hash = ''
  u.search = ''
  let path = u.pathname.replace(/\/+$/, '')
  path = path.replace(/\/(chat\/completions|completions|models)$/i, '')
  return `${u.protocol}//${u.host}${path}`
}
