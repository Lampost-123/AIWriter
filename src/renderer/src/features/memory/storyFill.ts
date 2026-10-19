// "Fill in the whole story" (the story index, 2026-10-19): the memory works out, for every scene of a story it hasn't yet,
// what people wear and carry, any injuries, and where everyone ends up (it does the last chapters by itself). Which story
// the dialog is asking about (it is mounted once in the workspace: StoryFillDialog.tsx), and its words. Pure apart from
// the small store.

import { create } from 'zustand'
import type { ID, MemoryStatus } from '@shared/types'
import type { StoryFillDone, StoryFillEstimate } from '@shared/contracts/storyIndex'
import { dollars } from '@/features/importing/importLogic'

interface StoryFillState {
  /** The story to fill in, and its title for the dialog; null when the dialog is closed. */
  ask: { storyId: ID; title: string } | null
}

export const useStoryFill = create<StoryFillState>(() => ({ ask: null }))

export const openStoryFill = (storyId: ID, title: string): void => useStoryFill.setState({ ask: { storyId, title } })
export const closeStoryFill = (): void => useStoryFill.setState({ ask: null })

const n = (k: number, one: string, many: string): string => `${k.toLocaleString('en-US')} ${k === 1 ? one : many}`
const named = (title: string): string => (title.trim() ? `“${title.trim()}”` : 'this story')

/** What it does, in a sentence or two. */
export const FILL_WHAT = 'What people wear and carry, any injuries, and where everyone ends up, worked out for every scene.'

/** What the dialog says it does. */
export function fillIntro(title: string): string {
  return `The memory reads each scene of ${named(title)} it hasn’t read for these yet, one after another in the background: what people wear and carry, any injuries, and where everyone ends up. The AI then keeps them straight anywhere in the story. Keep writing meanwhile; you can stop it at any time.`
}

/**
 * What it costs, in one sentence: "About $0.12 with DeepSeek Flash, for 42 scenes (about 63,000 words).", "Less than a
 * cent with …", "Free with your local model, …", or, with no price known, "About 42 AI calls with …". '' when every
 * scene is filled in already (the dialog says so instead).
 */
export function fillCostWords(e: StoryFillEstimate): string {
  if (!e.scenes) return ''
  const words = e.words >= 1000 ? ` (about ${(Math.round(e.words / 1000) * 1000).toLocaleString('en-US')} words)` : ''
  const what = `${n(e.scenes, 'scene', 'scenes')}${words}`
  const model = e.model ?? 'this model'
  if (e.free) return `Free with your local model, ${model}. It reads ${what}.`
  const price = dollars(e.cost)
  if (!price) return `About ${n(e.scenes, 'AI call', 'AI calls')} with ${model}, one for each of ${what}.`
  return `${price} with ${model}, for ${what}.`
}

/** How much of the story is filled in already, when some is: "18 of 60 scenes are filled in already." */
export function fillSoFarWords(e: StoryFillEstimate): string {
  const already = e.total - e.scenes
  if (already <= 0 || !e.scenes) return ''
  return `${already.toLocaleString('en-US')} of ${n(e.total, 'scene', 'scenes')} ${already === 1 ? 'is' : 'are'} filled in already.`
}

/** The toast once it has started. */
export function fillStarted(scenes: number): string {
  return `Filling in ${n(scenes, 'scene', 'scenes')} in the background. You can stop it from the top bar.`
}

/** How far it has got: "Filling in scene 3 of 42…". */
export function fillProgress(p: NonNullable<MemoryStatus['filling']>): string {
  if (p.total <= 1) return 'Filling in the scene…'
  return `Filling in scene ${Math.min(p.total, p.done + 1).toLocaleString('en-US')} of ${p.total.toLocaleString('en-US')}…`
}

/** The quiet note once it is over; '' when Adam stopped it (his Stop says so itself). */
export function fillDoneWords(d: StoryFillDone): string {
  if (d.stopped) return ''
  if (d.problem) return d.problem
  if (!d.failed) return `${named(d.title).replace(/^this story$/, 'The story')} is filled in: ${n(d.filled, 'scene', 'scenes')}.`
  return `Filled in ${d.filled.toLocaleString('en-US')} of ${n(d.total, 'scene', 'scenes')} of ${named(d.title)}. ${d.failed === 1 ? 'The memory model couldn’t read one; Recall in that scene can read it again.' : `The memory model couldn’t read ${d.failed.toLocaleString('en-US')}; Recall in those scenes can read them again.`}`
}
