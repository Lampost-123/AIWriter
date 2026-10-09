// The desk's drawings and covers (UI overhaul, D5.4): Adam's choices for the open world (src/shared/contracts/art.ts),
// loaded once per world and kept in step as he changes them, and the drawing each entry and story shows: his choice,
// else the one its words call for (src/shared/motifs.ts), no two alike where another good one fits.
import { useEffect, useMemo } from 'react'
import { create } from 'zustand'
import type { ArtChoices, StoryCoverChoice } from '@shared/contracts/art'
import { pickMotif, pickMotifs, pickStoryMotif, type MotifSource } from '@shared/motifs'
import type { EntryKind, ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

/** What an entry's drawing is picked from, and when it was made (the order drawings are handed out). */
export interface MotifEntry extends MotifSource {
  id: ID
  createdAt: string
}

interface ArtState {
  worldId: ID | null
  choices: ArtChoices
  /** The world's entries as drawings are picked from them, for the world and entries revision in `key`. */
  listed: { key: string; entries: MotifEntry[] }
}

const NONE: ArtChoices = { entries: {}, stories: {} }

export const useArt = create<ArtState>(() => ({ worldId: null, choices: NONE, listed: { key: '', entries: [] } }))

let loading: ID | null = null

/** Loads the open world's choices (once per world). Safe to use in many components. */
export function useArtChoices(): ArtChoices {
  const worldId = useApp((s) => s.world?.id ?? null)
  const state = useArt()
  useEffect(() => {
    if (!worldId || state.worldId === worldId || loading === worldId) return
    loading = worldId
    api
      .getArtChoices()
      .then((choices) => useArt.setState({ worldId, choices }))
      .catch(() => useArt.setState({ worldId, choices: NONE }))
      .finally(() => (loading = null))
  }, [worldId, state.worldId])
  return state.worldId === worldId ? state.choices : NONE
}

/** The drawing an entry shows: Adam's choice, else the one its words call for. */
export function motifOf(choices: ArtChoices, entry: MotifSource & { id: ID }): string {
  return choices.entries[entry.id]?.motif ?? pickMotif(entry)
}

/** The drawing and colour a story's cover chose, if any. */
export const coverChoice = (choices: ArtChoices, storyId: ID): StoryCoverChoice => choices.stories[storyId] ?? {}

/** The drawing a story's cover shows. */
export function storyMotif(choices: ArtChoices, story: { id: ID; title: string; premise: string }): string {
  return choices.stories[story.id]?.motif ?? pickStoryMotif(story)
}

async function save(run: () => Promise<ArtChoices>): Promise<void> {
  try {
    const choices = await run()
    useArt.setState({ worldId: useApp.getState().world?.id ?? null, choices })
  } catch (e) {
    toast((e as Error).message, { tone: 'danger' })
  }
}

/** Chooses an entry's drawing; null goes back to the one its words call for. */
export const chooseEntryMotif = (entryId: ID, motif: string | null): Promise<void> => save(() => api.setEntryMotif(entryId, motif))

/** Chooses a story's cover; null goes back to its own. */
export const chooseStoryCover = (storyId: ID, cover: StoryCoverChoice | null): Promise<void> => save(() => api.setStoryCover(storyId, cover))

/** The kinds whose drawings show on cards and portraits side by side (lore's scrolls and plot threads' cards show none). */
const SPREAD: EntryKind[] = ['character', 'place', 'group', 'item', 'event', 'glossary']

/**
 * Every entry's drawing, by id: Adam's choice, else the one its words call for. Handed out across the whole world, so no
 * two show the same drawing (in a cast, a row of cards, the gallery) while another good one fits, and each entry shows
 * the same drawing everywhere; the entry whose words call for one most keeps it (ties: the one made first). Adam's
 * choices are never changed (src/shared/motifs.ts, pickMotifs).
 */
export function entryMotifs(entries: MotifEntry[], choices: ArtChoices): Map<ID, string> {
  const chosen: Record<ID, string> = {}
  for (const [id, c] of Object.entries(choices.entries)) chosen[id] = c.motif
  const ordered = [...entries].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  const out = pickMotifs(
    ordered.filter((e) => SPREAD.includes(e.kind)),
    chosen
  )
  for (const e of ordered) if (!out.has(e.id)) out.set(e.id, chosen[e.id] ?? pickMotif(e))
  // A choice for an entry not listed yet (made a moment ago) shows at once.
  for (const [id, motif] of Object.entries(chosen)) if (!out.has(id)) out.set(id, motif)
  return out
}

/** Every entry's drawing in the open world, by id (their words read once per change to the world's entries). */
export function useEntryMotifs(): Map<ID, string> {
  const choices = useArtChoices()
  const rev = useApp((s) => s.entriesRev)
  const worldId = useApp((s) => s.world?.id ?? null)
  const listed = useArt((s) => s.listed)
  useEffect(() => {
    if (!worldId || listed.key === `${worldId}:${rev}`) return
    const key = `${worldId}:${rev}`
    api
      .listEntries()
      .then((entries) =>
        useArt.setState({
          listed: {
            key,
            entries: entries.map((e) => ({ id: e.id, kind: e.kind, name: e.name, summary: e.summary, description: e.description, fields: e.fields, createdAt: e.createdAt }))
          }
        })
      )
      .catch(() => undefined)
  }, [worldId, rev, listed.key])
  return useMemo(() => sharedMotifs(listed, choices), [listed, choices])
}

/**
 * The drawings worked out once for everyone: every card, portrait and row that shows a drawing asks for them, and in a
 * world of 150 entries working them out takes tens of milliseconds, so each new room, the home, a dossier and every row
 * of the Cast list doing it again made opening them slow (Phase 6 speed pass). Kept until the entries or the choices
 * change (both are new objects then).
 */
let lastMotifs: { listed: unknown; choices: ArtChoices; motifs: Map<ID, string> } | null = null
function sharedMotifs(listed: { entries: MotifEntry[] }, choices: ArtChoices): Map<ID, string> {
  if (lastMotifs && lastMotifs.listed === listed && lastMotifs.choices === choices) return lastMotifs.motifs
  const motifs = entryMotifs(listed.entries, choices)
  lastMotifs = { listed, choices, motifs }
  return motifs
}
