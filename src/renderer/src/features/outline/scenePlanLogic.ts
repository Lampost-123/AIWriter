// "Plan this scene" (2026-10-19, no dead ends): what one scene's planned card, as the outline helper gives it, puts on a
// scene card that has nothing on it, and only where the card is empty, so nothing Adam wrote changes. Names are matched
// to the codex's characters and places; one it doesn't have is left out. No React, so it is unit-tested.
import type { ID, SceneCard } from '@shared/types'
import type { SuggestedScene } from './parse'

/** Finds a codex page by name (codexNames.ts pageFor), or null. */
export interface NameFinder {
  character: (name: string) => ID | null
  place: (name: string) => ID | null
}

const empty = (v: unknown): boolean => (Array.isArray(v) ? !v.some((x) => String(x).trim()) : typeof v === 'string' ? !v.trim() : v == null)

/** What goes on the card from the planned scene, and the parts' names for the toast ("goal", "beats", "When"...). */
export function planOnCard(card: SceneCard, s: SuggestedScene, find: NameFinder): { patch: Partial<SceneCard>; names: string[] } {
  const patch: Partial<SceneCard> = {}
  const names: string[] = []
  const put = <K extends keyof SceneCard>(key: K, value: SceneCard[K] | null | undefined, name: string): void => {
    if (value == null || empty(value) || !empty(card[key])) return
    patch[key] = value
    names.push(name)
  }
  const one = (v: string): string => v.replace(/\s+/g, ' ').trim()
  put('goal', one(s.summary), 'goal')
  put('beats', s.beats.map(one).filter(Boolean), 'beats')
  put('when', one(s.when), 'When')
  const pov = s.card.pov ? find.character(s.card.pov) : null
  put('povId', pov, 'point of view')
  const present = [...new Set(s.card.characters.map((n) => find.character(n)).filter((id): id is ID => !!id))]
  put('presentIds', present.length ? present : null, 'characters present')
  put('locationId', s.card.location ? find.place(s.card.location) : null, 'location')
  put('mood', one(s.card.mood), 'mood')
  return { patch, names }
}

/** "the goal, beats and When" */
export function partsWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
