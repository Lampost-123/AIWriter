// "Sticky" entries (story memory step 5): anything that was in either of the last two scenes stays in the briefing,
// even if it isn't named again, so a carried item, a wound or someone waiting outside isn't forgotten the moment the
// scene card stops naming it. Pure.

import type { EntryState, ID, SceneCard } from '@shared/types'
import { mentions } from '../ai/context'

/** How many scenes back an entry stays. */
export const STICKY_SCENES = 2

/** One of the scenes just before: its card and its words. */
export interface SceneBefore {
  card: Pick<SceneCard, 'povId' | 'presentIds' | 'locationId'> & Partial<Pick<SceneCard, 'setsUpIds' | 'paysOffIds'>>
  text: string
}

const squash = (s: string): string => s.toLocaleLowerCase().replace(/\s+/g, ' ')

/**
 * The entries in the last scenes before this one (the nearest first): those on their cards, then those named in their
 * words (by name or alias). Only entries that exist here (`entries`, as of this scene); plot threads and events only
 * from a card, since their names are rarely said in the words.
 */
export function stickyEntries(entries: Pick<EntryState, 'id' | 'kind' | 'name' | 'aliases'>[], scenes: SceneBefore[]): ID[] {
  const here = new Map(entries.map((e) => [e.id, e]))
  const out: ID[] = []
  const add = (id: ID | null | undefined): void => {
    if (id && here.has(id) && !out.includes(id)) out.push(id)
  }
  for (const s of scenes) {
    add(s.card.povId)
    for (const id of s.card.presentIds ?? []) add(id)
    add(s.card.locationId)
    for (const id of [...(s.card.setsUpIds ?? []), ...(s.card.paysOffIds ?? [])]) add(id)
  }
  for (const s of scenes) {
    const text = s.text ?? ''
    if (!text.trim()) continue
    const plain = squash(text)
    for (const e of entries) {
      if (out.includes(e.id) || e.kind === 'thread' || e.kind === 'event') continue
      const names = [e.name, ...(e.aliases ?? [])].map((n) => n.trim()).filter((n) => n.length >= 2)
      if (names.some((n) => plain.includes(squash(n)) && mentions(text, n))) out.push(e.id)
    }
  }
  return out
}
