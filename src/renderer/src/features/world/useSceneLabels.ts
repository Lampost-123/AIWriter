import { useEffect, useState } from 'react'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { sceneLabels } from './memoryLogic'

// Every scene of every story in the open world in plain words ("Book 1, Ch 3, Sc 2"), for entry
// pages that say where something first appears or which scene its words are in. Loaded once per
// change to the stories or their chapters and scenes, and shared by every page that asks.

/** A scene in plain words, and the story it is in (for opening it). */
export interface ScenePlace {
  label: string
  storyId: ID
}

let cache: { key: string; labels: Promise<Map<ID, ScenePlace>> } | null = null

/** Every scene's place in the open world, or null until first loaded. Only loads when `enabled`. */
export function useSceneLabels(enabled: boolean): Map<ID, ScenePlace> | null {
  const worldId = useApp((s) => s.world?.id ?? '')
  const rev = useApp((s) => s.outlineRev)
  const stories = useApp((s) => s.stories)
  const key = `${worldId}|${rev}|${stories.map((s) => `${s.id}:${s.title}`).join('|')}`
  const [labels, setLabels] = useState<Map<ID, ScenePlace> | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    if (cache?.key !== key) {
      const ids = useApp.getState().stories.map((s) => s.id)
      cache = {
        key,
        labels: Promise.all(ids.map((id) => api.getOutline(id).catch(() => null))).then((outlines) => {
          const all = new Map<ID, ScenePlace>()
          for (const o of outlines) if (o) for (const [id, label] of sceneLabels(o)) all.set(id, { label, storyId: o.story.id })
          return all
        })
      }
    }
    // The labels on screen stay until the new ones arrive, so nothing flickers.
    void cache.labels.then((m) => live && setLabels(m))
    return () => {
      live = false
    }
  }, [enabled, key])

  return labels
}
