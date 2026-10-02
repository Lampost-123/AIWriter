// Runs the manuscript editor outside React: loading scenes into the one editor
// instance, autosaving, crash-recovery files, and the bridge that streams AI
// drafts into the page. Nothing here re-renders React while Adam types.

import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, Selection, TextSelection, type Transaction } from '@tiptap/pm/state'
import { closeHistory, undo } from '@tiptap/pm/history'
import type { ID, Scene } from '@shared/types'
import { countWords } from '@shared/defaults'
import { toast } from '@/components/ui'
import { api, modKey } from '@/lib/api'
import type { EditorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { Autosaver, combineSaveStates, debounce, type AutosaveState } from './autosave'
import { FollowScroll } from './followScroll'
import { itemsForWorld, shouldRestore } from './recovery'
import * as streamDoc from './streamDoc'
import { newSplitState, splitChunk, type SplitState } from './streamText'
import { requestEditorFocus, takeFocusRequest } from './focusRequest'
import { withParagraphIds } from './paragraphIds'
import { findTextRange, type FindOptions } from './findText'
import { REVEALED } from './reveal'
import { requestPutBack } from './putBack'

/** Where Adam was in each scene this session, so coming back restores the view. */
const memory = new Map<ID, { scrollTop: number; anchor: number; head: number }>()

/**
 * The check for leftover recovery files in the open world. Every scene load waits
 * for it, so no scene is ever read before writing from last time is put back into it.
 */
let recovery: { worldId: ID; done: Promise<void> } | null = null

const app = useApp.getState

/** The scene was deleted (Undo brings it back as it was last saved), so saving into it again can't work. */
const sceneGone = (e: unknown): boolean => (e as Error | undefined)?.message === 'That scene no longer exists.'

/** One scene's unsaved state. Outlives the switch to another scene until its last save lands. */
class SceneSession {
  readonly saver: Autosaver
  private readonly recovery: ReturnType<typeof debounce>
  /** The document while the scene isn't on screen any more. */
  private snapshot: PMNode | null = null
  private disposed = false
  private closing = false
  /** This scene's own save state; the top bar shows all sessions combined. */
  state: AutosaveState | null = null

  constructor(
    readonly id: ID,
    readonly worldId: ID,
    private wordCount: number,
    private readonly currentDoc: () => PMNode,
    /** Called when this session's save state changes. */
    private readonly onState: () => void,
    /** Called once a closed session has nothing left to save. */
    private readonly onGone: (s: SceneSession) => void
  ) {
    this.saver = new Autosaver({
      save: () => this.save(),
      onState: (state) => {
        // A save that failed: make sure the recovery file has the latest text right away.
        if (state === 'error') this.recovery.flush()
        this.state = state
        this.onState()
      },
      onSaved: (clean) => {
        if (!clean) return
        // The file only matters until the text is safely in the database.
        this.recovery.cancel()
        void api.clearRecovery(this.id).catch(() => undefined)
        if (this.closing) this.finish()
      },
      // A scene left behind that was deleted meanwhile: nothing more can be saved into it, so it stops
      // trying, and the top bar goes back to saying how the open scene is doing.
      isGone: (e) => this.closing && sceneGone(e),
      onGone: () => {
        this.state = null
        void api.clearRecovery(this.id).catch(() => undefined)
        this.finish()
      }
    })
    // The recovery file is at most half a second behind while Adam types, so a crash loses almost nothing.
    this.recovery = debounce(() => this.writeRecovery(), 150, 500)
  }

  get doc(): PMNode {
    return this.snapshot ?? this.currentDoc()
  }

  changed(): void {
    if (this.disposed) return
    this.saver.changed()
    this.recovery.call()
  }

  /** The scene is leaving the screen: keep its last document for any pending save. */
  leave(doc: PMNode): void {
    this.snapshot = doc
  }

  /** Saves what's pending, then lets go (a failed save keeps retrying until it lands, unless the scene was deleted). */
  async close(): Promise<void> {
    this.closing = true
    this.recovery.flush()
    await this.saver.flush()
    // Already let go of (its world was closed): nothing more will be saved from here.
    if (this.disposed || !this.saver.dirty) this.finish()
  }

  /** Lets go of the session. Safe to call more than once. */
  private finish(): void {
    this.dispose()
    this.onGone(this)
  }

  dispose(): void {
    this.disposed = true
    this.saver.dispose()
    this.recovery.cancel()
  }

  private stillInOpenWorld(): boolean {
    return app().world?.id === this.worldId
  }

  private async save(): Promise<void> {
    // After a world switch the old world is closed; its last save ran before switching.
    // If that save failed, the recovery file keeps the text until the world is opened again.
    if (!this.stillInOpenWorld()) {
      this.recovery.flush()
      this.finish()
      return
    }
    const doc = this.doc
    const text = streamDoc.sceneText(doc)
    const res = await api.saveSceneText(this.id, doc.toJSON(), text)
    const meta = useOutlineStore.getState().outline?.scenes.find((s) => s.id === this.id)
    // Saving moves a planned scene to drafted once it has words, and back when emptied.
    const statusChanged = !!meta && meta.status !== res.status
    if (res.wordCount !== this.wordCount || statusChanged) {
      this.wordCount = res.wordCount
      app().bumpOutline()
    }
  }

  private writeRecovery(): void {
    if (this.disposed) return
    const doc = this.doc
    void api
      .writeRecovery({ worldId: this.worldId, sceneId: this.id, doc: doc.toJSON(), text: streamDoc.sceneText(doc), savedAt: new Date().toISOString() })
      .catch(() => undefined)
  }
}

export interface ControllerEvents {
  /** A scene is about to be shown (render its header in the same frame). */
  onShow(scene: Scene): void
  /** Loading failed (or null to clear an earlier failure). */
  onError(message: string | null): void
  /** A draft is being written below what's on screen (true), or it's in view or finished (false). */
  onDraftBelow?(below: boolean): void
}

/** How long a scene switch waits for a stopped draft's last words before moving on. */
const LAST_WORDS_WAIT_MS = 2000

export class SceneController {
  private session: SceneSession | null = null
  private leaving = new Set<SceneSession>()
  private loadTicket = 0
  private requested: ID | null = null
  private stream: { generationId: ID; split: SplitState; quiet?: boolean } | null = null
  /** The draft being written starts below the visible page. */
  private draftBelow = false
  /** The draft being stopped because Adam opened another scene (no "added below" message for it). */
  private stopping: ID | null = null
  /**
   * Adam picked where a draft goes, so the keyboard belongs in the page; a draft replacing the
   * scene's text gets it once that draft ends (see takeKeyboard).
   */
  private keyboardWanted = false
  /** The draft that ended last, and whether it took the place of the scene's text (for messages about it that come later). */
  private lastEnded: { generationId: ID; replaced: boolean } | null = null
  /** The top bar's word count: after a pause, and every couple of seconds while a draft streams in. */
  private readonly words = debounce(
    () => {
      if (this.session && !this.destroyed) app().setSceneWords(countWords(streamDoc.sceneText(this.editor.state.doc)))
    },
    300,
    2000
  )
  private destroyed = false
  private idleWaiters: (() => void)[] = []
  readonly follow: FollowScroll
  readonly bridge: EditorBridge

  constructor(
    private readonly editor: Editor,
    private readonly scroller: () => HTMLElement | null,
    private readonly events: ControllerEvents
  ) {
    this.follow = new FollowScroll(scroller)
    editor.on('update', this.onUpdate)
    editor.on('transaction', this.onTransaction)

    const sceneIdOf = (): ID | null => this.session?.id ?? null
    const editorOf = (): Editor | null => (this.destroyed ? null : this.editor)
    this.bridge = {
      get sceneId() {
        return sceneIdOf()
      },
      holdForReplace: (sceneId) => this.holdForReplace(sceneId),
      releaseHold: () => this.releaseHold(),
      beginStream: (sceneId, generationId, opts) => this.beginStream(sceneId, generationId, opts),
      appendStream: (generationId, text) => this.appendStream(generationId, text),
      endStream: (generationId, opts) => this.endStream(generationId, opts),
      takeKeyboard: () => this.takeKeyboard(),
      undo: () => this.undoFromOutside(),
      flush: () => this.flush(),
      getText: () => streamDoc.sceneText(this.editor.state.doc),
      hasText: () => this.editor.state.doc.textContent.trim() !== '',
      stopDraft: (reason) => this.stopStreamForSwitch(reason),
      get editor() {
        return editorOf()
      },
      busy: () => this.busy(),
      current: () => this.current(),
      replaceScene: (sceneId, doc, text, opts) => this.replaceScene(sceneId, doc, text, opts)
    }
  }

  get sceneId(): ID | null {
    return this.session?.id ?? null
  }

  // ---------- Loading ----------

  /** Shows a scene. The previous scene stays on screen until the next one is ready. */
  async open(id: ID): Promise<void> {
    if (this.destroyed) return
    if (this.session?.id === id) {
      // Back to the scene already on screen: cancel any other load and keep it as it is
      // (clearing a failed load of another scene, so the page shows again).
      this.loadTicket++
      this.requested = id
      this.events.onError(null)
      if (takeFocusRequest(id)) this.focus()
      return
    }
    if (this.requested === id) return
    this.requested = id
    const ticket = ++this.loadTicket
    try {
      // A draft still being written into the scene on screen stops; its last words land first.
      await this.stopStreamForSwitch('scene')
      if (ticket !== this.loadTicket || this.destroyed) return
      const worldId = app().world?.id
      if (!worldId) return
      // Save the scene being left first, so reopening a scene never reads text older than what was on screen.
      await this.flush()
      if (recovery?.worldId !== worldId) recovery = { worldId, done: recoverUnsaved(worldId).catch(() => undefined) }
      await recovery.done
      if (ticket !== this.loadTicket || this.destroyed) return
      const scene = await api.getScene(id)
      if (ticket !== this.loadTicket || this.destroyed) return
      this.show(scene, worldId)
    } catch (e) {
      if (ticket !== this.loadTicket || this.destroyed) return
      this.requested = null
      this.events.onError((e as Error).message)
      // The binder may be showing a scene that's gone; bring it up to date.
      app().bumpOutline()
    }
  }

  /** Tries the last requested scene again after a failure. */
  retry(id: ID): void {
    this.requested = null
    void this.open(id)
  }

  /** Remembers where Adam is in the open scene (scroll and caret), so coming back puts him there. */
  remember(): void {
    const s = this.session
    if (!s || this.destroyed) return
    const { anchor, head } = this.editor.state.selection
    memory.set(s.id, { scrollTop: this.scroller()?.scrollTop ?? 0, anchor, head })
  }

  private show(scene: Scene, worldId: ID): void {
    const view = this.editor.view
    const el = this.scroller()
    const prev = this.session
    if (prev) {
      this.remember()
      prev.leave(this.editor.state.doc)
      this.leaving.add(prev)
      void prev.close()
    }

    // Coming back to a scene whose last save hasn't landed yet (saving is failing): the text on
    // screen when Adam left is newer than the stored copy, so carry it over and let one session own it.
    const unsaved = [...this.leaving].find((s) => s.id === scene.id && s.saver.dirty)
    if (unsaved) {
      unsaved.dispose()
      this.dropLeaving(unsaved)
    }
    // Every paragraph has a stable id; a scene from before ids existed gets them now, and (if it has
    // words) they are saved.
    const { doc, filled } = withParagraphIds(unsaved?.doc ?? streamDoc.docFromStored(this.editor.schema, scene.doc, scene.text))
    const mem = memory.get(scene.id)
    let selection: Selection = Selection.atStart(doc)
    if (mem) {
      const clamp = (n: number): number => Math.max(0, Math.min(n, doc.content.size))
      try {
        selection = TextSelection.between(doc.resolve(clamp(mem.anchor)), doc.resolve(clamp(mem.head)))
      } catch {
        // Keep the start of the scene.
      }
    }
    const state = EditorState.create({ doc, selection, plugins: this.editor.state.plugins })
    // A wish for the keyboard was about the scene being left.
    this.keyboardWanted = false

    this.session = new SceneSession(
      scene.id,
      worldId,
      scene.wordCount,
      () => this.editor.state.doc,
      () => this.reportSaveState(),
      (gone) => this.dropLeaving(gone)
    )
    this.words.cancel()
    app().setSceneWords(scene.wordCount)

    // Header and page change in the same frame, and the scroll position comes back before paint.
    this.events.onShow(scene)
    this.events.onError(null)
    view.updateState(state)
    this.follow.stop()
    if (el) el.scrollTop = mem?.scrollTop ?? 0
    if (unsaved) {
      this.session.changed()
      app().setSceneWords(countWords(streamDoc.sceneText(doc)))
    } else if (filled && doc.textContent.trim()) {
      // Only a scene with words in it: an empty one gets its ids saved with the first thing typed,
      // so merely opening it never writes over the stored copy.
      this.session.changed()
    }
    // The caret goes into the page when asked (opening a scene from the binder), and whenever
    // nothing else has focus (launch, a new world), so typing straight away is never lost.
    const idle = !document.activeElement || document.activeElement === document.body
    if (takeFocusRequest(scene.id) || idle) this.focus()
  }

  focus(): void {
    if (this.destroyed) return
    this.editor.view.focus()
  }

  /**
   * Selects the first place these words appear and brings it into view, a third of the way down
   * the page (from "What changed"). Returns false when the words aren't in the scene any more.
   */
  revealWords(quote: string, opts: FindOptions = {}): boolean {
    if (this.destroyed) return false
    const view = this.editor.view
    const range = findTextRange(view.state.doc, quote, opts)
    if (!range) return false
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, range.from, range.to)).setMeta(REVEALED, true))
    view.focus()
    const el = this.scroller()
    if (el) {
      const top = view.coordsAtPos(range.from).top - el.getBoundingClientRect().top
      el.scrollTop = Math.max(0, el.scrollTop + top - el.clientHeight / 3)
    }
    return true
  }

  // ---------- Editing and saving ----------

  private onUpdate = (): void => {
    const s = this.session
    if (!s) return
    s.changed()
    this.words.call()
  }

  /** Ctrl+Z in the page while a draft replaces its text, past Adam's own edits since: the draft goes back out. */
  private onTransaction = ({ transaction }: { transaction: Transaction }): void => {
    // After this transaction has finished being applied.
    if (streamDoc.undoAsked(transaction)) queueMicrotask(() => this.undoReplace())
  }

  /** Saves everything pending now (Ctrl+S, closing the window, switching worlds). Works after destroy too. */
  async flush(): Promise<void> {
    await Promise.allSettled([this.session?.saver.flush(), ...[...this.leaving].map((s) => s.saver.flush())])
  }

  /** The top bar shows one state for the open scene and any scene still finishing its save. */
  private reportSaveState(): void {
    const state = combineSaveStates([this.session?.state, ...[...this.leaving].map((s) => s.state)])
    if (state) app().setSaveState(state)
    // The scene that was failing or saving has gone (saved, or its world was closed): don't leave that showing.
    else if (app().saveState !== 'saved') app().setSaveState('idle')
  }

  private dropLeaving(s: SceneSession): void {
    if (!this.leaving.delete(s)) return
    this.reportSaveState()
    if (this.leaving.size === 0 && !this.session) {
      const waiters = this.idleWaiters
      this.idleWaiters = []
      waiters.forEach((fn) => fn())
    }
  }

  /** Runs `fn` once nothing is left to save (straight away if that's already so). Used after destroy. */
  whenIdle(fn: () => void): void {
    if (this.leaving.size === 0 && !this.session) fn()
    else this.idleWaiters.push(fn)
  }

  // ---------- Streaming drafts ----------

  /**
   * Holds the scene's text while a draft that will replace it gets ready (see streamDoc.holding):
   * nothing typed or pasted in the meantime can land in text that is about to go.
   */
  private holdForReplace(sceneId: ID): boolean {
    if (this.destroyed || this.stream || !this.session || this.session.id !== sceneId || this.requested !== sceneId) return false
    this.editor.view.dispatch(streamDoc.startStream(this.editor.state, '', { replace: true }))
    return true
  }

  /** Lets go of the held text: the draft that was to replace it didn't start. */
  private releaseHold(): void {
    if (this.destroyed || this.stream) return
    const tr = streamDoc.releaseHold(this.editor.state)
    if (tr) this.editor.view.dispatch(tr)
    this.keyboardBack()
  }

  private beginStream(sceneId: ID, generationId: ID, opts: { replace?: boolean; noBreak?: boolean; quiet?: boolean } = {}): boolean {
    if (this.destroyed || !this.session || this.session.id !== sceneId || this.requested !== sceneId) return false
    if (this.stream) this.finishStream()
    this.editor.view.dispatch(streamDoc.startStream(this.editor.state, generationId, { replace: !!opts.replace, noBreak: !!opts.noBreak }))
    this.stream = { generationId, split: newSplitState(), quiet: !!opts.quiet }
    this.updateDraftBelow()
    return true
  }

  private appendStream(generationId: ID, text: string): void {
    if (!this.stream || this.stream.generationId !== generationId || this.destroyed) return
    const { ops, state } = splitChunk(this.stream.split, text)
    this.stream.split = state
    const before = this.editor.state
    const tr = streamDoc.appendStream(before, ops)
    if (!tr) return
    if (streamDoc.replacedIn(tr)) {
      // The text being replaced goes with the draft's record first, so it is kept even if the app closes now.
      this.keepReplaced(generationId, before.doc)
      // The draft's first words took the place of the text Adam was reading: show the top of the
      // scene, where the draft is being written. From here the page follows it as usual.
      this.follow.stop()
      this.editor.view.dispatch(tr)
      const el = this.scroller()
      if (el) el.scrollTop = 0
      this.follow.check()
    } else {
      this.follow.check()
      this.editor.view.dispatch(tr)
    }
    this.follow.nudge()
    this.updateDraftBelow()
  }

  /** Keeps the text a draft replaced with the draft's record; null forgets it (the old text is back after all). */
  private keepReplaced(generationId: ID, old: PMNode | null): void {
    api.keepReplacedText(generationId, old ? { doc: old.toJSON(), text: streamDoc.sceneText(old) } : null).catch(() => {
      if (!old) return
      const meanwhile = `${modKey()}+Z puts it back while this scene stays open.`
      toast(`A copy of the scene's old text couldn't be kept with the new draft. ${meanwhile}`, { tone: 'danger' })
    })
  }

  /**
   * The draft has ended. `failed`: it ended with a problem, and Generate's own message about it says
   * how to get the old text back, so there's no message here. Returns whether the draft took the
   * place of the scene's text.
   */
  private endStream(generationId: ID, opts: { failed?: boolean } = {}): { replaced: boolean } {
    if (!this.stream || this.stream.generationId !== generationId) {
      return { replaced: this.lastEnded?.generationId === generationId && this.lastEnded.replaced }
    }
    return this.finishStream({ announce: this.stopping !== generationId, failed: !!opts.failed })
  }

  /**
   * Ends the stream: tidies a final scene break and makes the whole draft one undo step. With
   * `announce`, says where a draft that finished out of sight went, or that it replaced the
   * scene's text (with an Undo).
   */
  private finishStream({ announce = false, failed = false }: { announce?: boolean; failed?: boolean } = {}): { replaced: boolean } {
    const generationId = this.stream?.generationId ?? null
    const quiet = !!this.stream?.quiet
    this.stream = null
    if (this.destroyed) return { replaced: false }
    const view = this.editor.view
    const info = streamDoc.activeStream(view.state)
    const below = info?.wrote && !info.replace ? this.isBelowView(info.from) : false
    const tidy = streamDoc.finishStreamText(view.state)
    if (tidy) view.dispatch(tidy)
    // The draft took the place of words that were there (not just of an empty page).
    const old = streamDoc.activeStream(view.state)?.before?.doc ?? null
    const replaced = !!old && old.textContent.trim() !== '' && !old.eq(view.state.doc)
    // All that came was a lead-in that was left out, so the old text is back: there's nothing to keep.
    if (generationId && old && !replaced) this.keepReplaced(generationId, null)
    view.updateState(streamDoc.commitStream(view.state))
    this.follow.settle()
    this.setDraftBelow(false)
    if (generationId) this.lastEnded = { generationId, replaced }
    this.keyboardBack()
    if (!announce || !info || quiet) return { replaced }
    if (replaced && old) {
      if (failed) return { replaced }
      const sceneId = this.session?.id
      const worldId = app().world?.id
      const draft = view.state.doc
      toast("The new draft replaced the scene's text. The old text is kept in the Drafts tab.", {
        action: { label: 'Undo', run: () => sceneId && worldId && this.putOldTextBack(sceneId, worldId, draft, old) }
      })
    } else if (below) {
      // Finished out of sight: say where it went, and how to take it back.
      const from = info.from
      toast(`The new draft was added at the end of the scene. ${modKey()}+Z takes it out again.`, {
        action: { label: 'Show', run: () => this.reveal(from) }
      })
    }
    return { replaced }
  }

  /**
   * Leaving the scene mid-draft (or deleting it) stops the draft; the text so far stays. Waits
   * (briefly) for the last words that were already on their way, so the scene keeps everything
   * the draft's record has.
   */
  private async stopStreamForSwitch(reason: 'scene' | 'world' | 'deleted'): Promise<void> {
    if (!this.stream) return
    const id = this.stream.generationId
    this.stopping = id
    // The keyboard goes wherever Adam is going.
    this.keyboardWanted = false
    let replaced = false
    try {
      const stopped = api.stopGeneration(id).catch(() => undefined)
      await Promise.race([stopped, new Promise((r) => setTimeout(r, LAST_WORDS_WAIT_MS))])
      // Usually the draft's own "done" has ended the stream by now.
      if (this.stream?.generationId === id) replaced = this.finishStream().replaced
      else replaced = this.lastEnded?.generationId === id && this.lastEnded.replaced
    } finally {
      this.stopping = null
    }
    if (reason === 'deleted') {
      toast(
        replaced
          ? 'Drafting stopped because the scene was deleted. Undo brings it back with the text so far, and the text it replaced can be put back from its Drafts tab.'
          : 'Drafting stopped because the scene was deleted. Undo brings it back with the text so far.'
      )
      return
    }
    const where = reason === 'scene' ? 'opened another scene' : 'switched worlds'
    toast(
      replaced
        ? `Drafting stopped because you ${where}. The text so far is kept, and the text it replaced can be put back from that scene's Drafts tab.`
        : `Drafting stopped because you ${where}. The text so far is kept.`
    )
  }

  // ---------- The keyboard, and undoing a replace ----------

  /**
   * Adam picked where a draft goes: the keyboard belongs in the page, so Ctrl+Z works as the choice
   * says. A draft replacing the scene's text gets it once it ends (typing as its first words arrive
   * would join them).
   */
  private takeKeyboard(): void {
    if (this.destroyed || !this.session) return
    if (streamDoc.activeStream(this.editor.state)?.replace) this.keyboardWanted = true
    else this.focusIfFree()
  }

  /** A wish for the keyboard that had to wait (see takeKeyboard) is met now, if the keyboard is free. */
  private keyboardBack(): void {
    if (!this.keyboardWanted) return
    this.keyboardWanted = false
    this.focusIfFree()
  }

  /** Puts the keyboard in the page, unless Adam is using it somewhere else (a box, the binder, a menu). */
  private focusIfFree(): void {
    if (this.destroyed || !this.session || !this.editor.isEditable || app().view.kind !== 'write') return
    const here = document.activeElement
    const free = !here || here === document.body || here === this.editor.view.dom || !!here.closest('[data-generate-controls]')
    if (free) this.editor.view.focus()
  }

  /**
   * Ctrl+Z pressed outside the page while it shows (on the Generate button, after picking an answer
   * with the mouse, say): undoes in the page as if it had the keyboard. False when there was nothing to undo.
   */
  private undoFromOutside(): boolean {
    if (this.destroyed || !this.session || app().view.kind !== 'write') return false
    const view = this.editor.view
    const verdict = streamDoc.undoVerdict(view.state, 'undo')
    if (verdict === 'blocked') return true
    if (verdict === 'undo-replace') {
      this.undoReplace()
      return true
    }
    if (!undo(view.state, view.dispatch)) return false
    this.focusIfFree()
    return true
  }

  /**
   * Ctrl+Z, past Adam's own edits, while a draft is replacing the scene's text: the draft stops and the
   * old text comes back exactly (Ctrl+Shift+Z brings the draft so far back; its record keeps it too).
   */
  private undoReplace(): void {
    const s = this.stream
    if (!s || this.destroyed || streamDoc.undoVerdict(this.editor.state, 'undo') !== 'undo-replace') return
    void api.stopGeneration(s.generationId).catch(() => undefined)
    this.finishStream()
    const view = this.editor.view
    if (!undo(view.state, view.dispatch)) return
    this.lastEnded = { generationId: s.generationId, replaced: false }
    this.focusIfFree()
    toast("Drafting stopped, and the scene's text is back as it was.")
  }

  /** The replace message's Undo: the old text back in place of the draft, whether or not this scene is still open. */
  private putOldTextBack(sceneId: ID, worldId: ID, draft: PMNode, old: PMNode): void {
    if (this.destroyed || app().world?.id !== worldId) return
    if (this.session?.id !== sceneId) {
      requestPutBack({ sceneId, doc: old.toJSON(), text: streamDoc.sceneText(old) })
      app().selectScene(sceneId)
      return
    }
    const view = this.editor.view
    // Nothing has changed since the draft ended: its own undo step puts the old text back exactly.
    let step = null as Transaction | null
    if (!this.stream && view.state.doc.eq(draft)) undo(view.state, (tr) => (step = tr))
    if (step && view.state.apply(step).doc.eq(old)) view.dispatch(step)
    else this.putBack(sceneId, old.toJSON(), streamDoc.sceneText(old))
    if (this.stream) return
    // Asked for from the message, whose button goes with it: the keyboard goes back into the page
    // (once it shows, if another page covers it).
    if (app().view.kind === 'write') this.focus()
    else {
      requestEditorFocus(sceneId)
      app().navigate({ kind: 'write' })
    }
  }

  /**
   * Puts a scene's earlier text (from a draft's record) back in place of what's on the page, as one
   * step Ctrl+Z takes back, and says so (or why it couldn't).
   */
  putBack(sceneId: ID, doc: unknown, text: string): void {
    if (this.destroyed || this.session?.id !== sceneId) return
    const view = this.editor.view
    if (this.stream || streamDoc.holding(view.state)) {
      toast('A new draft is being written into this scene. Stop it first, then put the old text back.')
      return
    }
    const old = withParagraphIds(streamDoc.docFromStored(this.editor.schema, doc, text)).doc
    if (old.eq(view.state.doc)) {
      toast('The scene already has this text.')
      return
    }
    const tr = closeHistory(view.state.tr.replaceWith(0, view.state.doc.content.size, old.content))
    tr.setSelection(Selection.atStart(tr.doc))
    view.dispatch(tr)
    // Typing straight after is a step of its own.
    view.dispatch(closeHistory(view.state.tr))
    this.follow.stop()
    const el = this.scroller()
    if (el) el.scrollTop = 0
    this.focusIfFree()
    toast(`The text this draft replaced is back in the scene. ${modKey()}+Z takes it out again.`)
  }

  // ---------- Milestone 4: the page as a whole ----------

  /** A draft is being written into the page, or the page is held for one. */
  private busy(): boolean {
    return !this.destroyed && (!!this.stream || streamDoc.holding(this.editor.state))
  }

  /** The page as it shows now, as it would be saved. */
  private current(): { sceneId: ID; doc: unknown; text: string } | null {
    if (this.destroyed || !this.session) return null
    const doc = this.editor.state.doc
    return { sceneId: this.session.id, doc: doc.toJSON(), text: streamDoc.sceneText(doc) }
  }

  /** Other text in place of the whole scene, as one step Ctrl+Z takes back. */
  private replaceScene(sceneId: ID, doc: unknown, text: string, opts: { message?: string } = {}): boolean {
    if (this.destroyed || this.session?.id !== sceneId || this.busy()) return false
    const view = this.editor.view
    const next = withParagraphIds(streamDoc.docFromStored(this.editor.schema, doc, text)).doc
    if (!next.eq(view.state.doc)) {
      const tr = closeHistory(view.state.tr.replaceWith(0, view.state.doc.content.size, next.content))
      tr.setSelection(Selection.atStart(tr.doc))
      view.dispatch(tr)
      // Typing straight after is a step of its own.
      view.dispatch(closeHistory(view.state.tr))
      this.follow.stop()
      const el = this.scroller()
      if (el) el.scrollTop = 0
    }
    if (opts.message) toast(opts.message)
    return true
  }

  // ---------- Where the draft is being written ----------

  /** True when a document position is below the visible part of the page. */
  private isBelowView(pos: number): boolean {
    const el = this.scroller()
    if (!el || this.destroyed) return false
    try {
      const top = this.editor.view.coordsAtPos(Math.min(pos + 1, this.editor.state.doc.content.size)).top
      return top > el.getBoundingClientRect().bottom - 24
    } catch {
      return false
    }
  }

  private setDraftBelow(below: boolean): void {
    if (below === this.draftBelow) return
    this.draftBelow = below
    this.events.onDraftBelow?.(below)
  }

  /** Shows the "new draft below" pointer while the draft's start is out of sight below. */
  updateDraftBelow(): void {
    const info = this.stream && !this.stream.quiet ? streamDoc.activeStream(this.editor.state) : null
    this.setDraftBelow(!!info && this.isBelowView(info.from))
  }

  /** Scrolls to where the draft being written begins (or the one just written). */
  revealDraft(): void {
    const info = streamDoc.activeStream(this.editor.state)
    if (info) this.reveal(info.from)
  }

  private reveal(from: number): void {
    const el = this.scroller()
    if (!el || this.destroyed) return
    if (useApp.getState().view.kind !== 'write') useApp.getState().navigate({ kind: 'write' })
    try {
      const pos = Math.min(from + 1, this.editor.state.doc.content.size)
      const top = this.editor.view.coordsAtPos(pos).top - el.getBoundingClientRect().top + el.scrollTop
      // The draft's start a quarter of the way down; at the end of the page, following the draft as it grows.
      el.scrollTop = Math.min(top - el.clientHeight * 0.25, el.scrollHeight - el.clientHeight)
      this.follow.check()
    } catch {
      // The position is gone (edited away): nothing to show.
    }
    this.updateDraftBelow()
  }

  // ---------- Teardown ----------

  /** Saves what's pending and lets go of the editor. */
  destroy(): void {
    if (this.destroyed) return
    if (this.stream) {
      // The window or world is closing: stop the draft (its record keeps every word).
      const id = this.stream.generationId
      this.finishStream()
      void api.stopGeneration(id).catch(() => undefined)
    }
    this.destroyed = true
    this.editor.off('update', this.onUpdate)
    this.editor.off('transaction', this.onTransaction)
    this.words.cancel()
    this.follow.stop()
    const s = this.session
    this.session = null
    if (s) {
      // Its last save may still be on the way (or retrying); keep it with the others until it lands.
      s.leave(this.editor.state.doc)
      this.leaving.add(s)
      void s.close()
    }
  }

  /**
   * Lets go of the editor without saving anything: a backup was just restored, so whatever
   * the sessions hold is from before it and must not be written over the restored world
   * (now, or later from a recovery file). The view reloads the restored text afterwards.
   */
  discard(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.editor.off('update', this.onUpdate)
    this.editor.off('transaction', this.onTransaction)
    this.words.cancel()
    this.follow.stop()
    if (this.stream) {
      const id = this.stream.generationId
      this.stream = null
      void api.stopGeneration(id).catch(() => undefined)
    }
    const sessions = [...this.leaving, ...(this.session ? [this.session] : [])]
    this.session = null
    this.leaving.clear()
    for (const s of sessions) {
      s.dispose()
      void api.clearRecovery(s.id).catch(() => undefined)
    }
    this.reportSaveState()
    const waiters = this.idleWaiters
    this.idleWaiters = []
    waiters.forEach((fn) => fn())
  }
}

/** Puts back writing that was typed but not saved before the app last closed unexpectedly. */
async function recoverUnsaved(worldId: ID): Promise<void> {
  let items
  try {
    items = itemsForWorld(await api.listRecovery(), worldId)
  } catch {
    return
  }
  let restored = false
  for (const item of items) {
    try {
      const scene = await api.getScene(item.sceneId)
      if (shouldRestore(item, scene)) {
        await api.saveSceneText(item.sceneId, item.doc, item.text)
        restored = true
        toast(`Recovered unsaved writing from last time in “${scene.title}”.`, { tone: 'success' })
      }
    } catch {
      // The scene is gone (deleted), so there's nothing to put it back into.
    }
    await api.clearRecovery(item.sceneId).catch(() => undefined)
  }
  if (restored) app().bumpOutline()
}
