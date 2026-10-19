// Show me the plan first (2026-10-19; store.ts, src/main/plan/review.ts): a scene's plan, made before anything is written,
// waiting for Adam: what happens beat by beat, what the point-of-view character wants, who is where, what changes and the
// image it ends on, with what the app noticed comparing the scene card with the story so far. Write writes the scene to
// it; Change the plan turns each part into words Adam can change first (what he writes is what the writer gets); Cancel
// (or closing it) ends the draft before anything is written. The parts are Write the whole chapter's (planReview/parts).
// Mounted once in the workspace, beside the chapter's plan.
import { useEffect, useState } from 'react'
import type { ScenePlanParts, ScenePlanReview as Review } from '@shared/contracts/planReview'
import { Button, Dialog, Textarea } from '@/components/ui'
import { Plus } from '@/components/ui/icons'
import { plainReason } from '@/lib/reason'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { PlanPart, PlanReviewFooter } from './parts'
import { cancelPlan, listenForPlanReviews, usePlanReview, writeToPlan } from './store'
import { noteText, partsChanged, splitLines, type Draft } from './logic'

export function ScenePlanReview(): React.JSX.Element | null {
  useEffect(() => listenForPlanReviews(), [])
  const review = usePlanReview((s) => s.waiting[0] ?? null)
  const title = useOutlineStore((s) => (review ? (s.outline?.scenes.find((x) => x.id === review.sceneId)?.title ?? '') : ''))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<'write' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reviewId = review?.reviewId ?? null

  // A new plan starts as the AI made it.
  useEffect(() => {
    setEditing(false)
    setBusy(null)
    setError(null)
    setDraft(review?.plan ? draftOf(review.plan) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewId])

  if (!review) return null
  const plan = review.plan

  const write = async (): Promise<void> => {
    setBusy('write')
    setError(null)
    try {
      const parts = plan && draft && editing ? partsOf(draft) : undefined
      await writeToPlan(review.reviewId, parts && partsChanged(plan!, parts) ? parts : undefined)
    } catch (e) {
      setError(plainReason(e))
      setBusy(null)
    }
  }
  const cancel = async (): Promise<void> => {
    setBusy('cancel')
    await cancelPlan(review.reviewId)
  }
  const set = (patch: Partial<Draft>): void => setDraft((d) => (d ? { ...d, ...patch } : d))
  const named = title.trim() ? `“${title.trim()}”` : 'this scene'
  const notes = [...review.notes.map(noteText), ...review.flags]

  return (
    <Dialog
      open
      // Closing it (Escape, ×) is Cancel: nothing has been written.
      onOpenChange={(o) => !o && !busy && void cancel()}
      title={review.carryingOn ? 'The plan for what comes next' : 'The plan for this scene'}
      description={`What the AI will write in ${named}, before it writes it. Change any part you like, then write to it.`}
      width={620}
      footer={<PlanReviewFooter testId="scene-plan" busy={busy} editing={editing || !plan} onCancel={() => void cancel()} onChange={() => setEditing(true)} onWrite={() => void write()} />}
    >
      <div className="flex flex-col gap-4 text-[13px] leading-relaxed" data-testid="scene-plan">
        {notes.length ? (
          <section className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5" data-plan-notes aria-label="Worth knowing before it writes">
            <h3 className="text-[13px] font-semibold text-fg">Worth knowing before it writes</h3>
            <p className="-mt-1 text-[12px] text-faint">Your scene card held to the story so far, checked on this computer. The plan was asked to keep to the story.</p>
            <ul className="list-disc space-y-1 pl-4 text-muted">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </section>
        ) : null}
        {!plan || !draft ? (
          <p className="text-muted">No plan could be made this time, so the AI would write from the scene card alone. Write goes ahead without one.</p>
        ) : editing ? (
          <>
            <PlanPart title="The point" testId="point">
              <Labelled label="Wants">
                <Textarea aria-label="Wants" placeholder="What the point-of-view character wants here" value={draft.wants} minRows={1} maxRows={4} onChange={(e) => set({ wants: e.target.value })} />
              </Labelled>
              <Labelled label="Against it">
                <Textarea aria-label="Against it" placeholder="What stands in the way" value={draft.against} minRows={1} maxRows={4} onChange={(e) => set({ against: e.target.value })} />
              </Labelled>
              <Labelled label="How it turns">
                <Textarea aria-label="How it turns" placeholder="How it turns by the end" value={draft.turn} minRows={1} maxRows={4} onChange={(e) => set({ turn: e.target.value })} />
              </Labelled>
            </PlanPart>
            <PlanPart title="What happens" hint="One beat a box, in order. Empty a box to leave that beat out." testId="beats">
              {draft.beats.map((b, i) => (
                <Textarea
                  key={i}
                  aria-label={`Beat ${i + 1}`}
                  value={b}
                  minRows={1}
                  maxRows={5}
                  onChange={(e) => set({ beats: draft.beats.map((x, j) => (j === i ? e.target.value : x)) })}
                />
              ))}
              <div>
                <Button size="sm" variant="ghost" icon={<Plus size={13} />} onClick={() => set({ beats: [...draft.beats, ''] })}>
                  Add a beat
                </Button>
              </div>
            </PlanPart>
            <PlanPart title="Who is where" hint="A line each." testId="where">
              <Textarea aria-label="Who is where" value={draft.whoWhere} minRows={2} maxRows={6} onChange={(e) => set({ whoWhere: e.target.value })} />
            </PlanPart>
            <PlanPart title="What changes" hint="A line each, in the order it happens." testId="changes">
              <Textarea aria-label="What changes" value={draft.changes} minRows={2} maxRows={8} onChange={(e) => set({ changes: e.target.value })} />
            </PlanPart>
            <PlanPart title="It ends on" testId="closing">
              <Textarea aria-label="It ends on" value={draft.closing} minRows={1} maxRows={4} onChange={(e) => set({ closing: e.target.value })} />
            </PlanPart>
          </>
        ) : (
          <>
            {plan.wants || plan.against || plan.turn ? (
              <PlanPart title="The point" testId="point">
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted">
                  {plan.wants ? <Row label="Wants">{plan.wants}</Row> : null}
                  {plan.against ? <Row label="Against it">{plan.against}</Row> : null}
                  {plan.turn ? <Row label="How it turns">{plan.turn}</Row> : null}
                </dl>
              </PlanPart>
            ) : null}
            {plan.beats.length ? (
              <PlanPart title="What happens" testId="beats">
                <ol className="list-decimal space-y-1.5 pl-5 text-fg">
                  {plan.beats.map((b, i) => (
                    <li key={i} data-plan-beat={i + 1}>
                      {b}
                      {plan.first
                        .filter((f) => f.beat === i)
                        .map((f, j) => (
                          <span key={j} className="block text-[12.5px] text-faint">
                            {f.note}
                          </span>
                        ))}
                    </li>
                  ))}
                </ol>
              </PlanPart>
            ) : null}
            {plan.whoWhere.length ? (
              <PlanPart title="Who is where" testId="where">
                <List items={plan.whoWhere} />
              </PlanPart>
            ) : null}
            {plan.changes.length ? (
              <PlanPart title="What changes" testId="changes">
                <List items={plan.changes} ordered />
              </PlanPart>
            ) : null}
            {plan.closing ? (
              <PlanPart title="It ends on" testId="closing">
                <p className="text-muted">{plan.closing}</p>
              </PlanPart>
            ) : null}
            {plan.keep.length || plan.mustStay.length ? (
              <PlanPart title="What it keeps to" hint="From the story so far; the writer keeps to these whatever you change." testId="keeps">
                <List items={[...plan.keep, ...plan.mustStay]} faint />
              </PlanPart>
            ) : null}
          </>
        )}
        {error ? <p className="text-[13px] text-danger">{error}</p> : null}
      </div>
    </Dialog>
  )
}

/** A box with its name above it, faint, as the read view names each line of the point. */
function Labelled({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1">
      <span aria-hidden className="text-[12px] text-faint">
        {label}
      </span>
      {children}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </>
  )
}

function List({ items, ordered, faint }: { items: string[]; ordered?: boolean; faint?: boolean }): React.JSX.Element {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={`${ordered ? 'list-decimal pl-5' : 'list-disc pl-4'} space-y-1 ${faint ? 'text-[12.5px] text-faint' : 'text-muted'}`}>
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </Tag>
  )
}

/** The boxes Adam changes, from the plan as made. */
function draftOf(p: NonNullable<Review['plan']>): Draft {
  return {
    wants: p.wants,
    against: p.against,
    turn: p.turn,
    beats: p.beats.length ? [...p.beats] : [''],
    whoWhere: p.whoWhere.join('\n'),
    changes: p.changes.join('\n'),
    closing: p.closing
  }
}

/** The plan as Adam left the boxes. */
function partsOf(d: Draft): ScenePlanParts {
  return {
    wants: d.wants.trim(),
    against: d.against.trim(),
    turn: d.turn.trim(),
    beats: d.beats.map((b) => b.trim()).filter(Boolean),
    whoWhere: splitLines(d.whoWhere),
    changes: splitLines(d.changes),
    closing: d.closing.trim()
  }
}
