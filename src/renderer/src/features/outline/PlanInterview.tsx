// "Interview me" on a scene card or a chapter: the current question (with what it is about), a box for
// the answer (dictation works there), Answer, Skip, and Done in the corner (Stop while no answer is in).
// Not a transcript: the answers are used once, at the end, to fill in the scene card's empty parts or to
// plan the chapter. Narrow enough for the scene panel. The interview itself is in planInterviewStore.ts.

import { MessageCircleQuestion, Square } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { PlanTarget } from '@shared/contracts/outline'
import { Button, Notice } from '@/components/ui'
import { settingsAction, WritingStatus } from '@/features/builder/parts'
import { MicButton } from '@/features/dictation/MicButton'
import { insertIntoBox } from '@/features/dictation/insertText'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { useApp } from '@/lib/store'
import { askingLine, planNote } from './planInterviewLogic'
import {
  answeredOf,
  answerPlanQuestion,
  closePlanInterview,
  finishPlanInterview,
  planKey,
  retryPlan,
  setPlanAnswer,
  skipPlanQuestion,
  startPlanInterview,
  usePlanInterview,
  type PlanSession
} from './planInterviewStore'

/** The interview for this scene or chapter, if one is open. */
export function usePlanSession(target: PlanTarget): PlanSession | undefined {
  const worldId = useApp((s) => s.world?.id)
  return usePlanInterview((st) => st.sessions[planKey(worldId, target)])
}

const BUTTON_TITLES = {
  scene:
    'The AI asks you a few short questions about what this scene card doesn’t say yet, then fills in its empty parts from your answers.',
  chapter: 'The AI asks you a few short questions about this chapter, then suggests its goal and scene cards from your answers.'
}

/** A quiet "Interview me", as "Ideas for this scene" is. Hidden while the interview is open. */
export function InterviewButton({ target }: { target: PlanTarget }): React.JSX.Element | null {
  const s = usePlanSession(target)
  if (s) return null
  return (
    <button
      type="button"
      onClick={() => startPlanInterview(target)}
      title={BUTTON_TITLES[target.kind]}
      className="-mx-1.5 inline-flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <MessageCircleQuestion size={14} className="shrink-0 text-ai" aria-hidden />
      Interview me
    </button>
  )
}

/** The interview, while one is open for this scene or chapter. */
export function PlanInterview({ target, className }: { target: PlanTarget; className?: string }): React.JSX.Element | null {
  const s = usePlanSession(target)
  const box = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLElement>(null)
  const open = !!s

  // A new question: the answer box is ready for it.
  useEffect(() => {
    if (s?.phase === 'question') box.current?.focus({ preventScroll: true })
  }, [s?.phase, s?.question])

  // Opening it brings it into view (only as far as needed).
  useEffect(() => {
    if (open) panel.current?.scrollIntoView({ block: 'nearest' })
  }, [open])

  if (!s) return null
  const kind = target.kind
  const asking = s.phase === 'asking'
  const filling = s.phase === 'filling'
  const answered = answeredOf(s) + (s.phase === 'question' && s.answer.trim() ? 1 : 0)
  const number = s.asked.length + 1
  const done =
    kind === 'scene'
      ? 'Stop asking and fill in the card from your answers'
      : 'Stop asking and suggest the chapter’s scenes from your answers'
  return (
    <section
      ref={panel}
      aria-label="Interview"
      aria-busy={asking || filling}
      className={`scroll-mt-4 rounded-xl border border-line bg-surface px-3.5 pb-3 pt-2.5 shadow-sm animate-fade-in ${className ?? ''}`}
    >
      <div className="flex h-7 items-center gap-2">
        <MessageCircleQuestion size={14} className="shrink-0 text-ai" aria-hidden />
        <h3 className="min-w-0 truncate text-[11.5px] font-semibold uppercase tracking-wide text-faint">
          Interview {filling ? null : <span className="font-normal normal-case tracking-normal tabular-nums">· Question {number}</span>}
        </h3>
        <div className="flex-1" />
        {filling || s.failed === 'fill' ? (
          <Button
            size="sm"
            variant="ghost"
            icon={<Square size={10} fill="currentColor" />}
            onClick={() => closePlanInterview(target)}
            title="Stop. The card stays as it is."
          >
            Stop
          </Button>
        ) : answered ? (
          <Button size="sm" variant="ghost" onClick={() => finishPlanInterview(target)} title={done}>
            Done
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            icon={<Square size={10} fill="currentColor" />}
            onClick={() => finishPlanInterview(target)}
            title="Stop the interview"
          >
            Stop
          </Button>
        )}
      </div>

      {/* The question, or what is happening instead. At least two lines high, so the box below stays put. */}
      <div className="mt-1 min-h-[52px]">
        {s.phase === 'problem' && s.problem ? (
          <Problem message={s.problem.message} code={s.problem.code} onRetry={() => retryPlan(target)} />
        ) : asking || filling ? (
          <div className="pt-1">
            <WritingStatus text={filling ? 'Filling in the card from your answers…' : askingLine(kind, number)} />
          </div>
        ) : (
          <div role="status" aria-live="polite" className="animate-fade-in">
            <p className="text-[12px] font-medium text-ai">{s.topic}</p>
            <p className="mt-0.5 text-[14.5px] font-medium leading-snug text-fg">{s.question}</p>
          </div>
        )}
      </div>

      {s.phase === 'problem' || filling ? null : (
        <form
          className="mt-1"
          onSubmit={(e) => {
            e.preventDefault()
            answerPlanQuestion(target)
          }}
        >
          <div className="flex items-end justify-between gap-2">
            <label htmlFor={`plan-answer-${kind}`} className="block text-[12px] font-medium text-muted">
              Your answer
            </label>
            <MicButton disabled={asking} onText={(t) => box.current && insertIntoBox(box.current, t, (v) => setPlanAnswer(target, v))} />
          </div>
          <AutoTextarea
            ref={box}
            id={`plan-answer-${kind}`}
            value={s.answer}
            disabled={asking}
            minRows={2}
            maxRows={8}
            placeholder={asking ? '' : 'Type your answer, in your own words…'}
            className="mt-1 text-[14px] leading-[1.55]"
            onChange={(e) => setPlanAnswer(target, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                answerPlanQuestion(target)
              } else if (e.key === 'Escape' && !s.answer.trim()) {
                e.preventDefault()
                e.stopPropagation()
                finishPlanInterview(target)
              }
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Button type="submit" size="sm" variant="primary" disabled={asking || !s.answer.trim()}>
              Answer
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={asking}
              onClick={() => skipPlanQuestion(target)}
              title="Skip this question"
            >
              Skip
            </Button>
            <p className="ml-auto min-w-0 text-right text-[12px] text-faint">{planNote(kind, answeredOf(s))}</p>
          </div>
        </form>
      )}
    </section>
  )
}

/** What went wrong and its next step, with the buttons under the words so it fits the narrow scene panel. */
function Problem({ message, code, onRetry }: { message: string; code?: string; onRetry: () => void }): React.JSX.Element {
  const settings = settingsAction(message, code)
  return (
    <div role="alert">
      <Notice tone="danger">
        {message}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {settings ? (
            <Button size="sm" onClick={settings.run}>
              {settings.label}
            </Button>
          ) : null}
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        </div>
      </Notice>
    </div>
  )
}
