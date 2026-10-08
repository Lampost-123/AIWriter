// The desk's World room (UI overhaul phase 4): the gallery of everything in the world, and an entry's dossier over it.
// Everything (the codex), each kind's page and an entry's page are this one page on the desk, so going between them never
// reloads it: the gallery stays where it was under the dossier, and coming back finds it as it was left.
import './world.css'
import './dossier.css'
import { useCallback, useContext } from 'react'
import { createPortal } from 'react-dom'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { Entry, EntryKind, ID } from '@shared/types'
import { useApp } from '@/lib/store'
import { RoomOverlay } from '@/layout/desk/RoomFrame'
import { DossierLayer } from './DossierLayer'
import { closeDossier, openDossier } from './flip'
import type { OpenHow } from './GalleryCard'
import { WorldGallery } from './WorldGallery'
import { useWorldData } from './worldData'

export function WorldRoom(): React.JSX.Element {
  const data = useWorldData()
  const view = useApp((s) => s.view)
  const openId = view.kind === 'entries' ? view.entryId : null
  const from = view.kind === 'entries' ? view.from : undefined
  const overlay = useContext(RoomOverlay)

  const open = useCallback((card: CodexCard, _el: HTMLElement, _how: OpenHow) => openDossier(card), [])
  const created = useCallback((id: ID, kind: EntryKind) => openDossier({ id, kind }), [])
  const close = useCallback(() => {
    if (!openId) return
    // Opened from "What the AI saw": back there.
    if (from) return useApp.getState().navigate({ kind: 'generation', generationId: from.generationId })
    closeDossier(openId)
  }, [openId, from])
  const deleted = useCallback((e: Entry) => closeDossier(e.id), [])
  const another = useCallback((e: Pick<Entry, 'id' | 'kind'>) => openDossier(e), [])

  return (
    <>
      <div className="contents" inert={!!openId}>
        <WorldGallery data={data} openId={openId} onOpen={open} onCreated={created} />
      </div>
      {openId && overlay
        ? createPortal(
            <DossierLayer
              id={openId}
              data={data}
              back={from ? 'Back to What the AI saw' : 'Back to the world'}
              onClose={close}
              onDeleted={deleted}
              onOpen={another}
            />,
            overlay
          )
        : null}
    </>
  )
}
