// The desk's drawings and covers (UI overhaul, D5.4): Adam's choices for the open world (src/shared/contracts/art.ts),
// loaded once per world and kept in step as he changes them, and the drawing each entry and story shows: his choice,
// else the one its words call for (src/shared/motifs.ts).
import { useEffect } from 'react'
import { create } from 'zustand'
import type { ArtChoices, StoryCoverChoice } from '@shared/contracts/art'
import { pickMotif, pickStoryMotif, type MotifSource } from '@shared/motifs'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

interface ArtState {
  worldId: ID | null
  choices: ArtChoices
  /** Each entry's drawing from its words, for the world and entries revision in `key`. */
  picked: { key: string; byId: Map<ID, string> }
}

const NONE: ArtChoices = { entries: {}, stories: {} }

export const useArt = create<ArtState>(() => ({ worldId: null, choices: NONE, picked: { key: '', byId: new Map() } }))

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

/** Every entry's drawing in the open world, by id (their words read once per change to the world's entries). */
export function useEntryMotifs(): Map<ID, string> {
  const choices = useArtChoices()
  const rev = useApp((s) => s.entriesRev)
  const worldId = useApp((s) => s.world?.id ?? null)
  const picked = useArt((s) => s.picked)
  useEffect(() => {
    if (!worldId || picked.key === `${worldId}:${rev}`) return
    const key = `${worldId}:${rev}`
    api
      .listEntries()
      .then((entries) => useArt.setState({ picked: { key, byId: new Map(entries.map((e) => [e.id, pickMotif(e)])) } }))
      .catch(() => undefined)
  }, [worldId, rev, picked.key])
  const out = new Map(picked.byId)
  for (const [id, c] of Object.entries(choices.entries)) out.set(id, c.motif)
  return out
}
