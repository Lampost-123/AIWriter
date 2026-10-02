// Marking a draft as it lands (Adam, 2 October 2026; spec "Who says each line, and how"): when AI-written text goes
// into a scene (Generate, Beat by beat, a picked variant, an accepted AI edit or Continue), the paragraphs it added or
// changed are marked in the background (who says each line, and with Mark who says what how), so they are ready
// before Listen and "Show speakers and tone" can show them. Text Adam types himself is marked a little ahead of the
// reading, as before.
//
// How it hears of a draft: an AI change about to go in (the snapshot History takes first, with the page as it was)
// or a draft job starting says which paragraphs were there before; the scene's saves bring the page as it is now;
// a few seconds after the last save, once no draft is being written into it, the paragraphs that are new or whose
// words changed are marked. Only when it is wanted (read aloud is on or set up, or "Show speakers and tone" is on).
// Never throws, never holds a draft or a save up: a failure is logged and the draft goes on.
//
// No Electron imports: index.ts gives it the settings, the open world and the Marker.
import type { ID } from '@shared/types'
import { textHash } from './marks'
import { paragraphsOfDoc } from './suggest'

export interface DraftMarksDeps {
  /** Marks are wanted at all: read aloud is on or set up, or "Show speakers and tone" is on. */
  wanted(): boolean
  /** A draft is being written into this scene now. */
  drafting(sceneId: ID): boolean
  /** The scene's page as last saved, or null. */
  savedDoc(sceneId: ID): unknown
  /** Starts marking these paragraphs of the scene (`paragraphs`: the whole scene as it is now). */
  mark(sceneId: ID, paragraphs: { pid: string; text: string }[], pids: string[]): void
  /** How long after the last save it waits (the page settles first). */
  delayMs?: number
  /** An AI change nothing has been heard of for this long (it never went in) is let go. */
  forgetMs?: number
  now?: () => number
}

/** A few seconds after the last save. */
export const MARK_AFTER_MS = 2500
/** An AI change with no save and no draft for two minutes is let go, so Adam's own typing isn't taken for it. */
export const FORGET_AFTER_MS = 120_000

interface Pending {
  /** The paragraphs before the AI change: id → hash of its words. */
  before: Map<string, string>
  /** The page as last saved since. */
  doc: unknown
  /** When it was last heard of (the change, a save while drafting, the draft finishing). */
  heard: number
  timer: ReturnType<typeof setTimeout> | null
}

const hashes = (doc: unknown): Map<string, string> => new Map(paragraphsOfDoc(doc).map((p) => [p.pid, textHash(p.text)]))

export class DraftMarks {
  private pending = new Map<ID, Pending>()

  constructor(private readonly deps: DraftMarksDeps) {}

  private now = (): number => (this.deps.now ?? Date.now)()

  private safely(what: string, fn: () => void): void {
    try {
      fn()
    } catch (e) {
      console.warn(`[read aloud] marking a new draft: ${what} failed`, e)
    }
  }

  /**
   * AI-written text is about to go into a scene. `before`: the page as it is now (History's snapshot), else the page
   * as last saved. A change already waiting keeps the page from before it, so nothing it brought is missed.
   */
  aiChange(sceneId: ID, before?: unknown): void {
    this.safely('noting a change', () => {
      if (!this.deps.wanted()) return
      const p = this.pending.get(sceneId)
      if (p) {
        p.heard = this.now()
        return
      }
      const doc = before !== undefined && before !== null ? before : this.deps.savedDoc(sceneId)
      this.pending.set(sceneId, { before: hashes(doc), doc: null, heard: this.now(), timer: null })
    })
  }

  /** The scene was saved: marking waits for the page to settle. */
  saved(sceneId: ID, doc: unknown): void {
    this.safely('a save', () => {
      const p = this.pending.get(sceneId)
      if (!p) return
      const drafting = this.deps.drafting(sceneId)
      if (!drafting && this.now() - p.heard > (this.deps.forgetMs ?? FORGET_AFTER_MS)) return this.drop(sceneId)
      if (drafting) p.heard = this.now()
      p.doc = doc
      this.schedule(sceneId, p)
    })
  }

  /** A draft of the scene finished: its last words are saved a moment later, and marking waits for that. */
  draftEnded(sceneId: ID): void {
    this.safely('a finished draft', () => {
      const p = this.pending.get(sceneId)
      if (!p) return
      p.heard = this.now()
      this.schedule(sceneId, p)
    })
  }

  /** The world closed: nothing waits any more. */
  forget(): void {
    for (const id of [...this.pending.keys()]) this.drop(id)
  }

  /** Scenes with an AI change waiting to be marked (for tests). */
  waiting(): ID[] {
    return [...this.pending.keys()]
  }

  private drop(sceneId: ID): void {
    const p = this.pending.get(sceneId)
    if (p?.timer) clearTimeout(p.timer)
    this.pending.delete(sceneId)
  }

  private schedule(sceneId: ID, p: Pending): void {
    if (p.timer) clearTimeout(p.timer)
    p.timer = setTimeout(() => {
      p.timer = null
      this.safely('marking', () => this.fire(sceneId, p))
    }, this.deps.delayMs ?? MARK_AFTER_MS)
    ;(p.timer as { unref?: () => void }).unref?.()
  }

  private fire(sceneId: ID, p: Pending): void {
    if (this.pending.get(sceneId) !== p) return
    // Still being written: the draft's end (or its next save) brings marking back.
    if (this.deps.drafting(sceneId)) return
    this.pending.delete(sceneId)
    if (!this.deps.wanted()) return
    const paragraphs = paragraphsOfDoc(p.doc ?? this.deps.savedDoc(sceneId)).filter((x) => x.pid)
    const pids = paragraphs.filter((x) => p.before.get(x.pid) !== textHash(x.text)).map((x) => x.pid)
    if (pids.length) this.deps.mark(sceneId, paragraphs, pids)
  }
}
