// Adapted from mcreader-v2, src/server/speech/marks.ts (labelChapter, markRun and contextFor; reading aloud's own
// text-to-speech code; Adam's rule, 2 October 2026). MCreader keeps its marks in its database and calls its model
// directly; AI Write keeps them as a cache and makes its AI calls through the task runner (src/main/ai/tasks.ts),
// as 'speech' records with the Read aloud model.
//
// The AI's marks on a scene's paragraphs (who says each quote, and with Mark who says what how each line is said),
// kept per scene in the app's user data folder, never in the world: one file per scene, each paragraph's marks
// under its id with a hash of its words. A paragraph whose words change has its marks dropped, and is marked again
// when it is next read aloud.
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { ID } from '@shared/types'
import { readJson, writeFileAtomic } from '../util'
import type { CastMember } from './cast'
import {
  LABEL_PROMPT,
  MARK_FIRST,
  MARK_PART,
  MARK_PROMPT,
  markParts,
  marksFrom,
  numbered,
  parseLabels,
  parseNumbered,
  UNKNOWN,
  withLabels,
  withMarks,
  type Para
} from './speakers'
import type { ParagraphMarks } from './types'

/** A paragraph's marks as kept: with the hash of the words they were made for. */
export interface KeptParagraph extends ParagraphMarks {
  hash: string
}

interface MarksFile {
  v: 1
  paragraphs: Record<string, KeptParagraph>
}

/** The hash a paragraph's marks are kept with: when its words change, so does this, and the marks are dropped. */
export const textHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 20)

/** An id that is safe as a file name (world and scene ids are made by the app; anything else is refused). */
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/

export class MarkStore {
  constructor(readonly dir: string) {}

  private fileOf(worldId: ID, sceneId: ID): string | null {
    if (!SAFE_ID.test(worldId) || !SAFE_ID.test(sceneId)) return null
    return join(this.dir, worldId, `${sceneId}.json`)
  }

  /** Everything kept for a scene, whatever its words are now. */
  load(worldId: ID, sceneId: ID): Record<string, KeptParagraph> {
    const file = this.fileOf(worldId, sceneId)
    if (!file) return {}
    const kept = readJson<Partial<MarksFile>>(file, {})
    return kept.v === 1 && kept.paragraphs && typeof kept.paragraphs === 'object' ? kept.paragraphs : {}
  }

  /** The marks for these paragraphs, only where their words are the ones the marks were made for. */
  current(worldId: ID, sceneId: ID, paragraphs: readonly { pid: string; text: string }[]): Map<string, ParagraphMarks> {
    const kept = this.load(worldId, sceneId)
    const out = new Map<string, ParagraphMarks>()
    for (const p of paragraphs) {
      const k = kept[p.pid]
      if (!k || k.hash !== textHash(p.text)) continue
      out.set(p.pid, { ...(k.speakers ? { speakers: k.speakers } : {}), ...(k.delivery ? { delivery: k.delivery } : {}) })
    }
    return out
  }

  /**
   * Keeps new marks for some paragraphs. `scene`: the scene's paragraphs now, so marks for paragraphs it no longer
   * has, or whose words changed, are dropped.
   */
  save(worldId: ID, sceneId: ID, blocks: Para[], scene: readonly { pid: string; text: string }[]): void {
    const file = this.fileOf(worldId, sceneId)
    if (!file) return
    const now = new Map(scene.map((p) => [p.pid, textHash(p.text)]))
    const kept = Object.fromEntries(Object.entries(this.load(worldId, sceneId)).filter(([pid, k]) => now.get(pid) === k.hash))
    for (const b of blocks) {
      if (now.get(b.id) !== textHash(b.text)) continue
      const speakers = b.speakers && Object.keys(b.speakers).length ? b.speakers : undefined
      const delivery = b.delivery && Object.keys(b.delivery).length ? b.delivery : undefined
      kept[b.id] = { hash: textHash(b.text), ...(speakers ? { speakers } : {}), ...(delivery ? { delivery } : {}) }
    }
    const out: MarksFile = { v: 1, paragraphs: kept }
    writeFileAtomic(file, JSON.stringify(out))
  }
}

const contextFor = (before: string, text: string): string =>
  (before ? `Earlier in the scene, for context only:\n${before}\n\n---\n\n` : '') + text

/** One AI call, as the task runner makes it; resolves with the reply, or null when it failed or was stopped. */
export type Ask = (call: {
  system: string
  user: string
  reply: number
  temperature: number
}) => Promise<{ text: string | null; error: string | null }>

export interface MarkingScene {
  worldId: ID
  sceneId: ID
  /** The whole scene's paragraphs as they are now, with the marks kept for them. */
  blocks: Para[]
  /** The paragraphs being read, in order, from where reading is now. */
  run: string[]
  /** The characters the AI is told about. */
  cast: CastMember[]
  /** Who tells the story, when it is told in the first person. */
  pov?: string
}

/** Paragraphs that failed to be marked are left alone this long, so a reading doesn't ask again and again. */
const RETRY_MS = 120_000

/**
 * Starts and keeps track of the AI's marking: at most one call per paragraph at a time, a little ahead of the
 * reading, and nothing asked again soon after it failed.
 */
export class Marker {
  private busy = new Map<string, Set<string>>()
  private failed = new Map<string, Map<string, { hash: string; at: number }>>()
  private stops = new Map<string, Set<() => void>>()

  constructor(
    private readonly store: MarkStore,
    private readonly ask: (sceneId: ID) => { call: Ask; stop: () => void } | { error: string },
    private readonly done: (sceneId: ID, pids: string[], error: string | null) => void
  ) {}

  private key = (worldId: ID, sceneId: ID): string => `${worldId}:${sceneId}`

  /** The paragraphs of a scene being marked now. */
  busyIn(worldId: ID, sceneId: ID): Set<string> {
    return new Set(this.busy.get(this.key(worldId, sceneId)) ?? [])
  }

  private gaveUp(key: string, b: Para): boolean {
    const f = this.failed.get(key)?.get(b.id)
    return !!f && f.hash === textHash(b.text) && Date.now() - f.at < RETRY_MS
  }

  /**
   * Mark who says what: has the AI note who says each line and how, for the paragraphs a little ahead of the reading
   * (the part reading is in, and the next), where nothing is kept yet. Returns the paragraphs being noted now.
   */
  note(s: MarkingScene): Set<string> {
    const key = this.key(s.worldId, s.sceneId)
    const busy = this.busy.get(key) ?? new Set<string>()
    const byId = new Map(s.blocks.map((b) => [b.id, b]))
    // A little ahead: about the first part and the next.
    const ahead: string[] = []
    let size = 0
    for (const pid of s.run) {
      const b = byId.get(pid)
      if (!b) continue
      ahead.push(pid)
      size += b.text.length
      if (size >= MARK_FIRST + MARK_PART) break
    }
    const skip = new Set([...busy, ...s.blocks.filter((b) => this.gaveUp(key, b)).map((b) => b.id)])
    const parts = markParts(s.blocks, ahead, skip)
    for (const part of parts) {
      const run = this.begin(key, s.sceneId, part.blockIds)
      if (!run) break
      const reply = 200 + part.asks.length * 40
      void run
        .call({ system: MARK_PROMPT(s.cast, s.pov), user: contextFor(part.before, part.text), reply, temperature: 0.3 })
        .then(({ text, error }) => {
          const said = text == null ? {} : parseNumbered(text, 300)
          const got = Object.keys(said).length ? marksFrom(part, said, s.pov) : null
          this.finish(
            key,
            s,
            part.blockIds,
            got ? s.blocks.filter((b) => got.has(b.id)).map((b) => withMarks(b, got.get(b.id)!)) : null,
            error,
            run.stop
          )
        })
    }
    return new Set(this.busy.get(key) ?? [])
  }

  /**
   * Has the AI mark who says the quotes the rules can't place (`unplaced`: paragraph id → the quotes' keys), with the
   * whole scene in view. Returns the paragraphs being marked now.
   */
  label(s: MarkingScene, unplaced: Map<string, Set<string>>): Set<string> {
    const key = this.key(s.worldId, s.sceneId)
    const busy = this.busy.get(key) ?? new Set<string>()
    const wanted = (b: Para, quote: string): boolean =>
      !!unplaced.get(b.id)?.has(quote) && !busy.has(b.id) && !this.gaveUp(key, b) && b.speakers?.[quote] === undefined
    const { parts, quotes } = numbered(s.blocks, wanted)
    if (!quotes.length) return new Set(busy)
    const pids = [...new Set(quotes.map((q) => q.blockId))]
    const run = this.begin(key, s.sceneId, pids)
    if (!run) return new Set(this.busy.get(key) ?? [])
    void Promise.all(
      parts.map((part) => {
        const n = (part.text.match(/\[\d+\]/g) ?? []).length
        return run.call({ system: LABEL_PROMPT(s.cast), user: contextFor(part.before, part.text), reply: 80 + n * 16, temperature: 0 })
      })
    ).then((replies) => {
      const error = replies.find((r) => r.error)?.error ?? null
      if (replies.every((r) => r.text == null)) return this.finish(key, s, pids, null, error, run.stop)
      const said: Record<string, string> = Object.assign({}, ...replies.map((r) => (r.text == null ? {} : parseLabels(r.text))))
      const labels = new Map<string, Record<string, string>>()
      quotes.forEach((q, i) => {
        const of = labels.get(q.blockId) ?? labels.set(q.blockId, {}).get(q.blockId)!
        of[q.key] = said[String(i + 1)] ?? UNKNOWN
      })
      this.finish(
        key,
        s,
        pids,
        s.blocks.filter((b) => labels.has(b.id)).map((b) => withLabels(b, labels.get(b.id)!)),
        null,
        run.stop
      )
    })
    return new Set(this.busy.get(key) ?? [])
  }

  /** Marks the paragraphs busy and gets a way to ask; null (and says why, once) when the AI can't be asked. */
  private begin(key: string, sceneId: ID, pids: string[]): { call: Ask; stop: () => void } | null {
    const got = this.ask(sceneId)
    if ('error' in got) {
      this.done(sceneId, pids, got.error)
      return null
    }
    const busy = this.busy.get(key) ?? this.busy.set(key, new Set()).get(key)!
    for (const pid of pids) busy.add(pid)
    const stops = this.stops.get(key) ?? this.stops.set(key, new Set()).get(key)!
    stops.add(got.stop)
    return got
  }

  private finish(key: string, s: MarkingScene, pids: string[], blocks: Para[] | null, error: string | null, stop: () => void): void {
    this.stops.get(key)?.delete(stop)
    const busy = this.busy.get(key)
    // Stopped (the reading ended, or the world closed): nothing is kept and nobody is told.
    if (!busy || !pids.some((p) => busy.has(p))) return
    for (const pid of pids) busy.delete(pid)
    if (blocks) {
      try {
        this.store.save(
          s.worldId,
          s.sceneId,
          blocks,
          s.blocks.map((b) => ({ pid: b.id, text: b.text }))
        )
      } catch (e) {
        console.warn('[read aloud] could not keep the marks', e)
      }
    } else {
      const failed = this.failed.get(key) ?? this.failed.set(key, new Map()).get(key)!
      for (const pid of pids) {
        const b = s.blocks.find((x) => x.id === pid)
        if (b) failed.set(pid, { hash: textHash(b.text), at: Date.now() })
      }
    }
    this.done(s.sceneId, pids, blocks ? null : (error ?? "The AI's marks couldn't be read, so this part is read by the rules alone."))
  }

  /** Stops marking a scene (its reading stopped): calls in flight are stopped and their replies dropped. */
  stop(worldId: ID, sceneId: ID): void {
    const key = this.key(worldId, sceneId)
    this.busy.delete(key)
    this.failed.delete(key)
    for (const stop of this.stops.get(key) ?? []) stop()
    this.stops.delete(key)
  }

  /** The world closed: forget everything (its calls are stopped by the task runner). */
  forgetAll(): void {
    this.busy.clear()
    this.failed.clear()
    this.stops.clear()
  }
}
