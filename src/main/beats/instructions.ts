// What Beat by beat adds to a draft's briefing (milestone 4): the closing instruction that asks for one
// beat of the scene card, and the scene so far that the beat carries on from. The rest of the briefing
// is Generate's own (draftBriefing), so a beat knows everything a draft would. Pure, so it is tested
// without Electron (instructions.test.ts).
//
// The scene's own text is never in a draft's briefing (the previous scene and the story so far stop
// before it), so the scene so far goes in as a block of its own, once, right above the closing
// instruction, and never shortened by the briefing's fitting: a small model gets only its later part.

import type { SoFarEnd } from '@shared/contracts/beats'
import type { FinalOptions } from '../ai/prompts'
import { indentMore, lengthLine, repeatedLine } from '../ai/prompts'
import { DEFAULT_CONTEXT_LENGTH, sceneTail, TOKENS_PER_WORD } from '../ai/context'
import { MIN_TARGET_WORDS } from '../ai/gather'

/** Adam's note for a beat is kept to this many characters. */
export const MAX_STEER_CHARS = 2000

/** The scene card's beats as the briefing numbers them: blank ones left out. */
export const cardBeats = (beats: readonly string[]): string[] => beats.map((b) => b.trim()).filter(Boolean)

/** Each beat's share of the scene's length, in words, to the nearest ten (never under the shortest draft asked for). */
export function beatWords(sceneWords: number, of: number): number {
  const share = sceneWords / Math.max(1, of)
  return Math.max(MIN_TARGET_WORDS, Math.round(share / 10) * 10)
}

/** Adam's note for a beat, tidied: trimmed and kept to a sensible length. */
export const tidySteer = (steer: unknown): string => (typeof steer === 'string' ? steer.trim().slice(0, MAX_STEER_CHARS).trim() : '')

/**
 * How much of the scene so far is sent, in words: about a quarter of the writer model's window,
 * between 400 and 3,500 words (plenty to carry on from, while leaving the rest of the briefing room).
 */
export function soFarLimit(contextLength: number | null): number {
  const length = contextLength && contextLength > 0 ? contextLength : DEFAULT_CONTEXT_LENGTH
  return Math.round(Math.min(3500, Math.max(400, (length * 0.25) / TOKENS_PER_WORD)))
}

export const SO_FAR_BLOCK = 'scene-so-far'

/**
 * The scene so far as a block of the briefing: all of it, or (a long scene and a small model) its
 * later part, starting at a paragraph. Null when there is nothing on the page to carry on from.
 */
export function soFarBlock(text: string, contextLength: number | null): { id: string; title: string; text: string } | null {
  const t = text.trim()
  if (!t) return null
  const max = soFarLimit(contextLength)
  const tail = sceneTail(t, { min: Math.round(max * 0.6), target: Math.round(max * 0.85), max })
  return tail === t
    ? { id: SO_FAR_BLOCK, title: 'The scene so far', text: t }
    : { id: SO_FAR_BLOCK, title: 'End of the scene so far', text: tail }
}

/** What the closing instruction for one beat needs besides the usual closing's options. */
export interface BeatAsk {
  /** Which beat, from 1. */
  index: number
  /** The scene card's beats (cardBeats). */
  beats: string[]
  /** Adam's note for this beat (tidySteer), or ''. */
  steer: string
  /** The briefing has the scene so far (soFarBlock), which this beat carries on from. */
  hasSoFar: boolean
  /** How the scene so far ends: with the beat before (the default), part-way through it, or with Adam's own words after it. */
  soFarEnds?: SoFarEnd
}

/** What the closing instruction says of the beat before this one. */
function beforeNote(ask: BeatAsk): string {
  if (!ask.hasSoFar) return 'already happened'
  if (ask.soFarEnds === 'mid-beat') return 'begun, but it stopped part-way: the scene so far ends in the middle of it'
  if (ask.soFarEnds === 'after-beat') return "already written, and the author's own writing comes after it at the end of the scene so far"
  return 'already written: the scene so far ends with it'
}

const lowerFirst = (s: string): string => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s)

function joinAnd(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/**
 * The closing instruction for one beat, in place of "Write the scene now": write beat i of n and only
 * that beat (quoted, with the beats either side of it for orientation, and Adam's note for it), carry
 * on seamlessly from the scene so far, and stop at the end of the beat. The last beat ends the scene.
 */
export function beatInstruction(o: FinalOptions, ask: BeatAsk): string {
  const n = ask.beats.length
  const i = Math.min(Math.max(1, ask.index), Math.max(1, n))
  const beat = (k: number): string => indentMore(ask.beats[k - 1] ?? '', '  ')
  const last = i === n
  const only = n === 1

  const head = only
    ? 'Write the scene now. The scene card has one beat:'
    : last
      ? `Write only the last beat of the scene now: beat ${i} of the ${n} on the scene card.`
      : `Write only the ${i === 1 ? 'first beat' : 'next beat'} of the scene now: beat ${i} of the ${n} on the scene card. The beats after it will be written later, one at a time.`

  const where: string[] = []
  if (only) where.push(`- ${beat(1)}`)
  else {
    if (i > 1) where.push(`- Beat ${i - 1} (${beforeNote(ask)}): ${beat(i - 1)}`)
    where.push(`- Beat ${i} (write this one now): ${beat(i)}`)
    if (!last) where.push(`- Beat ${i + 1} (comes next: leave it for later): ${beat(i + 1)}`)
  }

  const parts = only ? [`${head}\n${where[0]}`] : [head, where.join('\n')]
  if (ask.steer) parts.push(`The author's note for this beat: ${indentMore(ask.steer)}`)

  const lines: string[] = []
  if (ask.hasSoFar) {
    lines.push(
      "- Carry on seamlessly from the very end of the scene so far, as if there had been no pause. Don't repeat, recap or rewrite any of it."
    )
    if (i > 1 && ask.soFarEnds === 'mid-beat') {
      lines.push(`- First bring beat ${i - 1} to its end in a few lines, from where the scene so far stops, then write this beat.`)
    }
    if (o.hasStand) {
      lines.push(
        '- Keep to where things stand at the end of the scene so far: where each person is, what they wear and how it sits, how they are placed and what they hold. Anything that changes, changes on the page.'
      )
    }
  } else if (i === 1) {
    const other = o.previousStory
    if (o.hasPrevious && other) {
      const gap = other.timeGap ? ` Time since then: ${other.timeGap.replace(/\.$/, '')}.` : ''
      const what = other.ended ? `is how ${other.title} ended` : `is where ${other.title} had got to`
      lines.push(
        `- The previous scene ${what}, not part of this story. Don't continue it seamlessly or recap it: open this story in its own right.${gap}`
      )
    } else if (o.hasPrevious) {
      lines.push(
        `- ${only ? 'Continue' : 'Open the scene with this beat, continuing'} seamlessly from where the previous scene ends. Don't repeat or recap it.`
      )
    } else if (!only) lines.push('- Open the scene with this beat.')
  } else lines.push('- Start the page with this beat, as if the beats before it had just happened.')
  if (only) lines.push('- Write the whole scene around that beat, from its first line to its last.')
  else if (last) lines.push('- Write what happens in this beat, and end the scene with it.')
  else lines.push(`- Write what happens in this beat, then stop at its end: don't begin beat ${i + 1}, and don't round the scene off.`)
  if (ask.steer) lines.push("- Follow the author's note for this beat.")
  lines.push(
    '- Prose only, in plain text with *asterisks* only for italics: no title, no headings, no beat numbers, no notes or comments before or after.'
  )
  lines.push(lengthLine(o))
  const keep: string[] = []
  if (o.style.pov) keep.push(lowerFirst(o.style.pov))
  if (o.style.tense) keep.push(lowerFirst(o.style.tense))
  if (o.style.spelling) keep.push(`${o.style.spelling} spelling`)
  lines.push(keep.length ? `- Keep to ${joinAnd(keep)}.` : '- Keep the point of view and tense steady throughout.')
  if (o.hasBringAbout && last)
    lines.push('- By the end of this beat, the scene should have brought about what the scene card says it should.')
  const repeated = repeatedLine(o.repeated)
  if (repeated) lines.push(repeated)
  if (o.hasDirection) lines.push("- Follow the author's direction for this draft.")
  lines.push('- Never contradict the facts given above.')
  parts.push(lines.join('\n'))
  return parts.join('\n\n')
}

/**
 * The direction kept with a beat's record (shown in "What the AI saw"): the scene's direction for the
 * draft, and Adam's note for this beat.
 */
export function beatDirection(direction: string, steer: string): string {
  const d = direction.trim()
  const s = steer.trim()
  if (!s) return d
  if (!d) return `For this beat: ${s}`
  return `${/[.!?…]["'”’)\]]*$/.test(d) ? d : `${d}.`} For this beat: ${s}`
}
