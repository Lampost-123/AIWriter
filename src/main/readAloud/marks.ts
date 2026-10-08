// Adapted from mcreader-v2, src/server/speech/marks.ts (labelChapter, markRun and contextFor; reading aloud's own
// text-to-speech code; Adam's rule, 2 October 2026). MCreader keeps its marks in its database and calls its model
// directly; AI Write keeps them as a cache and makes its AI calls through the task runner (src/main/ai/tasks.ts),
// as 'speech' records with the Read aloud model.
//
// The AI's marks on a scene's paragraphs (what each line is, whose it is and how it is said), kept per scene in the
// app's user data folder, never in the world: one file per scene, each paragraph's marks under its id with a hash of
// its words. A paragraph whose words change keeps the marks of the lines it still has, word for word, unless the
// speech tag beside a quote now names someone else ("he said" became "she said"); the rest is marked again when it is
// next read aloud. The marks come from the director (director.ts), one call over a stretch of the scene; the older
// marker prompts (LABEL_PROMPT, MARK_PROMPT) are kept for comparing them (`director: false`).
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
  NARRATION,
  NARRATOR,
  numbered,
  parseLabels,
  parseNumbered,
  quoteKey,
  quotesIn,
  spansIn,
  UNKNOWN,
  unmarkedIn,
  withLabels,
  withMarks,
  type Para
} from './speakers'
import type { ParagraphMarks } from './types'
import {
  contextBlock,
  DIRECT_PROMPT,
  EMPTY_STATE,
  linesByParagraph,
  marksOfScript,
  numberWindow,
  parseDirection,
  withDirection,
  type ScriptState
} from './director'

/** A paragraph's marks as kept: with the hash of the words they were made for. */
export interface KeptParagraph extends ParagraphMarks {
  hash: string
  /** Each marked quote's speech tag, as `tagOf` reads it: when it changes, the quote is marked again. */
  tags?: Record<string, string>
}

interface MarksFile {
  v: 1 | 2
  paragraphs: Record<string, KeptParagraph>
}

/**
 * Version 1 kept an empty note on a named speaker's line when it was marked without Mark who says what, and those
 * lines were never noted after it was turned on: their empty notes go, so they are asked about once more.
 */
function fromV1(paragraphs: Record<string, KeptParagraph>): Record<string, KeptParagraph> {
  const out: Record<string, KeptParagraph> = {}
  for (const [pid, k] of Object.entries(paragraphs)) {
    const delivery = Object.fromEntries(
      Object.entries(k.delivery ?? {}).filter(([key, how]) => {
        const who = k.speakers?.[key]
        return key.startsWith(NARRATION) || Object.keys(how).length > 0 || !who || who === NARRATOR || who === UNKNOWN
      })
    )
    out[pid] = { ...k, delivery }
  }
  return out
}

/** The hash a paragraph's marks are kept with: when its words change, so does this, and the marks are dropped. */
export const textHash = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 20)

/** Who-words: the pronouns and capitalised words a speech tag names its speaker by. */
const WHO_WORD = /^(?:he|she|they|i|we|you|it|him|her|them|me|us)$/i

/**
 * Who a quote's speech tag names, as words to compare: the pronouns and capitalised words in the rest of its sentence
 * after it and in the narration just before it, back to the quote before ("“Go,” he said" is "he"; "Mara laughed.
 * “Fine.”" is "mara"). Each quote by its key.
 */
export function tagsOf(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  const spans = spansIn(text)
  spans.forEach((x, i) => {
    if (!x.quote) return
    const next = spans.slice(i + 1).find((y) => y.quote)
    const after = text.slice(x.end, Math.min(next?.at ?? Infinity, x.end + 60)).split(/[.!?…]/)[0] ?? ''
    const last = spans.slice(0, i).reverse().find((y) => y.quote)
    const lead = text.slice(Math.max(last?.end ?? 0, x.at - 80), x.at)
    const words = `${lead} ${after}`.match(/[\p{L}’'-]+/gu) ?? []
    out[x.key] = words.filter((w) => WHO_WORD.test(w) || /^\p{Lu}/u.test(w)).map((w) => w.toLowerCase()).join(' ')
  })
  return out
}

/**
 * The marks a paragraph whose words changed still keeps: those of the quotes and sentences it still has, word for
 * word (each is kept under its own words), except a quote whose speech tag now names someone else (`tags`: the tags
 * as they were; a quote with none known is marked again). Null when none are left.
 */
export function keptFor(k: ParagraphMarks & { tags?: Record<string, string> }, text: string): ParagraphMarks | null {
  const now = tagsOf(text)
  const keys = new Set(spansIn(text).map((x) => x.key))
  // A quote's tag that changed (or was never known): its speaker, note and kind go, so it is marked again.
  for (const key of Object.keys(now)) if (k.tags?.[key] === undefined || k.tags[key] !== now[key]) keys.delete(key)
  const only = <T>(r: Record<string, T> | undefined): Record<string, T> | undefined => {
    const kept = Object.fromEntries(Object.entries(r ?? {}).filter(([key]) => keys.has(key)))
    return Object.keys(kept).length ? kept : undefined
  }
  const out: ParagraphMarks = {}
  const speakers = only(k.speakers)
  const delivery = only(k.delivery)
  const kinds = only(k.kinds)
  const voiced = only(k.voiced)
  if (speakers) out.speakers = speakers
  if (delivery) out.delivery = delivery
  if (kinds) out.kinds = kinds
  if (voiced) out.voiced = voiced
  return Object.keys(out).length ? out : null
}

/** The marks kept for a paragraph, as reading reads them (without their hash). */
const marksOf = (k: ParagraphMarks): ParagraphMarks => ({
  ...(k.speakers ? { speakers: k.speakers } : {}),
  ...(k.delivery ? { delivery: k.delivery } : {}),
  ...(k.kinds ? { kinds: k.kinds } : {}),
  ...(k.voiced ? { voiced: k.voiced } : {})
})

/** A paragraph's marks without the fields that are empty. */
function nonEmpty(b: ParagraphMarks): ParagraphMarks {
  const some = <T>(r: Record<string, T> | undefined): Record<string, T> | undefined => (r && Object.keys(r).length ? r : undefined)
  return { speakers: some(b.speakers), delivery: some(b.delivery), kinds: some(b.kinds), voiced: some(b.voiced) }
}

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
    if (!kept.paragraphs || typeof kept.paragraphs !== 'object') return {}
    return kept.v === 2 ? kept.paragraphs : kept.v === 1 ? fromV1(kept.paragraphs) : {}
  }

  /** The marks for these paragraphs, only where their words are the ones the marks were made for. */
  current(worldId: ID, sceneId: ID, paragraphs: readonly { pid: string; text: string }[]): Map<string, ParagraphMarks> {
    const kept = this.load(worldId, sceneId)
    const out = new Map<string, ParagraphMarks>()
    for (const p of paragraphs) {
      const k = kept[p.pid]
      if (!k) continue
      if (k.hash !== textHash(p.text)) {
        const still = keptFor(k, p.text)
        if (still) out.set(p.pid, still)
        continue
      }
      out.set(p.pid, marksOf(k))
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
    const loaded = Object.entries(this.load(worldId, sceneId))
    const kept = Object.fromEntries(loaded.filter(stays))
    // A paragraph whose words changed keeps the marks of the lines it still has, under its new words.
    const texts = new Map(scene.map((p) => [p.pid, p.text]))
    for (const [pid, k] of loaded) {
      if (pid in kept || !texts.has(pid)) continue
      const still = keptFor(k, texts.get(pid)!)
      if (still) kept[pid] = { hash: textHash(texts.get(pid)!), ...still, tags: tagsOf(texts.get(pid)!) }
    }
    for (const b of blocks) {
      if (now.get(b.id) !== textHash(b.text)) continue
      kept[b.id] = { hash: textHash(b.text), ...marksOf(nonEmpty(b)), tags: tagsOf(b.text) }
    }
    const out: MarksFile = { v: 2, paragraphs: kept }
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

/** Characters of a scene the lab's director takes in one window (MCreader's: a large model takes a chapter at once). */
export const DIRECTOR_WINDOW = 12000

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
    private readonly done: (sceneId: ID, pids: string[], error: string | null) => void,
    /** False: the older marker prompts (LABEL_PROMPT, MARK_PROMPT) instead of the director, for comparing them. */
    private readonly opts: { director?: boolean } = {}
  ) {}

  private get directing(): boolean {
    return this.opts.director !== false
  }

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

  /** Asks the AI to note each part (Mark who says what); with the lab's director, to direct it. */
  private askParts(key: string, s: MarkingScene, parts: MarkPart[], quiet: boolean): void {
    if (this.directing) return this.directParts(key, s, parts, quiet)
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
    // The director takes the paragraphs with lines nobody can place whole, in big windows.
    if (this.directing) {
      const ids = s.blocks.filter((b) => quotesIn(b.text).some((q) => wanted(b, quoteKey(q)))).map((b) => b.id)
      if (!ids.length) return this.busyIn(s.worldId, s.sceneId)
      const skip = new Set(s.blocks.filter((b) => taken(b) || this.gaveUp(key, b)).map((b) => b.id))
      this.directParts(key, s, markParts(s.blocks, ids, skip, DIRECTOR_WINDOW, DIRECTOR_WINDOW), !!o.quiet)
      return this.busyIn(s.worldId, s.sceneId)
    }
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
   * The lab's director (director.ts): each part, in order, as one window from its first paragraph that needs marks to
   * its last, every line numbered, told what the window before it ended on. A reply that can't be read, or leaves out
   * too many quotes, is asked for once more. What it gives is laid under what is kept (the writer's tags first).
   */
  private directParts(key: string, s: MarkingScene, parts: MarkPart[], quiet: boolean): void {
    const calls: { part: MarkPart; call: Call }[] = []
    for (const [i, part] of parts.entries()) {
      const call = this.begin(key, s, part.blockIds, quiet)
      if ('error' in call) {
        if (quiet) {
          console.warn('[read aloud] the director could not be asked:', call.error)
          break
        }
        const pids = parts.slice(i).flatMap((p) => p.blockIds)
        this.gaveUpOn(key, s, pids)
        this.done(s.sceneId, pids, call.error)
        break
      }
      calls.push({ part, call })
    }
    const index = new Map(s.blocks.map((b, i) => [b.id, i]))
    const system = DIRECT_PROMPT(s.cast, s.pov)
    void (async () => {
      let state: ScriptState = s.pov ? { ...EMPTY_STATE, pov: s.pov } : EMPTY_STATE
      for (const { part, call } of calls) {
        try {
          const at = part.blockIds.map((id) => index.get(id)).filter((n): n is number => n !== undefined)
          const window = s.blocks.slice(Math.min(...at), Math.max(...at) + 1).filter((b) => b.text.trim())
          const { text, lines } = numberWindow(window)
          const user = contextBlock(state, part.before) + text
          const reply = Math.min(16000, 800 + lines.length * 60)
          let got = await call.call({ system, user, reply, temperature: 0.3 })
          let direction = got.text == null ? null : parseDirection(got.text)
          const quotes = lines.filter((l) => l.quote)
          const lacking = (): number[] => quotes.filter((l) => !direction?.lines.has(l.n)).map((l) => l.n)
          if (got.text != null && (!direction || lacking().length > Math.max(1, quotes.length * 0.1) || direction.bad > 0)) {
            const problem = !direction
              ? 'Your reply was not one JSON object.'
              : `Your reply had no entry for line${lacking().length === 1 ? '' : 's'} ${lacking().join(', ')}${direction.bad ? `, and ${direction.bad} entries could not be read` : ''}.`
            got = await call.call({
              system,
              user: `${user}\n\n---\n\n${problem} Reply again with the whole JSON object, every quoted line included.`,
              reply,
              temperature: 0.3
            })
            const again = got.text == null ? null : parseDirection(got.text)
            if (again && (!direction || again.lines.size >= direction.lines.size)) direction = again
          }
          if (!direction) {
            this.finish(key, s, call, part.blockIds, null, got.error)
            continue
          }
          if (direction.state) state = direction.state
          const byPara = linesByParagraph(lines, direction)
          const blocks = window
            .filter((b) => part.blockIds.includes(b.id))
            .map((b) => withDirection(b, marksOfScript(b.text, byPara.get(b.id), s.pov)))
          this.finish(key, s, call, part.blockIds, blocks, null)
        } catch (e) {
          console.warn('[read aloud] directing failed', e)
          this.finish(key, s, call, part.blockIds, null, null)
        }
      }
    })()
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
