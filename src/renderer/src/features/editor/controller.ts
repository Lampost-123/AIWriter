// Runs the manuscript editor outside React: loading scenes into the one editor
// instance, autosaving, crash-recovery files, and the bridge that streams AI
// drafts into the page. Nothing here re-renders React while Adam types.

import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { EditorState, Selection, TextSelection } from '@tiptap/pm/state'
import type { ID, Scene } from '@shared/types'
import { countWords } from '@shared/defaults'
import { toast } from '@/components/ui'
import { api } from '@/lib/api'
import type { EditorBridge } from '@/lib/editorBridge'
import { useApp } from '@/lib/store'
import { useOutlineStore } from '@/features/binder/outlineStore'
import { Autosaver, debounce } from './autosave'
import { FollowScroll } from './followScroll'
import { itemsForWorld, shouldRestore } from './recovery'
import * as streamDoc from './streamDoc'
import { newSplitState, splitChunk, type SplitState } from './streamText'
import { takeFocusRequest } from './focusRequest'

/** Where Adam was in each scene this session, so coming back restores the view. */
const memory = new Map<ID, { scrollTop: number; anchor: number; head: number }>()

/** Worlds whose leftover recovery files have been checked since they were opened. */
let checkedWorld: ID | null = null

const app = useApp.getState

/** One scene's unsaved state. Outlives the switch to another scene until its last save lands. */
class SceneSession {
  readonly saver: Autosaver
  private readonly recovery: ReturnType<typeof debounce>
  /** The document while the scene isn't on screen any more. */
  private snapshot: PMNode | null = null
  private disposed = false
  private closing = false

  constructor(
    readonly id: ID,
    readonly worldId: ID,
    private wordCount: number,
    private readonly currentDoc: () => PMNode,
    /** Called once a closed session has nothing left to save. */
    private readonly onGone: (s: SceneSession) => void
  ) {
    this.saver = new Autosaver({
      save: () => this.save(),
      onState: (s) => app().setSaveState(s),
      onSaved: (clean) => {
        if (!clean) return
        // The file only matters until the text is safely in the database.
        this.recovery.cancel()
        void api.clearRecovery(this.id).catch(() => undefined)
        if (this.closing) this.finish()
      }
    })
    this.recovery = debounce(() => this.writeRecovery(), 250, 2000)
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

  /** Saves what's pending, then lets go (a failed save keeps retrying until it lands). */
  async close(): Promise<void> {
    this.closing = true
    this.recovery.flush()
    await this.saver.flush()
    if (!this.saver.dirty) this.finish()
  }

  private finish(): void {
    if (this.disposed) return
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
    if (!this.stillInOpenWorld()) {
      this.finish()
      return
    }
    const doc = this.doc
    const text = streamDoc.sceneText(doc)
    const res = await api.saveSceneText(this.id, doc.toJSON(), text)
    const meta = useOutlineStore.getState().outline?.scenes.find((s) => s.id === this.id)
    const statusChanges = meta?.status === 'planned' && res.wordCount > 0
    if (res.wordCount !== this.wordCount || statusChanges) {
      this.wordCount = res.wordCount
      app().bumpOutline()
    }
  }

  private writeRecovery(): void {
    if (this.disposed || !this.stillInOpenWorld()) return
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
}

export class SceneController {
  private session: SceneSession | null = null
  private leaving = new Set<SceneSession>()
  private loadTicket = 0
  private requested: ID | null = null
  private stream: { generationId: ID; split: SplitState } | null = null
  private wordsTimer: ReturnType<typeof setTimeout> | null = null
  private destroyed = false
  readonly follow: FollowScroll
  readonly bridge: EditorBridge

  constructor(
    private readonly editor: Editor,
    private readonly scroller: () => HTMLElement | null,
    private readonly events: ControllerEvents
  ) {
    this.follow = new FollowScroll(scroller)
    editor.on('update', this.onUpdate)

    const sceneIdOf = (): ID | null => this.session?.id ?? null
    this.bridge = {
      get sceneId() {
        return sceneIdOf()
      },
      beginStream: (sceneId, generationId) => this.beginStream(sceneId, generationId),
      appendStream: (generationId, text) => this.appendStream(generationId, text),
      endStream: (generationId) => this.endStream(generationId),
      flush: () => this.flush(),
      getText: () => streamDoc.sceneText(this.editor.state.doc)
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
      // Back to the scene already on screen: cancel any other load and keep it as it is.
      this.loadTicket++
      this.requested = id
      return
    }
    if (this.requested === id) return
    this.requested = id
    const ticket = ++this.loadTicket
    this.stopStreamForSwitch()
    try {
      const worldId = app().world?.id
      if (!worldId) return
      // Save the scene being left first, so reopening a scene never reads text older than what was on screen.
      await this.flush()
      if (checkedWorld !== worldId) {
        checkedWorld = worldId
        await recoverUnsaved(worldId)
      }
      if (ticket !== this.loadTicket || this.destroyed) return
      const scene = await api.getScene(id)
      if (ticket !== this.loadTicket || this.destroyed) return
      this.show(scene, worldId)
    } catch (e) {
      if (ticket !== this.loadTicket || this.destroyed) return
      this.requested = null
      this.events.onError((e as Error).message)
    }
  }

  /** Tries the last requested scene again after a failure. */
  retry(id: ID): void {
    this.requested = null
    void this.open(id)
  }

  private show(scene: Scene, worldId: ID): void {
    const view = this.editor.view
    const el = this.scroller()
    const prev = this.session
    if (prev) {
      const { anchor, head } = this.editor.state.selection
      memory.set(prev.id, { scrollTop: el?.scrollTop ?? 0, anchor, head })
      prev.leave(this.editor.state.doc)
      this.leaving.add(prev)
      void prev.close()
    }

    // Coming back to a scene whose last save hasn't landed yet (saving is failing): the text on
    // screen when Adam left is newer than the stored copy, so carry it over and let one session own it.
    const unsaved = [...this.leaving].find((s) => s.id === scene.id && s.saver.dirty)
    if (unsaved) {
      unsaved.dispose()
      this.leaving.delete(unsaved)
    }
    const doc = unsaved?.doc ?? streamDoc.docFromStored(this.editor.schema, scene.doc, scene.text)
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

    this.session = new SceneSession(
      scene.id,
      worldId,
      scene.wordCount,
      () => this.editor.state.doc,
      (gone) => this.leaving.delete(gone)
    )
    if (this.wordsTimer) clearTimeout(this.wordsTimer)
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
    }
    if (takeFocusRequest(scene.id)) this.focus()
  }

  focus(): void {
    if (this.destroyed) return
    this.editor.view.focus()
  }

  // ---------- Editing and saving ----------

  private onUpdate = (): void => {
    const s = this.session
    if (!s) return
    s.changed()
    if (this.wordsTimer) clearTimeout(this.wordsTimer)
    this.wordsTimer = setTimeout(() => {
      this.wordsTimer = null
      if (this.session === s) app().setSceneWords(countWords(streamDoc.sceneText(this.editor.state.doc)))
    }, 300)
  }

  /** Saves everything pending now (Ctrl+S, closing the window, switching worlds). */
  async flush(): Promise<void> {
    await Promise.allSettled([this.session?.saver.flush(), ...[...this.leaving].map((s) => s.saver.flush())])
  }

  // ---------- Streaming drafts ----------

  private beginStream(sceneId: ID, generationId: ID): boolean {
    if (this.destroyed || !this.session || this.session.id !== sceneId || this.requested !== sceneId) return false
    if (this.stream) this.finishStream()
    this.editor.view.dispatch(streamDoc.startStream(this.editor.state, generationId))
    this.stream = { generationId, split: newSplitState() }
    return true
  }

  private appendStream(generationId: ID, text: string): void {
    if (!this.stream || this.stream.generationId !== generationId || this.destroyed) return
    const { ops, state } = splitChunk(this.stream.split, text)
    this.stream.split = state
    const tr = streamDoc.appendStream(this.editor.state, ops)
    if (!tr) return
    this.follow.check()
    this.editor.view.dispatch(tr)
    this.follow.nudge()
  }

  private endStream(generationId: ID): void {
    if (!this.stream || this.stream.generationId !== generationId) return
    this.finishStream()
  }

  /** Ends the stream: tidies a final scene break and makes the whole draft one undo step. */
  private finishStream(): void {
    this.stream = null
    if (this.destroyed) return
    const view = this.editor.view
    const tidy = streamDoc.finishStreamText(view.state)
    if (tidy) view.dispatch(tidy)
    view.updateState(streamDoc.commitStream(view.state))
    this.follow.settle()
  }

  /** Leaving the scene mid-draft stops the draft; the text so far stays. */
  private stopStreamForSwitch(): void {
    if (!this.stream) return
    const id = this.stream.generationId
    this.finishStream()
    void api.stopGeneration(id).catch(() => undefined)
  }

  // ---------- Teardown ----------

  /** Saves what's pending and lets go of the editor. */
  destroy(): void {
    if (this.destroyed) return
    this.stopStreamForSwitch()
    this.destroyed = true
    this.editor.off('update', this.onUpdate)
    if (this.wordsTimer) clearTimeout(this.wordsTimer)
    this.follow.stop()
    const s = this.session
    if (s) {
      s.leave(this.editor.state.doc)
      void s.close()
    }
    this.session = null
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
