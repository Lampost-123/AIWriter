// Talking a plan over with the AI (talkStore.ts): the turns so far, the answer arriving, the revision waiting as a
// preview with Apply and Decline, and a box to say what to change. Quick asks sit above the box. Nothing changes
// until Apply; Stop keeps what was said. The same panel serves the outline, the codex list and a recipe.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, MessagesSquare, Send, Square, X } from '@/components/ui/icons'
import { Button, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { modKey } from '@/lib/api'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { LampStatus } from './LampThinking'
import { dismissTalkError, stopTalk, useTalks, type Talk } from './talkStore'

const EMPTY: Talk = { turns: [], running: null, preview: null, error: null }

export function TalkPanel({
  scope,
  title = 'Talk it over',
  intro,
  placeholder,
  quick = [],
  disabled = null,
  onSay,
  preview,
  onApply,
  onDecline,
  className
}: {
  scope: string
  title?: string
  /** What talking it over does here, in a line, before anything is said. */
  intro: ReactNode
  placeholder: string
  /** Quick asks: one click says them. */
  quick?: string[]
  /** Why it can't be used now (a plan still arriving), or null. */
  disabled?: string | null
  onSay: (message: string) => void
  /** The revision waiting, drawn by the page (null: none). */
  preview: ReactNode
  onApply: () => void
  onDecline: () => void
  className?: string
}): React.JSX.Element {
  const talk = useTalks((s) => s.talks[scope]) ?? EMPTY
  const [text, setText] = useState('')
  const id = useId()
  const end = useRef<HTMLDivElement>(null)
  const running = !!talk.running
  const blocked = running || !!disabled

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' })
  }, [talk.turns.length, running, !!talk.preview])

  const send = (words: string): void => {
    if (blocked || !words.trim()) return
    onSay(words.trim())
    setText('')
  }

  return (
    <section aria-label={title} className={cn('rounded-xl border border-line bg-surface', className)} data-talk={scope}>
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <MessagesSquare size={14} className="text-ai" aria-hidden />
        <h2 className="text-[12.5px] font-semibold text-fg">{title}</h2>
      </header>
      <div className="flex max-h-[420px] flex-col gap-2.5 overflow-y-auto px-3.5 py-3" aria-live="polite">
        {!talk.turns.length && !running ? <p className="text-[12.5px] leading-relaxed text-muted">{intro}</p> : null}
        {talk.turns.map((t, i) => (
          <div key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'max-w-[88%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-[13px] leading-relaxed',
                t.role === 'user' ? 'bg-accent/10 text-fg' : 'border border-ai/25 bg-ai-soft text-fg'
              )}
            >
              {t.text}
              {t.outcome === 'applied' ? (
                <span className="mt-1 flex items-center gap-1 text-[11.5px] text-success">
                  <Check size={11} aria-hidden /> Applied
                </span>
              ) : t.outcome === 'declined' ? (
                <span className="mt-1 block text-[11.5px] text-faint">Left as it was</span>
              ) : null}
            </div>
          </div>
        ))}
        {running ? (
          <div className="flex justify-start">
            <div className="max-w-[88%] rounded-lg border border-ai/25 bg-ai-soft px-3 py-2 text-[13px] leading-relaxed">
              {talk.running?.text.trim() ? <span className="whitespace-pre-wrap">{talk.running.text.trim()}</span> : <LampStatus text="Thinking it over…" />}
            </div>
          </div>
        ) : null}
        {talk.preview && preview ? (
          <div className="rounded-lg border border-ai/40 bg-bg p-3 animate-fade-in" data-talk-preview>
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">The change, before it is made</p>
            {preview}
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={onDecline}>
                Decline
              </Button>
              <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={onApply} data-apply>
                Apply
              </Button>
            </div>
          </div>
        ) : null}
        {talk.error ? (
          <Notice tone="danger" action={<Button size="sm" variant="ghost" onClick={() => dismissTalkError(scope)}>OK</Button>}>
            {talk.error}
          </Notice>
        ) : null}
        <div ref={end} />
      </div>
      <div className="border-t border-line px-3.5 py-3">
        {quick.length && !blocked ? (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                className="rounded-full border border-line px-2.5 py-1 text-[12px] text-muted transition-colors duration-150 hover:border-ai/40 hover:text-fg"
                onClick={() => send(q)}
              >
                {q}
              </button>
            ))}
          </div>
        ) : null}
        {disabled && !running ? <p className="mb-2 text-[12px] text-faint">{disabled}</p> : null}
        <label htmlFor={id} className="sr-only">
          What would you like changed?
        </label>
        <div className="flex items-end gap-2">
          <AutoTextarea
            id={id}
            value={text}
            minRows={1}
            maxRows={6}
            placeholder={placeholder}
            className="flex-1 text-[13.5px]"
            disabled={!!disabled && !running}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(text)
              }
            }}
          />
          {running ? (
            <Button icon={<Square size={11} fill="currentColor" />} onClick={() => stopTalk(scope)} title="Stop. Nothing is changed.">
              Stop
            </Button>
          ) : (
            <Button variant="ai" icon={<Send size={13} />} disabled={blocked || !text.trim()} onClick={() => send(text)} title={`Send (Enter). ${modKey()}+Enter also works.`}>
              Send
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
