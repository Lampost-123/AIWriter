// The AI edit being written or waiting in the page (one at a time): starts it, follows its words as they
// arrive (task events), and does what Accept, Reject, Stop and the keys ask. The suggestion itself lives in
// the editor (suggestions.ts); this keeps the task that writes it. Opening another scene while it is being
// written doesn't stop it: its words go on arriving here, and it shows again (still writing, or ready) when
// Adam is back in its scene. Owned by the AI edits part.

import type { Editor } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import type { EditorState } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { keepsLineBreaks, type EditInput } from '@shared/contracts/edits'
import type { TaskDone } from '@shared/contracts/tasks'
import type { EditTool, ID } from '@shared/types'
import { toast, useToasts } from '@/components/ui'
import { api, type ApiError, onEvent } from '@/lib/api'
import { editorBridge } from '@/lib/editorBridge'
import { shortcutText } from '@/lib/shortcuts'
import { useApp } from '@/lib/store'
import { snapshotBefore } from '@/features/history/snapshot'
import { sceneText } from '@/features/editor/streamDoc'
import { settleWords } from '@/features/editor/arrival'
import { revealEntryPart } from '@/features/palette/entryReveal'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { openScene } from '@/features/memory/openScene'
import {
  acceptSuggestion,
  activeSuggestion,
  clearSuggestion,
  markTarget,
  rejectSuggestion,
  restoreSuggestion,
  setSuggestionHandlers,
  showSuggestion,
  suggestionsOf,
  updateSuggestion,
  type GoneReason,
  type NewSuggestion,
  type Suggestion
} from './suggestions'
import { TOOL_NAMES } from './names'
import { cleanReply, continuePlace, parseAlternatives, sameWords, selectedWords, textOf, wordsIn, type Target } from './text'
import { repairLanded } from '@/features/repair/repairRun'

/** Why a suggestion went without Adam accepting or rejecting it, in plain words. */
const DROPPED: Partial<Record<GoneReason | 'scene', string>> = {
  edited: 'The words under the AI’s change were edited, so the change was dropped.',
  replaced: 'The scene’s text was replaced, so the AI’s change was dropped.',
  draft: 'A new draft started, so the AI’s change was dropped.',
  scene: 'The AI’s change was dropped because you opened another scene.'
}

/** Said when Adam is back in a scene whose words changed while its change was being written elsewhere. */
const CHANGED_AWAY = 'The scene’s words changed while you were in another scene, so the AI’s change was dropped.'

/** Said when a change is stopped (or rejected) before any of its words came. */
const NOTHING_CHANGED = 'Stopped. Nothing in the text was changed.'

/** The note on a change stopped before its end. */
const stoppedNote = (tool: EditTool): string =>
  tool === 'alternatives'
    ? 'Stopped before the end: these are the versions that came.'
    : 'Stopped before the end: these are the words that came.'

/** How long Accept waits for the snapshot of the scene before going ahead anyway. */
const SNAPSHOT_WAIT_MS = 1500
/** How long Stop waits for the task's last words before keeping what has arrived. */
const STOP_WAIT_MS = 4000

interface Live {
  taskId: ID
  sceneId: ID
  tool: EditTool
  direction: string
  /** The words sent (for telling the AI's quotation marks from the text's own). */
  selection: string
  /** Where it was, for Try again. */
  from: number
  to: number
  raw: string
  /** The setup note (Fix voice's speakers), kept to add the ending's note to. */
  note: string | null
  ended: boolean
  stopTimer: ReturnType<typeof setTimeout> | null
  /** The words must change (Fix the text): what to add when they come back the same, and what to say if they do again. */
  mustChange?: MustChange
  /** How it showed in the page, and the scene's words around it then: to show it again when Adam is back (see away). */
  shown: NewSuggestion
  before: string
  after: string
  worldId: ID | null
  generationId: ID | null
  /** Adam opened another scene while it was being written: it goes on, out of the page, until he is back in its scene. */
  away: boolean
  /** Its end, when that came while Adam was in another scene: it is done once he is back. */
  done: Pick<TaskDone, 'text' | 'status' | 'error' | 'cutOff'> | null
}

/**
 * A change that is no use unless the words change (Fix the text). A reply that is the selected words again is never
 * shown as a change: the AI is asked once more with `again` added to the direction, and if it still sends them back,
 * `giveUp` is said and nothing waits in the page.
 */
export interface MustChange {
  again: string
  giveUp: string
  /** Set on the second asking. */
  retried?: boolean
}

/** The note on a change asked for a second time, because the first answer changed nothing. */
const ASKED_AGAIN = 'The first answer changed nothing, so the AI was asked again.'

/** The task writing the suggestion in the page, until it ends and the suggestion goes. */
let live: Live | null = null
/** The suggestion the page showed last, to notice when it goes on its own (edited, a new draft...). */
let known: ID | null = null
let editor: Editor | null = null
let listening = false
let hooks: { focusPicker(): void; reveal(): void } | null = null
/** The "Change rejected" message with its Undo, while it shows: it goes once the change is back or another starts. */
let rejectedToast: number | null = null
/**
 * What to do once a change is accepted, by its id (milestone 5: the issue it fixes is marked fixed; a polished draft's
 * words are checked), told where the new words are in the page.
 */
const onAccepted = new Map<ID, (words: { from: number; to: number }) => void>()
/** History's label for the snapshot taken before a ready-made change goes in, by its id ("Before the polish pass"). */
const snapshotLabels = new Map<ID, string>()
/**
 * A change written by another part rather than an AI tool's task (Beat by beat writing an earlier beat again,
 * features/beats/redo.ts), by its id: how to stop what writes it, and what to tell it when the change goes
 * without being accepted (rejected, its words edited, another scene...).
 */
const outside = new Map<ID, { stop: () => void; gone?: (reason: GoneReason | 'scene') => void }>()

/** Tells the part writing a change from outside that it went, once. */
function tellGone(id: ID, reason: GoneReason | 'scene'): void {
  const o = outside.get(id)
  outside.delete(id)
  o?.gone?.(reason)
}

const noop = (): void => undefined

function view(): EditorView | null {
  return editor && !editor.isDestroyed ? editor.view : null
}

const current = (): Suggestion | null => {
  const v = view()
  return v ? activeSuggestion(v.state) : null
}

/** The suggestion waiting in the page, if any. */
export const waitingSuggestion = current

/** The interface's part: moving the keyboard to Alternatives' versions, and showing the suggestion. */
export function setLayerHooks(h: typeof hooks): void {
  hooks = h
}

// ---------- The editor ----------

/** The AI edits work in this editor from now on. Returns how to stop (the editor is going). */
export function attachEditor(e: Editor): () => void {
  editor = e
  setSuggestionHandlers({
    accept: (id) => void accept(id),
    reject: (id, how) => reject(id, how),
    stop: (id) => stop(id),
    restore: () => restore(),
    blocked: () => toast('Accept the AI’s change first (Tab) to edit its words, or reject it (Esc).'),
    focusPicker: () => hooks?.focusPicker()
  })
  listen()
  const onTransaction = (): void => notice()
  e.on('transaction', onTransaction)
  return () => {
    e.off('transaction', onTransaction)
    if (editor !== e) return
    // The page is going (another world, or the window closing): a change still being written stops.
    if (live && !live.ended) void api.stopTask(live.taskId).catch(noop)
    clearLive()
    for (const [id, o] of [...outside]) {
      o.stop()
      tellGone(id, 'scene')
    }
    known = null
    editor = null
    setSuggestionHandlers(null)
  }
}

/**
 * Another scene is showing in the page: a suggestion from the last one has gone with it (one still being written
 * goes on out of the page), and one written for this scene while Adam was elsewhere shows again.
 */
export function sceneShown(): void {
  // A change rejected in the last scene can't come back in this one: its message (with Undo) goes.
  dropRejectedToast()
  // The scene's name shows a moment before its text replaces the page's (with no transaction): look after.
  queueMicrotask(() => {
    notice('scene')
    backInScene()
  })
}

/** A scene's name in quotes, as the binder shows it. */
function sceneName(sceneId: ID): string {
  const scene = useOutlineStore.getState().outline?.scenes.find((s) => s.id === sceneId)
  return scene ? `“${scene.title || 'Untitled scene'}”` : 'another scene'
}

/** Stops the change kept for a scene Adam left, and forgets it. */
function letGoAway(l: Live): void {
  if (!l.ended) void api.stopTask(l.taskId).catch(noop)
  if (live === l) clearLive()
}

/**
 * Back in the scene a change was being written for while Adam was in another: it shows again in its place, with the
 * words that came meanwhile (still writing, or ready). The scene's words around it must be as they were.
 */
function backInScene(): void {
  const l = live
  if (!l?.away) return
  if (l.worldId !== (useApp.getState().world?.id ?? null)) return letGoAway(l)
  const v = view()
  const bridge = editorBridge()
  if (!v || bridge?.sceneId !== l.sceneId || bridge.editor !== editor) return
  l.away = false
  const doc = v.state.doc
  const size = doc.content.size
  const fits =
    l.to <= size && textOf(doc, 0, l.from) === l.before && textOf(doc, l.from, l.to) === l.selection && textOf(doc, l.to, size) === l.after
  if (!fits || current()) {
    letGoAway(l)
    toast(CHANGED_AWAY)
    return
  }
  v.dispatch(
    showSuggestion(v.state, { ...l.shown, status: l.generationId ? 'writing' : 'starting', generationId: l.generationId, note: l.note })
  )
  known = l.taskId
  if (l.done) finish(l.done)
  else show(false)
}

/** Its end came while Adam was in another scene: the change waits for him there (or, with no words, goes). */
function endedAway(l: Live, d: Pick<TaskDone, 'text' | 'status' | 'error' | 'cutOff'>): void {
  const words =
    l.tool === 'alternatives'
      ? parseAlternatives(l.raw, true).versions.some((x) => x.trim())
      : !!cleanReply(l.raw, true, l.tool === 'continue' ? {} : { selection: l.selection }).trim()
  const name = sceneName(l.sceneId)
  if (!words) {
    clearLive()
    if (d.status === 'error' && d.error) toast(`The AI’s change in ${name} ran into a problem. ${d.error}`, { tone: 'danger' })
    else toast(`The AI didn’t write anything for its change in ${name}, so nothing changed.`)
    return
  }
  l.done = d
  toast(`The AI’s change in ${name} is ready. Go back to that scene to accept or reject it.`, {
    action: { label: 'Show', run: () => void openScene(l.sceneId) }
  })
}

/** Notices a suggestion that went on its own, stops its task and says why. */
function notice(why: 'scene' | null = null): void {
  const v = view()
  const ps = v ? suggestionsOf(v.state) : null
  const active = ps?.active ?? null
  if (known && active?.id !== known) {
    const id = known
    known = null
    const reason: GoneReason | 'scene' = ps?.gone?.id === id ? ps.gone.reason : (why ?? 'scene')
    const l = live?.taskId === id ? live : null
    const sameWorld = l?.worldId === (useApp.getState().world?.id ?? null)
    if (l && reason === 'scene' && !l.ended && sameWorld && editorBridge()?.sceneId !== l.sceneId) {
      // Another scene opened while the AI writes the change: it goes on, and shows again when Adam is back (backInScene).
      l.away = true
    } else {
      if (l) {
        if (!l.ended) void api.stopTask(id).catch(noop)
        clearLive()
      }
      const o = outside.get(id)
      if (o && reason !== 'accepted') {
        o.stop()
        tellGone(id, reason)
      }
      const message = DROPPED[reason]
      if (message) toast(message)
    }
  }
  if (active && known !== active.id) known = active.id
}

function dropRejectedToast(): void {
  if (rejectedToast !== null) useToasts.getState().dismiss(rejectedToast)
  rejectedToast = null
}

function clearLive(): void {
  if (live?.stopTimer) clearTimeout(live.stopTimer)
  live = null
}

function patch(id: ID, p: Partial<Suggestion>): void {
  const v = view()
  if (v && activeSuggestion(v.state)?.id === id) v.dispatch(updateSuggestion(v.state, id, p))
}

/** Takes the suggestion away without keeping it (nothing came, or it couldn't start). */
function drop(id: ID): void {
  if (live?.taskId === id) clearLive()
  if (known === id) known = null
  tellGone(id, 'cleared')
  const v = view()
  if (v && activeSuggestion(v.state)?.id === id) v.dispatch(clearSuggestion(v.state, id))
}

// ---------- Its words ----------

function listen(): void {
  if (listening) return
  listening = true
  onEvent('task:progress', (p) => {
    if (!live || p.taskId !== live.taskId || live.ended) return
    live.raw = p.text
    show(false)
  })
  onEvent('task:retrying', (p) => {
    if (live && p.taskId === live.taskId) patch(p.taskId, { retrying: true })
  })
  onEvent('task:done', (d) => {
    if (live && d.taskId === live.taskId && !live.ended) finish(d)
  })
}

/** Shows the words that have arrived. */
function show(done: boolean): void {
  const l = live
  const s = current()
  if (!l || !s || s.id !== l.taskId) return
  if (l.tool === 'alternatives') {
    const { versions, complete } = parseAlternatives(l.raw, done)
    const same =
      !!s.versions && s.versions.length === versions.length && s.versions.every((x, i) => x === versions[i]) && s.versionsDone === complete
    if (same && !s.retrying) return
    patch(s.id, { versions, versionsDone: complete, text: s.chosen !== null ? (versions[s.chosen] ?? '') : '', retrying: false })
    return
  }
  const text = cleanReply(l.raw, done, l.tool === 'continue' ? {} : { selection: l.selection })
  if (text !== s.text || s.retrying) patch(s.id, { text, retrying: false })
}

/** The task has ended: what came waits for Accept or Reject; nothing at all goes, with a word about why. */
function finish(d: Pick<TaskDone, 'text' | 'status' | 'error' | 'cutOff'>): void {
  const l = live
  if (!l) return
  l.ended = true
  if (l.stopTimer) clearTimeout(l.stopTimer)
  l.stopTimer = null
  if (d.text.length >= l.raw.length) l.raw = d.text
  if (l.away) return endedAway(l, d)
  show(true)
  const s = current()
  if (!s || s.id !== l.taskId) {
    clearLive()
    return
  }
  const versions = (s.versions ?? []).filter((x) => x.trim())
  const words = l.tool === 'alternatives' ? versions.length > 0 : !!s.text.trim()
  if (words && l.mustChange && l.tool !== 'alternatives' && d.status === 'complete' && sameWords(s.text, l.selection)) {
    unchanged(l, s.id)
    return
  }
  if (!words) {
    const retry = retryAction(l)
    drop(s.id)
    if (d.status === 'error')
      toast(d.error ?? 'Something went wrong while the AI was writing. Try again.', {
        tone: 'danger',
        action: settingsAction(d.error ?? '') ?? retry
      })
    else if (d.status === 'complete')
      toast(
        l.tool === 'continue'
          ? 'The AI didn’t write anything to carry on with. Try again.'
          : 'The AI didn’t write anything for these words. Try again, or try another tool.',
        { action: retry }
      )
    else toast(NOTHING_CHANGED)
    return
  }
  const notes = [l.note]
  if (d.status === 'stopped') notes.push(stoppedNote(l.tool))
  if (d.status === 'error') notes.push(`The AI stopped part-way. ${d.error ?? ''}`.trim())
  if (d.cutOff) notes.push('The AI ran out of room before the end, so the new words may stop short.')
  const p: Partial<Suggestion> = { status: 'ready', retrying: false, note: notes.filter(Boolean).join(' ') || null }
  // A reply with one version (it didn't keep to the three) needs no picking.
  if (l.tool === 'alternatives' && s.chosen === null && versions.length === 1) Object.assign(p, { chosen: 0, text: versions[0] })
  patch(s.id, p)
}

/**
 * A change that had to change the words came back as the same words: it goes from the page unseen as a change, and
 * the AI is asked once more (told its answer was identical); after a second such answer, a plain word instead.
 */
function unchanged(l: Live, id: ID): void {
  const must = l.mustChange
  if (!must) return
  const accepted = onAccepted.get(id)
  onAccepted.delete(id)
  drop(id)
  const v = view()
  const fits =
    !!v && editorBridge()?.sceneId === l.sceneId && l.to <= v.state.doc.content.size && textOf(v.state.doc, l.from, l.to) === l.selection
  if (must.retried || !fits) {
    toast(must.giveUp)
    return
  }
  void startTool(l.tool, {
    direction: `${l.direction}\n${must.again}`,
    range: { from: l.from, to: l.to },
    ...(accepted ? { onAccepted: accepted } : {}),
    mustChange: { ...must, retried: true }
  })
}

// ---------- Starting ----------

const newTaskId = (): ID => globalThis.crypto.randomUUID()

/**
 * One change at a time, in any scene: a change still being written for a scene Adam left (or waiting there) says where
 * it is. True when there is none, or its scene has gone (deleted, or its world closed) and so has the change.
 */
async function noneAway(): Promise<boolean> {
  const l = live
  if (!l?.away) return true
  const there =
    l.worldId === (useApp.getState().world?.id ?? null) &&
    (await api.getScene(l.sceneId).then(
      () => true,
      () => false
    ))
  if (live !== l || !l.away) return !live?.away
  if (!there) {
    letGoAway(l)
    return true
  }
  const what = l.done ? 'is waiting for you to accept or reject it' : 'is still being written'
  toast(`One change at a time: the AI’s change in ${sceneName(l.sceneId)} ${what}.`, {
    action: { label: 'Show it', run: () => void openScene(l.sceneId) }
  })
  return false
}

/** The button a message about the model needs: to Settings › Models when that's where the fix is. */
function settingsAction(message: string, code?: string): { label: string; run: () => void } | undefined {
  if (code === 'no-writer-model' || code === 'no-key' || /\bSettings\b/.test(message)) {
    return { label: 'Open Settings', run: () => useApp.getState().navigate({ kind: 'settings', tab: 'models' }) }
  }
  return undefined
}

/** Try again, on the same words (if they are still as they were). */
function retryAction(l: Pick<Live, 'sceneId' | 'tool' | 'direction' | 'from' | 'to' | 'selection'>): { label: string; run: () => void } {
  return {
    label: 'Try again',
    run: () => {
      const v = view()
      if (!v || editorBridge()?.sceneId !== l.sceneId) return
      const size = v.state.doc.content.size
      const fits = l.to <= size && (l.tool === 'continue' || textOf(v.state.doc, l.from, l.to) === l.selection)
      if (!fits) {
        toast(
          l.tool === 'continue'
            ? 'The text changed there. Put the cursor where the AI should carry on, and try again.'
            : 'Those words have changed. Select them again, and try once more.'
        )
        return
      }
      void startTool(
        l.tool,
        l.tool === 'continue' ? { direction: l.direction, at: l.from } : { direction: l.direction, range: { from: l.from, to: l.to } }
      )
    }
  }
}

/**
 * The scene's words up to the cursor (or the end of the selected words), written as the scene's saved words are
 * (paragraphs between blank lines): where things stand there shows in Recall. Null when the page isn't showing it.
 */
export function wordsToCursor(sceneId: ID): string | null {
  const v = view()
  if (!v || editorBridge()?.sceneId !== sceneId) return null
  return sceneText(v.state.doc.cut(0, continueFrom(v.state)))
}

/** Where Continue carries on from: the cursor, or the end of the selected words (not the paragraph end a selection may reach). */
function continueFrom(state: EditorState): number {
  const sel = state.selection
  if (sel.empty) return sel.head
  return wordsIn(state.doc, sel.from, sel.to)?.to ?? sel.to
}

/**
 * Starts an AI tool on the selected words (or `range`), or Continue at the cursor or after the selected
 * words (or at `at`). The words stream into a tracked change in place; nothing in the scene changes until
 * Accept. Resolves true once the change is on its way (false when it didn't start; why has been shown).
 */
export async function startTool(
  tool: EditTool,
  o: { direction?: string; range?: Target; at?: number; onAccepted?: (words: { from: number; to: number }) => void; mustChange?: MustChange } = {}
): Promise<boolean> {
  if (live?.away && !(await noneAway())) return false
  const v = view()
  const bridge = editorBridge()
  const sceneId = bridge?.sceneId
  if (!v || !bridge || !sceneId || bridge.editor !== editor) return false
  if (bridge.busy()) {
    toast('A draft is being written into this scene. Wait for it to finish (or stop it), then try again.')
    return false
  }
  if (current()) {
    toast('One change at a time: accept or reject the AI’s waiting change first.', {
      action: { label: 'Show it', run: () => hooks?.reveal() }
    })
    return false
  }
  const state = v.state
  const doc = state.doc
  let from: number
  let to: number
  let mode: Suggestion['mode'] = 'replace'
  let continueAs: EditInput['continueAs']
  if (tool === 'continue') {
    const place = continuePlace(doc, o.at ?? continueFrom(state))
    if ('problem' in place) {
      toast(place.problem)
      return false
    }
    from = to = place.at
    mode = place.mode
    const $at = doc.resolve(place.at)
    // Carrying on a paragraph's words, or (after a finished one, ahead of one, or in an empty one) new paragraphs.
    continueAs = place.mode === 'inline' && $at.parent.textBetween(0, $at.parentOffset).trim() ? 'inline' : 'paragraph'
  } else {
    const r = o.range ?? selectedWords(state)
    if ('problem' in r) {
      toast(r.problem)
      return false
    }
    from = r.from
    to = r.to
  }
  const direction = (o.direction ?? '').trim()
  const input: EditInput = {
    taskId: newTaskId(),
    sceneId,
    tool,
    direction,
    selection: tool === 'continue' ? '' : textOf(doc, from, to),
    before: textOf(doc, 0, from),
    after: textOf(doc, to, doc.content.size),
    ...(continueAs ? { continueAs } : {})
  }
  const taskId = input.taskId
  if (o.onAccepted) onAccepted.set(taskId, o.onAccepted)
  const shown: NewSuggestion = { id: taskId, sceneId, tool, direction, from, to, mode, lineBreaks: keepsLineBreaks(input) }
  live = {
    taskId,
    sceneId,
    tool,
    direction,
    selection: input.selection,
    from,
    to,
    raw: '',
    note: null,
    ended: false,
    stopTimer: null,
    ...(o.mustChange ? { mustChange: o.mustChange } : {}),
    shown,
    before: input.before,
    after: input.after,
    worldId: useApp.getState().world?.id ?? null,
    generationId: null,
    away: false,
    done: null
  }
  v.dispatch(showSuggestion(v.state, shown))
  dropRejectedToast()
  known = taskId
  if (useApp.getState().view.kind === 'write') v.focus()
  try {
    const res = await api.startEdit(input)
    if (live?.taskId !== taskId) {
      // Stopped, rejected or dropped while it got ready.
      if (res.ok) void api.stopTask(taskId).catch(noop)
      return false
    }
    if (!res.ok) {
      drop(taskId)
      const { entryId, entryName } = res
      const open = entryId
        ? {
            label: `Open ${entryName ?? 'their page'}`,
            run: () => {
              useApp.getState().navigate({ kind: 'entries', entryKind: 'character', entryId })
              // Their page opens at Voice, where how they speak goes.
              revealEntryPart(entryId, 'character', { kind: 'field', key: 'speech' }, null)
            }
          }
        : undefined
      toast(res.problem, { action: open })
      return false
    }
    const setup = [res.note, o.mustChange?.retried ? ASKED_AGAIN : null].filter(Boolean).join(' ') || null
    live.note = setup
    live.generationId = res.generationId
    if (live.ended) {
      // All of it came before this answer did: it is ready already, and its note goes first.
      const note = [setup, current()?.note].filter(Boolean).join(' ') || null
      patch(taskId, { generationId: res.generationId, note })
    } else patch(taskId, { status: 'writing', generationId: res.generationId, note: setup })
    return true
  } catch (e) {
    if (live?.taskId !== taskId) return false
    const l = live
    drop(taskId)
    const err = e as ApiError
    toast(err.message, { tone: 'danger', action: settingsAction(err.message, err.code) ?? retryAction(l) })
    return false
  }
}

// ---------- Accept, Reject, Stop ----------

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Accept: the new words go into the scene (a snapshot of the scene is kept first), as one undo step. */
export async function accept(id?: ID): Promise<void> {
  const v = view()
  const s = current()
  if (!v || !s || (id && s.id !== id) || s.status !== 'ready' || !s.text.trim()) return
  v.dispatch(updateSuggestion(v.state, s.id, { status: 'accepting' }))
  const label = snapshotLabels.get(s.id) ?? `Before ${s.label ?? TOOL_NAMES[s.tool]}`
  await Promise.race([snapshotBefore(s.sceneId, label, { generationId: s.generationId }), wait(SNAPSHOT_WAIT_MS)])
  const v2 = view()
  const now = current()
  if (!v2 || !now || now.id !== s.id) return
  const tr = acceptSuggestion(v2.state, s.id)
  if (!tr) {
    patch(s.id, { status: 'ready' })
    toast('The new words couldn’t be put in. Try Accept again.')
    return
  }
  if (live?.taskId === s.id) clearLive()
  known = null
  outside.delete(s.id)
  // Where the new words are once in: from where the change starts (a paragraph's start, for new paragraphs ahead of
  // it) to where it ends, mapped through the change.
  const at = now.mode === 'before' ? v2.state.doc.resolve(now.from).before() : now.from
  const words = { from: tr.mapping.map(at, -1), to: tr.mapping.map(now.mode === 'before' ? at : now.to, 1) }
  // The New look: Continue's words settle into the page, as a finished draft's do (features/editor/arrival.ts).
  if (now.tool === 'continue') settleWords(tr, words.from, words.to)
  v2.dispatch(tr)
  // Typing straight after is a step of its own.
  v2.dispatch(closeHistory(v2.state.tr))
  if (useApp.getState().view.kind === 'write') v2.focus()
  const then = onAccepted.get(s.id)
  onAccepted.delete(s.id)
  snapshotLabels.delete(s.id)
  then?.(words)
  // Check and repair: Continue's words are checked claim by claim as they go in, slips mended in amber (features/repair).
  if (now.tool === 'continue' && now.generationId) repairLanded({ sceneId: now.sceneId, recordId: now.generationId, ...words })
}

/**
 * Shows a ready-made replacement for words in the page as a change waiting for Accept or Reject, as the AI
 * tools' changes do, with no AI call (milestone 5: a consistency check's suggested rewrite; the polish pass's
 * revision of a draft). `label` names it beside it, and `snapshot` is History's label for the snapshot taken
 * before it goes in; `generationId` is the record What the AI saw opens. Returns its id, or null when the page
 * can't take it now (a draft is being written, or another change waits; it says so).
 *
 * Written by another part as it shows (Beat by beat writing an earlier beat again): `status: 'starting'` with no
 * words yet, `working` what shows while it is written ("Writing beat 2 again"), `stop` stops what writes it (Stop,
 * Esc, Reject meanwhile), `onGone` hears when it goes without Accept; its words and status come with
 * updateReplacement, and dropReplacement takes it away.
 */
export function showReplacement(o: {
  from: number
  to: number
  text: string
  note?: string | null
  onAccepted?: (words: { from: number; to: number }) => void
  label?: string
  snapshot?: string
  generationId?: ID | null
  status?: 'starting' | 'ready'
  working?: string
  stop?: () => void
  onGone?: (reason: GoneReason | 'scene') => void
}): ID | null {
  const v = view()
  const bridge = editorBridge()
  const sceneId = bridge?.sceneId
  const writing = o.status === 'starting'
  if (!v || !bridge || !sceneId || bridge.editor !== editor || (!writing && !o.text.trim())) return null
  if (bridge.busy()) {
    toast('A draft is being written into this scene. Wait for it to finish (or stop it), then try again.')
    return null
  }
  if (current()) {
    toast('One change at a time: accept or reject the AI’s waiting change first.', {
      action: { label: 'Show it', run: () => hooks?.reveal() }
    })
    return null
  }
  const id = newTaskId()
  if (o.onAccepted) onAccepted.set(id, o.onAccepted)
  if (o.snapshot) snapshotLabels.set(id, o.snapshot)
  if (o.stop) outside.set(id, { stop: o.stop, gone: o.onGone })
  v.dispatch(
    showSuggestion(v.state, {
      id,
      sceneId,
      tool: 'rewrite',
      direction: '',
      from: o.from,
      to: o.to,
      mode: 'replace',
      text: o.text,
      status: writing ? 'starting' : 'ready',
      note: o.note ?? null,
      label: o.label ?? null,
      working: o.working ?? null,
      generationId: o.generationId ?? null
    })
  )
  dropRejectedToast()
  known = id
  if (useApp.getState().view.kind === 'write') v.focus()
  hooks?.reveal()
  return id
}

/**
 * A change shown from outside (showReplacement with `stop`), as its words arrive and it ends: false when it is no
 * longer in the page (rejected, dropped, accepted).
 */
export function updateReplacement(
  id: ID,
  p: Partial<Pick<Suggestion, 'text' | 'status' | 'note' | 'generationId' | 'retrying'>>
): boolean {
  const s = current()
  if (!s || s.id !== id) return false
  // Stopping: only the end of the words takes it out of that.
  const next = s.status === 'stopping' && p.status === 'writing' ? { ...p, status: undefined } : p
  patch(id, Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as Partial<Suggestion>)
  return true
}

/** Takes a change shown from outside away (nothing came, or it couldn't start), with nothing said. */
export function dropReplacement(id: ID): void {
  outside.delete(id)
  onAccepted.delete(id)
  snapshotLabels.delete(id)
  drop(id)
}

/** Reject: the text stays as it was. Undo (or Ctrl+Y) brings the change back. */
export function reject(id?: ID, how: 'button' | 'key' | 'undo' = 'button'): void {
  const v = view()
  const s = current()
  if (!v || !s || (id && s.id !== id) || s.status === 'accepting') return
  if (s.status === 'starting') {
    outside.get(s.id)?.stop()
    drop(s.id)
    toast(NOTHING_CHANGED)
    return
  }
  const writing = s.status === 'writing' || s.status === 'stopping'
  // Words to bring back (if it was still being written, those that had come).
  const kept = s.versions ? s.versions.some((x) => x.trim()) : !!s.text.trim()
  if (live?.taskId === s.id && !live.ended) void api.stopTask(s.id).catch(noop)
  if (writing) outside.get(s.id)?.stop()
  if (live?.taskId === s.id) clearLive()
  known = null
  tellGone(s.id, 'rejected')
  if (writing && kept) patch(s.id, { note: [s.note, stoppedNote(s.tool)].filter(Boolean).join(' ') })
  v.dispatch(rejectSuggestion(v.state, s.id))
  if (useApp.getState().view.kind === 'write' && how !== 'undo') v.focus()
  dropRejectedToast()
  if (!kept) {
    toast(NOTHING_CHANGED)
    return
  }
  const message =
    how === 'undo'
      ? `Change rejected. ${shortcutText('redo')} brings it back.`
      : writing
        ? 'Stopped, and the change was rejected.'
        : 'Change rejected.'
  rejectedToast = toast(message, { action: { label: 'Undo', run: restore } })
}

/** Brings back the change just rejected, if its words are still as they were. */
export function restore(): void {
  const v = view()
  if (!v) return
  if (current()) {
    toast('One change at a time: accept or reject the AI’s waiting change first.')
    return
  }
  const tr = restoreSuggestion(v.state)
  if (!tr) {
    toast('That change can’t come back: the words it was for have changed.')
    return
  }
  v.dispatch(tr)
  known = current()?.id ?? null
  dropRejectedToast()
  if (useApp.getState().view.kind === 'write') v.focus()
  hooks?.reveal()
}

/** Stop: the words so far stay, waiting for Accept or Reject. Before anything was sent, it simply goes. */
export function stop(id?: ID): void {
  const s = current()
  if (!s || (id && s.id !== id)) return
  if (s.status === 'starting') {
    outside.get(s.id)?.stop()
    drop(s.id)
    toast(NOTHING_CHANGED)
    return
  }
  if (s.status !== 'writing') return
  patch(s.id, { status: 'stopping' })
  // Written from outside: what writes it stops it, and says when its last words are in (updateReplacement).
  const o = outside.get(s.id)
  if (o) {
    o.stop()
    return
  }
  void api.stopTask(s.id).catch(noop)
  const l = live
  if (l?.taskId === s.id) {
    // The last words come with the task's end; if that never comes, what has arrived is kept.
    l.stopTimer = setTimeout(() => {
      if (live === l && !l.ended) finish({ text: l.raw, status: 'stopped', error: null, cutOff: false })
    }, STOP_WAIT_MS)
  }
}

/** Alternatives: shows version `i` in the page, ready to accept. Picking before the rest are written stops them. */
export function pick(i: number): void {
  const s = current()
  const text = s?.versions?.[i]
  if (!s || !text?.trim() || i >= s.versionsDone) return
  if (s.status === 'writing') stop(s.id)
  patch(s.id, { chosen: i, text })
  const v = view()
  if (v && useApp.getState().view.kind === 'write') v.focus()
}

/** Alternatives: back to the versions. */
export function unpick(): void {
  const s = current()
  if (s?.versions && s.status === 'ready') patch(s.id, { chosen: null, text: '' })
}

/** Softly marks the words an AI tool is about to work on while its menu is open (null to stop). */
export function markWords(target: Target | null): void {
  const v = view()
  if (v && !current()) v.dispatch(markTarget(v.state, target))
}

/** For What the AI saw: the record of the suggestion waiting in the page. */
export function openRecord(): void {
  const s = current()
  if (s?.generationId) useApp.getState().navigate({ kind: 'generation', generationId: s.generationId })
}
