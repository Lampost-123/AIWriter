// Beat markers (2026-10-08): where each scene's beats are (marks.ts), as kept with the scene (api.getBeatMarks),
// read once a scene and saved a moment after each change (and before the window closes or the world changes).
// flow.ts notes each beat as it is written; redo.ts each beat written again; BeatMarksLayer.tsx shows them.
import { create } from 'zustand'
import type { ID } from '@shared/types'
import { api } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { registerDiscarder, registerFlusher } from '@/lib/flush'
import { onRepaired } from '@/features/repair/repairRun'
import { withMended, type SceneBeatMarks } from './marks'

interface MarksState {
  /** By scene: its marks (null: it has none), once read. */
  byScene: Record<ID, SceneBeatMarks | null>
}

export const useBeatMarks = create<MarksState>(() => ({ byScene: {} }))

const SAVE_AFTER_MS = 400

/** Scenes with a change not saved yet. */
const pending = new Map<ID, ReturnType<typeof setTimeout>>()
/** Scenes being read. */
const reading = new Map<ID, Promise<SceneBeatMarks | null>>()

export const marksOf = (sceneId: ID): SceneBeatMarks | null => useBeatMarks.getState().byScene[sceneId] ?? null

/** Reads a scene's marks, once (later calls get what was read, with any change since). */
export function loadMarks(sceneId: ID): Promise<SceneBeatMarks | null> {
  const st = useBeatMarks.getState().byScene
  if (sceneId in st) return Promise.resolve(st[sceneId] ?? null)
  const was = reading.get(sceneId)
  if (was) return was
  const p = api
    .getBeatMarks(sceneId)
    .catch(() => null)
    .then((m) => {
      reading.delete(sceneId)
      // Changed meanwhile (a beat written as it was read): the change wins.
      if (!(sceneId in useBeatMarks.getState().byScene)) setMarks(sceneId, m)
      return marksOf(sceneId)
    })
  reading.set(sceneId, p)
  return p
}

function setMarks(sceneId: ID, marks: SceneBeatMarks | null): void {
  useBeatMarks.setState((s) => ({ byScene: { ...s.byScene, [sceneId]: marks } }))
}

/** Changes a scene's marks (null forgets them) and saves them a moment later. Nothing happens when they don't change. */
export function changeMarks(sceneId: ID, change: (m: SceneBeatMarks | null) => SceneBeatMarks | null): void {
  const was = marksOf(sceneId)
  const next = change(was)
  if (next === was) return
  setMarks(sceneId, next)
  const t = pending.get(sceneId)
  if (t) clearTimeout(t)
  pending.set(
    sceneId,
    setTimeout(() => void save(sceneId), SAVE_AFTER_MS)
  )
}

async function save(sceneId: ID): Promise<void> {
  const t = pending.get(sceneId)
  if (t) clearTimeout(t)
  pending.delete(sceneId)
  try {
    await api.saveBeatMarks(sceneId, marksOf(sceneId))
  } catch (e) {
    // The markers are a help, not the text: the page carries on without them.
    console.error('Could not keep where the beats are', e)
  }
}

/** Saves every change not saved yet. */
export const flushMarks = (): Promise<void> => Promise.all([...pending.keys()].map((id) => save(id))).then(() => undefined)

let installed = false

/**
 * Saved before the window closes or the world changes; forgotten when a backup is restored underneath. A beat's
 * words mended by check and repair as they landed keep their version's fingerprint up to date.
 */
export function installMarks(): void {
  if (installed) return
  installed = true
  registerFlusher(flushMarks)
  onRepaired((recordId, _before, after) => {
    const sceneId = editorBridge()?.sceneId
    if (sceneId && marksOf(sceneId)) changeMarks(sceneId, (m) => (m ? withMended(m, recordId, after.doc) : m))
  })
  registerDiscarder(() => {
    for (const t of pending.values()) clearTimeout(t)
    pending.clear()
    useBeatMarks.setState({ byScene: {} })
  })
}
