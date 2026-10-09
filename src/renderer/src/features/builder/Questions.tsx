// The follow-up questions after Quick start's notes, as a short conversation in the builder's style: the AI's questions
// in its amber bubbles, one at a time, and Adam's answers as cards of his own on the other side. Each can be answered
// in a line, skipped, or left to the AI to decide; then one click builds the entry from the notes and the answers, and
// the builder opens at Review with the finished card (QuickStart.tsx). Nothing is saved until it is built.
import { Check, RotateCcw, Sparkles, Square } from '@/components/ui/icons'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { BuilderKind } from '@shared/contracts/builder'
import { Button } from '@/components/ui'
import { cn } from '@/lib/cn'
import { scrollBehavior } from '@/features/look/motion'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { ProblemNotice, WritingStatus } from './parts'
import { askQuestions, replyToQuestion, skipTheRest, SKIP, stopQuickStart, undoReply, type QuickChat, type QuickReply } from './quickStartStore'
import { api } from '@/lib/api'

/** One of the AI's lines: an amber bubble with the lamp beside it. */
function Ai({ label, children, busy }: { label?: string; children: ReactNode; busy?: boolean }): React.JSX.Element {
  return (
    <li className="qs-row is-ai">
      <span aria-hidden className={cn('qs-lamp', busy && 'is-busy')} />
      <div className="qs-ai">
        {label ? <div className="qs-ai-label">{label}</div> : null}
        <div className="qs-ai-text">{children}</div>
      </div>
    </li>
  )
}

/** Adam's reply to a question: his words as a card of his own, or a quiet note that he skipped it or left it to the AI. */
function Reply({ reply }: { reply: QuickReply }): React.JSX.Element {
  return (
    <li className="qs-row is-me">
      {typeof reply === 'string' ? (
        <div className="qs-me">{reply}</div>
      ) : reply === null ? (
        <div className="qs-chip is-ai">
          <Sparkles size={12} aria-hidden />
          Left to the AI
        </div>
      ) : (
        <div className="qs-chip">Skipped</div>
      )}
    </li>
  )
}

export function Questions({
  kind,
  chat,
  storyId,
  building,
  status,
  buildLabel,
  onBuild
}: {
  kind: BuilderKind
  chat: QuickChat
  storyId: string | null
  /** The entry is being built from the notes and the answers now. */
  building: boolean
  /** What the build is doing now ("Building Brann Holt…"). */
  status: string
  buildLabel: string
  onBuild: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const n = chat.replies.length
  const asking = !!chat.jobId
  const current = chat.questions[n]
  const answeredAll = !asking && chat.questions.length > 0 && n >= chat.questions.length
  const none = !asking && !chat.problem && chat.questions.length === 0
  const who = kind === 'character' ? 'them' : 'it'
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)

  // Each new question (or the last word) comes into view, and the answer box takes the keyboard.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
    box.current?.focus({ preventScroll: true })
  }, [n, chat.questions.length, answeredAll])

  const reply = (r: QuickReply): void => {
    replyToQuestion(kind, r)
    setDraft('')
  }

  return (
    <section aria-label="Follow-up questions" className="qs-chat">
      <ol className="qs-list">
        <Ai>A few quick questions, so the {kind} comes out the way you see {who}. Answer each in a line, skip any, or let me decide.</Ai>
        {chat.questions.map((q, i) =>
          i > n ? null : (
            <Fragment key={i}>
              <Ai label={`Question ${i + 1} of ${chat.questions.length}${asking ? '…' : ''}`}>{q}</Ai>
              {i < n ? <Reply reply={chat.replies[i]} /> : null}
            </Fragment>
          )
        )}
        {asking && !current ? (
          <Ai busy>
            <WritingStatus text={chat.retrying ?? 'Thinking of a few questions…'} />
          </Ai>
        ) : null}
        {none ? <Ai>No questions this time: the notes say enough to go on.</Ai> : null}
        {answeredAll && !building ? <Ai>That’s plenty to go on. Build it, and it opens at Review to look over.</Ai> : null}
      </ol>

      {chat.problem ? (
        <div className="mt-2">
          <ProblemNotice message={chat.problem.message} code={chat.problem.code} onRetry={() => void askQuestions(kind, storyId)} />
        </div>
      ) : null}

      {current !== undefined && !building ? (
        <div className="qs-answer">
          <label htmlFor="qs-answer-box" className="sr-only">
            Your answer: {current}
          </label>
          <AutoTextarea
            ref={box}
            id="qs-answer-box"
            key={n}
            value={draft}
            minRows={1}
            maxRows={5}
            placeholder="Your answer, in a line"
            className="qs-answer-box"
            onChange={(e) => setDraft(e.target.value.replace(/[\r\n]+/g, ' '))}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              if (draft.trim()) reply(draft)
            }}
          />
          <div className="qs-answer-row">
            <Button variant="primary" size="sm" disabled={!draft.trim()} onClick={() => reply(draft)} icon={<Check size={13} />}>
              Answer
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="qs-decide"
              icon={<Sparkles size={13} />}
              title="The AI decides this one when it builds"
              onClick={() => reply(null)}
            >
              Let the AI decide
            </Button>
            <Button size="sm" variant="ghost" onClick={() => reply(SKIP)}>
              Skip
            </Button>
            <div className="flex-1" />
            {n > 0 ? (
              <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => undoReply(kind)} title="Answer the last question again">
                Back
              </Button>
            ) : null}
            {!asking && chat.questions.length - n > 1 ? (
              <Button size="sm" variant="ghost" onClick={() => skipTheRest(kind)}>
                Skip the rest
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {asking ? (
        <div className="qs-answer-row mt-2">
          <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={() => chat.jobId && void api.stopBuilder(chat.jobId)}>
            Stop asking
          </Button>
        </div>
      ) : null}

      {(answeredAll || none || (chat.problem && !asking)) && !building ? (
        <div className="qs-build">
          <Button variant="ai" size="lg" icon={<Sparkles size={15} />} onClick={onBuild}>
            {buildLabel}
          </Button>
          {answeredAll ? (
            <Button variant="ghost" size="lg" icon={<RotateCcw size={14} />} onClick={() => undoReply(kind)}>
              Change the last answer
            </Button>
          ) : null}
        </div>
      ) : null}
      {building ? (
        <div className="qs-build">
          <Button size="lg" icon={<Square size={11} fill="currentColor" />} onClick={() => stopQuickStart(kind)} title="Stop. What has fully arrived is kept and saved.">
            Stop
          </Button>
          <WritingStatus text={status} />
        </div>
      ) : null}
      <div ref={end} />
    </section>
  )
}
