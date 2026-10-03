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
  type MarkPart,
  marksFrom,
  numbered,
  parseLabels,
  parseNumbered,
  UNKNOWN,
  unmarkedIn,
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
   * Keeps new marks for some paragraphs. `scene`: the paragraphs whose words are known now (a reading sends the scene
   * from a little before where it starts), so marks for any of them whose words changed are dropped. `all`: every
   * paragraph the scene has now, when known, so marks for paragraphs it no longer has are dropped too.
   */
  save(worldId: ID, sceneId: ID, blocks: Para[], scene: readonly { pid: string; text: string }[], all?: ReadonlySet<string>): void {
    const file = this.fileOf(worldId, sceneId)
    if (!file) return
    const now = new Map(scene.map((p) => [p.pid, textHash(p.text)]))
    const stays = ([pid, k]: [string, KeptParagraph]): boolean => (now.has(pid) ? now.get(pid) === k.hash : !all || all.has(pid))
    const kept = Object.fromEntries(Object.entries(this.load(worldId, sceneId)).filter(stays))
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
  /** The scene's paragraphs as they are now (from a little before where reading is), with the marks kept for them. */
  blocks: Para[]
  /** The paragraphs being read, in order, from where reading is now. */
  run: string[]
  /** Where reading is in the run's first paragraph, in characters. */
  offset?: number
  /** The characters the AI is told about. */
  cast: CastMember[]
  /** Who tells the story, when it is told in the first person. */
  pov?: string
  /** Every paragraph id the scene has now, when known (marks for others are let go). */
  pids?: ReadonlySet<string>
}

/** Where reading asks for its clips again (ReadingPlan.markAhead): in paragraph `pid`, `at` characters into its words. */
export interface MarkAhead {
  pid: string
  at: number
}

/** Paragraphs that failed to be marked are left alone this long, so a reading doesn't ask again and again. */
const RETRY_MS = 120_000

/** One paragraph of the run: where its words start and end, counted from where reading is, and where it is read from. */
interface RunEntry {
  b: Para
  from: number
  start: number
  end: number
}

/** The run as reading goes through it. */
function runOf(s: MarkingScene): RunEntry[] {
  const byId = new Map(s.blocks.map((b) => [b.id, b]))
  const out: RunEntry[] = []
  let pos = 0
  s.run.forEach((pid, i) => {
    const b = byId.get(pid)
    if (!b) return
    const from = i === 0 ? Math.min(Math.max(0, s.offset ?? 0), b.text.length) : 0
    out.push({ b, from, start: pos, end: pos + b.text.length - from })
    pos += b.text.length - from
  })
  return out
}

/** A place in the run, as a paragraph and a place in its words. */
function placeIn(run: RunEntry[], at: number): MarkAhead | undefined {
  const e = run.find((x) => at < x.end) ?? run.at(-1)
  return e ? { pid: e.b.id, at: e.from + Math.max(0, Math.min(at, e.end) - e.start) } : undefined
}

/** A call the Marker made: its way to ask, and the number that tells its reply from a later call's. */
interface Call {
  call: Ask
  stop: () => void
  token: number
  /** Made in the background (a draft just landed): a failure is only logged, and a reading asks again itself. */
  quiet: boolean
}

/**
 * Starts and keeps track of the AI's marking: at most one call per paragraph at a time, a little ahead of the
 * reading, and nothing asked again soon after it failed.
 */
export class Marker {
  /** The paragraphs of each scene being marked now, each with the call marking it. */
  private busy = new Map<string, Map<string, number>>()
  /** The hash of the words each busy paragraph is being marked for, so a call for words since changed can be taken over. */
  private busyHash = new Map<string, Map<string, string>>()
  /** Each call in flight, by its number: its stop, so one whose paragraphs were all taken over is stopped. */
  private live = new Map<number, { key: string; stop: () => void }>()
  private failed = new Map<string, Map<string, { hash: string; at: number }>>()
  private stops = new Map<string, Set<() => void>>()
  private calls = 0

  constructor(
    private readonly store: MarkStore,
    private readonly ask: (sceneId: ID) => { call: Ask; stop: () => void } | { error: string },
    private readonly done: (sceneId: ID, pids: string[], error: string | null) => void
  ) {}

  private key = (worldId: ID, sceneId: ID): string => `${worldId}:${sceneId}`

  /** The paragraphs of a scene being marked now. */
  busyIn(worldId: ID, sceneId: ID): Set<string> {
    return new Set(this.busy.get(this.key(worldId, sceneId))?.keys() ?? [])
  }

  private gaveUp(key: string, b: Para): boolean {
    const f = this.failed.get(key)?.get(b.id)
    return !!f && f.hash === textHash(b.text) && Date.now() - f.at < RETRY_MS
  }

  /** Paragraphs that couldn't be marked: read by the rules, and not asked about again for a while. */
  private gaveUpOn(key: string, s: MarkingScene, pids: string[]): void {
    const failed = this.failed.get(key) ?? this.failed.set(key, new Map()).get(key)!
    const byId = new Map(s.blocks.map((b) => [b.id, b]))
    for (const pid of pids) {
      const b = byId.get(pid)
      if (b) failed.set(pid, { hash: textHash(b.text), at: Date.now() })
    }
  }

  /**
   * Mark who says what: has the AI note who says each line and how, a part of the scene at a time, a little ahead of
   * the reading: when the reading is about to need notes it hasn't got, the part from there (and, as a reading
   * starts, a small part whose notes come back while the first clip plays, then the next). Returns the paragraphs
   * being noted now, and `again`: where the reading asks again, a part's length before the next paragraph that
   * needs notes, so they keep ahead of it to the end of the scene.
   */
  note(s: MarkingScene): { busy: Set<string>; again?: MarkAhead } {
    const key = this.key(s.worldId, s.sceneId)
    const run = runOf(s)
    const open = (e: RunEntry): boolean =>
      !this.busy.get(key)?.has(e.b.id) && !this.gaveUp(key, e.b) && unmarkedIn(e.b.text, e.b.speakers, e.b.delivery).length > 0
    const first = run.find(open)
    if (first && first.start <= MARK_FIRST) {
      const start = first.start < MARK_FIRST / 2
      const ids = run.filter((e) => e.end > first.start && e.start < first.start + MARK_FIRST + MARK_PART).map((e) => e.b.id)
      const skip = new Set([...(this.busy.get(key)?.keys() ?? []), ...s.blocks.filter((b) => this.gaveUp(key, b)).map((b) => b.id)])
      const parts = markParts(s.blocks, ids, skip, start ? MARK_FIRST : MARK_PART).slice(0, start ? 2 : 1)
      this.askParts(key, s, parts, false)
    }
    const next = run.find(open)
    const again = next ? placeIn(run, Math.max(0, next.start - MARK_FIRST)) : undefined
    return { busy: this.busyIn(s.worldId, s.sceneId), ...(again ? { again } : {}) }
  }

  /**
   * Marks these paragraphs of a scene in the background, all of them, a part at a time (a draft just landed in it,
   * so its notes are ready before Listen). A paragraph already being marked for the same words is left to that call;
   * one being marked for words it no longer has is taken over. Failures are only logged. Returns the paragraphs
   * being noted now.
   */
  noteAll(s: MarkingScene, pids: ReadonlySet<string>): Set<string> {
    const key = this.key(s.worldId, s.sceneId)
    const skip = new Set(s.blocks.filter((b) => this.busyFor(key, b) || this.gaveUp(key, b)).map((b) => b.id))
    const ids = s.blocks.filter((b) => pids.has(b.id)).map((b) => b.id)
    this.askParts(key, s, markParts(s.blocks, ids, skip, MARK_PART, MARK_PART), true)
    return this.busyIn(s.worldId, s.sceneId)
  }

  /** True when this paragraph is being marked now for the words it has. */
  private busyFor(key: string, b: Para): boolean {
    return !!this.busy.get(key)?.has(b.id) && this.busyHash.get(key)?.get(b.id) === textHash(b.text)
  }

  /** Asks the AI to note each part (Mark who says what). */
  private askParts(key: string, s: MarkingScene, parts: MarkPart[], quiet: boolean): void {
    for (const [i, part] of parts.entries()) {
      const call = this.begin(key, s, part.blockIds, quiet)
      if ('error' in call) {
        if (quiet) {
          console.warn('[read aloud] the marks for a new draft were not made:', call.error)
          break
        }
        // The AI can't be asked (no model for it): these parts are read by the rules, and the reading is told once.
        const pids = parts.slice(i).flatMap((p) => p.blockIds)
        this.gaveUpOn(key, s, pids)
        this.done(s.sceneId, pids, call.error)
        break
      }
      const reply = 200 + part.asks.length * 40
      void call
        .call({ system: MARK_PROMPT(s.cast, s.pov), user: contextFor(part.before, part.text), reply, temperature: 0.3 })
        .then(({ text, error }) => {
          const said = text == null ? {} : parseNumbered(text, 300)
          const got = Object.keys(said).length ? marksFrom(part, said, s.pov, s.cast) : null
          const blocks = got ? s.blocks.filter((b) => got.has(b.id)).map((b) => withMarks(b, got.get(b.id)!)) : null
          this.finish(key, s, call, part.blockIds, blocks, error)
        })
        .catch((e: unknown) => {
          console.warn('[read aloud] marking failed', e)
          this.finish(key, s, call, part.blockIds, null, null)
        })
    }
  }

  /**
   * Has the AI mark who says the quotes the rules can't place (`unplaced`: paragraph id → the quotes' keys), with the
   * whole scene in view. Returns the paragraphs being marked now.
   */
  label(s: MarkingScene, unplaced: Map<string, Set<string>>, o: { quiet?: boolean } = {}): Set<string> {
    const key = this.key(s.worldId, s.sceneId)
    const busy = this.busy.get(key)
    // In the background, a paragraph being marked for words it no longer has is taken over.
    const taken = (b: Para): boolean => (o.quiet ? this.busyFor(key, b) : !!busy?.has(b.id))
    const wanted = (b: Para, quote: string): boolean =>
      !!unplaced.get(b.id)?.has(quote) && !taken(b) && !this.gaveUp(key, b) && b.speakers?.[quote] === undefined
    const { parts, quotes } = numbered(s.blocks, wanted)
    if (!quotes.length) return this.busyIn(s.worldId, s.sceneId)
    const pids = [...new Set(quotes.map((q) => q.blockId))]
    const call = this.begin(key, s, pids, !!o.quiet)
    if ('error' in call) {
      if (o.quiet) {
        console.warn('[read aloud] the speakers for a new draft were not marked:', call.error)
        return this.busyIn(s.worldId, s.sceneId)
      }
      // The AI can't be asked: these lines are read by the rules, and the reading is told once.
      this.gaveUpOn(key, s, pids)
      this.done(s.sceneId, pids, call.error)
      return this.busyIn(s.worldId, s.sceneId)
    }
    void Promise.all(
      parts.map((part) => {
        const n = (part.text.match(/\[\d+\]/g) ?? []).length
        return call.call({ system: LABEL_PROMPT(s.cast), user: contextFor(part.before, part.text), reply: 80 + n * 16, temperature: 0 })
      })
    )
      .catch((e: unknown) => {
        console.warn('[read aloud] marking failed', e)
        return [{ text: null, error: null }]
      })
      .then((replies) => {
        const error = replies.find((r) => r.error)?.error ?? null
        if (replies.every((r) => r.text == null)) return this.finish(key, s, call, pids, null, error)
        const said: Record<string, string> = Object.assign({}, ...replies.map((r) => (r.text == null ? {} : parseLabels(r.text))))
        const labels = new Map<string, Record<string, string>>()
        quotes.forEach((q, i) => {
          const of = labels.get(q.blockId) ?? labels.set(q.blockId, {}).get(q.blockId)!
          of[q.key] = said[String(i + 1)] ?? UNKNOWN
        })
        const blocks = s.blocks.filter((b) => labels.has(b.id)).map((b) => withLabels(b, labels.get(b.id)!))
        this.finish(key, s, call, pids, blocks, null)
      })
    return this.busyIn(s.worldId, s.sceneId)
  }

  /**
   * Marks the paragraphs busy with a new call and gets a way to ask, or why the AI can't be asked. A call whose
   * paragraphs are all taken over by this one is stopped (its reply would be dropped anyway).
   */
  private begin(key: string, s: MarkingScene, pids: string[], quiet = false): Call | { error: string } {
    const got = this.ask(s.sceneId)
    if ('error' in got) return got
    const token = ++this.calls
    const busy = this.busy.get(key) ?? this.busy.set(key, new Map()).get(key)!
    const hashes = this.busyHash.get(key) ?? this.busyHash.set(key, new Map()).get(key)!
    const texts = new Map(s.blocks.map((b) => [b.id, b.text]))
    const before = new Set<number>()
    for (const pid of pids) {
      const was = busy.get(pid)
      if (was !== undefined) before.add(was)
      busy.set(pid, token)
      hashes.set(pid, textHash(texts.get(pid) ?? ''))
    }
    const owned = new Set(busy.values())
    for (const t of before) {
      const old = this.live.get(t)
      if (old && !owned.has(t)) {
        this.live.delete(t)
        this.stops.get(key)?.delete(old.stop)
        old.stop()
      }
    }
    const stops = this.stops.get(key) ?? this.stops.set(key, new Set()).get(key)!
    stops.add(got.stop)
    this.live.set(token, { key, stop: got.stop })
    return { ...got, token, quiet }
  }

  private finish(key: string, s: MarkingScene, call: Call, pids: string[], blocks: Para[] | null, error: string | null): void {
    this.stops.get(key)?.delete(call.stop)
    this.live.delete(call.token)
    const busy = this.busy.get(key)
    // A call that was stopped (the reading ended, or the world closed), or that a later call took over from: its
    // reply is dropped, and nobody is told.
    const mine = pids.filter((pid) => busy?.get(pid) === call.token)
    if (!busy || !mine.length) return
    for (const pid of mine) {
      busy.delete(pid)
      this.busyHash.get(key)?.delete(pid)
    }
    if (!blocks && call.quiet) {
      // Made in the background: only logged, and nothing is held against these paragraphs, so a reading asks again
      // (and says so if that fails too). A reading waiting for them is told they are free.
      console.warn('[read aloud] the marks for a new draft were not made:', error ?? 'the reply could not be read')
      this.done(s.sceneId, mine, null)
      return
    }
    if (blocks) {
      try {
        this.store.save(
          s.worldId,
          s.sceneId,
          blocks.filter((b) => mine.includes(b.id)),
          s.blocks.map((b) => ({ pid: b.id, text: b.text })),
          s.pids
        )
      } catch (e) {
        console.warn('[read aloud] could not keep the marks', e)
      }
    } else this.gaveUpOn(key, s, mine)
    this.done(s.sceneId, mine, blocks ? null : (error ?? "The AI's marks couldn't be read, so this part is read by the rules alone."))
  }

  /** Stops marking a scene (its reading stopped): calls in flight are stopped and their replies dropped. */
  stop(worldId: ID, sceneId: ID): void {
    const key = this.key(worldId, sceneId)
    this.busy.delete(key)
    this.busyHash.delete(key)
    this.failed.delete(key)
    for (const stop of this.stops.get(key) ?? []) stop()
    this.stops.delete(key)
    for (const [t, c] of this.live) if (c.key === key) this.live.delete(t)
  }

  /** The world closed: forget everything (its calls are stopped by the task runner). */
  forgetAll(): void {
    this.busy.clear()
    this.busyHash.clear()
    this.failed.clear()
    this.stops.clear()
    this.live.clear()
  }
}
