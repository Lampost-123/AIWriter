// A summary (of a scene, a chapter or a story), edited in place and saved as Adam types. Once he
// edits it, it is his: AI Write never replaces it. A quiet note says whose words it is.
import { useEffect, useRef, useState } from 'react'
import type { ID, Summary, SummaryLevel } from '@shared/types'
import { api } from '@/lib/api'
import { registerDiscarder } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { createDraftCache } from '@/features/world/parts/draftCache'
import { SaveNote } from '@/features/world/parts/SaveNote'
import { useAutosave } from '@/features/world/parts/useAutosave'
import { summaryNote } from './summaryText'

// What Adam typed, until its write is confirmed, so a panel that re-opens meanwhile starts from it.
const drafts = createDraftCache<string>()
registerDiscarder(() => drafts.clear())

const WHAT: Record<SummaryLevel, string> = {
  scene: "the scene's summary",
  chapter: "the chapter's summary",
  story: "the story's summary",
  series: "the series' summary"
}

export function SummaryEditor({
  level,
  targetId,
  summary,
  id,
  label,
  minRows = 3,
  placeholder,
  showSaved = true
}: {
  level: SummaryLevel
  targetId: ID
  /** The summary as stored (null: none yet). A newer copy replaces the text unless Adam is editing it. */
  summary: Summary | null
  id?: string
  /** Accessible name for the text box. */
  label: string
  minRows?: number
  placeholder?: string
  /** Show the "Saved" note beside the box's own note. */
  showSaved?: boolean
}): React.JSX.Element {
  const key = `${level}:${targetId}`
  const [text, setText] = useState(() => drafts.get(key) ?? summary?.text ?? '')
  const [stored, setStored] = useState<Summary | null>(summary)
  const editing = useRef(false)

  const autosave = useAutosave<string>(
    async (t) => {
      const saved = await api.setSummary(level, targetId, t)
      drafts.confirm(key, t)
      setStored(saved)
      useApp.getState().bumpBriefing()
    },
    { what: WHAT[level], delay: 700 }
  )

  // Opened from a copy that isn't confirmed saved yet: queue it again.
  const { schedule } = autosave
  useEffect(() => {
    const draft = drafts.get(key)
    if (draft !== undefined) schedule(draft)
  }, [key, schedule])

  // The memory wrote a newer summary: show it, unless Adam is in the middle of editing this one.
  useEffect(() => {
    if (editing.current || drafts.get(key) !== undefined) return
    setStored(summary)
    setText(summary?.text ?? '')
  }, [summary, key])

  const note = summaryNote(stored, level)
  return (
    <div className="flex flex-col gap-1">
      <AutoTextarea
        id={id}
        aria-label={label}
        value={text}
        minRows={minRows}
        maxRows={18}
        placeholder={placeholder}
        onFocus={() => (editing.current = true)}
        onBlur={() => {
          editing.current = false
          void autosave.flush()
        }}
        onChange={(e) => {
          setText(e.target.value)
          drafts.set(key, e.target.value)
          schedule(e.target.value)
        }}
        className="text-[13px]"
      />
      <div className="flex min-h-[18px] items-start justify-between gap-2">
        <p className="text-[12px] leading-relaxed text-faint">{note}</p>
        {showSaved ? <SaveNote status={autosave.status} error={autosave.error} className="shrink-0" /> : null}
      </div>
    </div>
  )
}
