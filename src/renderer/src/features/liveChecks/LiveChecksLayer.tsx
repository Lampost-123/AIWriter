// The live checks in the page: keeps the words they check against in step with the world, and shows the
// card over an underline, when the pointer rests on it (as over a name), when Adam clicks into it, when
// the caret comes to rest in it from the arrow keys, or when the Issues tab asks to show the next one.
// Tab then takes the keyboard into the card and Esc gives it back. Any other key, a press elsewhere or a
// scroll closes it, and the key goes on to the page.
import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { useEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { takeEscape } from '@/lib/escape'
import { useApp } from '@/lib/store'
import { HoverIntent, OPEN_DELAY, type HoverTarget } from '@/features/editor/names/hoverIntent'
import { LiveCard, liveCardPosition, movesIntoCard } from './LiveCard'
import { changeSpelling, ignoreFlag, rewritePhrase } from './liveActions'
import { LIVE_CLASS, liveFlagAt, liveHidden, setLiveTabHandler, type PlacedFlag } from './liveDecorations'
import { onLiveCardRequest } from './liveStore'
import { useLiveWords } from './liveWords'
import './liveChecks.css'

const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Shift', 'Alt', 'AltGraph', 'CapsLock'])
/** Keys that move the caret: resting in an underline after them shows its card. */
const MOVE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'])

/** The flag the caret is in (or just after), if the selection is empty or is exactly a flag. */
function flagAtCaret(state: EditorState): PlacedFlag | null {
  const { empty, head, from, to } = state.selection
  if (!empty) {
    const f = liveFlagAt(state, from)
    return f && f.from === from && f.to === to ? f : null
  }
  return liveFlagAt(state, head) ?? (head > 0 ? liveFlagAt(state, head - 1) : null)
}

export function LiveChecksLayer({ editor, sceneId }: { editor: Editor; sceneId: ID | null }): React.JSX.Element | null {
  const writing = useApp((s) => s.view.kind === 'write')
  useLiveWords(sceneId, writing)

  // The card over an underline: from the pointer (hover), or at the caret (a click, the arrow keys, the Issues tab).
  const [hover, setHover] = useState<HoverTarget<HTMLElement> | null>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const intentRef = useRef<HoverIntent<HTMLElement> | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const caretRef = useRef<number | null>(null)
  caretRef.current = caret

  useEffect(() => {
    const view = editor.view
    const dom = view.dom as HTMLElement
    const intent = new HoverIntent<HTMLElement>(setHover)
    intentRef.current = intent
    let moved = false
    let restTimer: ReturnType<typeof setTimeout> | null = null
    const clearRest = (): void => {
      if (restTimer) clearTimeout(restTimer)
      restTimer = null
    }
    const close = (): void => {
      clearRest()
      intent.dismiss()
      setCaret(null)
    }
    const open = (): boolean => !!intent.current || caretRef.current !== null
    const inCard = (t: EventTarget | null): boolean => t instanceof Node && !!cardRef.current?.contains(t)

    const onMove = (e: MouseEvent): void => {
      // Never while selecting with the mouse.
      const el = e.buttons ? null : e.target instanceof Element ? e.target.closest<HTMLElement>(`.${LIVE_CLASS}`) : null
      if (!el) return intent.leaveName()
      let pos: number
      try {
        pos = view.posAtDOM(el, 0)
      } catch {
        return intent.leaveName()
      }
      intent.enterName(String(pos), el)
    }
    const onLeave = (): void => intent.leaveName()
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!open() || MODIFIER_KEYS.has(e.key) || inCard(e.target)) return
      // Tab takes the keyboard into the card (the page's own handler does it).
      if (movesIntoCard(e)) return
      // Any other key closes the card and goes on to the page; an Esc is used up by closing it.
      takeEscape(e)
      close()
    }
    const onPageKey = (e: KeyboardEvent): void => {
      moved = MOVE_KEYS.has(e.key)
    }
    const onDown = (e: MouseEvent): void => {
      moved = false
      if (!inCard(e.target)) close()
    }
    // A click into an underline shows its card straight away.
    const onUp = (e: MouseEvent): void => {
      if (e.button !== 0) return
      // Once the page has placed the caret.
      setTimeout(() => {
        if (editor.isDestroyed || !view.hasFocus() || liveHidden(view.state)) return
        const f = view.state.selection.empty ? flagAtCaret(view.state) : null
        if (!f) return
        intent.dismiss()
        setCaret(f.from)
      }, 0)
    }
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean; selectionSet: boolean } }): void => {
      if (transaction.docChanged) {
        clearRest()
        if (caretRef.current !== null) setCaret(null)
        return
      }
      if (!transaction.selectionSet) return
      const at = caretRef.current
      if (at !== null) {
        const f = flagAtCaret(view.state)
        if (!f || f.from !== at) setCaret(null)
      }
      clearRest()
      if (!moved) return
      // The caret came to rest in an underline from the arrow keys.
      restTimer = setTimeout(() => {
        restTimer = null
        if (editor.isDestroyed || !view.hasFocus() || liveHidden(view.state)) return
        const f = view.state.selection.empty ? flagAtCaret(view.state) : null
        if (f) setCaret(f.from)
      }, OPEN_DELAY + 250)
    }
    const onScroll = (e: Event): void => {
      if (!inCard(e.target)) close()
    }
    const onBlur = (): void => close()

    setLiveTabHandler(() => {
      const button = cardRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      if (!button) return false
      button.focus()
      return true
    })
    const offRequest = onLiveCardRequest((pos) => {
      intent.dismiss()
      setCaret(pos)
    })
    dom.addEventListener('mousemove', onMove)
    dom.addEventListener('mouseleave', onLeave)
    dom.addEventListener('keydown', onPageKey)
    dom.addEventListener('mouseup', onUp)
    editor.on('transaction', onTransaction)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('blur', onBlur)
    return () => {
      clearRest()
      intent.destroy()
      intentRef.current = null
      setLiveTabHandler(null)
      offRequest()
      dom.removeEventListener('mousemove', onMove)
      dom.removeEventListener('mouseleave', onLeave)
      dom.removeEventListener('keydown', onPageKey)
      dom.removeEventListener('mouseup', onUp)
      editor.off('transaction', onTransaction)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [editor])

  // Another scene, or another page over this one: the card goes.
  useEffect(() => {
    intentRef.current?.dismiss()
    setCaret(null)
  }, [sceneId, writing])

  if (!writing || !sceneId || editor.isDestroyed) return null
  const state = editor.state
  if (liveHidden(state)) return null
  const pos = caret ?? (hover && hover.anchor.isConnected ? Number(hover.id) : null)
  const flag = pos === null ? null : liveFlagAt(state, pos)
  if (!flag) return null
  let word: DOMRect
  if (caret === null && hover) word = hover.anchor.getBoundingClientRect()
  else {
    try {
      const a = editor.view.coordsAtPos(flag.from)
      word = new DOMRect(a.left, a.top, 0, a.bottom - a.top)
    } catch {
      return null
    }
  }
  const at = liveCardPosition(word, { width: window.innerWidth, height: window.innerHeight })

  const done = (refocus: boolean): void => {
    intentRef.current?.dismiss()
    setCaret(null)
    if (refocus && !editor.isDestroyed) editor.view.focus()
  }
  return (
    <LiveCard
      ref={cardRef}
      flag={flag}
      at={at}
      onEnter={() => intentRef.current?.enterCard()}
      onLeave={() => intentRef.current?.leaveCard()}
      onEscape={() => done(true)}
      onChange={() => {
        done(true)
        changeSpelling(editor, flag)
      }}
      onRewrite={() => {
        done(true)
        rewritePhrase(editor, flag)
      }}
      onIgnore={() => {
        done(true)
        ignoreFlag(sceneId, flag)
      }}
    />
  )
}
