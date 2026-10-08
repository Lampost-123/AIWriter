// What shows with an AI edit in the page: while it is written, what it's doing and Stop; once written,
// Accept and Reject (and Alternatives' versions to pick from first), with What the AI saw. It sits in the
// room the tracked change makes below itself (suggestions.ts), lined up with the text, so it moves with
// the words and covers none of them. Rendered by SceneView in the page's scrolling area. Its buttons never
// take the caret from the page. Owned by the AI edits part.
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { Check, Layers, ListRestart, Square, X } from '@/components/ui/icons'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { deskOn, useDesk } from '@/features/look/look'
import { parseEmphasis } from '@/features/editor/streamText'
import { ScrollGlide } from '@/features/editor/scrollGlide'
import { TOOL_NAMES, TOOL_WORKING } from './names'
import { picking, suggestionsOf, type Suggestion, type SuggestionsState } from './suggestions'
import { accept, attachEditor, openRecord, pick, reject, sceneShown, setLayerHooks, stop, unpick } from './session'
import { BREAK, newParagraphs } from './text'
import './suggestions.css'

/** Room left below the buttons, before the next paragraph. */
const ROOM_BELOW = 16
/** How close to the window's edge the buttons may sit before the page scrolls to show them. */
const VIEW_MARGIN = 16
/** The desk: the room the AI dock (and the fade above it) takes at the foot of the page. */
const DESK_DOCK_ROOM = 150
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
   * The page keeps the change in view while its words arrive, and once more when it is ready, until Adam
   * scrolls, clicks in the page, moves about it with the keys or types: from then on the page stays where
   * he puts it, and a message says when the change is ready out of sight.
   */
  const follow = useRef(false)
  /** Adam has moved about the page or typed since the change started (or was last shown to him). */
  const moved = useRef(false)
  /** The status the change had, to tell when it has just become ready. */
  const was = useRef<Suggestion['status'] | null>(null)
  /** The message saying the change is ready out of sight, while it shows. */
  const readyToast = useRef<number | null>(null)
  /** The page gliding along with the words while they arrive (time-based, as Add below's follow: scrollGlide.ts). */
  const [glide] = useState(() => new ScrollGlide(() => scrollerRef.current))

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
    // The desk: the AI dock floats over the foot of the page, so the buttons stay clear above it.
    const bottom = top + panel.offsetHeight + (deskOn() ? DESK_DOCK_ROOM : VIEW_MARGIN)
    let start = top
    try {
      start = editor.view.coordsAtPos(s.from).top - box.top + scroller.scrollTop - START_MARGIN
    } catch {
      // The position is being redrawn; keep to the buttons.
    }
    // New paragraphs ahead of a paragraph show above the place the change is at.
    const own = scroller.querySelector<HTMLElement>('.aw-sugg-new.on-its-own')
    if (own) start = Math.min(start, own.getBoundingClientRect().top - box.top + scroller.scrollTop - START_MARGIN)
    // While the words arrive the page glides along with them (on its way, from where it is going); otherwise it goes
    // there at once, as when the change is first brought into view.
    const streaming = s.status === 'writing' || s.status === 'stopping'
    const from = glide.gliding ? glide.target : scroller.scrollTop
    let want = from
    // Below the window's bottom edge, or above its top (the window was made smaller, say): just in view at the bottom.
    if (bottom > want + view || top < want) want = bottom - view
    if (start < want && bottom - start <= view) want = start
    want = Math.max(0, Math.round(want))
    if (streaming || glide.gliding) {
      if (want !== from) glide.to(want)
    } else if (want !== scroller.scrollTop) scroller.scrollTop = want
    // Once it's ready and in view, the page is Adam's again.
    if (s.status === 'ready' || s.status === 'accepting') follow.current = false
  }, [editor, scrollerRef, glide])

  /** Shows the change: the writing page, scrolled to its buttons, with the caret in the page. */
  const reveal = useCallback(() => {
    if (useApp.getState().view.kind !== 'write') useApp.getState().navigate({ kind: 'write' })
    follow.current = true
    moved.current = false
    glide.stop()
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
  }, [editor, scrollerRef, glide])

  // A new change: follow it into view. Adam moving about the page or typing stops that.
  const id = s?.id ?? null
  const status = s?.status ?? null
  useLayoutEffect(() => {
    if (id) {
      follow.current = true
      moved.current = false
    }
    return () => {
      // Accepted, rejected or gone: the message saying it is ready goes with it.
      if (readyToast.current !== null) useToasts.getState().dismiss(readyToast.current)
      readyToast.current = null
    }
  }, [id])
  useLayoutEffect(() => {
    const before = was.current
    was.current = status
    if (status !== 'ready' || before === 'ready') return
    if (!moved.current) {
      follow.current = true
      return
    }
    // Just written (not back from Accept), while Adam is elsewhere in the page: the page stays where he
    // is, and if the change is out of sight a message says it's ready.
    const panel = panelRef.current
    const scroller = scrollerRef.current
    if (!panel || !scroller || !writing || before === 'accepting') return
    const box = scroller.getBoundingClientRect()
    const r = panel.getBoundingClientRect()
    if (r.bottom > box.top && r.top < box.bottom) return
    const current = suggestionsOf(editor.state).active
    readyToast.current = toast(current && picking(current) ? 'The three versions are ready to pick from.' : 'The AI’s change is ready.', {
      action: { label: 'Show it', run: reveal }
    })
  }, [status, editor, reveal, scrollerRef, writing])
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const off = (): void => {
      follow.current = false
      moved.current = true
      glide.stop()
    }
    const press = (e: MouseEvent): void => {
      if (!(e.target as Element | null)?.closest?.('[data-ai-change]')) off()
    }
    // Keys that move about the page (not the arrows among Alternatives' versions).
    const keys = (e: KeyboardEvent): void => {
      if ((e.target as Element | null)?.closest?.('[data-ai-change]')) return
      if (/^(PageUp|PageDown|ArrowUp|ArrowDown)$/.test(e.key) || ((e.ctrlKey || e.metaKey) && /^(Home|End)$/.test(e.key))) off()
    }
    scroller.addEventListener('wheel', off, { passive: true })
    scroller.addEventListener('touchmove', off, { passive: true })
    scroller.addEventListener('mousedown', press)
    scroller.addEventListener('keydown', keys)
    return () => {
      scroller.removeEventListener('wheel', off)
      scroller.removeEventListener('touchmove', off)
      scroller.removeEventListener('mousedown', press)
      scroller.removeEventListener('keydown', keys)
    }
  }, [scrollerRef, glide])
  // Gone (another scene, or the writing view closing): the glide stops with it.
  useEffect(() => () => glide.stop(), [glide])

  // Placed as the page changes (the words arrive, Adam types above), as it resizes, and as the buttons change.
  useLayoutEffect(() => {
    if (!id) return
    place()
    // The words arriving change only what shows; a change to the text itself is Adam typing.
    const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
      if (transaction.docChanged) {
        follow.current = false
        moved.current = true
        glide.stop()
      }
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
  }, [id, editor, place, scrollerRef, glide])
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
      reveal
    })
    return () => setLayerHooks(null)
  }, [reveal])

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

/**
 * One row: what it's doing and Stop, or Accept and Reject; a note below when there is one. On the desk the AI dock
 * carries Stop, Accept and Reject (one clear place for them), so the row under the change keeps only what the dock
 * doesn't: what it is doing or what it is, Other versions, and What the AI saw.
 */
function Bar({ s }: { s: Suggestion }): React.JSX.Element {
  const busy = s.status === 'starting' || s.status === 'writing' || s.status === 'stopping'
  const desk = useDesk()
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
            {desk ? null : (
              <button
                type="button"
                className={cn(BUTTON, 'text-muted hover:bg-surface-2 hover:text-fg')}
                onClick={() => stop(s.id)}
                disabled={s.status === 'stopping'}
              >
                <Square size={11} fill="currentColor" aria-hidden />
                Stop <span className={KEY}>Esc</span>
              </button>
            )}
          </>
        ) : desk ? (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-2 pl-1.5 text-[12.5px] text-muted">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ai" aria-hidden />
              <span className="truncate">
                {s.versions && s.chosen !== null && s.versions.length > 1
                  ? `Version ${s.chosen + 1} of ${s.versions.length}`
                  : `${s.label ?? TOOL_NAMES[s.tool]} · Tab accepts, Esc rejects`}
              </span>
            </span>
            {s.versions && s.versions.length > 1 ? (
              <button type="button" className={cn(BUTTON, 'text-muted hover:bg-surface-2 hover:text-fg')} onClick={unpick}>
                <Layers size={13} aria-hidden />
                Other versions
              </button>
            ) : null}
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
                : (s.label ?? TOOL_NAMES[s.tool])}
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
            <Square size={11} fill="currentColor" aria-hidden />
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
          const paras = newParagraphs(versions[i] ?? '', s.lineBreaks)
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
                {paras.length ? (
                  <VersionText paras={paras} caret={!done && writing} />
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

/** A version's words as they will read in the page: its paragraphs, italics and bold, and line breaks. */
function VersionText({ paras, caret }: { paras: string[]; caret: boolean }): React.JSX.Element {
  return (
    <span className="flex flex-col gap-1.5 font-serif text-[14px] leading-relaxed text-fg">
      {paras.map((p, i) =>
        p === BREAK ? (
          <span key={i} className="text-center text-[12px] tracking-[0.2em] text-faint">
            * * *
          </span>
        ) : (
          <span key={i} className="block whitespace-pre-wrap">
            {parseEmphasis(p).map((piece, j) => {
              const words = piece.italic ? <em>{piece.text}</em> : piece.text
              return <span key={j}>{piece.bold ? <strong>{words}</strong> : words}</span>
            })}
            {caret && i === paras.length - 1 ? <span className="aw-sugg-caret" aria-hidden /> : null}
          </span>
        )
      )}
    </span>
  )
}
