// Under an answer, on hover or focus (chat overhaul Phase 2): Copy · Save to… · Retry · ⋯ (What the AI saw, and what
// it cost). It replaces the Save line and the "What the AI saw" line that showed under every turn. Its row is always
// there, so nothing moves when it shows; what stays shown is how the answer ended ("Stopped") and a note saved from it.
import * as M from '@radix-ui/react-dropdown-menu'
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { SavedNote } from '@shared/contracts/ask'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { BookmarkPlus, Check, ChevronDown, Copy, Eye, MoreHorizontal, RotateCcw } from '@/components/ui/icons'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { kindWord } from '@/features/peek/entryView'
import { markSaved, useAsk, type AskPlace, type ShownTurn } from './askStore'
import { savedMessage } from './askWords'
import { citedTargets, plainAnswer, type LinkTarget } from './citations'
import { openEntry } from './CiteChip'

const menuItem = 'flex items-center gap-2 rounded-md px-2 py-1.5 text-[13.5px] outline-none data-[highlighted]:bg-surface-2 data-[disabled]:text-faint'
const barButton =
  'inline-flex h-7 min-w-0 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50 data-[state=open]:bg-surface-2 data-[state=open]:text-fg'

/** The words selected inside `el`, or ''. */
function selectedIn(el: HTMLElement | null): string {
  const sel = document.getSelection()
  if (!el || !sel || sel.isCollapsed || !sel.rangeCount) return ''
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer) || !el.contains(r.endContainer)) return ''
  return sel.toString().trim()
}

/** The words selected inside an element, kept up to date. */
function useSelectionIn(ref: RefObject<HTMLElement | null>): string {
  const [text, setText] = useState('')
  useEffect(() => {
    const update = (): void => setText(selectedIn(ref.current))
    document.addEventListener('selectionchange', update)
    return () => document.removeEventListener('selectionchange', update)
  }, [ref])
  return text
}

/** The toast's Undo: the note comes out again. */
async function undoNote(generationId: ID, note: SavedNote): Promise<void> {
  try {
    await api.undoAskNote(note.undo, generationId)
    if (useAsk.getState().saved[generationId] === note) markSaved(generationId, null)
  } catch (e) {
    toast(`Couldn’t undo that. ${(e as Error).message}`, { tone: 'danger' })
  }
}

/**
 * "Save to Mara Venn": the answer (or the words selected in it) goes into the memory as Adam's own note, on the first
 * page it cites; the arrow beside it offers the others, or a new page in Lore. With nothing cited it becomes a new
 * page in Lore.
 */
function SaveButtons({
  turn,
  answerRef,
  index,
  place,
  reveal
}: {
  turn: ShownTurn
  answerRef: RefObject<HTMLElement | null>
  index: Map<string, LinkTarget>
  place: AskPlace
  /** How the bar's buttons show (on hover or focus); a saved note's line shows regardless. */
  reveal: string
}): React.JSX.Element {
  const cited = useMemo(() => citedTargets(turn.answer, index), [turn.answer, index])
  const selection = useSelectionIn(answerRef)
  const saved = useAsk((s) => s.saved[turn.generationId])
  const [busy, setBusy] = useState(false)
  // The words selected when the pointer went down on a button (a click can clear the selection first).
  const held = useRef('')
  const hold = (): void => {
    held.current = selectedIn(answerRef.current)
  }
  const first = cited[0] ?? null

  const save = async (target: LinkTarget | null): Promise<void> => {
    const words = held.current || selectedIn(answerRef.current) || plainAnswer(turn.answer)
    held.current = ''
    if (busy) return
    setBusy(true)
    try {
      const note = await api.saveAskNote({
        text: words,
        entryId: target?.id ?? null,
        question: turn.question,
        storyId: place.storyId,
        sceneId: place.sceneId,
        // Kept with the answer's record, so it shows "Saved" after a restart too.
        generationId: turn.generationId
      })
      markSaved(turn.generationId, note)
      toast(savedMessage(note), {
        tone: 'success',
        action: { label: 'Undo', run: () => void undoNote(turn.generationId, note) },
        secondary: { label: 'Open', run: () => openEntry(note.entryId, note.kind) }
      })
    } catch (e) {
      toast(`Couldn’t save that. ${(e as Error).message}`, { tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const label = selection ? (first ? `Save selection to ${first.name}` : 'Save selection to Lore') : first ? `Save to ${first.name}` : 'Save to Lore'
  const hint = `${selection ? 'Adds the words you selected' : 'Adds this answer'} to ${first ? `the memory for ${first.name}` : 'a new page in Lore'}, as your own note. Nothing else changes.`

  return (
    // A saved note's line, and Save while words in the answer are selected, show without hovering.
    <span className={cn('flex min-w-0 items-center', !saved && !selection && reveal)}>
      {saved && !selection ? (
        // Shown whether or not the bar is: the answer is kept in the memory.
        <span className="flex min-w-0 items-center gap-1.5 px-1.5 text-[12.5px] text-faint" data-saved>
          <Check size={12} className="shrink-0 text-success" aria-hidden />
          <span className="truncate">Saved to {saved.created ? 'Lore' : saved.name}</span>
        </span>
      ) : (
        <button
          type="button"
          disabled={busy}
          title={hint}
          aria-label={label}
          onPointerDown={hold}
          // Keeps the selection while the button is pressed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void save(first)}
          className={barButton}
        >
          <BookmarkPlus size={13} className="shrink-0" aria-hidden />
          <span className="max-w-[9rem] truncate">{label}</span>
        </button>
      )}
      {cited.length ? (
        <M.Root
          onOpenChange={(open) => {
            // Closed without choosing: the words held for it are let go.
            if (!open) queueMicrotask(() => (held.current = ''))
          }}
        >
          <M.Trigger disabled={busy} aria-label="Save somewhere else" title="Save somewhere else" onPointerDown={hold} onKeyDown={hold} className={cn(barButton, 'w-6 justify-center px-0')}>
            <ChevronDown size={13} />
          </M.Trigger>
          <M.Portal>
            <M.Content
              align="start"
              sideOffset={4}
              collisionPadding={8}
              // The selection stays where it was: the keyboard goes back to the answer's buttons.
              onCloseAutoFocus={(e) => e.preventDefault()}
              className="z-50 w-[260px] max-w-[calc(100vw-16px)] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
            >
              <M.Label className="px-2 pb-1 pt-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                {held.current || selection ? 'Save the selection to' : 'Save to'}
              </M.Label>
              {cited.map((t) => (
                <M.Item key={t.id} onSelect={() => void save(t)} className={menuItem}>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  <span className="shrink-0 text-[12px] text-faint">{kindWord(t.kind)}</span>
                </M.Item>
              ))}
              <M.Separator className="my-1 h-px bg-line" />
              <M.Item onSelect={() => void save(null)} className={menuItem}>
                A new page in Lore
              </M.Item>
            </M.Content>
          </M.Portal>
        </M.Root>
      ) : null}
    </span>
  )
}

export function ActionBar({
  turn,
  answerRef,
  index,
  place,
  hasAnswer,
  recorded,
  endNote,
  cost,
  onRetry
}: {
  turn: ShownTurn
  answerRef: RefObject<HTMLElement | null>
  index: Map<string, LinkTarget>
  place: AskPlace
  hasAnswer: boolean
  /** The turn has a record ("What the AI saw" can open it). */
  recorded: boolean
  /** How the answer ended, when not simply ("Stopped", "Cut short", "Didn’t get an answer"): always shown. */
  endNote: string | null
  /** What it cost, in words ("about $0.002"), once known. */
  cost: string | null
  /** Asks the same question again; absent when it can't be now. */
  onRetry?: () => void
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copy = (): void => {
    void navigator.clipboard
      .writeText(plainAnswer(turn.answer))
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => toast('Couldn’t copy that.', { tone: 'danger' }))
  }
  // The buttons show on hover or focus (or while a menu of theirs is open), in room kept for them.
  const reveal = cn(
    'transition-opacity duration-[140ms] group-hover/turn:opacity-100 group-hover/turn:duration-150 group-focus-within/turn:opacity-100 has-[[data-state=open]]:opacity-100',
    menuOpen ? 'opacity-100' : 'opacity-0'
  )
  return (
    <div className="mt-1.5 flex h-7 min-w-0 items-center gap-0.5" data-action-bar>
      {endNote ? (
        <span className="mr-1 shrink-0 px-1 text-[12px] text-faint" data-end-note>
          {endNote}
        </span>
      ) : null}
      {hasAnswer ? (
        <button type="button" onClick={copy} className={cn(barButton, reveal)} aria-label={copied ? 'Copied' : 'Copy the answer'} title="Copy the answer">
          {copied ? <Check size={13} className="text-success" aria-hidden /> : <Copy size={13} aria-hidden />}
        </button>
      ) : null}
      {hasAnswer ? <SaveButtons turn={turn} answerRef={answerRef} index={index} place={place} reveal={reveal} /> : null}
      <span className={cn('flex min-w-0 items-center gap-0.5', reveal)}>
        {onRetry ? (
          <button type="button" onClick={onRetry} className={barButton} aria-label="Retry: ask this again" title="Ask this question again">
            <RotateCcw size={13} aria-hidden />
          </button>
        ) : null}
        {recorded ? (
          <M.Root onOpenChange={setMenuOpen}>
            <M.Trigger className={cn(barButton, 'w-7 justify-center px-0')} aria-label="More about this answer" title="More about this answer">
              <MoreHorizontal size={14} />
            </M.Trigger>
            <M.Portal>
              <M.Content
                align="start"
                sideOffset={4}
                collisionPadding={8}
                className="z-50 w-[220px] max-w-[calc(100vw-16px)] rounded-lg border border-line bg-surface p-1 shadow-pop data-[state=open]:animate-pop-in"
              >
                <M.Item onSelect={() => useApp.getState().navigate({ kind: 'generation', generationId: turn.generationId })} className={menuItem}>
                  <Eye size={14} className="text-muted" /> What the AI saw
                </M.Item>
                {cost ? (
                  <M.Label className="px-2 pb-1 pt-1 text-[12px] tabular-nums text-faint" data-cost>
                    Cost: {cost}
                  </M.Label>
                ) : null}
              </M.Content>
            </M.Portal>
          </M.Root>
        ) : null}
      </span>
    </div>
  )
}
