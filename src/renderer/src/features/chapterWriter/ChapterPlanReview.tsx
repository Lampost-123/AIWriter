// Write the whole chapter's plan, before anything is written (spec "Write the chapter, reworked", 2026-10-19): what the
// chapter does, and for each scene what it must do, which threads it moves on and what changes for each person. Write
// starts writing to it; Change the plan turns each part into words Adam can change first; Cancel stops the run, which has
// changed nothing yet. Closing it (Escape) only hides it: the top bar opens it again while the run waits. Mounted once
// in the workspace, beside the start dialog.

import { useEffect, useState } from 'react'
import type { ID } from '@shared/types'
import { Button, Dialog, Textarea } from '@/components/ui'
import { plainReason } from '@/lib/reason'
import { hideChapterPlan, stopChapterWriter, useChapterWriter, writeToChapterPlan } from './chapterWriterStore'

export function ChapterPlanReview(): React.JSX.Element {
  const progress = useChapterWriter((s) => s.progress)
  const open = useChapterWriter((s) => s.planOpen)
  const plan = progress?.stage === 'review' ? (progress.plan ?? null) : null
  const runId = plan ? progress!.runId : null
  const [editing, setEditing] = useState(false)
  const [texts, setTexts] = useState<Record<ID, string>>({})
  const [overview, setOverview] = useState('')
  const [busy, setBusy] = useState<'write' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A new plan starts as the AI wrote it.
  useEffect(() => {
    setEditing(false)
    setError(null)
    setBusy(null)
    setTexts(Object.fromEntries((plan?.scenes ?? []).map((s) => [s.sceneId, s.text])))
    setOverview(plan?.overview ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const write = async (): Promise<void> => {
    if (!plan) return
    setBusy('write')
    setError(null)
    try {
      const scenes = plan.scenes.filter((s) => (texts[s.sceneId] ?? s.text).trim() !== s.text.trim()).map((s) => ({ sceneId: s.sceneId, text: texts[s.sceneId] ?? s.text }))
      await writeToChapterPlan({ scenes, ...(overview.trim() !== plan.overview.trim() ? { overview } : {}) })
    } catch (e) {
      setError(plainReason(e))
    } finally {
      setBusy(null)
    }
  }

  const cancel = async (): Promise<void> => {
    setBusy('cancel')
    try {
      await stopChapterWriter()
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open={!!plan && open}
      onOpenChange={(o) => !o && hideChapterPlan()}
      title="The chapter plan"
      description="What each scene will do, before anything is written. Change any part you like, then write the chapter to it."
      width={600}
      footer={
        <>
          <Button onClick={() => void cancel()} loading={busy === 'cancel'} disabled={busy === 'write'} data-testid="chapter-plan-cancel">
            Cancel
          </Button>
          {!editing ? (
            <Button onClick={() => setEditing(true)} disabled={!!busy} data-testid="chapter-plan-change">
              Change the plan
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => void write()} loading={busy === 'write'} disabled={busy === 'cancel'} data-autofocus data-testid="chapter-plan-write">
            Write
          </Button>
        </>
      }
    >
      {plan ? (
        <div className="flex flex-col gap-4 text-[13px] leading-relaxed" data-testid="chapter-plan">
          {editing ? (
            <Textarea aria-label="What the chapter does" value={overview} minRows={2} maxRows={6} onChange={(e) => setOverview(e.target.value)} />
          ) : overview.trim() ? (
            <p className="text-muted">{overview}</p>
          ) : null}
          {plan.scenes.map((s) => (
            <section key={s.sceneId} className="flex flex-col gap-1.5">
              <h3 className="text-[13px] font-semibold text-fg">{s.label}</h3>
              {editing ? (
                <Textarea
                  aria-label={`${s.label}: its part of the plan`}
                  value={texts[s.sceneId] ?? s.text}
                  minRows={3}
                  maxRows={12}
                  onChange={(e) => setTexts((t) => ({ ...t, [s.sceneId]: e.target.value }))}
                />
              ) : (
                <p className="whitespace-pre-wrap text-muted">{(texts[s.sceneId] ?? s.text) || 'Written from its scene card.'}</p>
              )}
            </section>
          ))}
          {plan.questions.length ? (
            <section className="flex flex-col gap-1.5 border-t border-line pt-3">
              <h3 className="text-[13px] font-semibold text-fg">Your scene cards and the story so far</h3>
              <p className="text-[12.5px] text-faint">Your cards aren’t changed: the scenes are written to keep to the story instead.</p>
              <ul className="list-disc space-y-1 pl-4 text-muted">
                {plan.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </section>
          ) : null}
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
        </div>
      ) : null}
    </Dialog>
  )
}
