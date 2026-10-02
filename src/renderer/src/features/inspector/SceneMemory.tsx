// The parts of the scene card that come from the memory: what this scene should bring about (on a
// redraft), and the scene's summary, which Adam can edit in place.
import { useEffect, useId, useState } from 'react'
import type { ChangeView, Entry, ID, Summary } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'
import { describeChange } from './changeText'
import { SummaryEditor } from './SummaryEditor'

/**
 * "What this scene should bring about": the changes the memory has pinned to this scene. They are
 * never facts for drafting it; a new draft is written towards them. Read-only and quiet (neutral,
 * since nothing here waits on Adam). Shows nothing when there are none.
 */
export function BringAbout({ sceneId, entries }: { sceneId: ID; entries: Map<ID, Entry> }): React.JSX.Element | null {
  const memoryRev = useApp((s) => s.memoryRev)
  const [changes, setChanges] = useState<ChangeView[]>([])
  const headingId = useId()

  useEffect(() => {
    let live = true
    api
      .listSceneChanges(sceneId)
      .then((list) => live && setChanges(list))
      // Not known right now: the card simply leaves the list out.
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [sceneId, memoryRev])

  if (!changes.length) return null
  const nameOf = (id: ID): string => entries.get(id)?.name.trim() || 'Someone'
  return (
    <div className="flex flex-col gap-1 animate-fade-in">
      <h4 id={headingId} className="text-[12px] font-medium text-muted">
        What this scene should bring about
      </h4>
      <ul aria-labelledby={headingId} className="flex flex-col gap-1 rounded-md bg-surface-2 px-3 py-2 text-[13px] leading-snug text-fg">
        {changes.map((c) => (
          <li key={c.id} className="flex gap-2">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
            <span className="min-w-0">{describeChange(c, nameOf)}</span>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-faint">A new draft of this scene is written towards these.</p>
    </div>
  )
}

/** The scene's summary: written by AI Write as the memory reads the scene, editable in place. */
export function SceneSummary({ sceneId }: { sceneId: ID }): React.JSX.Element {
  const memoryRev = useApp((s) => s.memoryRev)
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [writing, setWriting] = useState(false)
  const boxId = useId()

  useEffect(() => {
    let live = true
    api
      .getSummary('scene', sceneId)
      .then((s) => {
        if (!live) return
        setSummary(s)
        setFailed(false)
      })
      .catch(() => {
        if (!live) return
        setFailed(true)
        setSummary((prev) => (prev === undefined ? null : prev))
      })
    return () => {
      live = false
    }
  }, [sceneId, memoryRev])

  // Loading: keep the room quiet rather than flash a message.
  if (summary === undefined) return <div className="min-h-[60px]" />
  if (!summary && !writing) {
    return (
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] leading-relaxed text-muted">
          {failed ? "This scene's summary can't be shown right now." : 'A summary appears once the memory has read this scene.'}
        </p>
        {!failed ? (
          <button
            type="button"
            onClick={() => {
              setWriting(true)
              requestAnimationFrame(() => document.getElementById(boxId)?.focus())
            }}
            className="self-start rounded text-[12px] font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Write one yourself
          </button>
        ) : null}
      </div>
    )
  }
  return (
    <SummaryEditor
      id={boxId}
      level="scene"
      targetId={sceneId}
      summary={summary}
      label="Scene summary"
      placeholder="What happens in this scene, in a few sentences"
    />
  )
}
