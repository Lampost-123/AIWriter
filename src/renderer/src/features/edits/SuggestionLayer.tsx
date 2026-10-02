// What shows with an AI edit in the page: while it is written, what it's doing and Stop; once written,
// Accept and Reject (and Alternatives' versions to pick from first), with What the AI saw. It sits in the
// room the tracked change makes below itself (suggestions.ts), lined up with the text, so it moves with
// the words and covers none of them. Rendered by SceneView in the page's scrolling area. Its buttons never
// take the caret from the page. Owned by the AI edits part.
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { Check, Layers, ListRestart, Square, X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { ID } from '@shared/types'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { picking, suggestionsOf, type Suggestion, type SuggestionsState } from './suggestions'
import {
  accept,
  attachEditor,
  openRecord,
  pick,
  reject,
  sceneShown,
  setLayerHooks,
  stop,
  TOOL_NAMES,
  TOOL_WORKING,
  unpick
} from './session'
import './suggestions.css'

/** Room left below the buttons, before the next paragraph. */
const ROOM_BELOW = 16
/** How close to the window's edge the buttons may sit before the page scrolls to show them. */
const VIEW_MARGIN = 16
/** Room kept above the start of the change when the page scrolls to show it. */
const START_MARGIN = 24

function useSuggestions(editor: Editor): SuggestionsState {
  const subscribe = useCallback(
    (onChange: () => void) => {
      editor.on('transaction', onChange)
      return () => {
        editor.off('transaction', onChange)
      }
    },
    [editor]
  )
  return useSyncExternalStore(subscribe, () => suggestionsOf(editor.state))
}

export function SuggestionLayer({
  editor,
  sceneId,
  scrollerRef
}: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const { active } = useSuggestions(editor)
  const writing = useApp((st) => st.view.kind === 'write')
  const s = active && active.sceneId === sceneId ? active : null
  const panelRef = useRef<HTMLDivElement>(null)
  const pickerRef = useRef<HTMLDivElement>(null)
  /**
   * The page keeps the change in view while its words arrive (until Adam scrolls, clicks in the page or
   * types), and once more when it is ready.
   */
  const follow = useRef(false)

  useEffect(() => attachEditor(editor), [editor])
  useEffect(() => sceneShown(), [sceneId])

  /** Puts the buttons in the room below the change, lined up with the text, and (if following) in view. */
  const place = useCallback(() => {
    const panel = panelRef.current
    const scroller = scrollerRef.current
    if (!panel || !scroller || editor.isDestroyed) return
    const room = scroller.querySelector<HTMLElement>('.aw-sugg-room')
    if (!room) {
      panel.style.visibility = 'hidden'
      return
    }
    const box = scroller.getBoundingClientRect()
    const r = room.getBoundingClientRect()
    const prose = editor.view.dom.getBoundingClientRect()
    const top = Math.round(r.top - box.top + scroller.scrollTop)
    panel.style.visibility = ''
    panel.style.top = `${top}px`
    panel.style.left = `${Math.round(prose.left - box.left)}px`
    panel.style.width = `${Math.round(prose.width)}px`
    const s = suggestionsOf(editor.state).active
    if (!follow.current || !s) return
    // The buttons in view, and the start of the change too when it all fits.
    const view = scroller.clientHeight
    const bottom = top + panel.offsetHeight + VIEW_MARGIN
    let start = top
    try {
      start = editor.view.coordsAtPos(s.from).top - box.top + scroller.scrollTop - START_MARGIN
    } catch {
      // The position is being redrawn; keep to the buttons.
    }
    let want = scroller.scrollTop
    if (bottom > want + view) want = bottom - view
    if (start < want && bottom - start <= view) want = start
    want = Math.max(0, Math.round(want))
    if (want !== scroller.scrollTop) scroller.scrollTop = want
    // Once it's ready and in view, the page is Adam's again.
    if (s.status === 'ready' || s.status === 'accepting') follow.current = false
  }, [editor, scrollerRef])

  // A new change: follow it into view. Adam scrolling the page, clicking in it or typing stops that.
  const id = s?.id ?? null
  const status = s?.status ?? null
  useLayoutEffect(() => {
    if (id) follow.current = true
  }, [id])
  useLayoutEffect(() => {
    if (status === 'ready') follow.current = true
  }, [status])
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const off = (): void => {
      follow.current = false
    }
    const press = (e: MouseEvent): void => {
      if (!(e.target as Element | null)?.closest?.('[data-ai-change]')) off()
    }
    scroller.addEventListener('wheel', off, { passive: true })
    scroller.addEventListener('touchmove', off, { passive: true })
    scroller.addEventListener('mousedown', press)
    return () => {
      scroller.removeEventListener('wheel', off)
      scroller.removeEventListener('touchmove', off)
      scroller.removeEventListener('mousedown', press)
    }
  }, [scrollerRef])

  // Placed as the page changes (the words arrive, Adam types above), as it resizes, and as the buttons change.
  useLayoutEffect(() => {
    if (!id) return
    place()
    // The words arriving change only what shows; a change to the text itself is Adam typing.
    const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
      if (transaction.docChanged) follow.current = false
      place()
    }
    editor.on('transaction', onTransaction)
    const ro = new ResizeObserver(() => place())
    ro.observe(editor.view.dom)
    if (scrollerRef.current) ro.observe(scrollerRef.current)
    return () => {
      editor.off('transaction', onTransaction)
      ro.disconnect()
    }
  }, [id, editor, place, scrollerRef])
  useLayoutEffect(() => {
    if (id && writing) place()
  })

  // The room below the change is as tall as the buttons.
  useLayoutEffect(() => {
    const panel = panelRef.current
    const scroller = scrollerRef.current
    if (!id || !panel || !scroller) return
    const size = (): void => scroller.style.setProperty('--aw-sugg-room', `${panel.offsetHeight + ROOM_BELOW}px`)
    size()
    const ro = new ResizeObserver(size)
    ro.observe(panel)
    return () => ro.disconnect()
  }, [id, scrollerRef])

  // The keyboard can go to Alternatives' versions (Tab in the page), and "Show it" scrolls to the change.
  useEffect(() => {
    setLayerHooks({
      focusPicker: () => pickerRef.current?.querySelector<HTMLButtonElement>('button[data-version]:not(:disabled)')?.focus(),
      reveal: () => {
        if (useApp.getState().view.kind !== 'write') useApp.getState().navigate({ kind: 'write' })
        follow.current = true
        requestAnimationFrame(() => {
          const panel = panelRef.current
          const scroller = scrollerRef.current
          if (!panel || !scroller) return
          const top = panel.offsetTop
          if (top < scroller.scrollTop || top + panel.offsetHeight > scroller.scrollTop + scroller.clientHeight) {
            scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 2)
          }
          editor.view.focus()
        })
      }
    })
    return () => setLayerHooks(null)
  }, [editor, scrollerRef])

  if (!s || !sceneId) return null
  return (
    <div
      ref={panelRef}
      role="group"
      aria-label="The AI’s change"
      data-ai-change=""
      // Pressing a button keeps the caret in the page.
      onMouseDown={(e) => {
        if (!(e.target as Element).closest('[data-scrolls]')) e.preventDefault()
        e.stopPropagation()
      }}
      onKeyDown={(e) => {
        // Esc on the buttons does what it does in the page.
        if (e.key === 'Escape' && !e.defaultPrevented) {
          e.preventDefault()
          if (s.status === 'writing' || s.status === 'starting') stop(s.id)
          else if (s.status === 'ready') reject(s.id, 'key')
        }
      }}
      style={{ visibility: 'hidden' }}
      className="absolute z-10 font-sans"
    >
      {picking(s) ? <Picker s={s} pickerRef={pickerRef} /> : <Bar s={s} />}
    </div>
  )
}

const BUTTON =
  'inline-flex h-7 shrink-0 select-none items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 text-[12.5px] font-medium transition-[background-color,border-color,color,filter] duration-150 disabled:pointer-events-none disabled:opacity-50'

const KEY = 'text-[11px] font-normal opacity-70'

/** One row: what it's doing and Stop, or Accept and Reject; a note below when there is one. */
function Bar({ s }: { s: Suggestion }): React.JSX.Element {
  const busy = s.status === 'starting' || s.status === 'writing' || s.status === 'stopping'
  const label =
    s.status === 'starting'
      ? 'Getting ready…'
      : s.status === 'stopping'
        ? 'Stopping…'
        : s.retrying
          ? 'The AI service is busy. Trying again…'
          : `${TOOL_WORKING[s.tool]}…`
  return (
    <div className="rounded-lg border border-ai/30 bg-surface shadow-soft animate-fade-in">
      <div className="flex h-10 items-center gap-1.5 px-1.5">
        {busy ? (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-2 pl-1.5 text-[12.5px] font-medium text-ai" aria-live="polite">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ai animate-pulse" aria-hidden />
              <span className="truncate">{label}</span>
            </span>
            <button
              type="button"
              className={cn(BUTTON, 'text-muted hover:bg-surface-2 hover:text-fg')}
              onClick={() => stop(s.id)}
              disabled={s.status === 'stopping'}
            >
              <Square size={12} aria-hidden />
              Stop <span className={KEY}>Esc</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={cn(BUTTON, 'bg-ai text-page shadow-sm hover:brightness-110')}
              onClick={() => void accept(s.id)}
              disabled={s.status === 'accepting'}
            >
              <Check size={14} aria-hidden />
              Accept <span className={KEY}>Tab</span>
            </button>
            <button
              type="button"
              className={cn(BUTTON, 'border border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2')}
              onClick={() => reject(s.id)}
              disabled={s.status === 'accepting'}
            >
              <X size={14} aria-hidden />
              Reject <span className={KEY}>Esc</span>
            </button>
            {s.versions && s.versions.length > 1 ? (
              <button type="button" className={cn(BUTTON, 'text-muted hover:bg-surface-2 hover:text-fg')} onClick={unpick}>
                <Layers size={13} aria-hidden />
                Other versions
              </button>
            ) : null}
            <span className="min-w-0 flex-1 truncate pl-1 text-[12px] text-faint">
              {s.versions && s.chosen !== null && s.versions.length > 1
                ? `Version ${s.chosen + 1} of ${s.versions.length}`
                : TOOL_NAMES[s.tool]}
            </span>
          </>
        )}
        {s.generationId ? (
          <button type="button" className={cn(BUTTON, 'px-2 text-muted hover:bg-surface-2 hover:text-fg')} onClick={openRecord}>
            What the AI saw
          </button>
        ) : null}
      </div>
      {s.note ? <p className="border-t border-line/70 px-3 py-1.5 text-[12px] leading-relaxed text-muted">{s.note}</p> : null}
    </div>
  )
}

/** Alternatives: the versions as they arrive, each one a button that picks it. */
function Picker({ s, pickerRef }: { s: Suggestion; pickerRef: React.RefObject<HTMLDivElement | null> }): React.JSX.Element {
  const writing = s.status === 'starting' || s.status === 'writing' || s.status === 'stopping'
  const versions = s.versions ?? []
  const slots = s.status === 'ready' ? versions.length : 3
  const move = (e: React.KeyboardEvent, by: number): void => {
    const buttons = [...(pickerRef.current?.querySelectorAll<HTMLButtonElement>('button[data-version]:not(:disabled)') ?? [])]
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next = buttons[i < 0 ? 0 : (i + by + buttons.length) % buttons.length]
    if (!next) return
    e.preventDefault()
    next.focus()
  }
  return (
    <div className="rounded-lg border border-ai/30 bg-surface shadow-soft animate-fade-in">
      <div className="flex h-10 items-center gap-1.5 px-1.5">
        <span className="flex min-w-0 flex-1 items-center gap-2 pl-1.5 text-[12.5px] font-medium text-ai" aria-live="polite">
          {writing ? (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ai animate-pulse" aria-hidden />
          ) : (
            <ListRestart size={13} aria-hidden />
          )}
          <span className="truncate">
            {s.status === 'starting'
              ? 'Getting ready…'
              : s.status === 'stopping'
                ? 'Stopping…'
                : s.retrying
                  ? 'The AI service is busy. Trying again…'
                  : writing
                    ? 'Writing three versions…'
                    : 'Pick the version you like'}
          </span>
        </span>
        {writing ? (
          <button
            type="button"
            className={cn(BUTTON, 'text-muted hover:bg-surface-2 hover:text-fg')}
            onClick={() => stop(s.id)}
            disabled={s.status === 'stopping'}
          >
            <Square size={12} aria-hidden />
            Stop <span className={KEY}>Esc</span>
          </button>
        ) : (
          <button
            type="button"
            className={cn(BUTTON, 'border border-line bg-surface text-fg hover:border-line-strong hover:bg-surface-2')}
            onClick={() => reject(s.id)}
          >
            <X size={14} aria-hidden />
            Reject all <span className={KEY}>Esc</span>
          </button>
        )}
        {s.generationId ? (
          <button type="button" className={cn(BUTTON, 'px-2 text-muted hover:bg-surface-2 hover:text-fg')} onClick={openRecord}>
            What the AI saw
          </button>
        ) : null}
      </div>
      <div
        ref={pickerRef}
        data-scrolls=""
        role="listbox"
        aria-label="Versions"
        className="flex max-h-[min(46vh,420px)] flex-col gap-1 overflow-y-auto border-t border-line/70 p-1.5"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') move(e, 1)
          else if (e.key === 'ArrowUp') move(e, -1)
          else if (/^[1-3]$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault()
            pick(Number(e.key) - 1)
          }
        }}
      >
        {Array.from({ length: Math.max(1, slots) }, (_, i) => {
          const text = versions[i]
          const done = i < s.versionsDone
          return (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={false}
              data-version={i + 1}
              disabled={!done}
              onClick={() => pick(i)}
              className={cn(
                'group flex w-full items-start gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-150',
                'hover:bg-ai-soft focus-visible:bg-ai-soft focus-visible:outline-none disabled:cursor-default disabled:hover:bg-transparent'
              )}
            >
              <span
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                  done ? 'bg-ai-soft text-ai group-hover:bg-ai group-hover:text-page' : 'bg-surface-2 text-faint'
                )}
              >
                {i + 1}
              </span>
              <span className="min-w-0 flex-1">
                {text ? (
                  <span className="block whitespace-pre-wrap font-serif text-[14px] leading-relaxed text-fg">
                    {text}
                    {!done && writing ? <span className="aw-sugg-caret" aria-hidden /> : null}
                  </span>
                ) : (
                  <span className="flex flex-col gap-1.5 pt-1" aria-hidden>
                    <span className="h-2.5 w-[92%] rounded bg-surface-2" />
                    <span className="h-2.5 w-[70%] rounded bg-surface-2" />
                  </span>
                )}
              </span>
              <span
                className={cn(
                  'mt-0.5 shrink-0 text-[12px] font-medium text-ai opacity-0 transition-opacity duration-150',
                  done && 'group-hover:opacity-100 group-focus-visible:opacity-100'
                )}
              >
                Use this
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
