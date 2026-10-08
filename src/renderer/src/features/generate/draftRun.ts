// Generate's draft, kept here rather than in the Generate button, so it carries on when Adam opens
// another scene: the editor keeps the scene he left for the draft (see the editor's controller), the
// words go on landing in it and are saved as they come, and coming back to the scene shows it still
// writing, with Stop. There is one Generate draft at a time; Generate in another scene says where it is.
// With "Polish after drafting" on, a draft that finishes in full is then polished (polishRun.ts).
import { create } from 'zustand'
import type { AppEvents } from '@shared/api'
import type { ID } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError, modKey, onEvent } from '@/lib/api'
import type { EditorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { snapshotBefore } from '@/features/history/snapshot'
import { openScene } from '@/features/memory/openScene'
import { activeStream } from '@/features/editor/streamDoc'
import { resolveDraftOptions, type SceneDraftOptions } from './draftOptions'
import { blockIndexAt, draftPlace, polishable } from './polish'
import { polishingScene, startPolish, stopPolish, usePolish } from './polishRun'
import { repairLanded } from '@/features/repair/repairRun'
import { cardLength } from '@shared/defaults'

export type Phase = 'idle' | 'starting' | 'streaming' | 'stopping'

interface Run {
  sceneId: ID
  worldId: ID | null
  bridge: EditorBridge
  generationId: ID | null
  /** Text that arrived before startDraft returned the draft's id. */
  early: AppEvents['generation:chunk'][]
  earlyDone: AppEvents['generation:done'] | null
  cancelled: boolean
  /** "Polish after drafting" was on when the draft started. */
  polish: boolean
}

interface DraftState {
  /** The scene Generate's draft is for, while there is one. */
  sceneId: ID | null
  phase: Phase
  /** Why the draft is being tried again, while it is. */
  retrying: string | null
  /** A message's button asked for a panel under this scene's Generate button. */
  panel: { sceneId: ID; which: 'options' | 'need-model' } | null
}

export const useDraft = create<DraftState>(() => ({ sceneId: null, phase: 'idle', retrying: null, panel: null }))

let run: Run | null = null

const idle = (): Partial<DraftState> => ({ sceneId: null, phase: 'idle', retrying: null })

/** The scene's title in quotes, as the binder shows it, or null when it isn't in the open story. */
function titled(sceneId: ID): string | null {
  const scene = useOutlineStore.getState().outline?.scenes.find((s) => s.id === sceneId)
  return scene ? `“${scene.title || 'Untitled scene'}”` : null
}

/** Opens the scene (from anywhere) and, once it shows, a panel under its Generate button. */
export function openPanel(sceneId: ID, which: 'options' | 'need-model'): void {
  const app = useApp.getState()
  if (app.sceneId !== sceneId) void openScene(sceneId)
  else if (app.view.kind !== 'write') app.navigate({ kind: 'write' })
  useDraft.setState({ panel: { sceneId, which } })
}

const showScene = (sceneId: ID): (() => void) => () => {
  if (useApp.getState().sceneId === sceneId) useApp.getState().navigate({ kind: 'write' })
  else void openScene(sceneId)
}

/**
 * Says so when Generate's draft is writing into a scene other than `sceneId` (one draft at a time), with a
 * button to go there. True when it is.
 */
export function busyElsewhere(sceneId: ID): boolean {
  const r = run
  const other = r ? r.sceneId : polishingScene()
  if (!other || other === sceneId) return false
  const name = titled(other)
  const what = r ? 'still being written' : 'still being polished'
  toast(
    `${name ? `A draft of ${name}` : 'A draft of another scene'} is ${what}. Stop it there first, or wait for it to finish.`,
    { action: { label: 'Show', run: showScene(other) } }
  )
  return true
}

let listening = false

/** Hears the drafts' words and ends, once, for as long as the window is open. */
export function listenForDrafts(): void {
  if (listening) return
  listening = true
  onEvent('generation:chunk', (p) => {
    const r = run
    if (!r || r.cancelled) return
    if (r.generationId === null) {
      r.early.push(p)
      return
    }
    if (p.generationId !== r.generationId) return
    r.bridge.appendStream(p.generationId, p.text)
    if (useDraft.getState().retrying) useDraft.setState({ retrying: null })
  })
  onEvent('generation:retrying', (p) => {
    const r = run
    if (!r || (r.generationId !== null && p.generationId !== r.generationId)) return
    useDraft.setState({ retrying: p.reason })
  })
  onEvent('generation:done', (p) => {
    const r = run
    if (!r) return
    if (r.generationId === null) r.earlyDone = p
    else finish(p)
  })
  // Another world: a draft still getting ready is called off (one being written is stopped by the editor).
  useApp.subscribe((a, prev) => {
    const r = run
    if (r && !r.generationId && a.world?.id !== prev.world?.id && a.world?.id !== r.worldId) stopDraft()
  })
}

function finish(p: AppEvents['generation:done']): void {
  const r = run
  if (!r || r.generationId !== p.generationId) return
  // A problem is reported here, in one message; otherwise the page says what the draft did.
  const failed = (p.status === 'error' && !!p.error) || !!p.cutOff
  // Polishing a draft that came in full needs where it begins in the page, read before its stream ends.
  const toPolish = r.polish && p.status === 'complete' && !p.cutOff
  const editor = r.bridge.editor
  const shown = editor && r.bridge.sceneId === r.sceneId ? activeStream(editor.state) : null
  const stream = shown && shown.generationId === p.generationId ? shown : null
  const start =
    toPolish && stream && editor
      ? { index: blockIndexAt(editor.state.doc, stream.from), breakAdded: !!stream.breakAdded, replace: !!stream.replace }
      : null
  // Check and repair: where the draft's words begin, for checking them as soon as they are in.
  const landed = stream && !(stream.replace && !stream.before) ? stream.from : null
  const { replaced, away } = r.bridge.endStream(p.generationId, { failed })
  run = null
  useDraft.setState(idle())
  const app = useApp.getState()
  if (app.activeGeneration?.id === p.generationId) app.setActiveGeneration(null)
  const showRecord = { label: 'What the AI saw', run: () => useApp.getState().navigate({ kind: 'generation', generationId: p.generationId }) }
  // The draft took the place of the scene's text: how to have the old text back.
  const oldText = replaced ? (away ? ` ${modKey()}+Z in that scene puts its old text back.` : ` ${modKey()}+Z puts the scene's old text back.`) : ''
  // Written while Adam was in another scene: which scene the message is about.
  const name = away ? (titled(r.sceneId) ?? 'the scene') : null
  if (p.status === 'error' && p.error) {
    // The button goes where the message says the fix is: the draft options (a length the
    // model can't manage), Settings (key, credit, model), or else the draft's record.
    const action = /\bdraft options\b/.test(p.error)
      ? { label: 'Draft options', run: () => openPanel(r.sceneId, 'options') }
      : /\bSettings\b/.test(p.error)
        ? { label: 'Open Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) }
        : showRecord
    toast((name ? `The draft of ${name} ran into a problem. ` : '') + p.error + oldText, { tone: 'danger', action })
  } else if (p.cutOff) {
    toast(
      `The model ran out of room before the end of ${name ?? 'the scene'}, so the draft stops mid-way. The text so far is kept. Try a shorter target length, or a writer model that can write more in one go.${oldText}`,
      { action: showRecord }
    )
  } else if (name) {
    const done = p.status === 'stopped' ? `Drafting ${name} stopped. The text so far is kept.` : `The draft of ${name} is finished.`
    // Polishing needs the draft in front of it, so a draft that finished in another scene isn't polished.
    const unpolished = toPolish ? ' It wasn’t polished, because you were in another scene when it finished.' : ''
    toast(done + unpolished + oldText, { action: { label: 'Show', run: showScene(r.sceneId) } })
  } else if (toPolish && start && polishable(start.replace, replaced)) {
    const place = editor && !editor.isDestroyed ? draftPlace(editor.state.doc, start.index, start.breakAdded) : null
    // Polished, the draft's words are checked once Adam accepts the polished version (polishRun.ts).
    if (place) return void startPolish({ sceneId: r.sceneId, draftId: p.generationId, place })
  }
  // The draft's words are in the page: checked claim by claim now, slips mended in amber (features/repair). Not a draft
  // that went wrong, nor one that finished while Adam was in another scene (the check after the draft covers those).
  if (landed !== null && !away && p.status !== 'error' && editor && !editor.isDestroyed && r.bridge.sceneId === r.sceneId) {
    repairLanded({ sceneId: r.sceneId, recordId: p.generationId, from: landed, to: editor.state.doc.content.size })
  }
}

/**
 * Drafts the scene into the page (the open scene, as `bridge` shows it). `replace`: in place of its
 * text. `takeKeyboard`: Adam picked where it goes, so the keyboard goes back into the page. The draft
 * options are read once the scene card is saved. Resolves true once the draft's words have begun streaming into the
 * page (false when it didn't start; a reason, when there is one, has been shown).
 */
export async function startDraft(
  sceneId: ID,
  bridge: EditorBridge,
  o: { replace: boolean; takeKeyboard: boolean; options: () => SceneDraftOptions }
): Promise<boolean> {
  // One at a time, and not while the last draft is being polished.
  if (run || polishingScene()) return false
  // From now until the first words arrive, the text to be replaced is held as it is (dimmed, and
  // nothing can change it), so nothing typed while the draft gets ready goes with it.
  if (o.replace && !bridge.holdForReplace(sceneId)) {
    toast("The editor wasn't ready for this scene, so nothing was sent. Try again in a moment.")
    return false
  }
  // Picked from the choice: the keyboard goes back into the page, so Ctrl+Z works as the choice says.
  if (o.takeKeyboard) bridge.takeKeyboard()
  listenForDrafts()
  const r: Run = {
    sceneId,
    worldId: useApp.getState().world?.id ?? null,
    bridge,
    generationId: null,
    early: [],
    earlyDone: null,
    cancelled: false,
    polish: false
  }
  run = r
  useDraft.setState({ sceneId, phase: 'starting', retrying: null })
  // If Adam opens another scene while it gets ready, this one is kept for the draft.
  bridge.expectDraft(sceneId)
  /** The draft didn't start: the held text is the scene's again (unless a newer draft has started since). */
  const giveUp = (): false => {
    if (run !== r && run !== null) return false
    run = null
    useDraft.setState(idle())
    bridge.releaseHold(sceneId)
    return false
  }
  try {
    // Save the card and the page first, so the draft is built from the latest of both.
    await flushAll()
    const card = (await api.getScene(sceneId)).card
    const options = resolveDraftOptions(o.options(), cardLength(card), useApp.getState().settings?.creativity ?? 'balanced', usePolish.getState().on)
    r.polish = !!options.polish
    if (r.cancelled) return giveUp()
    const { generationId } = await api.startDraft(sceneId, options)
    // History keeps the scene as it is just before the draft goes in (linked to the draft, for What the AI saw).
    await snapshotBefore(sceneId, 'Before a new draft', { generationId })
    if (r.cancelled || run !== r) {
      void api.stopGeneration(generationId).catch(() => undefined)
      return giveUp()
    }
    if (!bridge.beginStream(sceneId, generationId, { replace: o.replace, keepWriting: true })) {
      void api.stopGeneration(generationId).catch(() => undefined)
      giveUp()
      // A scene deleted while its draft got ready has already said so.
      const gone = await api.getScene(sceneId).then(
        () => false,
        () => true
      )
      if (!gone) toast("The editor wasn't ready for this scene, so the draft was stopped. Try again in a moment.")
      return false
    }
    r.generationId = generationId
    useApp.getState().setActiveGeneration({ id: generationId, sceneId })
    useDraft.setState({ phase: 'streaming' })
    for (const c of r.early) if (c.generationId === generationId) bridge.appendStream(generationId, c.text)
    r.early = []
    if (r.earlyDone?.generationId === generationId) finish(r.earlyDone)
    return true
  } catch (e) {
    giveUp()
    const err = e as ApiError
    // Adam pressed Stop before it began: nothing was sent, and there's nothing to say.
    if (err.code === 'cancelled') return false
    if (err.code === 'no-writer-model') openPanel(sceneId, 'need-model')
    // A length the model can't write is changed in the draft options; key and model problems in Settings.
    else if (err.code === 'too-long') toast(err.message, { tone: 'danger', action: { label: 'Draft options', run: () => openPanel(sceneId, 'options') } })
    else {
      const settings = err.code === 'no-key' || /\bSettings\b/.test(err.message)
      const action = settings ? { label: 'Open Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) } : undefined
      toast(err.message, { tone: 'danger', action })
    }
    return false
  }
}

/** Stops Generate's draft (Stop, or Esc in its scene), or its polish pass. The text so far is kept. */
export function stopDraft(): void {
  const r = run
  if (!r) {
    stopPolish()
    return
  }
  if (!r.generationId) {
    // Still starting (perhaps waiting for the memory to catch up): it is called off and nothing is sent.
    // A draft that had already begun by then is stopped as soon as its start comes back.
    r.cancelled = true
    useDraft.setState({ phase: 'stopping' })
    void api.cancelDraftStart(r.sceneId).catch(() => undefined)
    return
  }
  if (useDraft.getState().phase === 'stopping') return
  useDraft.setState({ phase: 'stopping' })
  api.stopGeneration(r.generationId).catch((e: Error) => toast(e.message, { tone: 'danger' }))
}
