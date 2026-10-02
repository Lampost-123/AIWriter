// The small bar over words Adam selects in the page: "Add to memory" and "Quick start a character".
// It shows once the selection settles (after the mouse is let go, or a moment after the keyboard
// stops), never while a draft is being written into the selected part, and goes on Esc, typing, or a
// click elsewhere. It sits in the page's scrolling area, so it moves with the words, and it is not a
// pop-up layer: Ctrl+Enter, Ctrl+G and Esc keep working while it shows. Its buttons never take the
// selection or the caret from the page.
import * as P from '@radix-ui/react-popover'
import type { Editor } from '@tiptap/core'
import { BookmarkPlus, UserPlus } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { cn } from '@/lib/cn'
import { activeStream } from '../streamDoc'
import { nameIndex } from '../names/underlines'
import { useSceneNames } from '../names/sceneNames'
import { AddToMemoryForm } from './AddToMemoryForm'
import { prefill, tidySelection, type AddPrefill } from './addToMemoryLogic'

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
  const barRef = useRef<HTMLDivElement>(null)
  const formOpen = useRef(false)
  formOpen.current = !!form
  const barShown = useRef(false)
  barShown.current = !!bar
  // The selection the bar was closed for (Esc, or after adding): it stays closed until another is made.
  const closedFor = useRef<string | null>(null)

  useEffect(() => {
    const dom = editor.view.dom as HTMLElement
    let timer: ReturnType<typeof setTimeout> | undefined
    let mouseDown = false

    const hide = (): void => {
      clearTimeout(timer)
      if (!formOpen.current) setBar(null)
    }

    const show = (): void => {
      if (editor.isDestroyed || mouseDown || formOpen.current) return
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
      const box = scroller.getBoundingClientRect()
      const start = view.coordsAtPos(sel.from, 1)
      const end = view.coordsAtPos(sel.to, -1)
      // Above the first line when there's room in view, else below the last.
      const above = start.top - box.top >= BAR_HEIGHT + GAP + EDGE
      const top = (above ? start.top - BAR_HEIGHT - GAP : end.bottom + GAP) - box.top + scroller.scrollTop
      const oneLine = Math.abs(start.top - end.top) < 4
      const x = (oneLine ? (start.left + end.right) / 2 : start.left) - box.left
      setBar({ from: sel.from, to: sel.to, text, top, x, align: oneLine ? 'centre' : 'start' })
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
    const onSelection = (): void => {
      if (mouseDown || formOpen.current) return
      const sel = editor.state.selection
      if (sel.empty) return hide()
      if (barShown.current) setBar(null)
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
      if (to && (barRef.current?.contains(to) || (to instanceof Element && to.closest('[data-add-to-memory]')))) return
      hide()
    }
    // Esc closes the bar (and nothing else: a draft being written carries on); the caret stays.
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || !barShown.current || formOpen.current || e.defaultPrevented) return
      e.preventDefault()
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
    return () => {
      clearTimeout(timer)
      dom.removeEventListener('mousedown', onMouseDown)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('keydown', onKey, true)
      editor.off('selectionUpdate', onSelection)
      editor.off('update', onUpdate)
      editor.off('blur', onBlur)
    }
  }, [editor, scrollerRef])

  // Another scene, or another page over this one: it goes.
  useEffect(() => {
    setForm(null)
    setBar(null)
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

  const quickStart = (): void => {
    const start = { notes: bar.text, sceneId, mode: 'quick' as const }
    useApp.getState().navigate({ kind: 'builder', entryKind: 'character', entryId: null, start })
  }

  const kinds = new Map((names?.entries ?? []).map((e) => [e.id, e]))

  return (
    <P.Root open={!!form} onOpenChange={(open) => !open && closeForm(false)}>
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
          const toForm = to instanceof Element && !!to.closest('[data-add-to-memory]')
          const staying = !!to && (e.currentTarget.contains(to) || editor.view.dom.contains(to) || toForm)
          if (!staying && !form) setBar(null)
        }}
        style={{ top: bar.top, left, height: BAR_HEIGHT }}
        className={cn(
          'absolute z-20 flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5 font-sans shadow-pop animate-fade-in',
          'select-none whitespace-nowrap'
        )}
      >
        <P.Anchor asChild>
          <BarButton
            icon={<BookmarkPlus size={14} />}
            pressed={!!form}
            onClick={() => (form ? closeForm(false) : names && setForm(prefill(bar.text, nameIndex(), kinds)))}
            disabled={!names}
          >
            Add to memory
          </BarButton>
        </P.Anchor>
        <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
        <BarButton icon={<UserPlus size={14} />} onClick={quickStart}>
          Quick start a character
        </BarButton>
      </div>
      <P.Portal>
        <P.Content
          data-add-to-memory=""
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => {
            e.preventDefault()
            backToPage()
          }}
          // Esc closes the form only: a draft being written carries on, and the bar stays for another try.
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            closeForm(false)
          }}
          className="z-50 w-[340px] rounded-xl border border-line bg-surface p-4 shadow-pop focus:outline-none data-[state=open]:animate-pop-in"
        >
          {form && names ? <AddToMemoryForm start={form} names={names} onDone={(added) => closeForm(added)} /> : null}
        </P.Content>
      </P.Portal>
    </P.Root>
  )
}

const BarButton = ({
  icon,
  children,
  pressed,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: React.ReactNode
  pressed?: boolean
  ref?: React.Ref<HTMLButtonElement>
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
