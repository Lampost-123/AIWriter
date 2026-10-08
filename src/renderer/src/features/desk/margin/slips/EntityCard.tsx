// An entity's card, grown out of its margin slip (the desk, UI overhaul phase 3): a band in the kind's ink, the
// portrait, the name and one-liner, how a character speaks (with a line of theirs), where things stand as of this
// scene, and two ways on: **Open their page** (the entry's page) and **Show beside the page** (the scene drawer). It
// grows from the slip's corner in 240ms and folds back in 180ms (at once with less motion, or from the keyboard).
// Esc, the ×, or a click anywhere else folds it back.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowRight, PanelRight, X } from '@/components/ui/icons'
import { cn } from '@/lib/cn'
import { useApp } from '@/lib/store'
import { KIND_LABELS } from '@shared/fields'
import { Portrait } from '@/features/views/Portrait'
import { cardLines, displayName, noStateWords, voiceRows, whereWords } from '@/features/peek/entryView'
import { keyboardDriven } from '@/features/look/motion'
import type { EntitySlipData } from '../anchors'

/** The room kept at the foot of the page for its tools (the AI dock and its chip). */
const DOCK_ROOM = 120

const ROLE_WORDS: Record<EntitySlipData['role'], string> = {
  pov: 'Point of view',
  present: 'In this scene',
  location: 'Where it happens',
  named: 'Named here'
}

export function EntityCard({
  data,
  closing,
  inline,
  onClose
}: {
  data: EntitySlipData
  closing: boolean
  /** In a pop-up (the notes' tabs in a smaller window): in the flow, not over the page. */
  inline?: boolean
  onClose: (refocus: boolean) => void
}): React.JSX.Element {
  const { entry, role } = data
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const instant = useRef(keyboardDriven())
  const name = displayName(entry)
  const voice = voiceRows(entry.voice, 1)
  const lines = cardLines(entry.state, 2)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // It grows downwards from the slip, or upwards when there isn't room for it above the page's tools (the AI dock).
  const [up, setUp] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || inline) return
    const page = el.closest('.desk-scroller')?.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    if (page && box.bottom > page.bottom - DOCK_ROOM && box.height < box.top - page.top) setUp(true)
  }, [inline])

  useEffect(() => {
    if (closing) return
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      e.stopPropagation()
      onCloseRef.current(true)
    }
    const onDown = (e: MouseEvent): void => {
      const t = e.target as Node | null
      if (t && ref.current?.contains(t)) return
      // The slip it grew from toggles it itself.
      if (t instanceof Element && t.closest('.desk-entity') === ref.current?.parentElement) return
      onCloseRef.current(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', onDown, true)
    }
  }, [closing])

  const openPage = (): void => {
    onClose(false)
    useApp.getState().navigate({ kind: 'entries', entryKind: entry.kind, entryId: entry.id })
  }
  const beside = (): void => {
    onClose(false)
    useApp.getState().peekEntry(entry.id)
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={name}
      data-entity-card={entry.id}
      data-state={closing ? 'closed' : 'open'}
      data-instant={instant.current || undefined}
      data-up={up || undefined}
      className={cn('desk-ecard', `k-${entry.kind}`, inline && 'is-inline')}
    >
      <div className="ec-band">
        <span className="ec-kind">
          {KIND_LABELS[entry.kind]?.one ?? 'Entry'} · {ROLE_WORDS[role]}
        </span>
        <button ref={closeRef} type="button" className="ec-close" aria-label="Close the card" onClick={() => onClose(true)}>
          <X size={14} />
        </button>
      </div>
      <Portrait entry={entry} size={60} className="ec-portrait" />
      <div className="ec-body">
        <h2 className="ec-name">{name}</h2>
        {entry.summary ? <p className="ec-desc">{entry.summary}</p> : null}
        {voice.rows[0] ? (
          <div className="ec-sec">
            <span className="desk-caps">{voice.rows[0].label}</span>
            <p className="ec-txt">{voice.rows[0].text}</p>
          </div>
        ) : null}
        {voice.samples[0] ? <p className="ec-voice">“{voice.samples[0]}”</p> : null}
        <div className="ec-rule" />
        <div className="ec-sec">
          <span className="desk-caps">Where things stand</span>
          {lines.length && !entry.absent ? (
            lines.map((l, i) => (
              <p key={i} className="ec-txt">
                {l.text}
                {whereWords(l) ? <span className="ec-where"> · {whereWords(l)}</span> : null}
              </p>
            ))
          ) : (
            <p className="ec-txt ec-quiet">{noStateWords(entry)}</p>
          )}
        </div>
        <div className="ec-foot">
          <button type="button" className="ec-link" onClick={openPage}>
            <span>{entry.kind === 'character' ? 'Open their page' : 'Open its page'}</span>
            <ArrowRight size={14} aria-hidden />
          </button>
          <button type="button" className="ec-link" onClick={beside}>
            <PanelRight size={14} aria-hidden />
            <span>Show beside the page</span>
          </button>
        </div>
      </div>
    </div>
  )
}
