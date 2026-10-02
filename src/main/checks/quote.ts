// Quotes and keys for consistency issues (milestone 5, AI checks). Pure, no Electron imports.
// - A quote from the check model counts only when its words are in the scene: exactly, or with other
//   quotation marks, dashes, capitals or spacing, or (when the model joined pieces with "...") its longest
//   piece. What is kept is always the scene's own text, cut out exactly.
// - An issue's key is its check, what it is about (an entry, an earlier scene, another story) and its quote
//   made plain, so the same thing found again is the same issue, and an ignored one is never raised again.

import type { CheckKind, IssueKind } from '@shared/contracts/checks'
import { findQuote, plain, wordCount } from '../keeper/text'

/** Quotation marks a model wraps the words in. */
const WRAP = /^["“”'‘’«»]+|["“”'‘’«»]+$/g

/** The scene's own words for a quote from the check model, or null when they aren't in the scene. */
export function sceneQuote(text: string, quote: unknown): string | null {
  if (typeof quote !== 'string') return null
  const raw = quote.trim()
  if (!raw || !text) return null
  const bare = raw.replace(WRAP, '').trim()
  for (const q of [raw, bare]) {
    if (!q) continue
    const r = findQuote(text, q)
    if (r) return text.slice(r.start, r.end)
  }
  // Pieces joined with "...": the longest that is in the scene (a few words at least, so it means something).
  const parts = bare
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((p) => p.trim())
    .filter((p) => wordCount(p) >= 3)
    .sort((a, b) => b.length - a.length)
  if (parts.length < 2) return null
  for (const p of parts) {
    const r = findQuote(text, p)
    if (r) return text.slice(r.start, r.end)
  }
  return null
}

/** True when the words are still in the text (with the same allowances as sceneQuote's first step). */
export const stillThere = (text: string, quote: string): boolean => !quote.trim() || !!findQuote(text, quote) || !!findQuote(text, quote.replace(WRAP, ''))

/** A quote made plain for a key: plain quotes, one space, lower case, no punctuation at either end, at most 160 characters. */
export function plainQuote(quote: string): string {
  return plain(quote)
    .replace(/^[\s"'.,;:!?()[\]-]+|[\s"'.,;:!?()[\]-]+$/g, '')
    .slice(0, 160)
}

/** The issue kind a check's findings are stored under. */
export const KIND_OF_CHECK: Record<CheckKind, IssueKind> = {
  facts: 'fact',
  knowledge: 'knowledge',
  timeline: 'timeline',
  voice: 'voice',
  style: 'style'
}

/** The key of an AI check's issue: `check:<check>:<what it is about>:<the quote, plain>`. */
export const issueKey = (check: CheckKind | 'story', about: string, quote: string): string => `check:${check}:${about || '-'}:${plainQuote(quote)}`

/** Where the quote is in the text (for showing a scene's issues in reading order); Infinity when it isn't. */
export function quoteAt(text: string, quote: string): number {
  if (!quote.trim()) return Infinity
  return findQuote(text, quote)?.start ?? Infinity
}
