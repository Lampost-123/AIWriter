// "Polish after drafting": once Generate's draft has finished, the polish pass (contracts/polish.ts) revises
// it, and the revision waits in the page as one change to accept or reject (features/edits/session.ts
// showReplacement; Accept keeps a History snapshot first). While it runs, Generate shows "Polishing…" and Stop
// (or Esc) stops it. Whatever goes wrong, the draft stays as it was written, and a quiet message says so.
// Whether it is on is Adam's last choice, remembered on this computer.
import { create } from 'zustand'
import type { TaskDone } from '@shared/contracts/tasks'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, type ApiError, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { openScene } from '@/features/memory/openScene'
import { showReplacement, waitingSuggestion } from '@/features/edits/session'
import { cleanReply } from '@/features/edits/text'
import { looksLikeRefusalReply } from '@shared/refusal'
import { findDraft, lastPolish, polishedScene, rememberPolish, type DraftPlace } from './polish'
import { repairLanded } from '@/features/repair/repairRun'

interface PolishState {
  /** "Polish after drafting" is on. */
  on: boolean
  /** The scene whose draft is being polished, while one is. */
  sceneId: ID | null
  stopping: boolean
}

export const usePolish = create<PolishState>(() => ({ on: lastPolish(), sceneId: null, stopping: false }))

/** Turns "Polish after drafting" on or off, and remembers it for next time. */
export function setPolishOn(on: boolean): void {
  rememberPolish(on)
  usePolish.setState({ on })
}

interface Live {
  taskId: ID
  sceneId: ID
  /** The draft being polished (its stage is what the polished words are checked against). */
  draftId: ID
  place: DraftPlace
  stopAsked: boolean
  stopTimer: ReturnType<typeof setTimeout> | null
}

let live: Live | null = null
let listening = false

/** How long Stop waits for the polish pass to end before saying it stopped anyway. */
const STOP_WAIT_MS = 4000
/** How long "Show" waits for the scene to open before giving up. */
const OPEN_WAIT_MS = 4000

const newTaskId = (): ID => globalThis.crypto.randomUUID()

/** The scene whose draft is being polished, if any. */
export const polishingScene = (): ID | null => live?.sceneId ?? null

function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:done', (d) => {
    if (live && d.taskId === live.taskId) finish(d)
  })
}

function end(): void {
  if (live?.stopTimer) clearTimeout(live.stopTimer)
  live = null
  usePolish.setState({ sceneId: null, stopping: false })
}

/** The scene's title in quotes, as the binder shows it, or null when it isn't in the open story. */
function titled(sceneId: ID): string | null {
  const scene = useOutlineStore.getState().outline?.scenes.find((s) => s.id === sceneId)
  return scene ? `“${scene.title || 'Untitled scene'}”` : null
}

const recordAction = (generationId: ID): { label: string; run: () => void } => ({
  label: 'What the AI saw',
  run: () => useApp.getState().navigate({ kind: 'generation', generationId })
})

/** Starts polishing the draft just finished at `place` in the scene. */
export async function startPolish(o: { sceneId: ID; draftId: ID; place: DraftPlace }): Promise<void> {
  if (live) return
  listen()
  const l: Live = { taskId: newTaskId(), sceneId: o.sceneId, draftId: o.draftId, place: o.place, stopAsked: false, stopTimer: null }
  live = l
  usePolish.setState({ sceneId: o.sceneId, stopping: false })
  try {
    await api.startPolish({ taskId: l.taskId, sceneId: o.sceneId, draftId: o.draftId, text: o.place.text })
    // Stopped while it got ready: it stops now.
    if (live === l && l.stopAsked) void api.stopTask(l.taskId).catch(() => undefined)
  } catch (e) {
    if (live !== l) return
    end()
    const err = e as ApiError
    toast(`The draft is kept as it was: the polish pass didn't start. ${err.message}`.trim(), {
      action: /\bSettings\b/.test(err.message) ? { label: 'Open Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) } : undefined
    })
  }
}

/** Stops the polish pass; the draft stays as it was written. */
export function stopPolish(): void {
  const l = live
  if (!l || l.stopAsked) return
  l.stopAsked = true
  usePolish.setState({ stopping: true })
  void api.stopTask(l.taskId).catch(() => undefined)
  // Its end comes with the task's; if that never comes, it is over anyway.
  l.stopTimer = setTimeout(() => {
    if (live !== l) return
    end()
    toast('Polishing stopped. The draft is kept as it was.')
  }, STOP_WAIT_MS)
}

function finish(d: TaskDone): void {
  const l = live
  if (!l) return
  end()
  const record = recordAction(d.generationId)
  if (d.status === 'stopped') {
    toast('Polishing stopped. The draft is kept as it was.')
    return
  }
  if (d.status === 'error') {
    const settings = /\bSettings\b/.test(d.error ?? '')
    toast(`The draft is kept as it was: the polish pass didn't work. ${d.error ?? ''}`.trim(), {
      action: settings ? { label: 'Open Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) } : record
    })
    return
  }
  if (d.cutOff) {
    toast('The polish pass ran out of room before the end of the scene, so the draft is kept as it was.', { action: record })
    return
  }
  // Only a whole scene stands in for the draft: not a refusal, nor a reply missing much of it. Notes about the
  // changes after the scene are left out.
  const polished = polishedScene(cleanReply(d.text, true), l.place.text, looksLikeRefusalReply)
  if ('problem' in polished) {
    toast(
      polished.problem === 'refused'
        ? 'The writer model wouldn’t polish this draft, so it is kept as it was.'
        : polished.problem === 'short'
          ? 'The polished version left out much of the scene, so the draft is kept as it was.'
          : 'The polish pass sent nothing back, so the draft is kept as it was.',
      { action: record }
    )
    return
  }
  const text = polished.text
  if (put(l, text, d.generationId)) return
  // Adam is in another scene: the revision waits until he goes back to it.
  const name = titled(l.sceneId)
  toast(`The polished version of ${name ?? 'the draft'} is ready to review.`, {
    action: { label: 'Show', run: () => void showLater(l, text, d.generationId) }
  })
}

/** Opens the scene, then offers the revision there once the page shows it. */
async function showLater(l: Live, text: string, generationId: ID): Promise<void> {
  const app = useApp.getState()
  if (app.sceneId !== l.sceneId) await openScene(l.sceneId)
  else if (app.view.kind !== 'write') app.navigate({ kind: 'write' })
  const until = Date.now() + OPEN_WAIT_MS
  while (Date.now() < until) {
    if (put(l, text, generationId)) return
    await new Promise((r) => setTimeout(r, 100))
  }
  toast("The scene didn't open in time, so the polished version wasn't put in. What the AI saw has it.", { action: recordAction(generationId) })
}

/**
 * Offers the revision in the page in place of the draft, as one change to accept or reject. False when the
 * page isn't showing the scene (nothing is said); true once it is dealt with, or said why it can't be.
 */
function put(l: Live, text: string, generationId: ID): boolean {
  const bridge = editorBridge()
  const editor = bridge?.editor
  if (!bridge || !editor || editor.isDestroyed || bridge.sceneId !== l.sceneId) return false
  const record = recordAction(generationId)
  const where = findDraft(editor.state.doc, l.place)
  if (where === 'changed') {
    toast('The draft was edited while it was being polished, so the polished version wasn’t put in. What the AI saw has it.', { action: record })
    return true
  }
  if (where === 'gone') {
    toast('The polished version couldn’t be put in, because the draft has changed. What the AI saw has it.', { action: record })
    return true
  }
  if (waitingSuggestion()) {
    toast('The polished version is ready, but another AI change is waiting in the page. What the AI saw has it.', { action: record })
    return true
  }
  showReplacement({
    from: where.from,
    to: where.to,
    text,
    note: 'The polish pass’s revision of the draft. Accept to use it in place of the draft, or reject it to keep the draft as it was.',
    label: 'Polish pass',
    snapshot: 'Before the polish pass',
    generationId,
    // Check and repair: the polished words are checked claim by claim once they are in, as a draft's are.
    onAccepted: (words) => repairLanded({ sceneId: l.sceneId, recordId: generationId, stageOf: l.draftId, ...words })
  })
  return true
}
