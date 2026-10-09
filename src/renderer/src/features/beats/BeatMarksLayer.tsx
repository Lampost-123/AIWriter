// Beat markers on the page (2026-10-08; SceneView, in the page's scrolling area): while writing beat by beat, and
// after Finish with "Show beats" on, a band down the edge of each beat's paragraphs (beatMarks.ts) and a small
// "Beat N" label beside where it begins, shown when the pointer is over the beat or the label has the keyboard (Tab
// reaches the labels after the page). The label opens the beat's menu: Redo this beat, Change and redo (a one-line
// note), What the AI saw for it, Remove this beat; and for a beat written before an earlier beat changed, a quiet
// note under its label, Keep it as it is, and (from the changed beat) Redo the beats after this. What the menu does
// is in redo.ts. Owned by the Beat by beat part. Restylable: the labels sit in the page's left margin, drawn from
// data attributes and classes in beatMarks.css.
import * as M from '@radix-ui/react-dropdown-menu'
import * as P from '@radix-ui/react-popover'
import type { Editor } from '@tiptap/core'
import type { Transaction } from '@tiptap/pm/state'
import { Check, FileSearch, ListRestart, RotateCcw, SquarePen, Trash2 } from '@/components/ui/icons'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ID } from '@shared/types'
import { Button, Input } from '@/components/ui'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { setBeatMarks } from './beatMarks'
import { setShowBeats } from './BeatSettings'
import { adoptSplits, beatsShown, writtenBefore, type BeatOnPage } from './marks'
import { changeMarks, installMarks, loadMarks, useBeatMarks } from './marksStore'
import { keepBeat, redoAfter, redoBeat, redoing, removeBeat, showBeatRecord } from './redo'
import { useBeats } from './session'
import { MAX_NOTE_CHARS } from './sessionLogic'
import './beatMarks.css'

/** Room between a label and the band. */
const LABEL_GAP = 26
/** Narrower than this, the margin can't take the labels: they sit just above the beat's first line instead. */
const MIN_MARGIN = 84

interface Placed {
  index: number
  top: number
}

export function BeatMarksLayer({
  editor,
  sceneId,
  scrollerRef
}: {
  editor: Editor
  sceneId: ID | null
  scrollerRef: React.RefObject<HTMLDivElement | null>
}): React.JSX.Element | null {
  const session = useBeats((s) => (sceneId && s.session?.sceneId === sceneId ? s.session : null))
  const showBeats = useApp((s) => !!s.settings?.editor?.showBeats)
  const marks = useBeatMarks((s) => (sceneId ? (s.byScene[sceneId] ?? null) : null))
  const on = !!sceneId && (!!session || showBeats)
  const [shown, setShown] = useState<BeatOnPage[]>([])
  const [placed, setPlaced] = useState<Placed[]>([])
  const [margin, setMargin] = useState<{ right: number; inside: boolean; left: number }>({ right: 0, inside: false, left: 0 })
  const [hot, setHot] = useState<number | null>(null)
  /** The label whose menu (or note box) is open. */
  const [open, setOpen] = useState<number | null>(null)
  const [noteFor, setNoteFor] = useState<number | null>(null)
  // A beat written again shows its label while it is.
  const [busyBeat, setBusyBeat] = useState<number | null>(null)

  useEffect(() => {
    installMarks()
    if (sceneId) void loadMarks(sceneId)
    setHot(null)
    setOpen(null)
    setNoteFor(null)
  }, [sceneId])

  // A beat's paragraph split in two: the second half joins the beat (even while the markers are hidden).
  useEffect(() => {
    if (!sceneId) return
    const onTransaction = ({ transaction }: { transaction: Transaction }): void => {
      if (!transaction.docChanged || transaction.before.childCount === transaction.doc.childCount) return
      changeMarks(sceneId, (m) => (m ? adoptSplits(transaction.before, transaction.doc, m) : m))
    }
    editor.on('transaction', onTransaction)
    return () => {
      editor.off('transaction', onTransaction)
    }
  }, [editor, sceneId])

  // The beats on the page, worked out again as it changes (once a frame at most).
  useEffect(() => {
    if (!on) {
      setShown([])
      return
    }
    let frame = 0
    const work = (): void => {
      frame = 0
      if (editor.isDestroyed) return
      setShown(beatsShown(editor.state.doc, marks))
      setBusyBeat(sceneId ? redoing(sceneId) : null)
    }
    work()
    const onUpdate = (): void => {
      if (!frame) frame = requestAnimationFrame(work)
    }
    editor.on('transaction', onUpdate)
    return () => {
      editor.off('transaction', onUpdate)
      cancelAnimationFrame(frame)
    }
  }, [editor, marks, on, sceneId])

  // The bands on the page.
  useEffect(() => {
    if (editor.isDestroyed) return
    setBeatMarks(
      editor.view,
      on && shown.length ? { beats: shown.map((b) => ({ index: b.index, pids: b.pids, stale: b.staleBy != null })), hot: hot ?? open } : null
    )
  }, [editor, on, shown, hot, open])

  // Where each label goes: beside the first line of its beat, in the margin left of the page.
  const place = useCallback(() => {
    const scroller = scrollerRef.current
    if (!scroller || editor.isDestroyed || !shown.length) return
    const box = scroller.getBoundingClientRect()
    const prose = editor.view.dom.getBoundingClientRect()
    const left = prose.left - box.left
    // The desk's page is a sheet lying on the desk: its own margin is the room (a label past the sheet's edge would lie
    // half on the desk), and it is narrower than a label needs, so there the labels sit above their beat's first line.
    const sheet = editor.view.dom.closest('.desk-sheet')?.getBoundingClientRect()
    const room = sheet ? prose.left - sheet.left : left
    setMargin((m) => {
      const next = { right: Math.round(box.width - left + LABEL_GAP), inside: room - LABEL_GAP < MIN_MARGIN, left: Math.round(left) }
      return m.right === next.right && m.inside === next.inside && m.left === next.left ? m : next
    })
    const out: Placed[] = []
    for (const b of shown) {
      const el = editor.view.nodeDOM(b.pos)
      if (!(el instanceof HTMLElement)) continue
      out.push({ index: b.index, top: Math.round(el.getBoundingClientRect().top - box.top + scroller.scrollTop) })
    }
    setPlaced((p) => (p.length === out.length && p.every((x, i) => x.index === out[i].index && x.top === out[i].top) ? p : out))
  }, [editor, scrollerRef, shown])

  useLayoutEffect(() => {
    if (!on) return
    place()
    const ro = new ResizeObserver(() => place())
    ro.observe(editor.view.dom)
    if (scrollerRef.current) ro.observe(scrollerRef.current)
    editor.on('transaction', place)
    return () => {
      ro.disconnect()
      editor.off('transaction', place)
    }
  }, [editor, on, place, scrollerRef])

  // The beat the pointer is over: its label shows, and its band is drawn stronger.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !on) return
    const move = (e: MouseEvent): void => {
      const t = e.target as Element | null
      const label = t?.closest?.('[data-beat-label]')?.getAttribute('data-beat-label')
      const para = t?.closest?.('.scene-prose [data-beat]')?.getAttribute('data-beat')
      const n = Number(label ?? para)
      setHot(Number.isFinite(n) && n > 0 ? n : null)
    }
    const leave = (): void => setHot(null)
    scroller.addEventListener('mousemove', move, { passive: true })
    scroller.addEventListener('mouseleave', leave)
    return () => {
      scroller.removeEventListener('mousemove', move)
      scroller.removeEventListener('mouseleave', leave)
    }
  }, [scrollerRef, on])

  if (!on || !sceneId || !placed.length) return null
  const byIndex = new Map(shown.map((b) => [b.index, b]))
  const writingInBar = session && session.phase !== 'paused' ? session.current?.index ?? null : null
  return (
    <div data-beat-labels="" className={cn('aw-beat-labels', margin.inside && 'is-inside')} aria-label="Beats on this page">
      {placed.map((p) => {
        const b = byIndex.get(p.index)
        if (!b) return null
        const later = writtenBefore(shown, b.index)
        return (
          <BeatLabel
            key={b.index}
            sceneId={sceneId}
            beat={b}
            top={p.top}
            right={margin.right}
            left={margin.left}
            inside={margin.inside}
            later={later}
            shownNow={hot === b.index || open === b.index || noteFor === b.index || busyBeat === b.index || writingInBar === b.index}
            menuOpen={open === b.index}
            onMenu={(o) => setOpen(o ? b.index : null)}
            noteOpen={noteFor === b.index}
            onNote={(o) => setNoteFor(o ? b.index : null)}
          />
        )
      })}
    </div>
  )
}

const ITEM =
  'flex h-8 items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50'

function BeatLabel({
  sceneId,
  beat,
  top,
  right,
  left,
  inside,
  later,
  shownNow,
  menuOpen,
  onMenu,
  noteOpen,
  onNote
}: {
  sceneId: ID
  beat: BeatOnPage
  top: number
  right: number
  left: number
  inside: boolean
  later: number[]
  shownNow: boolean
  menuOpen: boolean
  onMenu: (open: boolean) => void
  noteOpen: boolean
  onNote: (open: boolean) => void
}): React.JSX.Element {
  const n = beat.index
  const stale = beat.staleBy
  const showBeats = useApp((s) => !!s.settings?.editor?.showBeats)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Change and redo was picked: the note box opens once the menu has closed. */
  const noteNext = useRef(false)
  const [note, setNote] = useState('')
  const style: React.CSSProperties = inside ? { top, left } : { top, right }
  return (
    <div
      data-beat-label={n}
      data-shown={shownNow || stale != null ? '' : undefined}
      data-stale={stale != null ? '' : undefined}
      className="aw-beat-label"
      style={style}
    >
      <P.Root open={noteOpen} onOpenChange={onNote}>
        <M.Root open={menuOpen} onOpenChange={onMenu} modal={false}>
          <P.Anchor asChild>
            <M.Trigger asChild>
              <button
                ref={buttonRef}
                type="button"
                className="aw-beat-tag"
                aria-label={`Beat ${n}${stale != null ? `, written before beat ${stale} changed` : ''}: what you can do with it`}
                // The caret stays in the page until the menu takes the keyboard.
                onMouseDown={(e) => e.preventDefault()}
              >
                Beat {n}
              </button>
            </M.Trigger>
          </P.Anchor>
          <M.Portal>
            <M.Content
              aria-label={`Beat ${n}`}
              align={inside ? 'start' : 'end'}
              side={inside ? 'bottom' : 'left'}
              sideOffset={6}
              collisionPadding={8}
              onCloseAutoFocus={(e) => {
                if (!noteNext.current) return
                // Change and redo: the keyboard goes to the note box rather than back to the label.
                noteNext.current = false
                e.preventDefault()
                onNote(true)
              }}
              className="z-50 min-w-[220px] rounded-lg border border-line bg-surface p-1 font-sans shadow-pop data-[state=open]:animate-pop-in"
            >
              <M.Item className={cn(ITEM, 'text-fg')} onSelect={() => void redoBeat(sceneId, n)}>
                <RotateCcw size={14} className="text-muted" aria-hidden />
                Redo this beat
              </M.Item>
              <M.Item
                className={cn(ITEM, 'text-fg')}
                onSelect={() => {
                  setNote('')
                  // Once the menu has gone, the note box opens beside the label (see onCloseAutoFocus).
                  noteNext.current = true
                }}
              >
                <SquarePen size={14} className="text-muted" aria-hidden />
                Change and redo…
              </M.Item>
              <M.Item className={cn(ITEM, 'text-fg')} disabled={!beat.recordId} onSelect={() => showBeatRecord(beat.recordId)}>
                <FileSearch size={14} className="text-muted" aria-hidden />
                What the AI saw
              </M.Item>
              {stale != null || later.length ? <M.Separator className="my-1 h-px bg-line" /> : null}
              {stale != null ? (
                <M.Item className={cn(ITEM, 'text-fg')} onSelect={() => keepBeat(sceneId, n)}>
                  <Check size={14} className="text-muted" aria-hidden />
                  Keep it as it is
                </M.Item>
              ) : null}
              {later.length ? (
                <>
                  <M.Item className={cn(ITEM, 'text-fg')} onSelect={() => void redoAfter(sceneId, n, 'next')}>
                    <ListRestart size={14} className="text-muted" aria-hidden />
                    {`Redo the next one after this (beat ${later[0]})`}
                  </M.Item>
                  {later.length > 1 ? (
                    <M.Item className={cn(ITEM, 'text-fg')} onSelect={() => void redoAfter(sceneId, n, 'all')}>
                      <ListRestart size={14} className="text-muted" aria-hidden />
                      {`Redo all ${later.length} after this, in order`}
                    </M.Item>
                  ) : null}
                </>
              ) : null}
              <M.Separator className="my-1 h-px bg-line" />
              <M.Item className={cn(ITEM, 'text-danger')} onSelect={() => void removeBeat(sceneId, n)}>
                <Trash2 size={14} aria-hidden />
                Remove this beat
              </M.Item>
              <M.Separator className="my-1 h-px bg-line" />
              <M.CheckboxItem className={cn(ITEM, 'text-fg')} checked={showBeats} onCheckedChange={(v) => void setShowBeats(v === true)}>
                <span className="flex w-[14px] justify-center text-muted" aria-hidden>
                  <M.ItemIndicator>
                    <Check size={14} />
                  </M.ItemIndicator>
                </span>
                Show beats after you finish
              </M.CheckboxItem>
            </M.Content>
          </M.Portal>
        </M.Root>
        <P.Portal>
          <P.Content
            side={inside ? 'bottom' : 'left'}
            align="start"
            sideOffset={6}
            collisionPadding={8}
            onOpenAutoFocus={(e) => {
              e.preventDefault()
              inputRef.current?.focus()
            }}
            className="z-50 w-[min(380px,calc(100vw-32px))] rounded-lg border border-line bg-surface p-2.5 font-sans shadow-pop data-[state=open]:animate-pop-in"
            aria-label={`Change and redo beat ${n}`}
          >
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault()
                onNote(false)
                void redoBeat(sceneId, n, note)
              }}
            >
              <Input
                ref={inputRef}
                value={note}
                maxLength={MAX_NOTE_CHARS}
                onChange={(e) => setNote(e.target.value)}
                aria-label={`What to change in beat ${n}`}
                placeholder={`What should change in beat ${n}?`}
                className="min-w-0 flex-1"
              />
              <Button type="submit" variant="primary" size="sm" icon={<RotateCcw size={13} />}>
                Redo
              </Button>
            </form>
          </P.Content>
        </P.Portal>
      </P.Root>
      {stale != null ? <span className="aw-beat-note">Written before beat {stale} changed</span> : null}
    </div>
  )
}
