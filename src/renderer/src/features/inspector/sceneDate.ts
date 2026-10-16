// A scene's date on the story calendar (long story memory fix 11), as the scene card and the desk's page head say it:
// read again whenever a card is saved (briefingRev) or the outline changes (a scene moved changes what it counts from).
import { useEffect, useState } from 'react'
import type { SceneDateView } from '@shared/contracts/worldViews'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { useApp } from '@/lib/store'

/** The scene's date view; null until it has been read (and whenever it can't be: nothing is said then). */
export function useSceneDate(sceneId: ID): SceneDateView | null {
  const briefingRev = useApp((s) => s.briefingRev)
  const outlineRev = useApp((s) => s.outlineRev)
  const [view, setView] = useState<{ id: ID; view: SceneDateView | null } | null>(null)
  useEffect(() => {
    let live = true
    api
      .getSceneDate(sceneId)
      .then((v) => live && setView({ id: sceneId, view: v }))
      .catch(() => live && setView({ id: sceneId, view: null }))
    return () => {
      live = false
    }
  }, [sceneId, briefingRev, outlineRev])
  return view && view.id === sceneId ? view.view : null
}
