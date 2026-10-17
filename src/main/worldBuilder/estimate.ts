// Roughly what a build would cost, before it starts: how many requests a summary this long, naming about
// this many things, takes, and how long each is. Said as "About $0.12", since the names are only counted
// from the summary's capitalised words and replies vary. Unknown (null) when the model's prices aren't
// known. Since 2026-10-17 it counts the filling in and the voices too, leaves out the themes request when the
// story gives them and the check when no page is Adam's, and takes the cache off only at a price the provider
// gives (none do yet, so it errs high). Pure.

import type { ModelChoice, ThinkingLevel } from '@shared/types'
import { estimateTokens, sentences } from '../keeper/text'
import { splitSummary } from './parse'
import { BATCH_ITEM_TOKENS, BATCH_MOST, NAMES_TOKENS, OVERVIEW_PART_TOKENS, replyRoom, summaryRoom, worldRoom } from './sizes'

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
  /** Thin pages filled in at the end, one request each. */
  fills: number
  /** Input and output tokens, all requests together. */
  input: number
  output: number
  /** Of `input`, about how much opens a request the same way as the one before (the shared system message and summary). */
  cached: number
}

/** What the world tells the estimate, besides the summary (run.ts estimateFacts). */
export interface BuildWorld {
  /** Entries already in the world (name-only pages an outline made aren't counted: the build lays those out). */
  existing: number
  /** Pages Adam wrote or read from his scenes: with none, the check against the world isn't asked for. All when not known. */
  his?: number
  /** The world's themes and tone are set already, or the story gives them: no request for them. */
  themesKnown?: boolean
  /** Thin pages the build would fill in (the pages laid out that come back thin aren't known before). */
  thin?: number
}

/** The shared system message every request opens with (prompts.ts worldSystem), and the fill's own instructions, about. */
const SYSTEM_TOKENS = 70
const FILL_INSTRUCTIONS = 450
const FILL_REPLY = 900
/** Read aloud's voices: one request for every VOICES_TOGETHER characters (readAloud/autoVoice.ts). */
const VOICES_TOGETHER = 12
const VOICE_INSTRUCTIONS = 350
const VOICE_EACH = 300
const VOICE_REPLY_EACH = 80

/** About how many requests a build makes and how long they are. `world`: entries already in the world (or what run.ts estimateFacts says). */
export function guessBuild(
  summary: string,
  choice: Pick<ModelChoice, 'contextLength' | 'maxOutput'>,
  world: number | BuildWorld,
  thinking: ThinkingLevel
): BuildGuess {
  const w: BuildWorld = typeof world === 'number' ? { existing: world } : world
  const existing = w.existing
  const his = w.his ?? existing
  const thin = w.thin ?? 0
  const text = summary.trim()
  const tokens = estimateTokens(text)
  const names = guessNames(text).length
  // Some of what is named is already in the world; lore, events and plot threads are often unnamed.
  const fresh = Math.max(0, names - Math.min(existing, Math.floor(names / 2)))
  const characters = Math.max(text ? 1 : 0, Math.round(fresh * 0.45))
  const others = Math.max(0, fresh - characters) + Math.ceil(sentences(text).length / 5)
  const namesIn = Math.min(existing * 8, NAMES_TOKENS)
  const parts = splitSummary(text, Math.min(OVERVIEW_PART_TOKENS, summaryRoom(choice, 'overview', INSTRUCTIONS.overview + namesIn))).length
  const worldIn = Math.min(existing * 40, worldRoom(choice, 'character'))
  const about = (job: 'character' | 'places'): number => Math.min(tokens, summaryRoom(choice, job, INSTRUCTIONS.batch + worldIn))
  const batches = Math.ceil(others / BATCH_MOST)
  const themes = !w.themesKnown
  const check = his > 0
  const voices = Math.ceil((characters + thin) / VOICES_TOGETHER)
  const requests = 2 * parts + characters + batches + 1 + (themes ? 1 : 0) + (check ? 1 : 0) + thin
  // Each part is read twice: the first look, then again for anything it left out (with what it listed).
  let input = 2 * ((INSTRUCTIONS.overview + namesIn) * parts + tokens) + names * 10
  input += characters * (INSTRUCTIONS.character + worldIn + about('character'))
  input += batches * (INSTRUCTIONS.batch + worldIn + about('places'))
  input += INSTRUCTIONS.relationships + tokens
  if (themes) input += INSTRUCTIONS.themes + tokens
  if (check) input += INSTRUCTIONS.check + tokens + Math.min(existing * 60, 3000)
  input += thin * (FILL_INSTRUCTIONS + Math.min(existing * 40, 1500) + Math.min(tokens, 1500))
  input += requests * SYSTEM_TOKENS
  input += voices * VOICE_INSTRUCTIONS + (characters + thin) * VOICE_EACH
  let output = parts * (250 + names * 50) + characters * Math.min(1600, replyRoom(choice, 'character'))
  output += others * Math.min(BATCH_ITEM_TOKENS / 2, replyRoom(choice, 'places'))
  output += 100 + characters * 40 + (themes ? 150 : 0) + (check ? 250 : 0)
  output += thin * FILL_REPLY + (characters + thin) * VOICE_REPLY_EACH
  // Every request after the first opens with the same system message, and with the whole summary when it fits whole
  // (a long one is read in parts, each request its own): what a provider's cache could read again.
  const whole = parts === 1 && tokens <= about('character')
  const cached = Math.max(0, requests - 1) * (SYSTEM_TOKENS + (whole ? tokens : 0))
  return { parts, characters, others, fills: thin, input, output: Math.round(output * THINKING_COST[thinking]), cached: Math.min(cached, input) }
}

/**
 * USD, or null when the model's prices aren't known. `cachedPrice`: what the provider charges a token it reads again
 * from its cache, when it says; without it, nothing is taken off for the cache (an estimate that errs high).
 */
export function estimateCost(
  g: Pick<BuildGuess, 'input' | 'output'> & { cached?: number },
  choice: Pick<ModelChoice, 'promptPrice' | 'completionPrice'>,
  cachedPrice: number | null = null
): number | null {
  if (choice.promptPrice == null || choice.completionPrice == null) return null
  const cached = cachedPrice != null && cachedPrice < choice.promptPrice ? Math.min(g.cached ?? 0, g.input) : 0
  return (g.input - cached) * choice.promptPrice + cached * (cachedPrice ?? 0) + g.output * choice.completionPrice
}
