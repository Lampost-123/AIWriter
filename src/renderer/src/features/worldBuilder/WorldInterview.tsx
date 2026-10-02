// "Interview me" on the World builder page: the button beside the summary box, and the interview itself
// under it: the current question (with what it is about), a box for the answer (dictation works there),
// Add to summary, Skip and Stop, and a small note of how many answers are in. Not a transcript: each
// answer goes straight into the summary above, in Adam's own words. Owned by the World builder part.

import { MessageCircleQuestion, Plus, Square } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Button } from '@/components/ui'
import { ProblemNotice, WritingStatus } from '@/features/builder/parts'
import { MicButton } from '@/features/dictation/MicButton'
import { insertIntoBox } from '@/features/dictation/insertText'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { interviewNote } from './interviewLogic'
import {
  answerQuestion,
  retryQuestion,
  setInterviewAnswer,
  skipQuestion,
  startInterview,
  stopInterview,
  useInterview
} from './interviewStore'

/** The button beside the summary box. Hidden while an interview is open (Stop is in it). */
export function InterviewButton({ disabled }: { disabled?: boolean }): React.JSX.Element | null {
  const open = useInterview((s) => s.open)
  if (open) return null
  return (
    <Button
      size="sm"
      variant="ghost"
      icon={<MessageCircleQuestion size={14} />}
      disabled={disabled}
      onClick={startInterview}
      title="The AI asks you short questions about what your summary is missing. Each answer is added to it in your own words."
    >
      Interview me
    </Button>
  )
}

/** Scrolls the page around the interview (never the window) just far enough to show all of it. */
function showWhole(el: HTMLElement | null): void {
  const page = el?.closest<HTMLElement>('.overflow-y-auto')
  if (!el || !page) return
  const box = el.getBoundingClientRect()
  const view = page.getBoundingClientRect()
  const by = box.bottom + 16 > view.bottom ? Math.min(box.bottom + 16 - view.bottom, box.top - view.top - 16) : 0
  if (by <= 0) return
  let still = false
  try {
    still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    // Smooth, then.
  }
  page.scrollBy({ top: by, behavior: still ? 'auto' : 'smooth' })
}

/** The interview under the summary box, while one is open. It ends when the page closes or a build starts. */
export function WorldInterview({ running }: { running: boolean }): React.JSX.Element | null {
  const s = useInterview()
  const box = useRef<HTMLTextAreaElement>(null)
  const panel = useRef<HTMLElement>(null)

  // Leaving the page, or starting a build, ends the interview (an answer typed is added first).
  useEffect(() => () => stopInterview(), [])
  useEffect(() => {
    if (running) stopInterview()
  }, [running])

  // A new question: the answer box is ready for it.
  useEffect(() => {
    if (s.open && s.phase === 'question') box.current?.focus({ preventScroll: true })
  }, [s.open, s.phase, s.question])

  // An answer added: the summary box shows its end, where the answer went in.
  const added = useRef(s.added)
  useEffect(() => {
    const more = s.added > added.current
    added.current = s.added
    const summary = document.getElementById('world-summary')
    if (more && summary) summary.scrollTop = summary.scrollHeight
  }, [s.added])

  // Opening it, and each new question (the summary above grows with each answer): the whole interview
  // comes into view, moving only the page, and no more than it needs.
  useEffect(() => {
    if (s.open) showWhole(panel.current)
  }, [s.open, s.question])

  if (!s.open) return null
  const asking = s.phase === 'asking'
  const number = s.asked.length + 1
  return (
    <section
      ref={panel}
      aria-label="Interview"
      className="mt-3 rounded-xl border border-line bg-surface px-4 pb-3 pt-3 shadow-sm animate-fade-in"
    >
      <div className="flex h-7 items-center gap-2">
        <MessageCircleQuestion size={14} className="shrink-0 text-ai" aria-hidden />
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-faint">
          Interview <span className="font-normal normal-case tracking-normal tabular-nums">· Question {number}</span>
        </h2>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          icon={<Square size={10} fill="currentColor" />}
          onClick={stopInterview}
          title={s.answer.trim() ? 'Stop the interview. The answer you typed is added first.' : 'Stop the interview'}
        >
          Stop
        </Button>
      </div>

      {/* The question, or what is happening instead. Always at least two lines high, so the box below stays put. */}
      <div className="mt-1 min-h-[60px]">
        {s.phase === 'problem' && s.problem ? (
          <ProblemNotice message={s.problem.message} code={s.problem.code} onRetry={retryQuestion} />
        ) : asking ? (
          <div className="pt-1">
            <WritingStatus text={number === 1 ? 'Reading your summary…' : 'Thinking of the next question…'} />
          </div>
        ) : (
          <div role="status" aria-live="polite" className="animate-fade-in">
            <p className="text-[12px] font-medium text-ai">{s.topic}</p>
            <p className="mt-0.5 text-[15px] font-medium leading-snug text-fg">{s.question}</p>
          </div>
        )}
      </div>

      {s.phase === 'problem' ? null : (
        <form
          className="mt-1"
          onSubmit={(e) => {
            e.preventDefault()
            answerQuestion()
          }}
        >
          <div className="flex items-end justify-between gap-2">
            <label htmlFor="world-interview-answer" className="block text-[12px] font-medium text-muted">
              Your answer
            </label>
            <MicButton disabled={asking} onText={(t) => box.current && insertIntoBox(box.current, t, setInterviewAnswer)} />
          </div>
          <AutoTextarea
            ref={box}
            id="world-interview-answer"
            value={s.answer}
            disabled={asking}
            minRows={2}
            maxRows={8}
            placeholder={asking ? '' : 'Type your answer, in your own words…'}
            className="mt-1 text-[14px] leading-[1.55]"
            onChange={(e) => setInterviewAnswer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                answerQuestion()
              }
            }}
          />
          <div className="mt-2 flex items-center gap-2">
            <Button type="submit" size="sm" variant="primary" icon={<Plus size={14} />} disabled={asking || !s.answer.trim()}>
              Add to summary
            </Button>
            <Button type="button" size="sm" variant="ghost" disabled={asking} onClick={skipQuestion} title="Skip this question">
              Skip
            </Button>
            <p className="ml-auto min-w-0 truncate text-right text-[12px] text-faint">{interviewNote(s.added)}</p>
          </div>
        </form>
      )}
    </section>
  )
}
