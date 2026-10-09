// The desk's page has no scene toolbar, so the keys its buttons carry in the panels are listened for here instead
// (UI overhaul, phase 3): Ctrl+Enter marks the scene done (Mark done's hook) and Ctrl+L listens from the cursor (Listen's
// hook, with read aloud on). Ctrl+G, Esc to stop a draft and Ctrl+Z on Generate are the AI dock's (useGenerate), and
// Ctrl+Shift+Enter is its Continue; Ctrl+, is the top bar's (useSettingsKey). Each is heard exactly once: the panels'
// toolbar isn't mounted on the desk. Renders nothing.
import type { ID, SceneStatus } from '@shared/types'
import { useOutline } from '@/features/binder/outlineStore'
import { useMarkDoneKeys } from '@/features/editor/DoneButton'
import { useListenKeys } from '@/features/readAloud/ListenButton'

export function DeskSceneKeys({ sceneId, fallbackStatus }: { sceneId: ID; fallbackStatus: SceneStatus }): null {
  const { outline } = useOutline()
  const status = outline?.scenes.find((s) => s.id === sceneId)?.status ?? fallbackStatus
  useMarkDoneKeys(sceneId, status === 'done')
  useListenKeys()
  return null
}
