// Providers Adam has connected: OpenRouter and any OpenAI-compatible service.
// The list lives in settings.providers; API keys live only in secrets.ts under
// 'provider:<id>' and never reach the interface (hasKey says one is stored).

import type { Job, ModelChoice, ModelInfo, ProviderConfig, ProviderInput } from '@shared/types'
import { OPENROUTER_BASE_URL } from '@shared/defaults'
import { getSettings, updateSettings } from '../settings'
import { getSecret, hasSecret, setSecret } from '../secrets'
import { newId, UserError } from '../util'
import { knownParams, rememberParams, requestJson, type ChatTarget } from './client'
import { describeFailure, isKeyFailure, looksLikeTokenParamRejected, providerWho, type Failure, type ProviderRef } from './errors'
import { normalizeBaseUrl, parseModelList } from './models'

const keyName = (id: string): string => `provider:${id}`
const JOBS: Job[] = ['writer', 'memory', 'chat', 'builder', 'speech', 'world', 'check']

/** Model lists, fetched once per provider per session. */
const modelCache = new Map<string, ModelInfo[]>()
const modelLoads = new Map<string, Promise<ModelInfo[]>>()

/** Providers removed this session, kept in memory so "Undo" can bring them back with their key. */
const removed = new Map<string, { config: ProviderConfig; key: string | null; index: number; choices: Partial<Record<Job, ModelChoice>> }>()

const withKeyState = (p: ProviderConfig): ProviderConfig => ({ ...p, hasKey: hasSecret(keyName(p.id)) })

export function listProviders(): ProviderConfig[] {
  return getSettings().providers.map(withKeyState)
}

export function getProvider(id: string): ProviderConfig | null {
  const p = getSettings().providers.find((x) => x.id === id)
  return p ? withKeyState(p) : null
}

function requireProvider(id: string): ProviderConfig {
  const p = getProvider(id)
  if (!p) throw new UserError('That provider has been removed. Connect it again on this page.')
  return p
}

/** Everything needed to call the provider, including its key. Main process only. */
export function providerTarget(p: ProviderConfig): ChatTarget & { id: string } {
  return { id: p.id, name: p.name, kind: p.kind, baseUrl: p.baseUrl, apiKey: getSecret(keyName(p.id)) }
}

const refOf = (p: ProviderConfig): ProviderRef => ({ name: p.name, kind: p.kind, baseUrl: p.baseUrl, hasKey: p.hasKey })

export function saveProvider(input: ProviderInput): ProviderConfig {
  const kind = input.kind === 'openrouter' ? 'openrouter' : 'custom'
  const list = getSettings().providers
  const name = (input.name ?? '').trim() || (kind === 'openrouter' ? 'OpenRouter' : '')
  if (!name) throw new UserError('Give this provider a name, like “LM Studio” or “DeepSeek”.')
  const baseUrl = kind === 'openrouter' ? OPENROUTER_BASE_URL : normalizeBaseUrl(input.baseUrl ?? '')
  if (!baseUrl) {
    throw new UserError("That base URL doesn't look right. It should look like https://api.example.com/v1, or http://localhost:1234/v1 for a program on this computer.")
  }

  let id = input.id
  // There is only ever one OpenRouter connection.
  if (!id && kind === 'openrouter') id = list.find((p) => p.kind === 'openrouter')?.id
  const existing = id ? list.find((p) => p.id === id) : undefined
  if (input.id && !existing) throw new UserError('That provider has been removed. Connect it again on this page.')
  if (!id) id = kind === 'openrouter' && !list.some((p) => p.id === 'openrouter') ? 'openrouter' : newId()

  const willHaveKey = input.apiKey !== undefined ? !!input.apiKey.trim() : hasSecret(keyName(id))
  if (kind === 'openrouter' && !willHaveKey) throw new UserError('Paste your OpenRouter API key first. You can make one at openrouter.ai/keys.')
  if (input.apiKey !== undefined) setSecret(keyName(id), input.apiKey.trim() || null)

  const config: ProviderConfig = { id, name, kind, baseUrl, hasKey: hasSecret(keyName(id)) }
  // The last check still holds only while the address and the key are the ones it checked.
  if (existing?.lastCheck && existing.baseUrl === baseUrl && input.apiKey === undefined) config.lastCheck = existing.lastCheck
  const next = existing ? list.map((p) => (p.id === id ? config : p)) : [...list, config]
  updateSettings({ providers: next })
  // Keep model choices pointing at it, and forget its model list (the address or key may have changed).
  modelCache.delete(id)
  modelLoads.delete(id)
  return config
}

export function deleteProvider(id: string): void {
  const s = getSettings()
  const index = s.providers.findIndex((p) => p.id === id)
  if (index < 0) return
  const choices: Partial<Record<Job, ModelChoice>> = {}
  const models: Partial<Record<Job, null>> = {}
  for (const job of JOBS) {
    const c = s.models[job]
    if (c && c.providerId === id) {
      choices[job] = c
      models[job] = null
    }
  }
  removed.set(id, { config: s.providers[index], key: getSecret(keyName(id)), index, choices })
  setSecret(keyName(id), null)
  updateSettings({ providers: s.providers.filter((p) => p.id !== id), models })
  modelCache.delete(id)
  modelLoads.delete(id)
}

export function restoreProvider(id: string): ProviderConfig {
  const r = removed.get(id)
  if (!r) throw new UserError("That provider can't be brought back any more. Connect it again on this page.")
  removed.delete(id)
  const s = getSettings()
  const already = s.providers.find((p) => p.id === id)
  if (already) return withKeyState(already)
  const providers = [...s.providers]
  providers.splice(Math.min(r.index, providers.length), 0, r.config)
  if (r.key) setSecret(keyName(id), r.key)
  const models: Partial<Record<Job, ModelChoice>> = {}
  for (const job of JOBS) {
    const c = r.choices[job]
    if (c && !s.models[job]) models[job] = c
  }
  updateSettings({ providers, models })
  return withKeyState(r.config)
}

/** Remembers whether the provider last worked, so Settings shows it after a restart too. */
export function markCheck(id: string, ok: boolean): void {
  const list = getSettings().providers
  if (!list.some((p) => p.id === id)) return
  const at = new Date().toISOString()
  updateSettings({ providers: list.map((p) => (p.id === id ? { ...p, lastCheck: { ok, at } } : p)) })
}

export async function listModels(providerId: string): Promise<ModelInfo[]> {
  const cached = modelCache.get(providerId)
  if (cached) return cached
  const inFlight = modelLoads.get(providerId)
  if (inFlight) return inFlight
  const p = requireProvider(providerId)
  const fetchList = async (): Promise<ModelInfo[]> => {
    const r = await requestJson(providerTarget(p), 'models', { timeoutMs: 20_000 })
    if (!r.ok) {
      if (isKeyFailure(r.failure)) markCheck(p.id, false)
      throw new UserError(describeFailure(r.failure, refOf(p), { during: 'models' }))
    }
    return parseModelList(r.json, p.kind)
  }
  const load: Promise<ModelInfo[]> = fetchList().then((models) => {
    // Only cache if the provider wasn't changed while the list was loading.
    if (modelLoads.get(providerId) === load) modelCache.set(providerId, models)
    return models
  })
  modelLoads.set(providerId, load)
  try {
    return await load
  } finally {
    if (modelLoads.get(providerId) === load) modelLoads.delete(providerId)
  }
}

const seconds = (ms: number): string => (ms < 1000 ? 'under a second' : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} seconds`)
const usd = (n: number): string => `$${n.toFixed(n < 10 ? 2 : 0)}`

type TestResult = { ok: boolean; message: string; latencyMs: number | null; failure?: Failure }

export async function testProvider(id: string, modelId?: string): Promise<{ ok: boolean; message: string; latencyMs: number | null }> {
  const { failure, ...res } = await runTest(id, modelId)
  // A model test that fails because of the model (not the key) says nothing about the connection.
  if (!modelId || res.ok || isKeyFailure(failure)) markCheck(id, res.ok)
  return res
}

async function runTest(id: string, modelId?: string): Promise<TestResult> {
  const p = requireProvider(id)
  const target = providerTarget(p)
  const ref = refOf(p)
  const who = providerWho(p)
  const fail = (message: string, failure?: Failure): TestResult => ({ ok: false, message, latencyMs: null, failure })

  let reachedIn: number | null = null
  let detail = ''
  if (p.kind === 'openrouter') {
    if (!target.apiKey) return fail('Paste your OpenRouter API key first. You can make one at openrouter.ai/keys.')
    // The model list is public, so ask about the key itself to check it.
    let r = await requestJson(target, 'key', { timeoutMs: 15_000 })
    if (!r.ok && r.failure.type === 'http' && r.failure.status === 404) r = await requestJson(target, 'auth/key', { timeoutMs: 15_000 })
    if (!r.ok) return fail(describeFailure(r.failure, ref, { during: 'test' }), r.failure)
    reachedIn = r.ms
    detail = 'Your key works.'
    const data = (r.json as { data?: { limit_remaining?: unknown } } | null)?.data
    if (typeof data?.limit_remaining === 'number') detail += ` Credit left on this key: ${usd(data.limit_remaining)}.`
  } else {
    const r = await requestJson(target, 'models', { timeoutMs: 15_000 })
    if (r.ok) {
      reachedIn = r.ms
      const models = parseModelList(r.json, p.kind)
      modelCache.set(id, models)
      if (models.length) detail = `It offers ${models.length.toLocaleString('en-GB')} ${models.length === 1 ? 'model' : 'models'}.`
    } else {
      // Some servers don't list their models; a model to try can still prove the connection.
      const canGoOn = !!modelId && r.failure.type === 'http' && (r.failure.status === 404 || r.failure.status === 405)
      if (!canGoOn) return fail(describeFailure(r.failure, ref, { during: 'models' }), r.failure)
    }
  }

  if (modelId) {
    // Ask the way this model is known to want (OpenAI's reasoning models take max_completion_tokens).
    let tokenParam = knownParams(target, modelId).tokenParam
    const ask = () =>
      requestJson(target, 'chat/completions', {
        method: 'POST',
        body: { model: modelId, messages: [{ role: 'user', content: 'Reply with the word OK.' }], [tokenParam]: 1, stream: false },
        timeoutMs: 90_000
      })
    let r = await ask()
    if (!r.ok && tokenParam === 'max_tokens' && r.failure.type === 'http' && looksLikeTokenParamRejected(r.failure.status, r.failure.message)) {
      tokenParam = 'max_completion_tokens'
      rememberParams(target, modelId, { ...knownParams(target, modelId), tokenParam })
      r = await ask()
    }
    if (!r.ok) return fail(describeFailure(r.failure, ref, { during: 'test', modelId }), r.failure)
    const err = (r.json as { error?: { message?: string; code?: number } } | null)?.error
    if (err) {
      const failure: Failure = { type: 'http', status: Number(err.code) || 500, message: err.message ?? '' }
      return fail(describeFailure(failure, ref, { during: 'test', modelId }), failure)
    }
    return { ok: true, message: `Connected to ${who}. The model answered in ${seconds(r.ms)}.`, latencyMs: r.ms }
  }
  return { ok: true, message: `Connected to ${who}${reachedIn != null ? ` in ${seconds(reachedIn)}` : ''}. ${detail}`.trim(), latencyMs: reachedIn }
}
