// Who was there (World Memory Overhaul B5, 2026-10-08): the people on stage at one paragraph of a scene, so that when
// something is said or happens there, everyone who was there is marked as knowing it (keeper/apply.ts), and "X does
// not know it" can be told to the writer only when it rests on that (or on Adam). On stage at a paragraph:
// - the people on the scene card (point of view and those present),
// - and anyone named in that paragraph or the two before it (someone who walks in, or speaks),
// - but not someone who left or died at an earlier paragraph of the scene (a change read there says so).
// Only people: never an animal (mustStay.ts isPerson). Words said in a whisper or aside reach only those the memory
// model says heard them. Pure.

import type { EntryState, ID } from '@shared/types'
import type { Para } from './text'
import { isPerson, namesPerson } from '../ai/mustStay'

/** How many paragraphs before this one a name still puts someone on stage. */
export const NAMED_BEFORE = 2

/** Words said so only some of those there hear them. */
export const WHISPERED = /\b(whisper\w*|murmur\w*|under (?:his|her|their) breath|aside to|mouthed|into (?:his|her|their) ear)\b/i

/** A note saying someone left the place (not a thing they left behind) or died. */
export const LEFT_OR_DIED =
  /\b(?:left|leaves) (?:the (?:room|house|inn|hall|tavern|yard|kitchen|building|camp|ship|city|town|village|chapel|cottage|shop)|for|through|by|home|town)\b|\b(?:went|goes|walked|walks|ran|runs|stormed|storms|slipped|slips|hurried|hurries|stepped|steps) (?:out|off|away)\b|\b(?:departed|departs|fled|flees|rode (?:off|away|out)|set off|sets off)\b|\b(?:died|dies|is dead|was killed|is killed)\b/i

export type Person = Pick<EntryState, 'id' | 'name' | 'kind'> & Partial<Pick<EntryState, 'aliases' | 'summary' | 'tags' | 'fields'>>

export interface StageInput {
  paras: Para[]
  /** The paragraph the words are in. */
  index: number
  /** The scene card's point of view and those present. */
  onCard: ID[]
  /** Everyone who could be there: the characters at this scene. */
  people: Person[]
  /** People who left or died at a paragraph of this scene, with its index. */
  gone: { id: ID; index: number }[]
}

/** The people on stage at a paragraph, card first, then in the order given. */
export function onStageAt(o: StageInput): ID[] {
  const people = o.people.filter(isPerson)
  const near = o.paras.slice(Math.max(0, o.index - NAMED_BEFORE), o.index + 1).map((p) => p.text)
  const left = new Set(o.gone.filter((g) => g.index < o.index).map((g) => g.id))
  const card = new Set(o.onCard)
  const out: ID[] = []
  for (const p of people) if (card.has(p.id) && !left.has(p.id)) out.push(p.id)
  for (const p of people) {
    if (out.includes(p.id) || left.has(p.id)) continue
    if (near.some((t) => namesPerson(t, { name: p.name, aliases: p.aliases ?? [] }))) out.push(p.id)
  }
  return out
}

/** The index of the paragraph holding a spot (by its paragraph id, or by where it starts in the scene's plain text). */
export function paraIndexOf(paras: Para[], spot: { paragraphId: string | null; start: number }): number {
  if (spot.paragraphId) return paras.findIndex((p) => p.pid === spot.paragraphId)
  return paras.findIndex((p) => p.offset != null && spot.start >= p.offset && spot.start <= p.offset + p.text.length)
}
