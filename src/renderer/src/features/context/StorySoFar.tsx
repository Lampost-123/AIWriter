// The "Story so far" part of the briefing, opened: the scene, chapter and story summaries the AI
// is told, each editable in place. This is where Adam fixes what the AI believes happened earlier,
// right where he can see it is wrong. His words are kept from then on.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Summary, SummaryLevel } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { SummaryEditor } from '@/features/inspector/SummaryEditor'
import { keepTouched, summaryKey, usedSummaries, type UsedSummary } from './contextLogic'

const LEVEL_WORDS: Record<SummaryLevel, string> = { scene: 'Scene', chapter: 'Chapter', story: 'Story', series: 'Series' }

/** Whether each scene's "Story so far" shows the text as sent rather than the summaries, this session. */
const showingText = new Set<string>()

/**
 * The summaries the part was built from, in reading order. Null while they load. `touched` holds the
 * ones Adam has been editing, so their boxes stay put while the part is worked out again.
 */
function useUsedSummaries(blockText: string): { used: UsedSummary[] | null; touched: Set<string> } {
  const stories = useApp((s) => s.stories)
  const memoryRev = useApp((s) => s.memoryRev)
  const [used, setUsed] = useState<UsedSummary[] | null>(null)
  const touched = useRef(new Set<string>())
  const storyIds = stories.map((s) => s.id).join(',')

  useEffect(() => {
    let live = true
    const ids = storyIds ? storyIds.split(',') : []
    // A story whose summaries can't be read just isn't offered for editing; the text still shows.
    void Promise.all(ids.map((id) => api.listStorySummaries(id).catch(() => [] as Summary[]))).then((lists) => {
      if (!live) return
      const next = usedSummaries(blockText, lists.flat())
      setUsed((prev) => keepTouched(prev ?? [], next, touched.current))
    })
    return () => {
      live = false
    }
  }, [blockText, storyIds, memoryRev])

  return { used, touched: touched.current }
}

export function StorySoFar({ sceneId, text, children }: { sceneId: string; text: string; children: ReactNode }): React.JSX.Element {
  const { used, touched } = useUsedSummaries(text)
  const [asText, setAsText] = useState(() => showingText.has(sceneId))
  const toggle = (): void => {
    if (asText) showingText.delete(sceneId)
    else showingText.add(sceneId)
    setAsText(!asText)
  }

  // Loading: keep a little room rather than flash the raw text first.
  if (used === null) return <div className="min-h-[48px]" />
  // Nothing to edit here (no summaries yet, or they can't be read): the text as sent.
  if (!used.length) return <>{children}</>

  const switcher = (
    <button type="button" onClick={toggle} className="self-start rounded text-[12px] font-medium text-accent hover:underline">
      {asText ? 'Show the summaries to edit them' : 'Show the text as sent'}
    </button>
  )
  if (asText) {
    return (
      <div className="flex flex-col gap-2">
        {switcher}
        {children}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] leading-relaxed text-muted">
        The AI is told what happened before from these summaries. If one is wrong, correct it here: your words are kept from then on.
      </p>
      {used.map((u) => {
        const key = summaryKey(u.summary)
        const level = LEVEL_WORDS[u.summary.level]
        return (
          <div key={key} className="flex flex-col gap-1" onFocus={() => touched.add(key)}>
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[12.5px] font-medium text-fg">{u.label || level}</span>
              <span className="shrink-0 text-[11.5px] text-faint">{level} summary</span>
            </div>
            <SummaryEditor
              level={u.summary.level}
              targetId={u.summary.targetId}
              summary={u.summary}
              label={`${level} summary${u.label ? `: ${u.label}` : ''}`}
              minRows={2}
            />
          </div>
        )
      })}
      {switcher}
    </div>
  )
}
