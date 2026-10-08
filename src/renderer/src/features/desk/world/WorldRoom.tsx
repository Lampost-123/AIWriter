// The desk's World room (UI overhaul phase 4): the gallery of everything in the world. Everything (the codex) and each
// kind's page are this one page on the desk, so going between them never reloads it.
import './world.css'
import { useCallback } from 'react'
import type { CodexCard } from '@shared/contracts/entryViews'
import type { EntryKind, ID } from '@shared/types'
import { itemOf } from '@/features/codex/codexPlace'
import { openFromCodex } from '@/features/codex/codexStore'
import type { OpenHow } from './GalleryCard'
import { WorldGallery } from './WorldGallery'
import { useWorldData } from './worldData'

/** Where the card is in the gallery's scroll area, for coming back to it. */
function placeOf(id: ID): { scroll: number; top: number | null } {
  const el = document.querySelector<HTMLElement>('[data-world-gallery] .g-pane')
  const item = el ? itemOf(el, id) : null
  return { scroll: el?.scrollTop ?? 0, top: el && item ? item.getBoundingClientRect().top - el.getBoundingClientRect().top : null }
}

export function WorldRoom(): React.JSX.Element {
  const data = useWorldData()
  const open = useCallback((card: CodexCard, _el: HTMLElement, _how: OpenHow) => openFromCodex(card, placeOf(card.id)), [])
  const created = useCallback((id: ID, kind: EntryKind) => openFromCodex({ id, kind }, placeOf(id)), [])
  return <WorldGallery data={data} openId={null} onOpen={open} onCreated={created} />
}
