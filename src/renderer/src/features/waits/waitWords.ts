// Plain waits (the calm overhaul, 2026-10-19: a draft said "Getting ready…" for a minute and more while the memory caught
// up, the scene was planned and things were looked up). The status line names each step before the first word, in
// Adam's words, and keeps calm: a step over in less than CALM_MS is never shown, so nothing flickers. Pure, so it is
// unit-tested; useDraftWait.ts follows the draft's steps ('draft:step') and the memory's catching up.
import type { DraftStep } from '@shared/contracts/calm'
import type { MemoryStatus } from '@shared/types'
import { memoryFor, memoryWords } from '@/features/consistency/runsLogic'

/** A step must last this long before the status line names it. */
export const CALM_MS = 300

/** Each look-up (main ai/lookups) as the status line says it, in Adam's words. */
const LOOKUP_WORDS: Record<string, string> = {
  state_of: 'where everyone is',
  last_seen: 'where everyone is',
  where_is: 'where things are',
  who_was_there: 'who was there',
  who_knows: 'who knows what',
  open_threads: 'the open plot threads',
  what_happened: 'what happened before',
  read_passage: 'what happened before',
  find_in_story: 'earlier scenes',
  timeline: 'when things happened',
  get_entry: 'the codex'
}

/** "where everyone is and who knows what": the first two things looked up, in Adam's words ('' for none known). */
export function lookupWords(names: readonly string[]): string {
  const said = [...new Set(names.map((n) => LOOKUP_WORDS[n]).filter((w): w is string => !!w))]
  if (!said.length) return ''
  return said.length === 1 ? said[0] : `${said[0]} and ${said[1]}`
}

/**
 * What the status line says for a draft before its first word, the same in fewer words for a small room (the scene
 * header: "Memory: 3 of 5"), and its hover.
 */
export function draftWaitWords(
  step: Pick<DraftStep, 'step' | 'count' | 'about'> | null,
  memory: Pick<MemoryStatus, 'catchingUp' | 'reading'> | null | undefined,
  sceneId: string,
  o: { review?: boolean } = {}
): { words: string; short: string; title: string } {
  // Show me the plan first (features/planReview): the plan waits for Adam, and nothing is written until he answers.
  if (o.review) {
    return {
      words: 'The plan is ready for you to read',
      short: 'Plan ready for you',
      title: 'The scene is planned. Read the plan, change it if you like, then Write (or Cancel).'
    }
  }
  switch (step?.step) {
    case 'memory': {
      const m = memoryFor(memory, sceneId)
      return {
        words: memoryWords(m),
        short: shortMemoryWords(m),
        title: 'Bringing the memory up to date with the scenes before this one first, so the draft knows what happened in them.'
      }
    }
    case 'gathering':
      return {
        words: 'Gathering what the scene needs…',
        short: 'Gathering notes…',
        title: 'Putting the scene card, the memory and the story so far together for the writer.'
      }
    case 'plan':
      return { words: 'Planning the scene…', short: 'Planning the scene…', title: 'The scene is planned before it is written, so the draft does what the scene card asks.' }
    case 'lookups': {
      const n = step.count ?? 0
      const counted = n > 0 ? `Looking up ${n} ${n === 1 ? 'thing' : 'things'}…` : 'Looking things up…'
      // What it looks up, in Adam's words (the Plan hub's fold-in, 2026-10-20): "Planning the scene: looking up where
      // everyone is and who knows what…". With nothing said of what, the count as before.
      const what = lookupWords(step.about ?? [])
      const words = what ? `Planning the scene: looking up ${what}…` : counted
      return { words, short: counted, title: 'Looking up details in the story for the plan: who was where, what they carry, what was said.' }
    }
    case 'writing':
      return { words: 'Writing…', short: 'Writing…', title: 'The writer model has the scene; its first words are on their way.' }
    default: {
      // Before the first step is heard: the memory may already be reading.
      if (!memory?.reading) return { words: 'Getting ready…', short: 'Getting ready…', title: 'Getting the draft ready.' }
      const m = memoryFor(memory, sceneId)
      return { words: memoryWords(m), short: shortMemoryWords(m), title: 'Bringing the memory up to date first, so the draft knows what happened.' }
    }
  }
}

/** "Memory: 3 of 5", "Updating memory…": the memory's catching up in fewer words. */
function shortMemoryWords(m: { done: number; total: number; stage: 'earlier' | 'scene' } | null): string {
  if (!m || m.stage === 'scene' || m.total <= 1) return 'Updating memory…'
  return `Memory: ${Math.min(m.done + 1, m.total)} of ${m.total}`
}

/** The calm line: what shows, and a newer text waiting to have lasted CALM_MS. */
export interface Calm {
  shown: string
  next: { text: string; since: number } | null
}

/**
 * The line after `text` was asked for at `now`: a new text shows once it has lasted `ms` (one replaced sooner never shows);
 * going back to what shows cancels the wait. The first text shows at once.
 */
export function calmStep(c: Calm | null, text: string, now: number, ms = CALM_MS): Calm {
  if (!c) return { shown: text, next: null }
  if (text === c.shown) return c.next ? { shown: c.shown, next: null } : c
  if (c.next?.text === text) return now - c.next.since >= ms ? { shown: text, next: null } : c
  return { shown: c.shown, next: { text, since: now } }
}
