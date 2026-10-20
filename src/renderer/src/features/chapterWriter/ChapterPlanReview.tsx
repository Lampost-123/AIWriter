// Write this chapter's plan, before anything is written (spec "Write the chapter, reworked", 2026-10-19; built to the
// Build with AI mock-up, 2026-10-20), shown inline at its chapter in the story line (features/planHub/WritePanel.tsx):
// "Write this chapter · step 1 of 3: the plan", the chapter's name, then
//   What the chapter does: whose chapter, what they want, what is against them, how it turns (the overview, for a plan
//     made before those parts);
//   Scene by scene: each scene's line and "Ends with: …";
//   Kept true from the memory: the facts the plan holds to, each with where it was set (the story index's, no AI call);
//   the questions the cards raise against the story so far, when there are any;
//   Write the chapter / Change the plan / Cancel, and about how long and what it costs.
// Change the plan turns each part into words Adam can change first; a part he changes is his from then on. Cancel ends
// the run, which has changed nothing yet.

import { useEffect, useId, useState } from 'react'
import type { ChapterWriterEstimate, ChapterWritingPlan } from '@shared/contracts/chapterWriter'
import type { ID } from '@shared/types'
import { Button } from '@/components/ui'
import { PenLine, SquarePen } from '@/components/ui/icons'
import { plainReason } from '@/lib/reason'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { estimateWords, keptLines, sceneDoes, sceneHead, threeHeads } from '@/features/planHub/buildLogic'
import { stopChapterWriter, writeToChapterPlan } from './chapterWriterStore'

export interface ChapterPlanReviewProps {
  runId: ID
  /** The chapter's name: "Ch 2 · The cart on the coast road". */
  title: string
  plan: ChapterWritingPlan
  estimate: ChapterWriterEstimate | null | undefined
}

type Three = { wants: string; against: string; turn: string }

export function ChapterPlanReview({ runId, title, plan, estimate }: ChapterPlanReviewProps): React.JSX.Element {
  const id = useId()
  const [editing, setEditing] = useState(false)
  const [texts, setTexts] = useState<Record<ID, string>>({})
  const [overview, setOverview] = useState(plan.overview)
  const [three, setThree] = useState<Three>({ wants: plan.wants ?? '', against: plan.against ?? '', turn: plan.turn ?? '' })
  const [busy, setBusy] = useState<'write' | 'cancel' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // A new plan starts as the AI wrote it.
  useEffect(() => {
    setEditing(false)
    setError(null)
    setBusy(null)
    setTexts(Object.fromEntries(plan.scenes.map((s) => [s.sceneId, s.text])))
    setOverview(plan.overview)
    setThree({ wants: plan.wants ?? '', against: plan.against ?? '', turn: plan.turn ?? '' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId])

  const hasThree = !!(plan.wants || plan.against || plan.turn)
  const heads = threeHeads(plan.lead)
  const kept = keptLines(plan)
  const est = estimateWords(estimate)
  const changedText = (sceneId: ID, was: string): boolean => (texts[sceneId] ?? was).trim() !== was.trim()

  const write = async (): Promise<void> => {
    setBusy('write')
    setError(null)
    try {
      const scenes = plan.scenes.filter((s) => changedText(s.sceneId, s.text)).map((s) => ({ sceneId: s.sceneId, text: texts[s.sceneId] ?? s.text }))
      const parts = (['wants', 'against', 'turn'] as const).filter((k) => three[k].trim() !== (plan[k] ?? '').trim())
      await writeToChapterPlan({
        scenes,
        ...(overview.trim() !== plan.overview.trim() ? { overview } : {}),
        ...Object.fromEntries(parts.map((k) => [k, three[k]]))
      })
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
    <section aria-labelledby={`${id}-t`} className="cw-review" data-testid="chapter-plan">
      <header className="cw-head">
        <p className="cw-step">Write this chapter · step 1 of 3: the plan</p>
        <h3 id={`${id}-t`} className="cw-title">
          {title}
        </h3>
        <p className="cw-lead">Here is how the chapter will go. Change anything before it writes. It uses what the story’s memory says is true at this point.</p>
      </header>

      <section aria-labelledby={`${id}-does`} className="cw-block" data-plan-part="does">
        <h4 id={`${id}-does`} className="cw-h">
          What the chapter does
        </h4>
        {hasThree || editing ? (
          <div className="cw-three">
            {(['wants', 'against', 'turn'] as const).map((k) => (
              <div key={k} className="cw-tile" data-three={k}>
                <span className="cw-tile-k">{heads[k]}</span>
                {editing ? (
                  <AutoTextarea aria-label={heads[k]} value={three[k]} minRows={2} maxRows={6} className="cw-box" onChange={(e) => setThree((t) => ({ ...t, [k]: e.target.value }))} />
                ) : (
                  <span className="cw-tile-v">{three[k] || '—'}</span>
                )}
              </div>
            ))}
          </div>
        ) : null}
        {editing && !hasThree ? (
          <AutoTextarea aria-label="What the chapter does" value={overview} minRows={2} maxRows={6} className="cw-box" onChange={(e) => setOverview(e.target.value)} />
        ) : !hasThree && overview.trim() ? (
          <p className="cw-text">{overview}</p>
        ) : null}
      </section>

      <section aria-labelledby={`${id}-scenes`} className="cw-block">
        <h4 id={`${id}-scenes`} className="cw-h">
          Scene by scene
        </h4>
        <ol className="cw-scenes">
          {plan.scenes.map((s) => {
            const mine = changedText(s.sceneId, s.text) || s.changed
            return (
              <li key={s.sceneId} className="cw-scene" data-plan-scene={s.sceneId}>
                <strong className="cw-scene-t">{sceneHead(s.label)}</strong>
                {editing ? (
                  <AutoTextarea
                    aria-label={`${s.label}: its part of the plan`}
                    value={texts[s.sceneId] ?? s.text}
                    minRows={3}
                    maxRows={12}
                    className="cw-box"
                    onChange={(e) => setTexts((t) => ({ ...t, [s.sceneId]: e.target.value }))}
                  />
                ) : mine ? (
                  <span className="cw-text is-pre">{texts[s.sceneId] ?? s.text}</span>
                ) : (
                  <>
                    <span className="cw-text">{sceneDoes(s) || 'Written from its scene card.'}</span>
                    {s.ends?.trim() ? <span className="cw-ends">Ends with: {s.ends.trim()}</span> : null}
                  </>
                )}
              </li>
            )
          })}
        </ol>
      </section>

      {kept.length ? (
        <section aria-labelledby={`${id}-kept`} className="cw-block">
          <h4 id={`${id}-kept`} className="cw-h">
            Kept true from the memory
          </h4>
          <ul className="cw-kept">
            {kept.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {plan.questions.length ? (
        <section aria-labelledby={`${id}-q`} className="cw-block is-quiet">
          <h4 id={`${id}-q`} className="cw-h">
            Your scene cards and the story so far
          </h4>
          <p className="cw-note">Your cards aren’t changed: the scenes are written to keep to the story instead.</p>
          <ul className="cw-kept">
            {plan.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {error ? (
        <p className="cw-error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="cw-actions">
        <Button variant="primary" size="lg" icon={<PenLine size={15} />} onClick={() => void write()} loading={busy === 'write'} disabled={busy === 'cancel'} data-testid="chapter-plan-write">
          Write the chapter
        </Button>
        {!editing ? (
          <Button size="lg" icon={<SquarePen size={14} />} onClick={() => setEditing(true)} disabled={!!busy} data-testid="chapter-plan-change">
            Change the plan
          </Button>
        ) : null}
        <Button variant="ghost" size="lg" onClick={() => void cancel()} loading={busy === 'cancel'} disabled={busy === 'write'} data-testid="chapter-plan-cancel">
          Cancel
        </Button>
        {est ? (
          <span className="cw-est" data-estimate>
            {est}
          </span>
        ) : null}
      </div>
    </section>
  )
}
