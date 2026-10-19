// The director's line by a directed draft, while it writes (Adam's spec, "Directed writing (an option)"): what the
// director just decided, in a few plain words ("Director: carry on — next, the knock at the door"), its note for the next
// stretch, and a box for Adam's own note ("slower", "she wouldn't say that"; typed, or dictated as in any text box) that
// goes in at the next pause. Small and quiet: it lies over the foot of the page (above the AI dock on the desk), never
// over the words being written, and goes a moment after the draft ends. Text never moves: a new line simply replaces the
// last.
import { useEffect, useId, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { Drama, Send } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { listenForDirector, sendNote, useDirector } from './store'

/** No notes (one array for all, so the store's selectors keep giving the same one). */
const NONE: string[] = []

export function DirectorBar({ sceneId, className }: { sceneId: ID; className?: string }): React.JSX.Element | null {
  useEffect(listenForDirector, [])
  const p = useDirector((s) => s.byScene[sceneId])
  const sent = useDirector((s) => (p ? (s.sent[p.generationId] ?? NONE) : NONE))
  const taken = useDirector((s) => (p ? (s.taken[p.generationId] ?? NONE) : NONE))
  const [note, setNote] = useState('')
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  // Another draft (or scene): the box starts empty.
  const gen = p?.generationId ?? null
  useEffect(() => setNote(''), [gen])
  if (!p) return null
  const writing = !p.ended

  const send = async (): Promise<void> => {
    const text = note.trim()
    if (!text || sending || !writing) return
    setSending(true)
    const ok = await sendNote(p.generationId, text)
    setSending(false)
    if (ok) setNote('')
    inputRef.current?.focus()
  }

  const step = p.of > 0 ? (p.stretch > p.of ? `${p.stretch}` : `${p.stretch} of ${p.of}`) : null
  const hint = sent.length
    ? sent.length === 1
      ? 'Your note goes in at the next pause.'
      : `Your ${sent.length} notes go in at the next pause.`
    : taken.length && writing
      ? taken.length === 1
        ? 'Your note went in.'
        : 'Your notes went in.'
      : null

  return (
    <section
      aria-label="Director"
      data-director={p.phase}
      className={cn(
        'pointer-events-auto w-full max-w-[560px] rounded-xl border border-line bg-surface/95 px-3 py-2 shadow-pop backdrop-blur-sm animate-fade-in',
        className
      )}
    >
      <div className="flex min-w-0 items-center gap-2 text-[12.5px] leading-5" role="status" aria-live="polite">
        <Drama size={14} className="shrink-0 text-ai" aria-hidden />
        <span className="shrink-0 font-medium text-fg">Director</span>
        <span className="min-w-0 flex-1 truncate text-muted" data-director-line title={p.line}>
          {p.line}
        </span>
        {step && writing ? (
          <span className="shrink-0 tabular-nums text-[11.5px] text-faint" title="Stretch">
            {step}
          </span>
        ) : null}
      </div>
      {p.note && writing ? (
        <p className="mt-0.5 truncate pl-[22px] text-[12px] leading-[18px] text-faint" data-director-note title={p.note}>
          Note: {p.note}
        </p>
      ) : null}
      {writing ? (
        <form
          className="mt-1.5 flex items-center gap-1.5 pl-[22px]"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <label htmlFor={id} className="sr-only">
            Your note for the next stretch
          </label>
          <input
            ref={inputRef}
            id={id}
            type="text"
            value={note}
            maxLength={400}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              // Esc here leaves the box; it never stops the draft (Stop does).
              if (e.key === 'Escape') {
                e.stopPropagation()
                inputRef.current?.blur()
              }
            }}
            placeholder="A note for the next stretch: “slower”, “she wouldn’t say that”"
            className="h-7 min-w-0 flex-1 rounded-md border border-line bg-page px-2 text-[12.5px] text-fg outline-none transition-colors duration-150 placeholder:text-faint focus:border-accent"
          />
          <button
            type="submit"
            disabled={!note.trim() || sending}
            aria-label="Send the note"
            title="Send the note (Enter)"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40"
          >
            <Send size={13} aria-hidden />
          </button>
        </form>
      ) : null}
      {hint ? <p className="mt-1 pl-[22px] text-[11.5px] leading-4 text-faint" data-director-hint>{hint}</p> : null}
    </section>
  )
}
