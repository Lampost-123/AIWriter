// "Interview me" on a scene card or a chapter: what the AI's answer puts in the card (only the parts
// still empty, so nothing Adam wrote changes), how Undo takes it out again (only what is still as it was
// put in), and the words the interview shows. Pure, so it is unit-tested; planInterviewStore.ts uses it.

import type { SceneFillParts } from '@shared/contracts/outline'
import type { SceneCard } from '@shared/types'

/** The card's parts the interview fills, in the order they are named. */
const PARTS: { key: keyof SceneFillParts; name: string }[] = [
  { key: 'beats', name: 'beats' },
  { key: 'goal', name: 'goal' },
  { key: 'conflict', name: 'conflict' },
  { key: 'outcome', name: 'outcome' },
  { key: 'mood', name: 'mood' },
  { key: 'povId', name: 'point of view' },
  { key: 'presentIds', name: 'characters present' },
  { key: 'locationId', name: 'location' }
]

/** Whether this part of the card has nothing in it. */
function isEmpty(card: SceneCard, key: keyof SceneFillParts): boolean {
  const v = card[key]
  if (Array.isArray(v)) return !v.some((x) => String(x).trim())
  if (typeof v === 'string') return !v.trim()
  return v == null
}

/** Whether a fill part says anything. */
function hasWords(v: unknown): boolean {
  if (Array.isArray(v)) return v.some((x) => String(x).trim())
  if (typeof v === 'string') return !!v.trim()
  return v != null
}

/** What goes in the card: each part the AI filled whose place on the card is still empty, and those parts' names. */
export function fillOnCard(card: SceneCard, fill: SceneFillParts): { patch: Partial<SceneCard>; names: string[] } {
  const patch: Partial<SceneCard> = {}
  const names: string[] = []
  for (const { key, name } of PARTS) {
    const v = fill[key]
    if (!hasWords(v) || !isEmpty(card, key)) continue
    ;(patch as Record<string, unknown>)[key] = v
    names.push(name)
  }
  return { patch, names }
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** Undo: the parts the fill put in that are still as it put them go back to empty; anything changed since stays. */
export function unfill(card: SceneCard, patch: Partial<SceneCard>): Partial<SceneCard> {
  const back: Partial<SceneCard> = {}
  for (const [key, v] of Object.entries(patch) as [keyof SceneCard, unknown][]) {
    if (!same(card[key], v)) continue
    ;(back as Record<string, unknown>)[key] = Array.isArray(v) ? [] : key === 'povId' || key === 'locationId' ? null : ''
  }
  return back
}

/** "the goal, conflict and beats" */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** The toast after the card is filled in. */
export function filledMessage(names: string[]): string {
  if (!names.length) return 'Your scene card already had everything your answers covered, so nothing changed.'
  return `Filled in the ${listNames(names)} from your answers.`
}

/** The note under the answer box: how answers are used, then how many there are. */
export function planNote(kind: 'scene' | 'chapter', answered: number): string {
  if (answered <= 0) {
    return kind === 'scene'
      ? 'When you’re done, your answers fill in the empty parts of the card.'
      : 'When you’re done, your answers become the chapter’s goal and scene cards.'
  }
  return `${answered === 1 ? '1 answer' : `${answered} answers`} so far.`
}

/** The line shown while the AI thinks of the next question. */
export function askingLine(kind: 'scene' | 'chapter', number: number): string {
  if (number > 1) return 'Thinking of the next question…'
  return kind === 'scene' ? 'Reading the scene card…' : 'Reading the chapter…'
}
