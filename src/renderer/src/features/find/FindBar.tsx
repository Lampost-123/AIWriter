// Find and replace in the open scene (Writing by hand, Ctrl+F): a small bar over the top of the page, never
// pushing the words down. Matches are marked in the page (highlights.ts), the current one more strongly; Enter
// and Shift+Enter go to the next and previous; Esc closes it and puts the keyboard back in the page. Replace and
// Replace all go through the editor (pageEdits.ts), so Ctrl+Z undoes them, Replace all in one step. Nothing is
// replaced while a draft is being written into the scene, nor inside an AI suggestion waiting there.
import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import { redo } from '@tiptap/pm/history'
import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import type { ID } from '@shared/types'
import { Button, IconButton, Input, toast } from '@/components/ui'
import { modKey } from '@/lib/api'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { takeEscape } from '@/lib/escape'
import { isShortcut, withShortcut } from '@/lib/shortcuts'
import { useFind } from './findStore'
import { anchorAfter, findStateOf, setCurrentTr, setFindInputs } from './highlights'
import { isKept, replaceMatchesTr } from './pageEdits'
import { openFindInStory } from './open'
import { BUSY_MESSAGE, IN_SUGGESTION_MESSAGE, times } from './words'
import './find.css'


export function FindBar({
  editor,
  sceneId,
  scrollerRef
}: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const open = useFind((s) => s.sceneOpen)
  const shown = open && !!sceneId
  const query = useFind((s) => s.query)
  const replacement = useFind((s) => s.replacement)
  const matchCase = useFind((s) => s.matchCase)
  const wholeWord = useFind((s) => s.wholeWord)
  const focusTick = useFind((s) => s.focusTick)
  const set = useFind((s) => s.set)
  const findRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState({ n: 0, current: -1 })
  const [top, setTop] = useState(56)
  /** Adam went through the matches (Enter, the arrows, Replace): Esc leaves the current one selected. */
  const moved = useRef(false)
  /** Where the caret was as the bar opened: the first match shown is the first after it. */
  const startAt = useRef(0)

  // The count follows the page (typing, Ctrl+Z, another scene).
  useEffect(() => {
    const read = (): void => {
      const st = findStateOf(editor.state)
      setCount((c) => (c.n === st.matches.length && c.current === st.current ? c : { n: st.matches.length, current: st.current }))
    }
    read()
    editor.on('transaction', read)
    return () => {
      editor.off('transaction', read)
    }
  }, [editor])

  /** Brings a match into view (a third of the way down) when it is out of sight or under the bar. */
  const reveal = useCallback(
    (index?: number) => {
      const el = scrollerRef.current
      const st = findStateOf(editor.state)
      const m = st.matches[index ?? st.current]
      if (!el || !m) return
      try {
        const box = el.getBoundingClientRect()
        const at = editor.view.coordsAtPos(m.from)
        const b = barRef.current?.getBoundingClientRect()
        const underBar = !!b && at.bottom > b.top && at.top < b.bottom + 4 && at.right > b.left && at.left < b.right
        if (at.top >= box.top + 8 && at.bottom <= box.bottom - 24 && !underBar) return
        el.scrollTop = Math.max(0, el.scrollTop + at.top - box.top - el.clientHeight / 3)
      } catch {
        // The position is gone: nothing to show.
      }
    },
    [editor, scrollerRef]
  )

  // What is being found goes to the page, which marks every match.
  useEffect(() => {
    if (!shown) return
    setFindInputs({ active: true, query, opts: { matchCase, wholeWord } }, editor.view, startAt.current)
    reveal()
  }, [shown, query, matchCase, wholeWord, editor, reveal])

  // Another scene opened while the bar shows: its matches, from its start (or the match the story's list opened).
  useEffect(() => {
    if (!shown) return
    // After the page has taken the new scene (it shows it just after this runs).
    queueMicrotask(() => {
      if (editor.isDestroyed) return
      startAt.current = 0
      setFindInputs({ active: true, query, opts: { matchCase, wholeWord } }, editor.view, 0)
      const goTo = useFind.getState().goTo
      if (goTo && goTo.sceneId === sceneId) {
        useFind.getState().set({ goTo: null })
        editor.view.dispatch(setCurrentTr(editor.state, goTo.index))
        moved.current = true
        requestAnimationFrame(() => reveal())
      }
    })
    // Only when the scene changes (or the bar opens); the effect above follows the words.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId, shown])

  // Closing takes the marks away.
  useEffect(() => {
    if (shown) return
    if (!editor.isDestroyed && findStateOf(editor.state).matches.length) setFindInputs({ active: false, query: '', opts: {} }, editor.view)
    else setFindInputs({ active: false, query: '', opts: {} })
  }, [shown, editor])

  // Opening (or Ctrl+F again) puts the keyboard in the find box, its words selected.
  useLayoutEffect(() => {
    if (!shown) return
    if (!findRef.current?.matches(':focus')) startAt.current = editor.state.selection.from
    moved.current = false
    findRef.current?.focus()
    findRef.current?.select()
  }, [shown, focusTick, editor])

  // The bar sits just over the top of the page, below anything above the page (the reading bar, a guide).
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!shown || !el) return
    const place = (): void => setTop(el.offsetTop + 10)
    place()
    const ro = new ResizeObserver(place)
    ro.observe(el)
    return () => ro.disconnect()
  }, [shown, scrollerRef])

  if (!shown) return null

  const go = (step: 1 | -1): void => {
    const st = findStateOf(editor.state)
    if (!st.matches.length) return
    editor.view.dispatch(setCurrentTr(editor.state, st.current + step))
    moved.current = true
    reveal()
  }

  const close = (): void => {
    const view = editor.view
    const st = findStateOf(view.state)
    const m = st.matches[st.current]
    set({ sceneOpen: false })
    // The caret goes back into the page: on the current match if Adam went through them, else where it was.
    if (moved.current && m) view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, m.from, m.to)).setMeta('addToHistory', false))
    view.focus()
  }

  const busy = (): boolean => {
    if (!editorBridge()?.busy()) return false
    toast(BUSY_MESSAGE)
    return true
  }

  /**
   * After a replace that leaves nothing to find, the buttons turn off and would drop the keyboard: it goes to the bar
   * itself first, so Ctrl+Z still reaches onBarKey.
   */
  const keepKeyboard = (): void => {
    const bar = barRef.current
    if (!bar || findStateOf(editor.state).matches.length) return
    if (!bar.contains(document.activeElement) || document.activeElement instanceof HTMLButtonElement) bar.focus()
  }

  const replaceOne = (): void => {
    const view = editor.view
    const st = findStateOf(view.state)
    const m = st.matches[st.current]
    if (!m || busy()) return
    if (isKept(view.state, m)) {
      toast(IN_SUGGESTION_MESSAGE)
      go(1)
      return
    }
    const r = replaceMatchesTr(view.state, [m], replacement)
    if (!r) return
    view.dispatch(anchorAfter(r.tr, r.end))
    // Typing straight after is a step of its own.
    view.dispatch(closeHistory(view.state.tr))
    moved.current = true
    reveal()
    keepKeyboard()
  }

  const replaceAll = (): void => {
    const view = editor.view
    const st = findStateOf(view.state)
    if (!st.matches.length || busy()) return
    const r = replaceMatchesTr(view.state, st.matches, replacement)
    if (!r) {
      toast(st.matches.length === 1 ? IN_SUGGESTION_MESSAGE : 'Those are all inside the AI’s suggested change. Accept or reject the change first.')
      return
    }
    view.dispatch(r.tr)
    view.dispatch(closeHistory(view.state.tr))
    keepKeyboard()
    const left = r.kept ? ` ${r.kept === 1 ? 'One' : r.kept} inside the AI’s suggested change ${r.kept === 1 ? 'was' : 'were'} left as ${r.kept === 1 ? 'it is' : 'they are'}.` : ''
    toast(`Replaced ${times(r.count)} in this scene. ${modKey()}+Z puts ${r.count === 1 ? 'it' : 'them'} back.${left}`)
  }

  const onFindKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      go(e.shiftKey ? -1 : 1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      takeEscape(e.nativeEvent)
      close()
    }
  }

  const onReplaceKey = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault()
      replaceOne()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      takeEscape(e.nativeEvent)
      close()
    }
  }

  /**
   * Ctrl+Z and Ctrl+Y pressed on the bar's buttons or switches (after Replace or Replace all, say) undo and redo in
   * the page, as the message after Replace all says. In the Find and Replace boxes they undo typing there.
   */
  const onBarKey = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.target instanceof HTMLInputElement || e.nativeEvent.isComposing) return
    const undoing = isShortcut(e, 'undo')
    if (!undoing && !isShortcut(e, 'redo')) return
    e.preventDefault()
    if (undoing) editorBridge()?.undo()
    else if (!editorBridge()?.busy()) redo(editor.view.state, editor.view.dispatch)
  }

  const has = count.n > 0
  return (
    <div
      ref={barRef}
      role="search"
      aria-label="Find in this scene"
      style={{ top }}
      // Presses here stay here (the page puts the caret at the end on a press below its words).
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={onBarKey}
      tabIndex={-1}
      className="absolute right-4 z-20 w-[420px] outline-none max-w-[calc(100%-32px)] rounded-lg border border-line bg-surface p-2 shadow-pop animate-fade-in"
    >
      <div className="flex items-center gap-1.5">
        <Input
          ref={findRef}
          value={query}
          onChange={(e) => set({ query: e.target.value })}
          onKeyDown={onFindKey}
          placeholder="Find"
          aria-label="Find"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 text-[13px]"
        />
        <span className="w-[74px] shrink-0 text-right text-[12px] tabular-nums text-muted" aria-live="polite">
          {query.trim() ? (has ? `${count.current + 1} of ${count.n.toLocaleString()}` : 'No matches') : ''}
        </span>
        <IconButton size="sm" label="Previous match (Shift+Enter)" disabled={!has} onClick={() => go(-1)}>
          <ChevronUp size={15} />
        </IconButton>
        <IconButton size="sm" label="Next match (Enter)" disabled={!has} onClick={() => go(1)}>
          <ChevronDown size={15} />
        </IconButton>
        <IconButton size="sm" label="Close (Esc)" onClick={close}>
          <X size={14} />
        </IconButton>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Input
          value={replacement}
          onChange={(e) => set({ replacement: e.target.value })}
          onKeyDown={onReplaceKey}
          placeholder="Replace with"
          aria-label="Replace with"
          spellCheck={false}
          className="h-7 min-w-0 flex-1 text-[13px]"
        />
        <Button size="sm" disabled={!has} onClick={replaceOne}>
          Replace
        </Button>
        <Button size="sm" disabled={!has} onClick={replaceAll}>
          Replace all
        </Button>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        <Toggle on={matchCase} onChange={(v) => set({ matchCase: v })}>
          Match case
        </Toggle>
        <Toggle on={wholeWord} onChange={(v) => set({ wholeWord: v })}>
          Whole word
        </Toggle>
        <button
          type="button"
          onClick={() => openFindInStory()}
          title={withShortcut('Find and replace in the whole story', 'findInStory')}
          className="ml-auto rounded-md px-2 py-1 text-[12px] text-muted transition-colors duration-150 hover:bg-surface-2 hover:text-fg"
        >
          In the whole story…
        </button>
      </div>
    </div>
  )
}

/** A small switch with its words on it ("Match case"). */
export function Toggle({ on, onChange, children }: { on: boolean; onChange: (on: boolean) => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={cn(
        'rounded-md border px-2 py-0.5 text-[12px] transition-colors duration-150',
        on ? 'border-accent/50 bg-accent-soft text-fg' : 'border-line text-muted hover:bg-surface-2 hover:text-fg'
      )}
    >
      {children}
    </button>
  )
}
