// "Re-read this scene" and "Re-read the whole story" (World Memory Overhaul B8): which re-read the dialog is asking
// about (opened from the scene menu in the binder, the story menu and the command palette), and its words. The dialog is
// mounted once in the workspace (RereadDialog.tsx). Pure apart from the small store.

import { create } from 'zustand'
import type { ID, MemoryStatus, RereadEstimate, RereadTarget } from '@shared/types'
import { dollars } from '@/features/importing/importLogic'

interface RereadState {
  /** What to read again, and its title for the dialog; null when the dialog is closed. */
  ask: { target: RereadTarget; title: string } | null
}

export const useReread = create<RereadState>(() => ({ ask: null }))

export const openReread = (target: RereadTarget, title: string): void => useReread.setState({ ask: { target, title } })
export const closeReread = (): void => useReread.setState({ ask: null })

export const rereadScene = (sceneId: ID, title: string): void => openReread({ sceneId }, title)
export const rereadStory = (storyId: ID, title: string): void => openReread({ storyId }, title)

const n = (k: number, one: string, many: string): string => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`

/**
 * What the re-read costs, in one sentence: "About $0.04 with DeepSeek Flash, for 12 scenes (about 25,000 words).",
 * "Less than a cent with …", "Free with your local model, …", or "The cost isn't known for …". '' while there is
 * nothing to read (the dialog says so instead).
 */
export function rereadCostWords(e: RereadEstimate): string {
  if (!e.scenes) return ''
  const words = e.words >= 1000 ? ` (about ${(Math.round(e.words / 1000) * 1000).toLocaleString('en-US')} words)` : ''
  const what = `${n(e.scenes, 'scene', 'scenes')}${words}`
  const model = e.model ?? 'this model'
  if (e.free) return `Free with your local model, ${model}. It reads ${what}.`
  const price = dollars(e.cost)
  if (!price) return `The cost isn’t known for ${model}. It reads ${what}.`
  return `${price} with ${model}, for ${what}.`
}

/** What the dialog says it does. */
export function rereadIntro(target: RereadTarget, title: string): string {
  const name = title.trim() ? `“${title.trim()}”` : 'this scene'
  if ('sceneId' in target)
    return `The memory reads ${name} again from the start, as if for the first time, and brings what it knows up to date. Anything you made yourself stays as it is.`
  return `The memory reads every scene of ${title.trim() ? `“${title.trim()}”` : 'this story'} again, one after another, in the background. Keep writing meanwhile; you can stop it at any time from the top bar. Anything you made yourself stays as it is.`
}

/** The toast once it has started. */
export function rereadStarted(target: RereadTarget, scenes: number): string {
  if ('sceneId' in target || scenes === 1) return 'Re-reading the scene. What the memory finds shows in What changed.'
  return `Re-reading ${n(scenes, 'scene', 'scenes')} in the background. You can stop it from the top bar.`
}

/** The top bar while a re-read goes on: "Re-reading 3 of 12…", or "Re-reading the scene…" for one. */
export function rereadProgress(r: NonNullable<MemoryStatus['rereading']>): string {
  if (r.total <= 1) return 'Re-reading the scene…'
  return `Re-reading ${Math.min(r.total, r.total - r.left + 1)} of ${r.total}…`
}
