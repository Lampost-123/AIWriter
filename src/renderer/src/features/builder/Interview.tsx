// Interview mode: Adam asks, the character answers in character. Any reply can be saved as a sample
// line of their voice with one click. The conversation lives here only; it isn't stored in the world.
import { Check, MessageCircle, Send, Square, X } from '@/components/ui/icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { InterviewTurn } from '@shared/contracts/builder'
import type { ID } from '@shared/types'
import { Button, IconButton, Textarea, useToastsAbove } from '@/components/ui'
import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { hasSampleLine } from './builderLogic'
import type { BuildDraft } from './useBuildDraft'
import { ProblemNotice, SuggestionButton, WritingStatus } from './parts'
import { useBuilderJob } from './useBuilderJob'

const STARTERS = [
  'What do you want more than anything?',
  'Who do you trust?',
  'What are you afraid of?',
  'Tell me about where you grew up.'
]

export function InterviewPanel({
  draft,
  storyId,
  turns,
  over,
  onTurns,
  onSaveLine,
  onClose
}: {
  draft: BuildDraft
  storyId: ID | null
  /** Kept by the builder, so closing the panel and opening it again keeps the conversation. */
  turns: InterviewTurn[]
  /** Open over the step, like a drawer, when the window is too narrow for both side by side. */
  over: boolean
  onTurns: (fn: (t: InterviewTurn[]) => InterviewTurn[]) => void
  onSaveLine: (text: string) => void
  onClose: () => void
}): React.JSX.Element {
  const name = draft.values.name?.trim() ?? ''
  const [question, setQuestion] = useState('')
  const [reply, setReply] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ message: string; code?: string } | null>(null)
  // The last question asked and the conversation before it, for Try again.
  const last = useRef<{ question: string; turns: InterviewTurn[] } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  // Toasts sit above the question box, so Ask is never under one.
  const askBar = useRef<HTMLFormElement>(null)
  useToastsAbove(askBar)

  const job = useBuilderJob({
    stopOnLeave: true,
    onProgress: (p) => setReply(p.text),
    onDone: (d) => {
      setReply(null)
      const text = d.text.trim()
      if (text) onTurns((t) => [...t, { from: 'character', text }])
      // The question stays in the conversation; Try again asks it once more.
      setProblem(d.status === 'error' && d.error ? { message: d.error } : null)
    }
  })
  const running = !!job.running

  const ask = async (q: string, before: InterviewTurn[]): Promise<void> => {
    const text = q.trim()
    if (!text || running) return
    last.current = { question: text, turns: before }
    setProblem(null)
    onTurns(() => [...before, { from: 'adam', text }])
    setQuestion('')
    setReply('')
    try {
      await job.start('interview', (jobId) =>
        api.startInterview({ jobId, entryId: draft.entry?.id ?? null, values: draft.current(), turns: before, question: text, storyId })
      )
    } catch (e) {
      setReply(null)
      setProblem({ message: (e as Error).message, code: e instanceof ApiError ? e.code : undefined })
    }
  }

  // The newest words stay in view as they arrive.
  useLayoutEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns.length, reply, problem])

  useEffect(() => {
    input.current?.focus()
  }, [])

  const samples = draft.values.sampleLines ?? ''

  return (
    <aside
      aria-label="Interview"
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.nativeEvent.isComposing) return
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }}
      className={cn(
        'flex flex-col bg-surface animate-fade-in',
        // Over the step it takes the step's whole width (the rail stays), so the step is never squeezed.
        over ? 'absolute inset-y-0 left-[216px] right-0 z-10 shadow-soft' : 'w-[340px] shrink-0 border-l border-line'
      )}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line pl-4 pr-2">
        <MessageCircle size={15} className="shrink-0 text-muted" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold text-fg">{name ? `Interview ${name}` : 'Interview'}</h2>
        <IconButton label="Close the interview" size="sm" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>

      <div ref={scroller} className={cn('min-h-0 flex-1 overflow-y-auto py-4', over ? 'px-[max(16px,calc(50%_-_320px))]' : 'px-4')}>
        {!name ? (
          <p className="pt-8 text-center text-[13px] leading-relaxed text-muted">
            Give the character a name first, so there is someone to talk to.
          </p>
        ) : turns.length === 0 && reply === null ? (
          <div className="pt-4 animate-fade-in">
            <p className="text-[13px] leading-relaxed text-muted">
              Ask {name} anything and they answer in character, from what they know of themselves and your world. Save any reply as a sample
              line of their voice. The conversation isn't kept.
            </p>
            <div className="mt-4 flex flex-col items-start gap-1.5">
              {STARTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void ask(s, turns)}
                  className="rounded-full border border-line px-3 py-1 text-left text-[12.5px] text-muted transition-colors duration-150 hover:border-line-strong hover:bg-surface-2 hover:text-fg"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol aria-label="Conversation" className="flex flex-col gap-3">
            {turns.map((t, i) => (
              <li key={i} className={cn('flex flex-col', t.from === 'adam' ? 'items-end' : 'items-start')}>
                {t.from === 'adam' ? (
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-accent-soft px-3 py-2 text-[13px] leading-relaxed text-fg">
                    {t.text}
                  </p>
                ) : (
                  <>
                    <p className="max-w-[92%] whitespace-pre-wrap rounded-lg border border-line bg-page px-3 py-2 font-serif text-[14px] leading-relaxed text-fg">
                      {t.text}
                    </p>
                    <SaveLine
                      saved={hasSampleLine(samples, t.text)}
                      onSave={() => {
                        onSaveLine(t.text)
                        // The button gives way to "Saved": the keyboard goes back to the question box, so
                        // Escape still closes the interview and the next question can be typed.
                        input.current?.focus()
                      }}
                    />
                  </>
                )}
              </li>
            ))}
            {reply !== null ? (
              <li className="flex flex-col items-start">
                {reply ? (
                  <p className="max-w-[92%] whitespace-pre-wrap rounded-lg border border-line bg-page px-3 py-2 font-serif text-[14px] leading-relaxed text-fg">
                    {reply}
                  </p>
                ) : null}
                <div className="mt-1.5 flex h-6 items-center">
                  <WritingStatus text={job.running?.retrying ?? `${name} is answering…`} />
                </div>
              </li>
            ) : null}
          </ol>
        )}
        {problem ? (
          <div className="mt-3">
            <ProblemNotice
              message={problem.message}
              code={problem.code}
              onRetry={() => {
                const l = last.current
                if (l) void ask(l.question, l.turns)
              }}
            />
          </div>
        ) : null}
      </div>

      <form
        ref={askBar}
        className={cn('flex shrink-0 items-end gap-2 border-t border-line py-3', over ? 'px-[max(12px,calc(50%_-_320px))]' : 'px-3')}
        onSubmit={(e) => {
          e.preventDefault()
          void ask(question, turns)
        }}
      >
        <Textarea
          ref={input}
          value={question}
          disabled={!name}
          minRows={1}
          maxRows={5}
          aria-label={name ? `Ask ${name} something` : 'Ask something'}
          placeholder={name ? `Ask ${name} something…` : 'Give them a name first'}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void ask(question, turns)
            }
          }}
        />
        {running ? (
          <Button type="button" icon={<Square size={11} fill="currentColor" />} onClick={job.stop} title="Stop. What has arrived is kept.">
            Stop
          </Button>
        ) : (
          <Button type="submit" variant="primary" icon={<Send size={14} />} disabled={!name || !question.trim()}>
            Ask
          </Button>
        )}
      </form>
    </aside>
  )
}

function SaveLine({ saved, onSave }: { saved: boolean; onSave: () => void }): React.JSX.Element {
  if (saved) {
    return (
      <span className="mt-1 flex h-6 items-center gap-1 px-1 text-[12px] text-faint">
        <Check size={11} aria-hidden />
        Saved as a sample line
      </span>
    )
  }
  return (
    <SuggestionButton onClick={onSave} className="mt-1" title="Adds this reply to their sample lines of dialogue, in Voice">
      Save as a sample line
    </SuggestionButton>
  )
}
