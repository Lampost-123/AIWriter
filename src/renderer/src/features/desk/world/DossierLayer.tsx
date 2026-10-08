// An entry's dossier over the World room (UI overhaul phase 4, D4.2): a dimmed, softly blurred room with the dossier on
// it, centred, as a dialog. The gallery and the spine under it are out of the keyboard's way; Tab goes round the
// dossier; Esc, Back and a click on the dimmed room go back to the gallery, with the keyboard on the card it came from.
// How it opens and goes (the card flipping into it) is flip.ts.
import { useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react'
import type { Entry, ID } from '@shared/types'
import { Dossier } from '@/features/world/dossier/Dossier'
import type { WorldData } from './worldData'

/** Everything in the dossier the keyboard can reach, in order. */
const tabbables = (root: HTMLElement): HTMLElement[] =>
  [
    ...root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ].filter((el) => !el.closest('[inert]') && el.getClientRects().length > 0)

export function DossierLayer({
  id,
  data,
  back,
  onClose,
  onDeleted,
  onOpen
}: {
  id: ID
  data: WorldData
  /** What Back says ("Back to the world", "Back to What the AI saw"). */
  back: string
  /** Back to where it was opened from; `how` says whether from the keyboard (Esc) or the pointer. */
  onClose: (how: 'keyboard' | 'pointer') => void
  onDeleted: (e: Entry) => void
  onOpen: (e: Pick<Entry, 'id' | 'kind'>) => void
}): React.JSX.Element | null {
  const titleId = useId()
  const sheet = useRef<HTMLDivElement>(null)
  const entry = data.byId.get(id) ?? null
  const others = useMemo(() => (data.entries ?? []).filter((e) => e.id !== id), [data.entries, id])
  const places = useMemo(() => (data.entries ?? []).filter((e) => e.kind === 'place'), [data.entries])
  // Where it first appears, from its codex card (unknown until the cards have loaded).
  const card = data.cards?.find((c) => c.id === id)
  const firstSeen = data.cards ? (card?.first ?? null) : undefined

  // The keyboard goes to the dossier's heading as it opens (a new entry's own page then puts it in its name).
  const shown = !!entry
  useLayoutEffect(() => {
    const el = sheet.current
    if (!el || el.contains(document.activeElement)) return
    el.querySelector<HTMLElement>(`[id="${CSS.escape(titleId)}"]`)?.focus({ preventScroll: true })
  }, [id, titleId, shown])

  // Esc anywhere in the dossier goes back (a field being edited takes its own Esc first; a menu or picker open over it
  // closes itself).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      const el = sheet.current
      if (!el) return
      const t = e.target as Node | null
      if (t && t !== document.body && !el.contains(t)) return
      e.preventDefault()
      onClose('keyboard')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!entry) {
    if (data.entries === null) return null
    return (
      <div className="dz-layer" data-dossier-layer>
        <div className="dz-scrim" aria-hidden onClick={() => onClose('pointer')} />
        <div ref={sheet} role="dialog" aria-modal="true" aria-labelledby={titleId} className="dz-sheet dz-missing" data-dossier={id}>
          <h2 id={titleId} tabIndex={-1} className="dz-missing-h">
            This entry can’t be found
          </h2>
          <p className="dz-missing-p">
            It may have been deleted. Anything deleted can be brought back from Settings › Recently deleted for 30 days.
          </p>
          <button type="button" className="dz-btn" onClick={() => onClose('pointer')}>
            {back}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="dz-layer" data-dossier-layer>
      <div className="dz-scrim" aria-hidden onClick={() => onClose('pointer')} />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dz-sheet"
        data-dossier={id}
        onKeyDown={(e) => {
          // Tab goes round the dossier.
          if (e.key !== 'Tab' || !sheet.current) return
          const list = tabbables(sheet.current)
          if (!list.length) return
          const i = list.indexOf(document.activeElement as HTMLElement)
          if (e.shiftKey && (i <= 0 || i === -1)) {
            e.preventDefault()
            list[list.length - 1].focus()
          } else if (!e.shiftKey && i === list.length - 1) {
            e.preventDefault()
            list[0].focus()
          }
        }}
      >
        <Dossier
          key={entry.id}
          entry={entry}
          others={others}
          places={places}
          back={{ label: back, run: () => onClose('pointer') }}
          onLiveChange={data.live}
          onDeleted={onDeleted}
          onOpen={onOpen}
          titleId={titleId}
          firstSeen={firstSeen}
        />
      </div>
    </div>
  )
}
