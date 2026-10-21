// Settings › Models says how much a model reads, and what it costs, in words (the Words rule: never "tokens").
// Models count in tokens, pieces of words: English prose comes to about three words for every four tokens.
// Pure, so it is unit-tested (words.test.ts).
import { pricePerMillion } from '@/features/generate/format'

export const WORDS_PER_TOKEN = 0.75

/** Roughly how many words a number of tokens holds, rounded to two figures (128,000 -> 96,000; 32,768 -> 25,000). */
export function wordsFor(tokens: number): number {
  const words = tokens * WORDS_PER_TOKEN
  if (!Number.isFinite(words) || words <= 0) return 0
  const unit = 10 ** Math.max(0, Math.floor(Math.log10(words)) - 1)
  return Math.round(words / unit) * unit
}

/** "about 96,000 words", "about 1.5 million words". */
export function aboutWords(tokens: number): string {
  const words = wordsFor(tokens)
  if (words >= 1_000_000) return `about ${(words / 1_000_000).toFixed(1).replace(/\.0$/, '')} million words`
  return `about ${words.toLocaleString('en-GB')} words`
}

/** The short form for a narrow column: "96K", "1.5M". */
export function shortWords(tokens: number | null | undefined): string {
  if (!tokens) return '—'
  const words = wordsFor(tokens)
  if (words >= 1_000_000) return `${(words / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (words >= 1000) return `${Math.round(words / 1000)}K`
  return String(words)
}

/** A per-token price as dollars for a million words: "$4", "$0.36", "Free". */
export const pricePerMillionWords = (perToken: number | null | undefined): string =>
  pricePerMillion(perToken == null ? perToken : perToken / WORDS_PER_TOKEN)
