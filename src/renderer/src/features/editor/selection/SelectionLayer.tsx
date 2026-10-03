// The small bar over words Adam selects in the page: Bold and Italic (writing by hand), the AI tools
// ("Rewrite", milestone 4), "Add to memory" and "Quick start a character".
// It shows once the selection settles (after the mouse is let go, or a moment after the keyboard
// stops), never while a draft is being written into the selected part, and goes on Esc, typing, or a
// click elsewhere. It sits in the page's scrolling area, so it moves with the words, and it is not a
// pop-up layer: Ctrl+Enter, Ctrl+G and Esc keep working while it shows. Its buttons never take the
// selection or the caret from the page.
import * as P from '@radix-ui/react-popover'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { BookmarkPlus, UserPlus } from '@/components/ui/icons'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { takeEscape } from '@/lib/escape'
import { activeStream } from '../streamDoc'
import { nameIndex } from '../names/underlines'
import { useSceneNames } from '../names/sceneNames'
import { REVEALED } from '../reveal'
import { AddToMemoryForm } from './AddToMemoryForm'
import { ListenFromHere } from '@/features/readAloud/ListenFromHere'
import { MarkButtons } from '@/features/typing/MarkButtons'
import { AiTools } from '@/features/edits/AiTools'
import { suggestionsOf } from '@/features/edits/suggestions'
import { FORM_EDGE, FORM_GAP, FORM_SIZE, formPlace, prefill, tidySelection, type AddPrefill, type FormPlace } from './addToMemoryLogic'

/** How long the selection must stay still before the bar shows: after the mouse is let go, and after keys. */
const AFTER_MOUSE = 200
const AFTER_KEYS = 450
const BAR_HEIGHT = 34
const GAP = 8
const EDGE = 8

interface Bar {
  from: number
  to: number
  text: string
  /** In the scrolling area's own coordinates: the top, and where it lines up (centred over one line, or from where the words start). */
  top: number
  x: number
  align: 'centre' | 'start'
}

export function SelectionLayer({
  editor,
  sceneId,
  scrollerRef
}: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const writing = useApp((s) => s.view.kind === 'write')
  const { data: names } = useSceneNames(sceneId, writing)
  const [bar, setBar] = useState<Bar | null>(null)
  const [form, setForm] = useState<AddPrefill | null>(null)
  // Where the form shows, chosen as it opens and kept while it is open.
  const [place, setPlace] = useState<FormPlace>({ side: 'bottom', sideOffset: FORM_GAP, alignOffset: 0, room: FORM_SIZE.height })
  const barRef = useRef<HTMLDivElement>(null)
  const formOpen = useRef(false)
  formOpen.current = !!form
  // The AI tools' menu is open (the bar stays while it is).
  const toolsOpen = useRef(false)
  const barShown = useRef(false)
  barShown.current = !!bar
  const barNow = useRef<Bar | null>(null)
  barNow.current = bar
  // The selection the bar was closed for (Esc, or after adding): it stays closed until another is made.
  const closedFor = useRef<string | null>(null)

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement
    let timer: ReturnType<typeof setTimeout> | undefined
    let mouseDown = false

    const hide = (): void => {
      clearTimeout(timer)
      if (!formOpen.current && !toolsOpen.current) setBar(null)
    }

    /** Where the bar goes over the words from `from` to `to`. */
    const placeFor = (from: number, to: number, text: string, scroller: HTMLElement): Bar => {
      const box = scroller.getBoundingClientRect()
      const start = editor.view.coordsAtPos(from, 1)
      const end = editor.view.coordsAtPos(to, -1)
      // Above the first line when there's room in view, else below the last; and not over the buttons of the
      // AI's change waiting in the page (milestone 4, and the room it makes for them) when the other side is clear.
      const buttons = ['[data-ai-change]', '.aw-sugg-room'].map((q) => scroller.querySelector(q)?.getBoundingClientRect())
      const clear = (top: number): boolean => buttons.every((r) => !r || !r.height || top + BAR_HEIGHT <= r.top || top >= r.bottom)
      const aboveTop = start.top - BAR_HEIGHT - GAP
      const belowTop = end.bottom + GAP
      const above = start.top - box.top >= BAR_HEIGHT + GAP + EDGE && (clear(aboveTop) || !clear(belowTop))
      const top = (above ? aboveTop : belowTop) - box.top + scroller.scrollTop
      const oneLine = Math.abs(start.top - end.top) < 4
      const x = (oneLine ? (start.left + end.right) / 2 : start.left) - box.left
      return { from, to, text, top, x, align: oneLine ? 'centre' : 'start' }
    }

    const show = (): void => {
      if (editor.isDestroyed || mouseDown || formOpen.current || toolsOpen.current) return
      const { state, view } = editor
      const sel = state.selection
      const scroller = scrollerRef.current
      if (sel.empty || !scroller || !view.hasFocus() || useApp.getState().view.kind !== 'write') return hide()
      // Not over words a draft is being written into.
      const stream = activeStream(state)
      if (stream && sel.to > stream.from) return hide()
      if (closedFor.current === `${sel.from}:${sel.to}`) return
      const text = tidySelection(state.doc.textBetween(sel.from, sel.to, '\n\n', '\n'))
      if (!text) return hide()
      setBar(placeFor(sel.from, sel.to, text, scroller))
    }

    // The AI's change in the page grows, goes or comes back (its words arriving, Accept, Reject): the words
    // after it move, and the bar moves with them.
    let lastChange = suggestionsOf(editor.state)
    const onTransaction = (): void => {
      const now = suggestionsOf(editor.state)
      if (now === lastChange) return
      lastChange = now
      const b = barNow.current
      const scroller = scrollerRef.current
      const sel = editor.state.selection
      if (!b || !scroller || editor.isDestroyed || mouseDown || formOpen.current || toolsOpen.current || sel.empty) return
      const next = placeFor(sel.from, sel.to, b.text, scroller)
      if (next.top !== b.top || next.x !== b.x || next.from !== b.from || next.to !== b.to) setBar(next)
    }

    const settle = (ms: number): void => {
      clearTimeout(timer)
      timer = setTimeout(show, ms)
    }

    const onMouseDown = (e: MouseEvent): void => {
      if (e.button !== 0) return
      mouseDown = true
      closedFor.current = null
      hide()
    }
    const onMouseUp = (): void => {
      if (!mouseDown) return
      mouseDown = false
      settle(AFTER_MOUSE)
    }
    const onSelection = ({ transaction }: { transaction: Transaction }): void => {
      if (mouseDown || formOpen.current || toolsOpen.current) return
      const sel = editor.state.selection
      if (sel.empty) return hide()
      if (barShown.current) setBar(null)
      // Words the app selected to show them (where a fact came from, a search match) aren't offered:
      // the bar waits for a selection Adam makes himself.
      if (transaction.getMeta(REVEALED)) {
        clearTimeout(timer)
        closedFor.current = `${sel.from}:${sel.to}`
        return
      }
      settle(AFTER_KEYS)
    }
    const onUpdate = (): void => {
      // Typing over the words, or a draft reaching them, closes it; a draft further down leaves it be.
      const sel = editor.state.selection
      const stream = activeStream(editor.state)
      if (sel.empty || (stream && sel.to > stream.from)) hide()
    }
    const onBlur = ({ event }: { event: FocusEvent }): void => {
      const to = event.relatedTarget as Node | null
      if (to && (barRef.current?.contains(to) || (to instanceof Element && to.closest('[data-add-to-memory], [data-ai-tools]')))) return
      hide()
    }
    // Esc closes the bar (and nothing else: it takes the press, so a draft being written carries on); the caret stays.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !barShown.current || formOpen.current || toolsOpen.current || e.defaultPrevented) return
      e.preventDefault()
      takeEscape(e)
      const sel = editor.state.selection
      closedFor.current = `${sel.from}:${sel.to}`
      const fromBar = !!barRef.current?.contains(document.activeElement)
      hide()
      if (fromBar) editor.view.focus()
    }

    dom.addEventListener('mousedown', onMouseDown)
    window.addEventListener('mouseup', onMouseUp)
    window.addEventListener('keydown', onKey, true)
    editor.on('selectionUpdate', onSelection)
    editor.on('update', onUpdate)
    editor.on('blur', onBlur)
    editor.on('transaction', onTransaction)
    return () => {
      clearTimeout(timer)
      dom.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKey, true)
      editor.off('selectionUpdate', onSelection)
      editor.off('update', onUpdate)
      editor.off('blur', onBlur)
      editor.off('transaction', onTransaction)
    }
  }, [editor, scrollerRef])

  // Another scene, or another page over this one: it goes.
  useEffect(() => {
    setForm(null)
    setBar(null)
    toolsOpen.current = false
    closedFor.current = null
  }, [sceneId, writing])

  // Kept inside the page's width, once its own width is known.
  const [left, setLeft] = useState(0)
  useLayoutEffect(() => {
    const el = barRef.current
    const scroller = scrollerRef.current
    if (!bar || !el || !scroller) return
    const w = el.offsetWidth
    const want = bar.align === 'centre' ? bar.x - w / 2 : bar.x - 6
    setLeft(Math.round(Math.max(EDGE, Math.min(want, scroller.clientWidth - w - EDGE))))
  }, [bar, scrollerRef])

  if (!bar || !writing || !sceneId) return null

  /** Back to the page with the words still selected. */
  const backToPage = (): void => {
    if (!editor.isDestroyed) editor.view.focus()
  }

  const closeForm = (added: boolean): void => {
    setForm(null)
    if (added) {
      // Done with these words: the bar stays closed until another selection.
      closedFor.current = `${bar.from}:${bar.to}`
      setBar(null)
    }
  }

  const openForm = (): void => {
    const el = barRef.current
    if (!names || !el) return
    setPlace(formPlace(el.getBoundingClientRect(), { width: window.innerWidth, height: window.innerHeight }))
    setForm(prefill(bar.text, nameIndex(), new Map(names.entries.map((e) => [e.id, e]))))
  }

  const quickStart = (): void => {
    const start = { notes: bar.text, sceneId, mode: 'quick' as const }
    useApp.getState().navigate({ kind: 'builder', entryKind: 'character', entryId: null, start })
  }

  return (
    <P.Root open={!!form} onOpenChange={(open) => !open && closeForm(false)}>
      {/* The form opens beside the bar, lined up with its edge (or over it, in a short window). */}
      <P.Anchor asChild>
        <div
          ref={barRef}
          role="toolbar"
          aria-label="Selected words"
          // Pressing a button keeps the words selected and the caret in the page (and never reaches the page below).
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          // Tabbing on past it (not back to the page or into the form) closes it.
          onBlur={(e) => {
            const to = e.relatedTarget as Node | null
            const toForm = to instanceof Element && !!to.closest('[data-add-to-memory], [data-ai-tools]')
            const staying = !!to && (e.currentTarget.contains(to) || editor.view.dom.contains(to) || toForm)
            if (!staying && !form && !toolsOpen.current) setBar(null)
          }}
          style={{ top: bar.top, left, height: BAR_HEIGHT }}
          className={cn(
            'absolute z-20 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 font-sans shadow-pop animate-fade-in',
            'select-none whitespace-nowrap'
          )}
        >
          <MarkButtons editor={editor} />
          <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
          <AiTools
            editor={editor}
            from={bar.from}
            to={bar.to}
            text={bar.text}
            onOpenChange={(open) => {
              toolsOpen.current = open
              if (open && form) closeForm(false)
            }}
          />
          <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
          <BarButton
            icon={<BookmarkPlus size={14} />}
            pressed={!!form}
            onClick={() => (form ? closeForm(false) : openForm())}
            disabled={!names}
          >
            Add to memory
          </BarButton>
          <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
          <BarButton icon={<UserPlus size={14} />} onClick={quickStart}>
            Quick start a character
          </BarButton>
          <ListenFromHere editor={editor} sceneId={sceneId} from={bar.from} to={bar.to} />
        </div>
      </P.Anchor>
      <P.Portal>
        <P.Content
          data-add-to-memory=""
          // On the side chosen as it opened (formPlace), never flipping while in use, and only as tall as
          // the room there: in a short window the box to type in gives up height first, then the form
          // covers the bar rather than hide any of its parts.
          side={place.side}
          align="start"
          alignOffset={place.alignOffset}
          sideOffset={place.sideOffset}
          avoidCollisions={false}
          collisionPadding={FORM_EDGE}
          style={{
            width: FORM_SIZE.width,
            height: `min(${FORM_SIZE.height}px, var(--radix-popover-content-available-height, ${place.room}px))`
          }}
          onOpenAutoFocus={(e) => e.preventDefault()}
          // A press in the form (or its lists) belongs to the form, never to the page it was opened from.
          onMouseDown={(e) => e.stopPropagation()}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            backToPage()
          }}
          // Esc closes the form only: a draft being written carries on, and the bar stays for another try.
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            closeForm(false)
          }}
          className={cn(
            'z-50 flex flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop',
            'focus:outline-none data-[state=open]:animate-pop-in'
          )}
        >
          {form && names ? <AddToMemoryForm start={form} names={names} onDone={(added) => closeForm(added)} /> : null}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

export const BarButton = ({
  icon,
  children,
  pressed,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode
  pressed?: boolean
}): React.JSX.Element => (
  <button
    type="button"
    aria-expanded={pressed === undefined ? undefined : pressed}
    className={cn(
      'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium text-fg transition-colors duration-150 hover:bg-surface-2 disabled:opacity-50',
      pressed && 'bg-surface-2'
    )}
    {...rest}
  >
    <span className="text-muted">{icon}</span>
    {children}
  </button>
)
