// Plain waits (the calm overhaul, 2026-10-19: a draft said "Getting ready…" for a minute and more while the memory caught
// up, the scene was planned and things were looked up). The status line names each step before the first word, in
// Adam's words, and keeps calm: a step over in less than CALM_MS is never shown, so nothing flickers. Pure, so it is
// unit-tested; useDraftWait.ts follows the draft's steps ('draft:step') and the memory's catching up.
import type { DraftStep } from '@shared/contracts/calm'
import type { MemoryStatus } from '@shared/types'
import { memoryFor, memoryWords } from '@/features/consistency/runsLogic'

/** A step must last this long before the status line names it. */
export const CALM_MS = 300

/** What the status line says for a draft before its first word, and its hover. */
export function draftWaitWords(
  step: Pick<DraftStep, 'step' | 'count'> | null,
  memory: Pick<MemoryStatus, 'catchingUp' | 'reading'> | null | undefined,
  sceneId: string
): { words: string; title: string } {
  switch (step?.step) {
    case 'memory':
      return {
        words: memoryWords(memoryFor(memory, sceneId)),
        title: 'Bringing the memory up to date with the scenes before this one first, so the draft knows what happened in them.'
      }
    case 'gathering':
      return { words: 'Gathering what the scene needs…', title: 'Putting the scene card, the memory and the story so far together for the writer.' }
    case 'plan':
      return { words: 'Planning the scene…', title: 'The scene is planned before it is written, so the draft does what the scene card asks.' }
    case 'lookups': {
      const n = step.count ?? 0
      return {
        words: n > 0 ? `Looking up ${n} ${n === 1 ? 'thing' : 'things'}…` : 'Looking things up…',
        title: 'Looking up details in the story for the plan: who was where, what they carry, what was said.'
      }
    }
    case 'writing':
      return { words: 'Writing…', title: 'The writer model has the scene; its first words are on their way.' }
    default:
      // Before the first step is heard: the memory may already be reading.
      return memory?.reading
        ? { words: memoryWords(memoryFor(memory, sceneId)), title: 'Bringing the memory up to date first, so the draft knows what happened.' }
        : { words: 'Getting ready…', title: 'Getting the draft ready.' }
  }
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
