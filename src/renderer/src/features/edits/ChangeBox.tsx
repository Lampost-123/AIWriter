// The change box (2026-10-19, "Keep this, change that"; changeStore.ts holds what it is about): over the foot of the page,
// the passage's sentences to click to keep word for word (marked, as a quick ask that is on), the direction composer for
// what to change (Enter changes it; ↑, the quick asks and Recent as everywhere), and Change it. Esc or × closes it and
// the page has the keyboard again. While it is open, the words it is about are marked softly in the page; a change to them
// closes it. Owned by the AI edits part.
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { countWords } from '@shared/defaults'
import { sentencesOf } from '@shared/revise'
import { Button, IconButton } from '@/components/ui'
import { SquarePen, X } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { DirectionComposer } from '@/features/direction/DirectionComposer'
import { mapRange } from './suggestions'
import {
  canSubmit,
  clearKeeps,
  closeChangeBox,
  mapTarget,
  setChangeNote,
  submitChange,
  submitLabel,
  toggleKeep,
  useChangeBox,
  type ChangeTarget
} from './changeStore'
import { BREAK, newParagraphs } from './text'
import { parseEmphasis } from '@/features/editor/streamText'

/** The box over the foot of the page, for the scene on show. */
export function ChangeBoxLayer({ editor, sceneId }: { editor: Editor; sceneId: ID | null }): React.JSX.Element | null {
  const target = useChangeBox((s) => s.target)
  const seq = useChangeBox((s) => s.seq)
  // Another scene: the box goes (its words aren't on show any more).
  useEffect(() => {
    const t = useChangeBox.getState().target
    if (t && t.sceneId !== sceneId) closeChangeBox(false)
  }, [sceneId])
  // The words it is about move with the page; a change inside them closes it.
  useEffect(() => {
    if (!target || target.kind === 'change') return
    const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
      if (!transaction.docChanged) return
      const t = useChangeBox.getState().target
      if (!t || t.kind === 'change') return
      const m = mapRange(t, transaction)
      mapTarget((pos, assoc) => transaction.mapping.map(pos, assoc), typeof m === 'string')
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor, target])
  if (!target || target.sceneId !== sceneId) return null
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-4">
      <ChangeBox key={seq} target={target} />
    </div>
  )
}

/** One sentence of the passage, where it is among them all. */
interface Shown {
  text: string
  i: number
}

function ChangeBox({ target }: { target: ChangeTarget }): React.JSX.Element {
  const note = useChangeBox((s) => s.note)
  const keeps = useChangeBox((s) => s.keeps)
  const state = { target, note, keeps }
  const boxRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  // The passage's paragraphs and their sentences, numbered in order (a scene break shows as one).
  const paras = useMemo(() => {
    let n = 0
    const out: (Shown[] | 'break')[] = []
    const broken = newParagraphs(target.text).filter((p) => p === BREAK).length
    const sentences = sentencesOf(target.text)
    // A scene break among the paragraphs shows where it was (sentencesOf leaves it out).
    if (!broken) return sentences.map((p) => p.map((s) => ({ text: s.text, i: n++ })))
    let k = 0
    for (const p of newParagraphs(target.text)) {
      if (p === BREAK) out.push('break')
      else if (sentences[k]) out.push(sentences[k++].map((s) => ({ text: s.text, i: n++ })))
    }
    return out
  }, [target.text])
  const count = paras.reduce((n, p) => n + (p === 'break' ? 0 : p.length), 0)
  /** The sentence the keyboard is on among them (Tab reaches one; the arrows move between them). */
  const [at, setAt] = useState(0)
  const kept = new Set(keeps)
  const words = countWords(target.text)
  const beat = target.kind === 'beat'

  useEffect(() => {
    boxRef.current?.focus()
  }, [])

  const go = async (): Promise<void> => {
    if (busy || !canSubmit(state)) return
    setBusy(true)
    await submitChange()
  }

  const moveTo = (i: number): void => {
    const n = Math.max(0, Math.min(count - 1, i))
    setAt(n)
    listRef.current?.querySelector<HTMLElement>(`[data-sentence="${n}"]`)?.focus()
  }

  return (
    <section
      role="dialog"
      aria-label="Change it"
      data-change-box=""
      data-covers-page=""
      onKeyDown={(e) => {
        if (e.key !== 'Escape' || e.defaultPrevented) return
        // Esc in one of the box's own lists (Recent) closes that list first.
        if ((e.target as Element | null)?.closest?.('[data-radix-popper-content-wrapper]')) return
        e.preventDefault()
        closeChangeBox()
      }}
      className="pointer-events-auto w-full max-w-[680px] rounded-xl border border-line bg-surface px-4 pb-3 pt-2.5 font-sans shadow-pop animate-slide-up"
    >
      <header className="flex h-7 items-center gap-2">
        <SquarePen size={14} className="shrink-0 text-ai" aria-hidden />
        <h2 className="shrink-0 text-[13px] font-semibold text-fg">Change it</h2>
        <span className="min-w-0 truncate text-[12.5px] text-muted">
          {target.what} · {words.toLocaleString('en-GB')} {words === 1 ? 'word' : 'words'}
        </span>
        <span className="flex-1" />
        <IconButton label="Close (Esc)" size="sm" onClick={() => closeChangeBox()}>
          <X size={14} />
        </IconButton>
      </header>
      <div className="mt-1 flex h-6 items-center gap-2 text-[12px]">
        <span className="min-w-0 flex-1 truncate text-faint">
          {count > 1 ? 'Click the sentences to keep word for word. The rest can change.' : 'Click the sentence to keep it word for word.'}
        </span>
        {keeps.length ? (
          <>
            <span className="shrink-0 tabular-nums text-muted" aria-live="polite">
              {keeps.length} kept
            </span>
            <button
              type="button"
              onClick={clearKeeps}
              className="shrink-0 rounded-sm font-medium text-muted underline-offset-2 hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-focus"
            >
              Clear
            </button>
          </>
        ) : null}
      </div>
      <div
        ref={listRef}
        role="group"
        aria-label="Sentences to keep"
        className="mt-1 max-h-[min(34vh,300px)] overflow-y-auto rounded-lg border border-line/70 bg-page px-3 py-2.5 font-serif text-[14px] leading-[1.65] text-fg"
        onKeyDown={(e) => {
          const i = Number((e.target as HTMLElement).getAttribute('data-sentence'))
          if (!Number.isFinite(i)) return
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault()
            moveTo(i + 1)
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault()
            moveTo(i - 1)
          } else if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault()
            moveTo(e.key === 'Home' ? 0 : count - 1)
          }
        }}
      >
        {paras.map((p, k) =>
          p === 'break' ? (
            <p key={k} className="my-2 text-center text-[12px] tracking-[0.3em] text-faint" aria-hidden>
              * * *
            </p>
          ) : (
            <p key={k} className="mb-2 last:mb-0">
              {p.map((s) => {
                const on = kept.has(s.text)
                return (
                  <span key={s.i}>
                    <span
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`Keep: ${plain(s.text)}`}
                      data-sentence={s.i}
                      data-kept={on || undefined}
                      tabIndex={s.i === at ? 0 : -1}
                      onFocus={() => setAt(s.i)}
                      onClick={() => toggleKeep(s.text)}
                      onKeyDown={(e) => {
                        if (e.key !== ' ' && e.key !== 'Enter') return
                        e.preventDefault()
                        toggleKeep(s.text)
                      }}
                      title={on ? 'Kept word for word. Click to let it change.' : 'Click to keep this sentence word for word.'}
                      className={cn(
                        'cursor-pointer rounded-[3px] outline-none transition-[background-color,box-shadow] duration-(--dur-quick) [box-decoration-break:clone] [-webkit-box-decoration-break:clone]',
                        'focus-visible:shadow-[0_0_0_2px_var(--focus)]',
                        on ? 'bg-accent-soft shadow-[inset_0_-1.5px_0_color-mix(in_srgb,var(--accent)_55%,transparent)]' : 'hover:bg-surface-2'
                      )}
                    >
                      <Words text={s.text} />
                    </span>{' '}
                  </span>
                )
              })}
            </p>
          )
        )}
      </div>
      <div className="mt-2.5 flex items-start gap-2">
        <DirectionComposer
          kind="rewrite"
          boxRef={boxRef}
          className="min-w-0 flex-1"
          minRows={1}
          maxRows={4}
          value={note}
          onChange={setChangeNote}
          onSubmit={() => void go()}
          side="top"
          maxLength={2000}
          ariaLabel={beat ? `What to change in ${target.what.toLowerCase()}` : 'What to change'}
          placeholder={beat ? 'What should change? (or leave it empty to write it afresh)' : 'What should change? “Closer, but shorter”'}
        />
        <Button
          variant="ai"
          className="h-[35px] w-[132px]"
          icon={<SquarePen size={14} />}
          disabled={busy || !canSubmit(state)}
          onClick={() => void go()}
          title={canSubmit(state) ? 'Change it (Enter in the box). The new version waits for you to accept or reject it.' : 'Say what to change first'}
        >
          {submitLabel(state)}
        </Button>
      </div>
    </section>
  )
}

/** A sentence as it reads, italics and bold shown. */
function Words({ text }: { text: string }): React.JSX.Element {
  return (
    <>
      {parseEmphasis(text).map((piece, j) => {
        const w = piece.italic ? <em>{piece.text}</em> : piece.text
        return <span key={j}>{piece.bold ? <strong>{w}</strong> : w}</span>
      })}
    </>
  )
}

/** A sentence without its emphasis markers, for its name. */
const plain = (text: string): string =>
  parseEmphasis(text)
    .map((p) => p.text)
    .join('')
