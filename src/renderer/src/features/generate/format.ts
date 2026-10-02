// Small formatting helpers for the drafting screens. Pure (no React, no
// window), so they are unit-tested.

import type { Creativity, ModelChoice, ModelInfo, ThinkingLevel } from '@shared/types'
import { CREATIVITY_PRESETS } from '@shared/defaults'

/** "Maker: Model Name" -> "Model Name"; "maker/model-name" -> "model-name". */
export function shortModelName(labelOrId: string): string {
  const s = labelOrId.trim()
  if (!s) return 'Unnamed model'
  const colon = s.indexOf(': ')
  if (colon > 0 && colon < 40) return s.slice(colon + 2).trim() || s
  const slash = s.lastIndexOf('/')
  if (slash >= 0 && slash < s.length - 1) return s.slice(slash + 1)
  return s
}

/** A cost in US dollars, as Adam would say it. */
export function formatCost(usd: number | null | undefined): string {
  if (usd == null || !Number.isFinite(usd)) return '—'
  if (usd === 0) return 'Free'
  if (usd < 0.001) return '<$0.001'
  if (usd < 0.01) return `$${usd.toFixed(3)}`
  if (usd < 100) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString()}`
}

/** A per-token price as dollars per million tokens: 0.000003 -> "$3", 0.00000015 -> "$0.15". */
export function pricePerMillion(perToken: number | null | undefined): string {
  if (perToken == null || !Number.isFinite(perToken)) return '—'
  const m = perToken * 1_000_000
  if (m === 0) return 'Free'
  if (m < 0.01) return '<$0.01'
  if (m < 10) return `$${trimZeros(m.toFixed(2))}`
  return `$${trimZeros(m.toFixed(1))}`
}

const trimZeros = (s: string): string => (s.includes('.') ? s.replace(/\.?0+$/, '') : s)

/** "200K", "1M", "8,192" style context sizes. */
export function formatContext(tokens: number | null | undefined): string {
  if (!tokens) return '—'
  if (tokens >= 1_000_000) return `${trimZeros((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}K`
  if (tokens >= 1000) return `${trimZeros((tokens / 1000).toFixed(1))}K`
  return tokens.toLocaleString()
}

export const formatNumber = (n: number | null | undefined): string => (n == null ? '—' : Math.round(n).toLocaleString())

/** "just now", "5 minutes ago", "yesterday at 14:05", "3 Oct 2026". */
export function relativeTime(iso: string, nowMs: number = Date.now()): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const diff = Math.max(0, nowMs - t)
  const min = diff / 60_000
  if (min < 0.75) return 'just now'
  if (min < 1.5) return 'a minute ago'
  if (min < 45) return `${Math.round(min)} minutes ago`
  if (min < 90) return 'an hour ago'
  const d = new Date(t)
  const n = new Date(nowMs)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const sameDay = d.toDateString() === n.toDateString()
  if (sameDay) return `${Math.round(min / 60)} hours ago`
  const yesterday = new Date(nowMs)
  yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`
  if (diff < 6 * 86_400_000) return `${d.toLocaleDateString(undefined, { weekday: 'long' })} at ${time}`
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fullDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  return new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** The creativity preset a draft used (older records only have the temperature). */
export function creativityOf(params: { temperature: number; creativity?: Creativity }): string {
  if (params.creativity && params.creativity in CREATIVITY_PRESETS) return CREATIVITY_PRESETS[params.creativity].label
  const match = (Object.keys(CREATIVITY_PRESETS) as Creativity[]).find((k) => CREATIVITY_PRESETS[k].temperature === params.temperature)
  return match ? CREATIVITY_PRESETS[match].label : `Temperature ${params.temperature}`
}

export const CREATIVITY_HINTS: Record<Creativity, string> = {
  steady: 'Sticks closely to the card, with plainer choices.',
  balanced: 'Follows the card, with some fresh turns of phrase.',
  adventurous: 'Takes more risks with wording and ideas.'
}

/** How much a model thinks before it answers, as named on screen, in the order offered. */
export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  auto: 'Model decides',
  off: 'Off',
  low: 'Low',
  medium: 'Medium',
  high: 'High'
}

/** Rough cost of a draft before it is written: the briefing plus the target length, at the model's prices. */
export function estimateDraftCost(briefingTokens: number, targetWords: number, model: Pick<ModelChoice, 'promptPrice' | 'completionPrice'>): number | null {
  if (model.promptPrice == null || model.completionPrice == null) return null
  return briefingTokens * model.promptPrice + Math.ceil(targetWords * 1.35) * model.completionPrice
}

/** Models matching what Adam typed: every word must appear in the name or id. */
export function filterModels(models: ModelInfo[], query: string): ModelInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return models
  return models.filter((m) => {
    const hay = `${m.name} ${m.id}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** Share of the budget used, 0 to 1+ (above 1 means it doesn't fit). */
export const budgetShare = (used: number, available: number): number => (available > 0 ? used / available : used > 0 ? Infinity : 0)
