// Data the story screens load: another story's chapters and scenes (for "after Ch 5"), and the live
// preview of what a story would know. Both keep the last result on screen while the next one loads.
import { useEffect, useRef, useState } from 'react'
import type { StoryDraft, StoryPreview } from '@shared/contracts/stories'
import type { ID, Outline } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

const outlines = new Map<string, Outline>()

/** A story's chapters and scenes (null until loaded, or when there is no story). */
export function useStoryOutline(storyId: ID | null): Outline | null {
  const rev = useApp((s) => s.outlineRev)
  const key = storyId ? `${storyId}:${rev}` : ''
  const [outline, setOutline] = useState<Outline | null>(() => (key ? (outlines.get(key) ?? null) : null))
  useEffect(() => {
    if (!storyId) {
      setOutline(null)
      return
    }
    const cached = outlines.get(key)
    if (cached) {
      setOutline(cached)
      return
    }
    let live = true
    api
      .getOutline(storyId)
      .then((o) => {
        for (const k of outlines.keys()) if (k.startsWith(`${storyId}:`)) outlines.delete(k)
        outlines.set(key, o)
        if (live) setOutline(o)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [storyId, key])
  // Another story's outline never shows for this one.
  return outline && outline.story.id === storyId ? outline : null
}

/**
 * What the draft would know, worked out by the main process without saving anything. The last preview
 * stays while the next is worked out (a quick pause first while a title is typed), and an answer for
 * an older draft is dropped.
 */
export function usePreview(
  draft: StoryDraft | null,
  initial: StoryPreview | null = null
): { preview: StoryPreview | null; current: boolean } {
  const [state, setState] = useState<{ key: string; preview: StoryPreview | null }>({ key: '', preview: initial })
  const ticket = useRef(0)
  const memoryRev = useApp((s) => s.memoryRev)
  const stories = useApp((s) => s.stories)
  const key = draft ? JSON.stringify(draft) : ''
  useEffect(() => {
    if (!key) return
    const mine = ++ticket.current
    const t = setTimeout(() => {
      api
        .previewStory(JSON.parse(key) as StoryDraft)
        .then((preview) => {
          if (mine === ticket.current) setState({ key, preview })
        })
        .catch(() => undefined)
    }, 120)
    return () => clearTimeout(t)
  }, [key, memoryRev, stories])
  return { preview: state.preview, current: !!key && state.key === key }
}
