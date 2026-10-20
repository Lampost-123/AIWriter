// Generate's draft, kept here rather than in the Generate button, so it carries on when Adam opens
// another scene: the editor keeps the scene he left for the draft (see the editor's controller), the
// words go on landing in it and are saved as they come, and coming back to the scene shows it still
// writing, with Stop. There is one Generate draft at a time; Generate in another scene says where it is.
// With "Polish after drafting" on, a draft that finishes in full is then polished (polishRun.ts).
import { create } from 'zustand'
import type { AppEvents } from '@shared/api'
import type { DraftOptions, ID, ModelChoice } from '@shared/types'
import { toast } from '@/components/ui'
import { api, ApiError, modKey, onEvent } from '@/lib/api'
import { editorBridge, type EditorBridge } from '@/lib/editorBridge'
import { flushAll } from '@/lib/flush'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { snapshotBefore } from '@/features/history/snapshot'
import { openScene } from '@/features/memory/openScene'
import { activeStream } from '@/features/editor/streamDoc'
import { continueAtEnd } from '@/features/edits/continue'
import { sceneInPage } from '@/features/ask/sceneInPage'
import { draftEndActions, type DraftEndAction } from './draftEnd'
import { resolveDraftOptions, type SceneDraftOptions } from './draftOptions'
import { blockIndexAt, draftPlace, polishable } from './polish'
import { polishingScene, startPolish, stopPolish, usePolish } from './polishRun'
import { checkLanded } from '@/features/repair/repairRun'
import { cardLength, countWords } from '@shared/defaults'
import { jobModelName, shortModelName } from '@shared/modelJobs'
import { withDirected } from '@/features/director/store'
import { beginDraftNote, draftNoteRecord, noteDraftEnd, noteDraftStart } from '@/features/draftNote/draftNote'
import { anotherModel, modelName } from '@/features/draftNote/compose'

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
  /** How it was asked for, so a refusal can be tried again with another model (the calm overhaul). */
  replace: boolean
  options: () => SceneDraftOptions
  /** The model this draft was written with in place of the writer model ("Try with …"), if any. */
  model: DraftOptions['model'] | null
  /** The scene had words before the draft. */
  hadText: boolean
  /** The draft's words so far (the top bar's progress card counts them). */
  text: string
}

/** A draft as the top bar's progress card shows it (features/progress), from Generate to its first words and on. */
export interface DraftLive {
  sceneId: ID
  /** When Generate was pressed, and when the first words came (Date.now()). */
  startedAt: number
  firstWordAt: number | null
  /** Its words so far (counted now and then). */
  words: number
  /** The length it aims for; null for Auto. */
  target: number | null
  /** The writer model's name as Settings shows it (or the one it was tried with). */
  model: string
  /** The memory model's (it catches up and plans the scene). */
  memoryModel: string
}

/** How the latest draft ended, for a progress card left open (features/progress). */
export interface DraftLast {
  sceneId: ID
  status: 'complete' | 'stopped' | 'error'
  words: number
  error: string | null
  cutOff: boolean
  at: number
}

interface DraftState {
  /** The scene Generate's draft is for, while there is one. */
  sceneId: ID | null
  phase: Phase
  /** Why the draft is being tried again, while it is. */
  retrying: string | null
  /** A message's button asked for a panel under this scene's Generate button. */
  panel: { sceneId: ID; which: 'options' | 'need-model' } | null
  /** The draft going now, as the top bar's progress card shows it. */
  live: DraftLive | null
  /** How the latest draft ended. */
  last: DraftLast | null
  /** The scene whose new words are being checked straight after its draft (features/repair), while they are. */
  checking: ID | null
}

export const useDraft = create<DraftState>(() => ({ sceneId: null, phase: 'idle', retrying: null, panel: null, live: null, last: null, checking: null }))

/** How often the progress card's word count follows a draft. */
const COUNT_MS = 400
let countTimer: ReturnType<typeof setTimeout> | null = null

/** Counts the draft's words for the progress card, now and then. */
function countSoon(r: Run): void {
  if (countTimer) return
  countTimer = setTimeout(() => {
    countTimer = null
    const live = useDraft.getState().live
    if (run !== r || !live || live.sceneId !== r.sceneId) return
    useDraft.setState({ live: { ...live, words: countWords(r.text), firstWordAt: live.firstWordAt ?? Date.now() } })
  }, COUNT_MS)
}

/** The model's name as Settings shows it: the one this draft was tried with, else the writer model. */
function draftModelName(model: DraftOptions['model'] | null | undefined): string {
  const models = useApp.getState().settings?.models
  if (model) {
    const same = Object.values(models ?? {}).find((m) => m && m.providerId === model.providerId && m.modelId === model.modelId)
    return same ? shortModelName(same) : model.modelId
  }
  return jobModelName(models, 'writer')
}

let run: Run | null = null

const idle = (): Partial<DraftState> => ({ sceneId: null, phase: 'idle', retrying: null, live: null })

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
 * Continue from here, on a draft that stopped short: Continue (features/edits) writes on from the end of the scene, as
 * a change to accept or reject. The scene opens again first if Adam has gone elsewhere since.
 */
async function continueFromEnd(sceneId: ID): Promise<void> {
  if (useApp.getState().sceneId !== sceneId) await openScene(sceneId)
  // It isn't in any story now (deleted, say): openScene has said so.
  if (useApp.getState().sceneId !== sceneId) return
  if (!(await sceneInPage(sceneId))) return void toast("The scene didn't open in time, so nothing was sent. Try again in a moment.")
  // Continue says itself why it can't start (another change waiting, a draft being written).
  if (!continueAtEnd()) toast('The scene has no words to carry on from.')
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
    r.text += p.text
    countSoon(r)
    if (useDraft.getState().retrying) useDraft.setState({ retrying: null })
  })
  // Directed writing (src/main/director): the draft's last paragraph is taken back for a retake.
  onEvent('generation:takeBack', (p) => {
    const r = run
    if (!r || r.cancelled || r.generationId !== p.generationId) return
    r.bridge.takeBackStream?.(p.generationId)
    const at = p.text ? r.text.lastIndexOf(p.text) : -1
    if (at >= 0) r.text = r.text.slice(0, at)
    countSoon(r)
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
  const words = countWords(r.text)
  const ended: DraftLast['status'] = p.status === 'stopped' ? 'stopped' : p.status === 'error' ? 'error' : 'complete'
  useDraft.setState({
    ...idle(),
    last: { sceneId: r.sceneId, status: ended, words, error: p.status === 'error' ? p.error : null, cutOff: !!p.cutOff, at: Date.now() }
  })
  const app = useApp.getState()
  if (app.activeGeneration?.id === p.generationId) app.setActiveGeneration(null)
  // The draft took the place of the scene's text: how to have the old text back.
  const oldText = replaced ? (away ? ` ${modKey()}+Z in that scene puts its old text back.` : ` ${modKey()}+Z puts the scene's old text back.`) : ''
  // Written while Adam was in another scene: which scene the message is about.
  const name = away ? (titled(r.sceneId) ?? 'the scene') : null
  // The message's buttons (draftEnd.ts): where the fix is, or, for a draft that stopped short with its words in the
  // page, Continue from here beside the draft's record.
  const button = (kind: DraftEndAction): { label: string; run: () => void } =>
    kind === 'options'
      ? { label: 'Draft options', run: () => openPanel(r.sceneId, 'options') }
      : kind === 'settings'
        ? { label: 'Open Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) }
        : kind === 'continue'
          ? { label: 'Continue from here', run: () => void continueFromEnd(r.sceneId) }
          : { label: 'What the AI saw', run: () => useApp.getState().navigate({ kind: 'generation', generationId: p.generationId }) }
  // One note for the draft (features/draftNote): how it ended, and later what check and repair, the live checks and the
  // check after it found, all in the same note. A draft written here with nothing to say says nothing.
  const fixes = (): DraftEndAction[] =>
    draftEndActions({ error: p.status === 'error' ? p.error : null, cutOff: !!p.cutOff, wrote: !!stream?.wrote, here: !!stream && !away })
  const handlers = {
    options: button('options'),
    settings: button('settings'),
    continue: button('continue'),
    record: button('record'),
    scene: { label: 'Show', run: showScene(r.sceneId) }
  }
  // The writer model turned the scene down (the calm overhaul): one click tries again with another model Adam has set up.
  if (p.refused && p.status !== 'stopped') {
    const settings = useApp.getState().settings
    const other = anotherModel(settings?.models, [settings?.models.writer, r.model, ...(triedModels.get(r.sceneId) ?? [])])
    // Words that are a refusal, in a scene that had none before, are what the next draft replaces.
    const retryReplace = r.replace || (p.status === 'complete' && !r.hadText)
    const retry = other && (p.status === 'error' || retryReplace) ? other : null
    noteDraftEnd(
      r.sceneId,
      { kind: 'refused', message: p.status === 'error' ? (p.error ?? null) : REFUSAL_WORDS },
      {
        away: name,
        oldText,
        retryWith: retry ? modelName(retry) : null,
        handlers: { ...handlers, ...(retry ? { retry: { label: `Try with ${modelName(retry)}`, run: () => void retryWith(r, retry, retryReplace) } } : {}) }
      }
    )
    return
  }
  if (p.status === 'error' && p.error) {
    noteDraftEnd(r.sceneId, { kind: 'error', message: p.error }, { away: name, oldText, fixes: fixes(), handlers })
  } else if (p.cutOff) {
    noteDraftEnd(r.sceneId, { kind: 'cutOff' }, { away: name, oldText, fixes: fixes(), handlers })
  } else if (name) {
    // Polishing needs the draft in front of it, so a draft that finished in another scene isn't polished.
    noteDraftEnd(r.sceneId, { kind: 'written', stopped: p.status === 'stopped', unpolished: toPolish }, { away: name, oldText, handlers })
  } else if (toPolish && start && polishable(start.replace, replaced)) {
    const place = editor && !editor.isDestroyed ? draftPlace(editor.state.doc, start.index, start.breakAdded) : null
    // Polished, the draft's words are checked once Adam accepts the polished version (polishRun.ts).
    if (place) return void startPolish({ sceneId: r.sceneId, draftId: p.generationId, place })
  } else {
    noteDraftEnd(r.sceneId, { kind: 'written', stopped: p.status === 'stopped' }, { away: null, oldText, handlers })
  }
  // The draft's words are in the page: checked claim by claim now, slips mended in amber (features/repair). Not a draft
  // that went wrong, nor one that finished while Adam was in another scene (the check after the draft covers those).
  if (landed !== null && !away && p.status !== 'error' && !p.refused && editor && !editor.isDestroyed && r.bridge.sceneId === r.sceneId) {
    // The top bar's progress card says it is checking them, while it does.
    useDraft.setState({ checking: r.sceneId })
    void checkLanded({ sceneId: r.sceneId, recordId: p.generationId, from: landed, to: editor.state.doc.content.size }).finally(() => {
      if (useDraft.getState().checking === r.sceneId) useDraft.setState({ checking: null })
    })
  }
}

/** Said of a draft whose words are a refusal (it came back as if finished). */
const REFUSAL_WORDS = 'The writer model sent back a refusal instead of the scene'

/** The models each scene's refused drafts were tried again with, so a second refusal offers yet another. */
const triedModels = new Map<ID, ModelChoice[]>()

/**
 * "Try with …" after a refusal: the same draft again, written this once by another of Adam's models (the writer model
 * stays as he chose it). Opens the scene first if he has gone elsewhere.
 */
async function retryWith(r: Run, model: ModelChoice, replace: boolean): Promise<void> {
  triedModels.set(r.sceneId, [...(triedModels.get(r.sceneId) ?? []), model])
  if (useApp.getState().sceneId !== r.sceneId || useApp.getState().view.kind !== 'write') await openScene(r.sceneId)
  if (!(await sceneInPage(r.sceneId))) return void toast("The scene didn't open in time, so nothing was sent. Try again in a moment.")
  const bridge = editorBridge()
  if (!bridge || bridge.sceneId !== r.sceneId) return void toast("The editor wasn't ready for this scene, so nothing was sent. Try again in a moment.")
  await startDraft(r.sceneId, bridge, { replace, takeKeyboard: false, options: r.options, model: { providerId: model.providerId, modelId: model.modelId } })
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
  o: { replace: boolean; takeKeyboard: boolean; options: () => SceneDraftOptions; model?: DraftOptions['model'] }
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
    polish: false,
    replace: o.replace,
    options: o.options,
    model: o.model ?? null,
    hadText: !!bridge.editor && bridge.sceneId === sceneId && bridge.editor.state.doc.textContent.trim().length > 0,
    text: ''
  }
  run = r
  const models = useApp.getState().settings?.models
  useDraft.setState({
    live: {
      sceneId,
      startedAt: Date.now(),
      firstWordAt: null,
      words: 0,
      target: null,
      model: draftModelName(o.model),
      memoryModel: jobModelName(models, 'memory')
    },
    checking: null
  })
  // The draft's one note begins (features/draftNote).
  beginDraftNote(sceneId, null)
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
    // Directed writing: the draft options' choice for this one draft, if Adam made one (features/director).
    const options = withDirected(
      resolveDraftOptions(o.options(), cardLength(card), useApp.getState().settings?.creativity ?? 'balanced', usePolish.getState().on),
      sceneId
    )
    r.polish = !!options.polish
    const live = useDraft.getState().live
    if (live && run === r) useDraft.setState({ live: { ...live, target: options.targetWords ?? null } })
    if (r.cancelled) return giveUp()
    const { generationId, note } = await api.startDraft(sceneId, o.model ? { ...options, model: o.model } : options)
    draftNoteRecord(sceneId, generationId)
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
    // Written without where things stand (it wasn't ready in time): said once, in the draft's note, so Adam checks the
    // opening follows on.
    if (note) noteDraftStart(sceneId, note)
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
