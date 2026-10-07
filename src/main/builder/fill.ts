// Fill in the gaps: characters, places, groups and items that were made with little in them get their empty
// fields filled by the AI from what the story and the world say about them. Two callers: the World builder's
// last step ("Filling in missing details"), and the memory keeper after it finds someone new in a scene's
// text (a character it makes has only a name, a line and perhaps pronouns).
//
// The rules (each tested in fill.test.ts):
// - Only empty fields are filled, and only when the entry is thin: its summary or description is empty, or a
//   third or more of its kind's fields are. A field with words in it (read from the text, typed by Adam or
//   drafted before) is never changed, and neither is its name or other names.
// - What is filled is the AI's (`origin 'ai'`, "Drafted by AI"), so the memory keeper replaces it when the
//   text says otherwise, and Adam's edits make it his.
// - The caller says which entries; entries Adam made himself are its to leave out.
// - Each entry is one request, recorded under the caller's job. A failed or unusable reply leaves that entry
//   as it was and the rest go on; nothing here throws once started.
// - The memory keeper's follow-on (`fromStory`, Adam 2026-10-07) fills in only what the story's words say, up to
//   where the entry was found: no world, no premise, no guessing. Each value comes with the words that show it, and
//   is kept only when those words are in the story and the value rests on them. Fields about the author's plans
//   (the arc, the role, lines of dialogue, what they never say) are never filled there. A field the words don't
//   fill stays empty; with no words about the entry, nothing is asked.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { BuilderKind, BuilderValues } from '@shared/contracts/builder'
import type { Entry, GenerationJob, ID, WritingPrefs } from '@shared/types'
import * as repo from '../db/repo'
import * as hist from '../db/history'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import type { MemoryModel } from '../keeper/model'
import { parseLenient } from '../keeper/json'
import { estimateTokens, findNearQuote, findQuote, plain, words } from '../keeper/text'
import { newId } from '../util'
import { gatherWorld } from './context'
import { entryText, fleshOutValues, profileKeys, toInput, valuesOf } from './profile'
import { fillFoundSystem, fillFoundUser, fillGapsSystem, fillGapsUser, styleText, worldText } from './prompts'
import { cleanValues, isBuilderKind } from './save'
import { paragraphsOfDoc } from '../readAloud/suggest'

type DB = Database.Database

/** The keys never filled: a name and other names are the story's (or Adam's) to give. */
const NEVER = new Set(['name', 'aliases'])

/**
 * Never filled from the story's words alone: the author's plans for the entry (its arc and role), and lines of
 * dialogue or what someone never says, which the memory keeper takes from the text as it is written.
 */
const NOT_FROM_STORY = new Set(['role', 'arcStart', 'arcEnd', 'sampleLines', 'neverSays'])

/** The most of the world and of the story's words one request carries, in tokens. */
export const FILL_WORLD_TOKENS = 1500
export const FILL_SAID_TOKENS = 1500

/**
 * The empty fields to fill on an entry, or none when it isn't thin enough to need it (or isn't a kind with
 * a profile): see the rules at the top.
 */
export function fillTargets(e: Entry): string[] {
  if (!isBuilderKind(e.kind)) return []
  const keys = profileKeys(e.kind).filter((k) => !NEVER.has(k))
  const empty = keys.filter((k) => !entryText(e, k).trim())
  const thin = !e.summary.trim() || !e.description.trim() || empty.length * 3 >= keys.length
  return thin ? empty : []
}

/** Room for the reply: about 70 tokens for each field asked for. */
export const fillReplyTokens = (targets: number): number => Math.min(4000, Math.max(600, 120 + targets * 70))

export interface FillOptions {
  db: DB
  model: JobModel
  /** The job the requests are recorded under ('world' for the World builder, 'memory' for the memory keeper). */
  job: GenerationJob
  prefs: WritingPrefs
  /** The story whose style guide applies; null for the world's own. */
  storyId: ID | null
  /** What the story (or the author's summary) says about the entry, word for word; '' when nothing is known. */
  saidAbout?: (e: Entry) => string
  /**
   * Only what `saidAbout` gives, each value resting on words from it (the memory keeper's follow-on); without it, the
   * AI may also choose what fits the world where the story says nothing (the World builder).
   */
  fromStory?: boolean
  /** True once the caller has stopped (Cancel, the world closing): nothing more is asked or written. */
  stopped?: () => boolean
  /** Told each request's task id as it starts (null when it ends), so the caller can stop it. */
  onTask?: (taskId: ID | null) => void
  /** Told each entry as soon as its fields are filled. */
  onFilled?: (entryId: ID) => void
  emit?: Emit
  onKeyRejected?: () => void
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export interface FillResult {
  /** The entries whose fields were filled. */
  filled: ID[]
  generationIds: ID[]
  /** USD; null when unknown. */
  cost: number | null
}

const quiet: Emit = () => undefined

/** Fills the gaps in these entries, one request each, in order. */
export async function fillGaps(o: FillOptions, entryIds: ID[]): Promise<FillResult> {
  const out: FillResult = { filled: [], generationIds: [], cost: null }
  for (const id of [...new Set(entryIds)]) {
    if (o.stopped?.() || !o.db.open) break
    try {
      if (await fillOne(o, id, out)) {
        out.filled.push(id)
        o.onFilled?.(id)
      }
    } catch (e) {
      console.warn('Could not fill in an entry', e)
    }
  }
  return out
}

/**
 * The memory keeper's follow-on: someone or something it just found in a scene's text (a name, a line, perhaps
 * pronouns) gets the empty fields that scene's words fill filled by the memory model, from the paragraphs of that
 * scene about it (`fromStory`: nothing guessed, nothing from later). Recorded under the 'memory' job. Never throws;
 * a failure leaves the fields empty.
 */
export async function fillFound(
  db: DB,
  entryIds: ID[],
  model: MemoryModel,
  o: Pick<FillOptions, 'prefs' | 'stopped' | 'fetchImpl' | 'retryDelays'>
): Promise<FillResult> {
  try {
    // Found in one scene, so in one story: its style guide applies.
    const storyId = repo.getEntries(db, entryIds)[0]?.originStoryId ?? null
    return await fillGaps(
      {
        db,
        // The memory model, run as a task; 'writer' only names the model in an error, which isn't shown.
        model: { job: 'writer', target: model.target, choice: model.choice, thinking: model.thinking ?? 'off' },
        job: 'memory',
        storyId,
        saidAbout: (e) => storySaid(db, e),
        fromStory: true,
        ...o
      },
      entryIds
    )
  } catch (e) {
    console.warn('Could not fill in what the memory found', e)
    return { filled: [], generationIds: [], cost: null }
  }
}

/** The entry, unless it has gone (deleted, or in Recently deleted). */
const liveEntry = (db: DB, id: ID): Entry | null => repo.getEntries(db, [id])[0] ?? null

async function fillOne(o: FillOptions, id: ID, out: FillResult): Promise<boolean> {
  const e = liveEntry(o.db, id)
  if (!e || !isBuilderKind(e.kind)) return false
  const targets = fillTargets(e).filter((k) => !o.fromStory || !NOT_FROM_STORY.has(k))
  if (!targets.length) return false
  const kind: BuilderKind = e.kind
  const said = clipTokens(o.saidAbout?.(e) ?? '', FILL_SAID_TOKENS)
  // From the story alone, with nothing in the story about it, there is nothing to fill in.
  if (o.fromStory && !said) return false
  const brief = gatherWorld(o.db, { kind, excludeId: e.id, storyId: o.storyId, prefs: o.prefs })
  const world = o.fromStory ? { text: '', entryIds: [] as ID[] } : worldText(brief, kind, FILL_WORLD_TOKENS)
  const versions = new Map([...brief.lore, ...brief.groups, ...brief.characters, ...brief.same].map((x) => [x.id, x.updatedAt]))
  const messages = o.fromStory
    ? [
        { role: 'system' as const, content: fillFoundSystem(kind) },
        { role: 'user' as const, content: fillFoundUser(kind, valuesOf(kind, e), targets, styleText(brief.style), said) }
      ]
    : [
        { role: 'system' as const, content: fillGapsSystem(kind) },
        { role: 'user' as const, content: fillGapsUser(kind, valuesOf(kind, e), targets, world.text, said) }
      ]
  const taskId = newId()
  o.onTask?.(taskId)
  let done
  try {
    done = await runTask({
      db: o.db,
      taskId,
      job: o.job,
      sceneId: null,
      model: o.model,
      messages,
      reply: o.fromStory ? foundReplyTokens(targets.length) : fillReplyTokens(targets.length),
      temperature: o.fromStory ? 0.2 : 0.7,
      direction: `Fill in the missing details of ${e.name}`,
      entries: world.entryIds.map((entryId) => ({ entryId, version: versions.get(entryId) ?? '' })),
      emit: o.emit ?? quiet,
      onKeyRejected: o.onKeyRejected,
      fetchImpl: o.fetchImpl,
      retryDelays: o.retryDelays
    })
  } finally {
    o.onTask?.(null)
  }
  out.generationIds.push(done.generationId)
  if (done.cost != null) out.cost = (out.cost ?? 0) + done.cost
  if (done.status !== 'complete' || o.stopped?.() || !o.db.open) return false
  const parsed = parseLenient(done.text)
  if (!parsed.ok) return false
  return saveFilled(o.db, id, o.fromStory ? storyValues(kind, parsed.value, targets, said) : fleshOutValues(kind, parsed.value, targets))
}

/** Room for a reply that gives the words with each value: about 110 tokens a field. */
export const foundReplyTokens = (targets: number): number => Math.min(4000, Math.max(600, 120 + targets * 110))

/** What a model writes for a field it has nothing for ("none", "unknown", "not stated"…): left empty instead. */
const NOTHING = /^(?:none|nothing|no one|nobody|unknown|not (?:stated|known|given|said|mentioned|described)|n\/?a|unspecified)[.!\s]*$/i

const SMALL = new Set(
  'a an the her his their its him them she he they it was were is are be been being has had have now then to of in on at by for with and or from but as not no so this that these those one'.split(
    ' '
  )
)

/** True when two words are the same word give or take an ending ("beads" and "bead", "plaited" and "plaits"). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const n = Math.max(4, Math.min(a.length, b.length) - 2)
  return a.length >= 4 && b.length >= 4 && a.slice(0, n) === b.slice(0, n)
}

/**
 * True when a value rests on the words given for it: at least half of what it says (its words that matter) is in
 * them. "a blue glass bead" rests on "sells glass beads. Blue ones."; "cool blue glass, faintly clouded at the core"
 * doesn't.
 */
export function restsOn(value: string, quote: string): boolean {
  const q = words(quote)
  const all = words(value)
  const said = all.filter((w) => !SMALL.has(w))
  const wanted = said.length ? said : all
  if (!wanted.length || !q.length) return false
  const found = wanted.filter((w) => q.some((x) => sameWord(w, x))).length
  return said.length ? found * 2 >= wanted.length : found > 0
}

/**
 * The values of a reply from the story alone ({"key": {"value": ..., "quote": ...}}), for the fields asked about:
 * only those whose words are in `said` and which rest on them. A bare value with no words, words the story doesn't
 * have, a value the words don't bear out, or "none" for a field that doesn't apply are all left out.
 */
export function storyValues(kind: BuilderKind, value: unknown, targets: string[], said: string): BuilderValues {
  const root = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  const out: BuilderValues = {}
  for (const key of targets) {
    const item = root[key]
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const v = (item as Record<string, unknown>).value
    const q = (item as Record<string, unknown>).quote
    if (typeof v !== 'string' || typeof q !== 'string') continue
    const text = v.trim()
    const shown = q.trim().replace(/^["“”'‘’]+|["“”'‘’]+$/g, '')
    if (!text || NOTHING.test(text) || !shown || !findNearQuote(said, shown)) continue
    if (restsOn(text, shown)) out[key] = text
  }
  return cleanValues(kind, out)
}

/**
 * Saves what the AI filled in, as the AI's: only fields that are still empty now (anything written meanwhile
 * stays), never a name. True when something was saved.
 */
export function saveFilled(db: DB, entryId: ID, values: BuilderValues): boolean {
  const e = liveEntry(db, entryId)
  if (!e || !isBuilderKind(e.kind)) return false
  const patch: BuilderValues = {}
  for (const [key, v] of Object.entries(cleanValues(e.kind, values))) {
    if (NEVER.has(key) || entryText(e, key).trim()) continue
    patch[key] = v
  }
  if (!Object.keys(patch).length) return false
  repo.updateEntry(db, entryId, toInput(e.kind, patch), { origin: 'ai' })
  return true
}

/** The words of a text, cut at a paragraph (else a word) once they pass `tokens`. */
function clipTokens(text: string, tokens: number): string {
  const t = text.trim()
  if (estimateTokens(t) <= tokens) return t
  const paras = t.split(/\n{2,}/)
  const kept: string[] = []
  for (const p of paras) {
    if (estimateTokens([...kept, p].join('\n\n')) > tokens) break
    kept.push(p)
  }
  if (kept.length) return kept.join('\n\n')
  return t.slice(0, tokens * 4).replace(/\s+\S*$/, '')
}

/**
 * What the scene an entry was found in says about it: its paragraphs that name the entry, and those holding the words
 * it was read from (a bead found in "sells glass beads. Blue ones." isn't named there), in order ('' for an entry not
 * found in a scene, or a scene that has gone).
 */
export function storySaid(db: DB, e: Pick<Entry, 'name' | 'aliases' | 'originSceneId'> & { id?: ID }): string {
  if (!e.originSceneId) return ''
  try {
    const paragraphs = paragraphsOfDoc(repo.getScene(db, e.originSceneId).doc)
    const named = new Set(paragraphsNaming(paragraphs.map((p) => p.text), e))
    const links = e.id ? hist.linksForEntry(db, e.id).filter((l) => l.sceneId === e.originSceneId && l.state === 'ok') : []
    const readFrom = (p: { pid: string; text: string }): boolean =>
      links.some((l) => (l.paragraphId ? l.paragraphId === p.pid : !!findQuote(p.text, l.quote)))
    return paragraphs
      .filter((p) => named.has(p.text) || readFrom(p))
      .map((p) => p.text)
      .join('\n\n')
  } catch {
    return ''
  }
}

/**
 * The paragraphs of a scene that name the entry (by its name or another name, as whole words), in order, for
 * the request: what the story says about someone the memory keeper found there.
 */
export function paragraphsNaming(paragraphs: string[], e: Pick<Entry, 'name' | 'aliases'>): string[] {
  const names = [e.name, ...e.aliases].map((n) => plain(n)).filter((n) => n.length > 1)
  if (!names.length) return []
  const escape = (n: string): string => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${names.map(escape).join('|')})(?=[^\\p{L}\\p{N}]|$)`, 'u')
  const named = (p: string): boolean => pattern.test(plain(p))
  return paragraphs.filter(named)
}
