// The draft just written (2026-10-19, "Keep this, change that"): once a Generate draft has finished in the page, a quiet
// row under its last line says so, with Change it… (the change box on the draft's words: keep this, change that), What
// the AI saw and Undo (while nothing else has changed the page since). It goes once Adam types, opens another scene or
// closes it, and steps aside while the AI is busy in the scene or a change waits. Rendered by SceneView in the page's
// scrolling area. Owned by the AI edits part.
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { countWords } from '@shared/defaults'
import { FileSearch, SquarePen, Undo2, X } from '@/components/ui/icons'
import { onEvent } from '@/lib/api'
import { cn } from '@/lib/cn'
import { editorBridge } from '@/lib/editorBridge'
import { shortcutText } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { activeStream } from '@/features/editor/streamDoc'
import { useDraft } from '@/features/generate/draftRun'
import { usePolish } from '@/features/generate/polishRun'
import { useBeats } from '@/features/beats/session'
import { openChangeBox, useChangeBox } from './changeStore'
import { suggestionsOf } from './suggestions'
import { textOf, wordsIn } from './text'

/** The draft just written in the page: its record and where its words are now. */
interface Just {
  sceneId: ID
  generationId: ID
  from: number
  to: number
  /** Nothing has changed the page since it finished, so Undo takes it out (one step). */
  clean: boolean
}

const useJust = create<{ just: Just | null }>(() => ({ just: null }))

/** How each draft ended, by its record (the draft's own message covers one that went wrong). */
const ended = new Map<ID, 'complete' | 'stopped' | 'error'>()

/** The row's room below the draft's last line, and below the desk's end mark when there is one. */
const GAP = 10

export function JustWritten({
  editor,
  sceneId,
  scrollerRef
}: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const just = useJust((s) => (s.just && s.just.sceneId === sceneId ? s.just : null))
  const drafting = useDraft((d) => d.sceneId === sceneId && d.phase !== 'idle')
  const polishing = usePolish((p) => !!sceneId && p.sceneId === sceneId)
  const beats = useBeats((s) => !!sceneId && s.session?.sceneId === sceneId)
  const boxOpen = useChangeBox((s) => !!s.target)
  const writing = useApp((s) => s.view.kind === 'write')
  const [waiting, setWaiting] = useState(false)
  const rowRef = useRef<HTMLDivElement>(null)
  /** The draft being written into this page, and where it begins. */
  const streaming = useRef<{ generationId: ID; from: number; sceneId: ID } | null>(null)

  // How drafts end (heard once for the whole window).
  useEffect(() => {
    const off = onEvent('generation:done', (p) => {
      ended.set(p.generationId, p.status === 'error' ? 'error' : p.status === 'stopped' ? 'stopped' : 'complete')
      if (ended.size > 50) ended.delete(ended.keys().next().value as ID)
    })
    return off
  }, [])

  // Another scene: the row goes.
  useEffect(() => {
    const j = useJust.getState().just
    if (j && j.sceneId !== sceneId) useJust.setState({ just: null })
    streaming.current = null
  }, [sceneId])

  // The page: where a draft being written begins; the draft's words moving as the page changes; a change waiting.
  useEffect(() => {
    const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
      const info = editor.isDestroyed ? null : activeStream(editor.state)
      const scene = editorBridge()?.sceneId ?? null
      const draft = useDraft.getState()
      // Generate's draft only (Beat by beat writes into the page too, and has its own bar).
      if (info && scene && draft.sceneId === scene && draft.phase !== 'idle') {
        // A draft that took the place of the scene's words begins where the page does.
        streaming.current = { generationId: info.generationId, from: info.replace ? 0 : info.from, sceneId: scene }
        if (useJust.getState().just) useJust.setState({ just: null })
      }
      setWaiting(!!suggestionsOf(editor.state).active)
      const j = useJust.getState().just
      if (!j || !transaction.docChanged || info) return
      const from = transaction.mapping.map(j.from, 1)
      const to = transaction.mapping.map(j.to, -1)
      useJust.setState({ just: to > from ? { ...j, from, to, clean: false } : null })
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  // A draft finished in this page: the row shows under it (once the draft's own ending has been heard).
  useEffect(
    () =>
      useDraft.subscribe((d, prev) => {
        if (prev.phase === 'idle' || d.phase !== 'idle') return
        const s = streaming.current
        streaming.current = null
        if (!s) return
        setTimeout(() => {
          const how = ended.get(s.generationId)
          if (how !== 'complete' && how !== 'stopped') return
          const bridge = editorBridge()
          if (editor.isDestroyed || bridge?.sceneId !== s.sceneId || bridge.editor !== editor) return
          const doc = editor.state.doc
          const words = wordsIn(doc, Math.min(s.from, doc.content.size), doc.content.size)
          if (!words || !countWords(textOf(doc, words.from, words.to))) return
          useJust.setState({ just: { sceneId: s.sceneId, generationId: s.generationId, from: words.from, to: words.to, clean: true } })
        }, 0)
      }),
    [editor]
  )

  // Typing (or pasting) in the page: the row has done its job.
  useEffect(() => {
    const dom = editor.view.dom
    const key = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete' || e.key === 'Enter') useJust.setState({ just: null })
    }
    const paste = (): void => useJust.setState({ just: null })
    dom.addEventListener('keydown', key)
    dom.addEventListener('paste', paste)
    return () => {
      dom.removeEventListener('keydown', key)
      dom.removeEventListener('paste', paste)
    }
  }, [editor])

  const shown = !!just && !drafting && !polishing && !beats && !boxOpen && !waiting && writing

  /** Under the draft's last line (and under the desk's end mark, which sits there). */
  const place = useCallback(() => {
    const row = rowRef.current
    const scroller = scrollerRef.current
    const j = useJust.getState().just
    if (!row || !scroller || !j || editor.isDestroyed) return
    try {
      const box = scroller.getBoundingClientRect()
      const end = editor.view.coordsAtPos(Math.min(j.to, editor.state.doc.content.size))
      let top = end.bottom - box.top + scroller.scrollTop + GAP
      const mark = scroller.querySelector<HTMLElement>('.desk-endmark')
      if (mark) {
        const r = mark.getBoundingClientRect()
        const markTop = r.top - box.top + scroller.scrollTop
        if (markTop < top + row.offsetHeight && r.bottom - box.top + scroller.scrollTop > top) top = r.bottom - box.top + scroller.scrollTop + 6
      }
      const prose = editor.view.dom.getBoundingClientRect()
      row.style.top = `${Math.round(top)}px`
      row.style.left = `${Math.round(prose.left - box.left)}px`
      row.style.maxWidth = `${Math.round(prose.width)}px`
      row.style.visibility = ''
    } catch {
      row.style.visibility = 'hidden'
    }
  }, [editor, scrollerRef])

  useLayoutEffect(() => {
    if (!shown) return
    place()
    const ro = new ResizeObserver(() => place())
    ro.observe(editor.view.dom)
    if (scrollerRef.current) ro.observe(scrollerRef.current)
    editor.on('transaction', place)
    return () => {
      ro.disconnect()
      editor.off('transaction', place)
    }
  }, [shown, editor, place, scrollerRef])

  if (!shown || !just) return null
  const words = countWords(textOf(editor.state.doc, just.from, just.to))

  const change = (): void => {
    const j = useJust.getState().just
    if (!j || editor.isDestroyed) return
    const doc = editor.state.doc
    openChangeBox({ kind: 'words', sceneId: j.sceneId, from: j.from, to: j.to, text: textOf(doc, j.from, j.to), what: 'The draft just written' })
  }
  const undo = (): void => {
    useJust.setState({ just: null })
    editorBridge()?.undo()
  }

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="The draft just written"
      data-just-written=""
      style={{ visibility: 'hidden' }}
      // Pressing a button keeps the caret in the page where it is (never the page's own press below its words).
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="absolute z-10 flex h-9 items-center gap-1 rounded-lg border border-line bg-surface pl-3 pr-1 font-sans shadow-soft animate-fade-in"
    >
      <span className="mr-1 flex min-w-0 items-center gap-2 truncate text-[12.5px] text-muted">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" aria-hidden />
        Draft written · {words.toLocaleString('en-GB')} {words === 1 ? 'word' : 'words'}
      </span>
      <button type="button" className={cn(BUTTON, 'text-fg')} onClick={change} title="Say what to change, and mark the sentences to keep word for word">
        <SquarePen size={13} className="text-ai" aria-hidden />
        Change it…
      </button>
      <button
        type="button"
        className={cn(BUTTON, 'text-muted hover:text-fg')}
        onClick={() => useApp.getState().navigate({ kind: 'generation', generationId: just.generationId })}
      >
        <FileSearch size={13} aria-hidden />
        What the AI saw
      </button>
      {just.clean ? (
        <button type="button" className={cn(BUTTON, 'text-muted hover:text-fg')} onClick={undo} title={`Take the draft out again (${shortcutText('undo')})`}>
          <Undo2 size={13} aria-hidden />
          Undo
        </button>
      ) : null}
      <button
        type="button"
        aria-label="Close"
        className={cn(BUTTON, 'px-1.5 text-faint hover:text-fg')}
        onClick={() => useJust.setState({ just: null })}
      >
        <X size={13} aria-hidden />
      </button>
    </div>
  )
}

const BUTTON =
  'inline-flex h-7 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-md px-2 text-[12.5px] font-medium transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-focus'
