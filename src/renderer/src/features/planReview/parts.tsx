// The parts a plan shown before writing is made of, shared by Write the whole chapter's plan (features/chapterWriter/
// ChapterPlanReview.tsx) and a scene's plan (ScenePlanReview.tsx): a part with its heading, and the footer's Cancel,
// Change the plan and Write.
import type { ReactNode } from 'react'
import { Button } from '@/components/ui'

/** One part of a plan: its heading, then what it says (or the box to change it in). */
export function PlanPart({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-1.5" data-plan-part={testId}>
      <h3 className="text-[13px] font-semibold text-fg">{title}</h3>
      {hint ? <p className="-mt-1 text-[12px] text-faint">{hint}</p> : null}
      {children}
    </section>
  )
}

/** Cancel, Change the plan (until it is being changed) and Write, each with its test id (`<testId>-cancel` and so on). */
export function PlanReviewFooter({
  testId,
  busy,
  editing,
  onCancel,
  onChange,
  onWrite
}: {
  testId: string
  busy: 'write' | 'cancel' | null
  editing: boolean
  onCancel: () => void
  onChange: () => void
  onWrite: () => void
}): React.JSX.Element {
  return (
    <>
      <Button onClick={onCancel} loading={busy === 'cancel'} disabled={busy === 'write'} data-testid={`${testId}-cancel`}>
        Cancel
      </Button>
      {!editing ? (
        <Button onClick={onChange} disabled={!!busy} data-testid={`${testId}-change`}>
          Change the plan
        </Button>
      ) : null}
      <Button variant="primary" onClick={onWrite} loading={busy === 'write'} disabled={busy === 'cancel'} data-autofocus data-testid={`${testId}-write`}>
        Write
      </Button>
    </>
  )
}
