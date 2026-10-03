// Quotes and keys for consistency issues (milestone 5, AI checks). Pure, no Electron imports.
// - A quote from the check model counts only when its words are in the scene: exactly, or with other
//   quotation marks, dashes, capitals or spacing, or (when the model joined pieces with "...") its longest
//   piece. What is kept is always the scene's own text, cut out exactly.
// - An issue's key is its check, what it is about (an entry, an earlier scene, another story) and its quote
//   made plain, so the same thing found again is the same issue, and an ignored one is never raised again.
//   Reworded or requoted, it is still the same issue when its quote overlaps (quotesOverlap; see
//   db/checks.ts saveFound).

import type { CheckKind, IssueKind } from '@shared/contracts/checks'
import { findQuote, plain, plainWithMap, wordCount } from '../keeper/text'

/** Quotation marks a model wraps the words in. */
const WRAP = /^["“”'‘’«»]+|["“”'‘’«»]+$/g

/**
 * Where a quote from the check model is in the scene: the scene's own words, where they start, and whether
 * they are the model's whole quote (false when only the longest piece of "A ... B" was found). Null when
 * the words aren't in the scene.
 */
export function findSceneQuote(text: string, quote: unknown): { quote: string; start: number; whole: boolean } | null {
  if (typeof quote !== 'string') return null
  const raw = quote.trim()
  if (!raw || !text) return null
  const bare = raw.replace(WRAP, '').trim()
  for (const q of [raw, bare]) {
    if (!q) continue
    const r = findQuote(text, q)
    if (r) return { quote: text.slice(r.start, r.end), start: r.start, whole: true }
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
    if (r) return { quote: text.slice(r.start, r.end), start: r.start, whole: false }
  }
  return null
}

/** The scene's own words for a quote from the check model, or null when they aren't in the scene. */
export const sceneQuote = (text: string, quote: unknown): string | null => findSceneQuote(text, quote)?.quote ?? null

/**
 * Which of the quote's appearances in the text starts at `start` (0 for the first), so the page can find the
 * same words when they appear more than once.
 */
export function occurrenceAt(text: string, quote: string, start: number): number {
  const t = plainWithMap(text)
  const q = plain(quote)
  if (!q) return 0
  let n = 0
  for (let i = t.plain.indexOf(q); i >= 0; i = t.plain.indexOf(q, i + 1)) {
    if (t.from[i] >= start) return n
    n++
  }
  return 0
}

/** True when two quotes overlap: either, made plain, holds the other. Empty quotes never do. */
export function quotesOverlap(a: string, b: string): boolean {
  const x = plainQuote(a)
  const y = plainQuote(b)
  return !!x && !!y && (x.includes(y) || y.includes(x))
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
