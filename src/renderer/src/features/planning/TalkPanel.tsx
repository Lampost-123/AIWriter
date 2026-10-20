// Talking a plan over with the AI (talkStore.ts): the turns so far, the answer arriving, the revision waiting as a
// preview with Apply and Decline, and a box to say what to change. Quick asks sit above the box. Nothing changes
// until Apply (or straight away, where the page allows it and Adam has said so; Undo is in a toast); Stop keeps what
// was said. The same panel serves the outline, the codex list and a recipe.

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, MessagesSquare, RotateCcw, Send, Sparkles, Square, SquarePen, X } from '@/components/ui/icons'
import { Button, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { modKey } from '@/lib/api'
import { AutoTextarea } from '@/features/world/parts/AutoTextarea'
import { LampStatus } from './LampThinking'
import { clearTalk, dismissTalkError, stopTalk, takeBackLast, useTalks, type Talk } from './talkStore'

const EMPTY: Talk = { turns: [], running: null, preview: null, error: null }

const AUTO_KEY = 'aiwrite.talk.autoApply'
const readAuto = (): boolean => {
  try {
    return localStorage.getItem(AUTO_KEY) === '1'
  } catch {
    return false
  }
}

/** The AI's mark beside its answers. */
function Lamp(): React.JSX.Element {
  return (
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ai/15 text-ai" aria-hidden>
      <Sparkles size={12} />
    </span>
  )
}

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
  canApplyStraightAway = false,
  applyLabel = 'Apply',
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
  /** Applying can be undone here, so Adam may have changes applied as they come. */
  canApplyStraightAway?: boolean
  /** The words on the button that makes the change (the Plan hub: "Make this change"). */
  applyLabel?: string
  className?: string
}): React.JSX.Element {
  const talk = useTalks((s) => s.talks[scope]) ?? EMPTY
  const [text, setText] = useState('')
  const [auto, setAuto] = useState(readAuto)
  const id = useId()
  const end = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const running = !!talk.running
  const blocked = running || !!disabled
  const waiting = !!(talk.preview && preview)
  const applyNow = canApplyStraightAway && auto

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [talk.turns.length, running, talk.running?.text, waiting, !!talk.error])

  // Changes applied as they come, when Adam has asked for that.
  useEffect(() => {
    if (applyNow && talk.preview) onApply()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyNow, talk.preview])

  const send = (words: string): void => {
    if (blocked || !words.trim()) return
    onSay(words.trim())
    setText('')
    box.current?.focus()
  }

  const retry = (): void => {
    const last = takeBackLast(scope)
    if (last) onSay(last)
  }

  const toggleAuto = (on: boolean): void => {
    setAuto(on)
    try {
      localStorage.setItem(AUTO_KEY, on ? '1' : '0')
    } catch {
      // Not kept; it still holds while the app is open.
    }
  }

  const talking = talk.turns.length > 0 || running

  return (
    <section aria-label={title} className={cn('flex flex-col overflow-hidden rounded-xl border border-line bg-surface', className)} data-talk={scope}>
      <header className="flex items-center gap-2 border-b border-line px-3.5 py-2.5">
        <MessagesSquare size={14} className="text-ai" aria-hidden />
        <h2 className="flex-1 text-[12.5px] font-semibold text-fg">{title}</h2>
        {talking && !running ? (
          <button
            type="button"
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-faint transition-colors duration-150 hover:bg-ai/10 hover:text-fg"
            onClick={() => clearTalk(scope)}
            title="Start a new talk. Nothing in the plan changes."
          >
            <SquarePen size={11} aria-hidden /> New talk
          </button>
        ) : null}
      </header>

      <div className="flex max-h-[min(62vh,600px)] flex-col gap-3 overflow-y-auto px-3.5 py-3" aria-live="polite">
        {!talking ? (
          <div className="flex flex-col gap-2.5">
            <p className="text-[12.5px] leading-relaxed text-muted">{intro}</p>
            {quick.length && !disabled ? (
              <div className="flex flex-col gap-1.5">
                {quick.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-left text-[12.5px] text-muted transition-colors duration-150 hover:border-ai/40 hover:bg-ai-soft hover:text-fg"
                    onClick={() => send(q)}
                  >
                    <Sparkles size={12} className="shrink-0 text-ai" aria-hidden />
                    {q}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {talk.turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="flex justify-end animate-fade-in">
              <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-accent/12 px-3 py-2 text-[13px] leading-relaxed text-fg">
                {t.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex items-start gap-2 animate-fade-in">
              <Lamp />
              <div className="min-w-0 max-w-[88%]">
                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-tl-md border border-ai/20 bg-ai-soft px-3 py-2 text-[13px] leading-relaxed text-fg">
                  {t.text}
                </div>
                {t.changes?.length ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="What changed">
                    {t.changes.slice(0, 8).map((c, j) => (
                      <li key={j} className="max-w-full truncate rounded-full border border-ai/25 bg-bg px-2 py-0.5 text-[11px] text-muted" title={c}>
                        {c}
                      </li>
                    ))}
                    {t.changes.length > 8 ? <li className="px-1 py-0.5 text-[11px] text-faint">and {t.changes.length - 8} more</li> : null}
                  </ul>
                ) : null}
                {t.outcome === 'applied' ? (
                  <span className="mt-1 flex items-center gap-1 text-[11.5px] text-success">
                    <Check size={11} aria-hidden /> Applied
                  </span>
                ) : t.outcome === 'declined' ? (
                  <span className="mt-1 block text-[11.5px] text-faint">Left as it was</span>
                ) : t.outcome === 'revised' ? (
                  <span className="mt-1 block text-[11.5px] text-faint">Built on below</span>
                ) : t.outcome === 'offered' && waiting ? (
                  <span className="mt-1 block text-[11.5px] text-ai">See the change below</span>
                ) : null}
              </div>
            </div>
          )
        )}

        {running ? (
          <div className="flex items-start gap-2">
            <Lamp />
            <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-md border border-ai/20 bg-ai-soft px-3 py-2 text-[13px] leading-relaxed">
              {talk.running?.text.trim() ? <span className="whitespace-pre-wrap">{talk.running.text.trim()}</span> : <LampStatus text="Thinking it over…" />}
              {talk.running?.note ? (
                <div className="mt-1.5">
                  <LampStatus text={talk.running.note} />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {talk.error ? (
          <Notice
            tone="danger"
            action={
              <span className="flex gap-1">
                <Button size="sm" variant="ghost" icon={<RotateCcw size={12} />} onClick={retry}>
                  Try again
                </Button>
                <Button size="sm" variant="ghost" onClick={() => dismissTalkError(scope)}>
                  OK
                </Button>
              </span>
            }
          >
            {talk.error}
          </Notice>
        ) : null}
        <div ref={end} />
      </div>

      {waiting && !applyNow ? (
        <div className="border-t border-ai/30 bg-bg animate-fade-in" data-talk-preview>
          <div className="max-h-[min(50vh,460px)] overflow-y-auto px-3.5 pt-3">
            <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">The change, before it is made</p>
            {preview}
          </div>
          <div className="flex items-center justify-end gap-2 px-3.5 py-2.5">
            <Button size="sm" variant="ghost" icon={<X size={13} />} onClick={onDecline}>
              Decline
            </Button>
            <Button size="sm" variant="primary" icon={<Check size={13} />} onClick={onApply} data-apply>
              {applyLabel}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="border-t border-line px-3.5 py-3">
        {talking && quick.length && !blocked ? (
          <div className="-mx-1 mb-2 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {quick.map((q) => (
              <button
                key={q}
                type="button"
                className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[12px] text-muted transition-colors duration-150 hover:border-ai/40 hover:text-fg"
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
        <div className="flex items-end gap-2 rounded-xl border border-line bg-bg px-2 py-1.5 transition-colors focus-within:border-ai/50">
          <AutoTextarea
            ref={box}
            id={id}
            value={text}
            minRows={1}
            maxRows={6}
            placeholder={waiting ? 'Not quite? Say what to fix, and it builds on this change.' : placeholder}
            className="flex-1 border-0! bg-transparent! px-1! text-[13.5px] ring-0!"
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
            <Button size="sm" icon={<Square size={10} fill="currentColor" />} onClick={() => stopTalk(scope)} title="Stop. Nothing is changed.">
              Stop
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ai"
              icon={<Send size={13} />}
              disabled={blocked || !text.trim()}
              onClick={() => send(text)}
              title={`Send (Enter). ${modKey()}+Enter also works.`}
            >
              Send
            </Button>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
          <span className="min-w-0 flex-[1_1_14em]">Enter to send, Shift+Enter for a new line</span>
          {canApplyStraightAway ? (
            <label className="flex cursor-pointer items-center gap-1.5 hover:text-muted">
              <input type="checkbox" className="h-3.5 w-3.5" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
              Apply changes straight away
            </label>
          ) : null}
        </div>
      </div>
    </section>
  )
}
