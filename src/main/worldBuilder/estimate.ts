// Roughly what a build would cost, before it starts: how many requests a summary this long, naming about
// this many things, takes, and how long each is. Said as "About $0.12", since the names are only counted
// from the summary's capitalised words and replies vary. Unknown (null) when the model's prices aren't
// known. Pure.

import type { ModelChoice, ThinkingLevel } from '@shared/types'
import { estimateTokens, sentences } from '../keeper/text'
import { splitSummary } from './parse'
import { BATCH_ITEM_TOKENS, BATCH_MOST, NAMES_TOKENS, replyRoom, summaryRoom, worldRoom } from './sizes'

/** Capitalised words that aren't names: sentence starts, pronouns, days and the like. */
const NOT_NAMES = new Set(
  `a an the and but or so if when while after before then there here this that these those it its he she they we you i his her hers their
  them him my our your who whom whose what where why how which in on at of to from by with without for as into over under once each every some no not one two three all most
  many few book chapter part act scene story world summary meanwhile later now soon years year months days long monday tuesday wednesday
  thursday friday saturday sunday january february march april may june july august september october november december`.split(/\s+/)
)

/** The distinct names a summary seems to use: runs of capitalised words, leaving out ordinary words that start sentences. */
export function guessNames(summary: string): string[] {
  const seen = new Map<string, string>()
  for (const s of sentences(summary)) {
    const words = s.split(/\s+/).map((w) => w.replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, '').replace(/['’]s$/u, ''))
    let run: string[] = []
    const flush = (): void => {
      while (run.length && NOT_NAMES.has(run[0].toLowerCase())) run.shift()
      const name = run.join(' ')
      if (name && name.length > 1) seen.set(name.toLowerCase(), name)
      run = []
    }
    for (const w of words) {
      if (/^\p{Lu}/u.test(w)) run.push(w)
      else flush()
    }
    flush()
  }
  return [...seen.values()]
}

/** How much more a model writes when asked to think (its thinking is paid for too). */
const THINKING_COST: Record<ThinkingLevel, number> = { off: 1, auto: 1.5, low: 1.5, medium: 2, high: 3 }

/** About how long each request's instructions are, in tokens. */
const INSTRUCTIONS = { overview: 900, character: 1300, batch: 1100, relationships: 600, themes: 250, check: 500 }

export interface BuildGuess {
  /** Requests the first look takes (one for each part of the summary). */
  parts: number
  characters: number
  /** Everything else that would be laid out. */
  others: number
  /** Input and output tokens, all requests together. */
  input: number
  output: number
}

/** About how many requests a build makes and how long they are. `existing`: entries already in the world. */
export function guessBuild(
  summary: string,
  choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>,
  existing: number,
  thinking: ThinkingLevel
): BuildGuess {
  const text = summary.trim()
  const tokens = estimateTokens(text)
  const names = guessNames(text).length
  // Some of what is named is already in the world; lore, events and plot threads are often unnamed.
  const fresh = Math.max(0, names - Math.min(existing, Math.floor(names / 2)))
  const characters = Math.max(text ? 1 : 0, Math.round(fresh * 0.45))
  const others = Math.max(0, fresh - characters) + Math.ceil(sentences(text).length / 5)
  const namesIn = Math.min(existing * 8, NAMES_TOKENS)
  const parts = splitSummary(text, summaryRoom(choice, 'overview', INSTRUCTIONS.overview + namesIn)).length
  const worldIn = Math.min(existing * 40, worldRoom(choice, 'character'))
  const about = (job: 'character' | 'places'): number => Math.min(tokens, summaryRoom(choice, job, INSTRUCTIONS.batch + worldIn))
  const batches = Math.ceil(others / BATCH_MOST)
  let input = (INSTRUCTIONS.overview + namesIn) * parts + tokens
  input += characters * (INSTRUCTIONS.character + worldIn + about('character'))
  input += batches * (INSTRUCTIONS.batch + worldIn + about('places'))
  input += INSTRUCTIONS.relationships + INSTRUCTIONS.themes + 2 * tokens
  if (existing) input += INSTRUCTIONS.check + tokens + Math.min(existing * 60, 3000)
  let output = parts * (150 + names * 50) + characters * Math.min(1600, replyRoom(choice, 'character'))
  output += others * Math.min(BATCH_ITEM_TOKENS / 2, replyRoom(choice, 'places'))
  output += 100 + characters * 40 + 150 + (existing ? 250 : 0)
  return { parts, characters, others, input, output: Math.round(output * THINKING_COST[thinking]) }
}

/** USD, or null when the model's prices aren't known. */
export function estimateCost(
  g: Pick<BuildGuess, 'input' | 'output'>,
  choice: Pick<ModelChoice, 'promptPrice' | 'completionPrice'>
): number | null {
  if (choice.promptPrice == null || choice.completionPrice == null) return null
  return g.input * choice.promptPrice + g.output * choice.completionPrice
}
