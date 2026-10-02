// Applies a run to the memory: moves links to where their words are now, then the memory model's
// verdicts on facts whose words were edited, removes facts whose words were deleted, adds new facts,
// links names to entries (and entries first seen elsewhere), raises issues for clashes with Adam's
// facts, moves text entries whose last mention is gone to Trash, and writes the "What changed" lines.
// Every write passes { origin: 'text', runId } so the memory history records it. Rules (spec,
// Multi-story rules, "Source links and automatic upkeep"):
// - Adam's facts (origin 'adam', and fields Adam typed) are never changed or removed: a clash raises
//   an issue, and words changed under one of his facts get a question-marked line offering a refresh.
// - A text fact goes only when its last link is gone or no longer supports it.
// - AI-drafted fields are replaced when the text says otherwise.
// - Facts Adam undid are not added again from the same words (suppressions).
// The caller runs this inside one transaction. No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ChangeData, Entry, EntryKind, ID, Origin, SourceLink } from '@shared/types'
import type { SceneMemory, WorldShape } from '../memory/types'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import type { KeeperScene, NewLog } from '../db/keeper'
import { newId } from '../util'
import { bool, str, strList, type ReadingReply } from './json'
import { fieldKeys } from './prompts'
import type { Ids } from './request'
import { findMention, spotIn, type ReadPlan, type Spot } from './track'
import { existedEarlier } from './places'
import {
  changeContent,
  changeWords,
  factContent,
  factFingerprint,
  fieldLabel,
  fieldOrigin,
  fieldValue,
  fingerprint,
  kindWord,
  removedWords,
  type SceneFact
} from './facts'
import { findQuote, likeness, locateQuote, plain, sameFact, sceneParagraphs, type Para } from './text'

type DB = Database.Database

/** One chunk's reply, with the short ids its request used and the paragraphs it read. */
export interface ChunkReply {
  ids: Ids
  reply: ReadingReply
  paras: Para[]
}

/** Where a side story and its host both change the same thing (memory core's sideClashes). */
export type SideClashes = (sideStoryId: ID) => { entryId: ID; aspect: string; answer: 'host' | 'side' | null }[]

export interface ApplyContext {
  runId: ID
  /** What counts at this scene; null when it couldn't be worked out (then nothing counts as "elsewhere"). */
  memory: SceneMemory | null
  shape: WorldShape | null
  sideClashes: SideClashes | null
  /** The scene was deleted: every fact read from it loses those words, and the scene isn't marked read. */
  removed?: boolean
}

export interface ApplyResult {
  /** "What changed" lines written. */
  lines: number
  /** Entries whose memory changed. */
  entryIds: ID[]
  /** Entries this read made (found in the text for the first time). */
  newEntryIds?: ID[]
}

// ---------- What undoing a line needs (stored with the line) ----------

export type FieldUndo = { op: 'field-set'; entryId: ID; field: string; before: string; beforeOrigin: Origin | null; linkIds: ID[] }
export type Undo = (
  | { op: 'entry-added'; entryId: ID; changeIds?: ID[] }
  | { op: 'entry-trashed'; entryId: ID; changeIds: ID[] }
  | { op: 'change-added'; changeId: ID }
  | { op: 'change-updated'; changeId: ID; version: number; link: SourceLink | null }
  | { op: 'change-removed'; changeId: ID }
  | FieldUndo
  | { op: 'voice-added'; entryId: ID; line: string; linkId: ID }
  | { op: 'voice-removed'; entryId: ID; line: string }
  | {
      op: 'first-seen'
      key: string
      entryId: ID
      pointId: ID | null
      linkId: ID | null
      sceneId: ID
      storyId: ID
      sideStoryId: ID | null
      endAfterChapterId: ID | null
      /** Set while "Make a new one" is the answer. */
      newEntryId?: ID | null
      /** Set while "End the side story before this point" is the answer: how it ended before. */
      previousEnd?: { endAt: string | null; endRefId: ID | null } | null
    }
  | { op: 'which-last'; key: string }
  | {
      op: 'refresh'
      key: string
      fact: { kind: 'field'; entryId: ID; field: string } | { kind: 'change'; changeId: ID }
      /** What the scene's words now say: a new value or payload, or null when the words were deleted. */
      proposal: { value: string } | { change: ChangeData } | null
      spot: Spot | null
      linkIds: ID[]
      sceneVersion: number
      /** Set while "Use the scene's words" is the answer: the version to go back to. */
      version?: number | null
    }
  | {
      op: 'summary'
      level: 'scene' | 'chapter' | 'story' | 'series'
      targetId: ID
      /** The summary's version before this one (0: there was none). */
      version: number
      /** What it was made from, so an undone one isn't written again from the same sources. */
      sourceHash: string
      place: { storyId: ID | null; chapterId: ID | null }
    }
  | { op: 'summary-refresh'; key: string; sceneId: ID; version: number; refreshed?: boolean }
) & { fingerprint?: string; words?: string }

// ---------- Small helpers ----------

const KINDS: EntryKind[] = ['character', 'place', 'group', 'item', 'lore', 'glossary']
const KIND_WORDS: Record<string, EntryKind> = {
  person: 'character',
  people: 'character',
  creature: 'character',
  location: 'place',
  building: 'place',
  region: 'place',
  faction: 'group',
  organisation: 'group',
  organization: 'group',
  family: 'group',
  object: 'item',
  artifact: 'item',
  artefact: 'item',
  weapon: 'item',
  term: 'glossary',
  word: 'glossary',
  concept: 'lore',
  magic: 'lore',
  rule: 'lore',
  history: 'lore'
}

function kindOf(v: unknown): EntryKind | null {
  const k = str(v, 30).toLowerCase()
  if ((KINDS as string[]).includes(k)) return k as EntryKind
  return KIND_WORDS[k] ?? null
}

/** Field keys the keeper may set on an entry of this kind (sample lines come in as voice lines). */
const settable = (kind: EntryKind): string[] => [...fieldKeys(kind), 'summary', 'description']

function fieldKey(kind: EntryKind, v: unknown): string | null {
  const raw = str(v, 40)
  if (!raw) return null
  const keys = settable(kind)
  if (keys.includes(raw)) return raw
  const lower = raw.toLowerCase().replace(/[\s_-]+/g, '')
  return keys.find((k) => k.toLowerCase() === lower) ?? null
}

export const patchFor = (e: Entry, field: string, value: string): Parameters<typeof repo.updateEntry>[2] =>
  field === 'summary' ? { summary: value } : field === 'description' ? { description: value } : { fields: { ...e.fields, [field]: value } }

/** True when Adam typed this field's value himself (an empty field he never touched can still be filled). */
function adamField(e: Entry, field: string): boolean {
  if (e.fieldOrigins?.[field] === 'adam') return true
  return fieldOrigin(e, field) === 'adam' && fieldValue(e, field).trim() !== ''
}

export const sampleLines = (e: Entry): string[] =>
  (e.fields?.sampleLines ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

export const MAX_SAMPLE_LINES = 5
const MAX_INVOLVED = 6

/** The words in plain form, as a suppression stores them. */
const wordsOf = (s: string): string => plain(s)

// ---------- Applying ----------

class Run {
  readonly lines: NewLog[] = []
  readonly touched = new Set<ID>()
  /** Facts already in the scene, and those this run added: a new one like them is a duplicate. */
  private readonly created: { fp: string; content: string; changeId?: ID }[] = []
  private readonly suppressions: { fingerprint: string; words: string }[]
  private entries: Entry[]
  private readonly here: Set<ID> | null
  private readonly firstSeenDone = new Set<ID>()
  /** Entries this read made. */
  readonly madeHere = new Set<ID>()
  private readonly removedChangeEntries = new Set<ID>()
  private readonly adamDeleted = new Map<EntryKind, { id: ID; name: string; aliases: string[] }[]>()
  private earlier: ((entryId: ID) => boolean) | null | undefined
  /** Values offered for Adam's fields in this run's "Keep your words?" questions. */
  private readonly offered = new Set<string>()

  constructor(
    readonly db: DB,
    readonly ctx: ApplyContext,
    readonly plan: ReadPlan
  ) {
    this.suppressions = kdb.suppressionsInScene(db, plan.scene.sceneId)
    this.entries = repo.listEntries(db)
    this.here = ctx.memory ? new Set(ctx.memory.entries.map((e) => e.id)) : null
    // Facts already in the scene (any origin, including changes Adam pinned to it) count as there.
    for (const f of plan.found)
      this.created.push({ fp: factFingerprint(f), content: factContent(f), changeId: f.kind === 'change' ? f.change.id : undefined })
    for (const c of mem.changesInScene(db, plan.scene.sceneId)) {
      this.created.push({ fp: fingerprint({ type: 'change', entryId: c.entryId, change: c }), content: changeContent(c), changeId: c.id })
    }
  }

  get scene(): KeeperScene {
    return this.plan.scene
  }
  get by(): { origin: 'text'; runId: ID } {
    return { origin: 'text', runId: this.ctx.runId }
  }

  log(
    l: Omit<NewLog, 'runId' | 'sceneId' | 'question' | 'undo' | 'factId' | 'quote'> &
      Partial<Pick<NewLog, 'question' | 'factId' | 'quote'>> & { undo: Undo | null }
  ): void {
    this.lines.push({
      runId: this.ctx.runId,
      sceneId: this.scene.sceneId,
      question: null,
      factId: null,
      quote: '',
      ...l,
      undo: l.undo as Record<string, unknown> | null
    })
    if (l.entryId) this.touched.add(l.entryId)
  }

  suppressed(fp: string, words: string): boolean {
    const w = wordsOf(words)
    return this.suppressions.some((s) => s.fingerprint === fp && s.words === w)
  }

  /**
   * True when Adam himself deleted an entry of this kind and name that was read from the paragraph
   * at `s`, and the words it was read from are still there: it isn't made again from them (as after
   * an undo). New words, in another paragraph or scene, can make it again.
   */
  deletedByAdam(kind: EntryKind, name: string, s: Spot): boolean {
    const n = plain(name)
    // Without paragraph ids, the words are looked for anywhere in the scene.
    const texts = s.paragraphId
      ? this.plan.paras.filter((p) => p.pid === s.paragraphId).map((p) => p.text)
      : this.plan.paras.map((p) => p.text)
    if (!texts.length) return false
    if (!this.adamDeleted.has(kind)) this.adamDeleted.set(kind, kdb.entriesAdamDeleted(this.db, kind))
    for (const d of this.adamDeleted.get(kind)!) {
      if (plain(d.name) !== n && !d.aliases.some((a) => plain(a) === n)) continue
      const links = hist.linksForEntry(this.db, d.id).filter((l) => l.sceneId === this.scene.sceneId && l.paragraphId === s.paragraphId)
      if (links.some((l) => texts.some((t) => findQuote(t, l.quote)))) return true
    }
    return false
  }

  /** The fact already in the scene (or added by this run) that this one repeats, or null. */
  duplicate(fp: string, content: string): { changeId?: ID } | null {
    return this.created.find((x) => x.fp === fp && sameFact(x.content, content)) ?? null
  }

  /** A fact now in the scene (a change this run added, or one it updated: its old words no longer count). */
  remember(fp: string, content: string, changeId?: ID): void {
    if (changeId) for (let i = this.created.length - 1; i >= 0; i--) if (this.created[i].changeId === changeId) this.created.splice(i, 1)
    this.created.push({ fp, content, changeId })
  }

  /**
   * Words that say a text change of this scene again also support it, so it stays until the last
   * passage that says it goes. Nothing is added when its words in the same paragraph already do.
   */
  alsoSupports(changeId: ID, s: Spot): void {
    let c: Change
    try {
      c = mem.getChange(this.db, changeId)
    } catch {
      return
    }
    if (c.origin !== 'text' || c.sceneId !== this.scene.sceneId) return
    const links = hist.linksForFact(this.db, 'change', changeId).filter((l) => l.state === 'ok')
    if (links.some((l) => l.quote === s.quote || (s.paragraphId && l.paragraphId === s.paragraphId))) return
    this.addLink('change', changeId, null, s)
  }

  /** The exact words in the scene a quote stands for: in the chunk's paragraphs first, then anywhere. */
  place(quote: unknown, prefer: Para[]): Spot | null {
    const q = str(quote, 1200)
    if (!q) return null
    const order = [...prefer, ...this.plan.paras.filter((p) => !prefer.includes(p))]
    const bare = q
      .replace(/^["“”'‘’]+/, '')
      .replace(/["“”'‘’]+$/, '')
      .trim()
    for (const p of order) {
      const r = findQuote(p.text, q) ?? findQuote(p.text, bare)
      if (r) return spotIn(p, r)
    }
    let best: { p: Para; words: string; score: number } | null = null
    for (const p of order) {
      const words = locateQuote(p.text, q)
      if (!words) continue
      const score = likeness(q, words)
      if (!best || score > best.score) best = { p, words, score }
    }
    if (!best) return null
    const r = findQuote(best.p.text, best.words)
    return r ? spotIn(best.p, r) : null
  }

  addLink(factKind: SourceLink['factKind'], factId: ID, field: string | null, s: Spot): SourceLink {
    return hist.addLink(this.db, { factKind, factId, field, sceneId: this.scene.sceneId, sceneVersion: this.plan.version, ...s })
  }

  moveLink(l: SourceLink, s: Spot): void {
    hist.updateLink(this.db, l.id, { ...s, sceneVersion: this.plan.version, state: 'ok' })
  }

  entry(id: ID): Entry | null {
    return repo.getEntries(this.db, [id])[0] ?? null
  }

  /** An entry by name or other name: one that exists here first, then any. */
  byName(name: string, kind?: EntryKind): Entry | null {
    const n = plain(name)
    if (!n) return null
    const matches = this.entries.filter((e) => (!kind || e.kind === kind) && (plain(e.name) === n || e.aliases.some((a) => plain(a) === n)))
    return matches.find((e) => !this.here || this.here.has(e.id) || this.madeHere.has(e.id)) ?? matches[0] ?? null
  }

  /** The entry a reply refers to: a short id (E1, or N1 for one added in the same reply), or a name. */
  resolve(v: unknown, ids: Ids, refs: Map<string, ID>): Entry | null {
    const s = str(v, 120)
    if (!s) return null
    const key = s.toUpperCase()
    const id = ids.entries.get(key) ?? refs.get(key)
    if (id) return this.entry(id)
    return this.byName(s)
  }

  entryMade(e: Entry): void {
    this.entries.push(e)
    this.madeHere.add(e.id)
  }

  /** Who "where" points at in this scene's story, for side-story questions. */
  private story(id: ID | null | undefined): WorldShape['stories'][number] | null {
    return (id && this.ctx.shape?.stories.find((s) => s.id === id)) || null
  }

  /**
   * An entry the scene refers to must exist here. If it doesn't exist at this point yet (it is from
   * a later scene, or another story), this scene becomes a first-exists point for it, with a
   * question-marked line offering the alternatives. False when Adam undid that from these words.
   */
  ensureHere(e: Entry, s: Spot): boolean {
    if (!this.here || this.here.has(e.id) || this.madeHere.has(e.id) || this.firstSeenDone.has(e.id)) return true
    const fp = fingerprint({ type: 'link', entryId: e.id })
    if (this.suppressed(fp, s.quote)) return false
    this.firstSeenDone.add(e.id)
    const point = mem.addExistsPoint(this.db, {
      entryId: e.id,
      kind: 'scene',
      storyId: this.scene.storyId,
      sceneId: this.scene.sceneId,
      byHand: false
    })
    const link = e.origin === 'text' ? this.addLink('entry', e.id, null, s) : null
    // "End [side story] before this point": only when the entry comes from a side story of this book.
    const story = this.story(this.scene.storyId)
    const sides = this.ctx.shape?.stories.filter((x) => x.kind === 'side' && x.startStoryId === this.scene.storyId) ?? []
    const points = mem.listExistsPoints(this.db, e.id)
    const side = sides.find((x) => e.originStoryId === x.id || points.some((p) => p.storyId === x.id)) ?? null
    const chapters = story?.chapters ?? []
    const at = chapters.findIndex((c) => c.id === this.scene.chapterId)
    const endAfter = side && at > 0 ? chapters[at - 1].id : null
    const label = this.ctx.memory?.elsewhere.find((x) => x.entry.id === e.id)?.label ?? 'not in the story yet at this point'
    const options = [
      { id: 'link', label: 'Yes, the same one' },
      ...(side && endAfter ? [{ id: 'end-side', label: `End ${side.title.trim() || 'the side story'} before this point` }] : []),
      { id: 'new', label: `Make a new ${kindWord(e.kind)}` }
    ]
    this.log({
      action: 'added',
      what: 'entry',
      entryId: e.id,
      entryName: e.name,
      text: `Linked to the ${kindWord(e.kind)} already in the world (${label})`,
      before: '',
      after: '',
      quote: s.quote,
      question: { text: 'Is this the same one?', options, answer: 'link' },
      undo: {
        op: 'first-seen',
        key: `first-seen:${this.scene.sceneId}:${e.id}`,
        entryId: e.id,
        pointId: point.id,
        linkId: link?.id ?? null,
        sceneId: this.scene.sceneId,
        storyId: this.scene.storyId,
        sideStoryId: side && endAfter ? side.id : null,
        endAfterChapterId: endAfter,
        fingerprint: fp,
        words: wordsOf(s.quote)
      }
    })
    return true
  }

  /**
   * True when a detail about this entry, read here, must count only in this scene's story: the story
   * is an own version of events or a prequel (or follows on from one), whose events reach no other
   * story, and the entry isn't one of its own. Writing such a detail on the entry's page would show
   * it in every story.
   */
  keepsToItsStory(e: Entry): boolean {
    if (e.originStoryId === this.scene.storyId || this.madeHere.has(e.id)) return false
    const byId = new Map((this.ctx.shape?.stories ?? []).map((s) => [s.id, s]))
    const seen = new Set<ID>()
    for (
      let cur = byId.get(this.scene.storyId);
      cur && !seen.has(cur.id);
      cur = cur.startStoryId ? byId.get(cur.startStoryId) : undefined
    ) {
      seen.add(cur.id)
      if (cur.kind === 'own' || cur.kind === 'prequel') return true
    }
    return false
  }

  /**
   * True when a detail about this entry, read here, is news from this scene on rather than part of
   * who it is from the start: the entry already existed at an earlier scene on this scene's line, and
   * wasn't first read in this scene. Written on the entry, it would show when drafting those earlier
   * scenes.
   */
  laterDetail(e: Entry): boolean {
    if (this.madeHere.has(e.id) || e.originSceneId === this.scene.sceneId) return false
    if (this.earlier === undefined) this.earlier = existedEarlier(this.db, this.ctx.shape, this.scene.sceneId)
    return this.earlier?.(e.id) ?? false
  }

  /** Notes a value offered for one of Adam's fields, so the same words don't raise an issue as well. */
  offer(entryId: ID, field: string, value: string): void {
    this.offered.add(`${entryId}|${field}|${plain(value)}`)
  }
  wasOffered(entryId: ID, field: string, value: string): boolean {
    return this.offered.has(`${entryId}|${field}|${plain(value)}`)
  }

  /** The entry as it is at this scene (with the changes that count here), or null. */
  stateHere(id: ID): Entry | null {
    return this.ctx.memory?.entries.find((x) => x.id === id) ?? null
  }

  noteRemovedChange(entryId: ID): void {
    this.removedChangeEntries.add(entryId)
  }
  get removedChanges(): Set<ID> {
    return this.removedChangeEntries
  }
}

/** Plain words for an aspect a side story and its host both change. */
function aspectWords(run: Run, entry: Entry, aspect: string): string {
  if (aspect === 'thread') return 'The plot thread'
  if (aspect.startsWith('rel:')) return `How things stand with ${run.entry(aspect.slice(4))?.name ?? 'someone'}`
  return fieldLabel(entry, aspect)
}

/** A changed fact's new payload from a verdict, or null when the verdict says nothing usable. */
function updatedPayload(
  c: Change,
  v: Record<string, unknown>,
  run: Run,
  ids: Ids,
  refs: Map<string, ID>,
  kind: EntryKind
): ChangeData | null {
  switch (c.kind) {
    case 'update': {
      const fields: Record<string, string> = {}
      const given = (v.fields && typeof v.fields === 'object' ? v.fields : {}) as Record<string, unknown>
      for (const [k, val] of Object.entries(given)) {
        const key = fieldKey(kind, k)
        if (key && key !== 'summary' && key !== 'description' && str(val)) fields[key] = str(val)
      }
      const note = str(v.note, 200) || c.payload.note
      if (!note && !Object.keys(fields).length) return null
      return { kind: 'update', payload: { ...c.payload, note, fields: Object.keys(fields).length ? fields : c.payload.fields } }
    }
    case 'relationship': {
      const other = v.other ? run.resolve(v.other, ids, refs) : null
      return {
        kind: 'relationship',
        payload: {
          otherId: other?.id ?? c.payload.otherId,
          type: str(v.rel, 80) || c.payload.type,
          feels: str(v.feels, 200) || c.payload.feels,
          otherFeels: str(v.otherFeels, 200) || c.payload.otherFeels,
          ended: v.ended !== undefined ? bool(v.ended) : c.payload.ended
        }
      }
    }
    case 'knowledge': {
      const fact = str(v.fact, 300)
      return {
        kind: 'knowledge',
        payload: { ...c.payload, fact: fact || c.payload.fact, forgets: v.forgets !== undefined ? bool(v.forgets) : c.payload.forgets }
      }
    }
    case 'thread': {
      const status = str(v.status, 20) === 'resolved' ? 'resolved' : str(v.status, 20) === 'open' ? 'open' : c.payload.status
      return { kind: 'thread', payload: { status, note: str(v.note, 300) || c.payload.note } }
    }
    case 'full':
      return null
  }
}

export const changeInput = (c: Change, data: ChangeData): Parameters<typeof mem.replaceChange>[2] =>
  ({ ...data, entryId: c.entryId, anchor: c.anchor, storyId: c.storyId, sceneId: c.sceneId }) as Parameters<typeof mem.replaceChange>[2]

// ---------- Verdicts on facts whose words changed, and facts whose words were deleted ----------

function linksHere(f: SceneFact, run: Run): SourceLink[] {
  return f.links.filter((l) => l.sceneId === run.scene.sceneId)
}

/**
 * The fact as it is now, or null when it is gone. The plan was made before the memory model was
 * asked, and Adam may have edited (made his own) or removed the fact meanwhile; an earlier step of
 * this run may also have changed the same entry. Every write starts from this, never from the plan.
 */
function freshFact(run: Run, f: SceneFact): SceneFact | null {
  if (f.kind === 'change') {
    let change: Change
    try {
      change = mem.getChange(run.db, f.change.id)
    } catch {
      return null
    }
    const entry = run.entry(change.entryId)
    return entry ? { ...f, change, entry, origin: change.origin } : null
  }
  const entry = run.entry(f.entry.id)
  if (!entry) return null
  if (f.kind === 'field') return { ...f, entry, origin: fieldOrigin(entry, f.field) }
  if (f.kind === 'voice') return { ...f, entry, origin: fieldOrigin(entry, 'sampleLines') }
  return { ...f, entry, origin: entry.origin }
}

/** Adam's fact lost its words: keep it, and offer to refresh it from the scene (once per set of words). */
function askRefresh(run: Run, f: SceneFact, proposal: Extract<Undo, { op: 'refresh' }>['proposal'], s: Spot | null): void {
  if (f.kind !== 'field' && f.kind !== 'change') return
  // The scene's new words are this question's offer: they aren't added as a second fact, or raised as an issue, too.
  if (f.kind === 'change' && proposal && 'change' in proposal) {
    run.remember(fingerprint({ type: 'change', entryId: f.change.entryId, change: proposal.change }), changeContent(proposal.change))
  }
  if (f.kind === 'field' && proposal && 'value' in proposal) run.offer(f.entry.id, f.field, proposal.value)
  const key = `refresh:${f.key}:${s ? wordsOf(s.quote) : 'gone'}`
  if (kdb.questionAsked(run.db, key)) return
  const entry = f.entry
  const current = f.kind === 'field' ? fieldValue(entry, f.field) : changeWords(f.change, (id) => run.entry(id)?.name ?? 'someone')
  const next =
    proposal && 'value' in proposal
      ? proposal.value
      : proposal && 'change' in proposal
        ? changeWords(proposal.change, (id) => run.entry(id)?.name ?? 'someone')
        : ''
  const label = f.kind === 'field' ? fieldLabel(entry, f.field) : current
  run.log({
    action: 'updated',
    what: f.kind === 'field' ? 'entry' : 'change',
    entryId: entry.id,
    factId: f.kind === 'change' ? f.change.id : null,
    entryName: entry.name,
    text: proposal
      ? `${label}: your words are kept, but the scene now says otherwise`
      : `${label}: your words are kept, but the scene's words for it were deleted`,
    before: proposal ? current : '',
    after: next,
    quote: s?.quote ?? f.links[0]?.quote ?? '',
    question: {
      text: 'Keep your words?',
      options: [
        { id: 'keep', label: 'Keep mine' },
        { id: 'refresh', label: proposal ? 'Use the scene’s words' : 'Remove it' }
      ],
      answer: 'keep'
    },
    undo: {
      op: 'refresh',
      key,
      fact: f.kind === 'field' ? { kind: 'field', entryId: entry.id, field: f.field } : { kind: 'change', changeId: f.change.id },
      proposal,
      spot: s,
      linkIds: linksHere(f, run).map((l) => l.id),
      sceneVersion: run.plan.version
    }
  })
}

/** Removes a text (or AI-drafted) fact whose words are gone or no longer say it. */
function removeFact(run: Run, planned: SceneFact, why: string): void {
  const db = run.db
  const f = freshFact(run, planned)
  if (!f) return
  if (f.origin === 'adam') return askRefresh(run, f, null, null)
  const quote = f.links[0]?.quote ?? ''
  const nameOf = (id: ID): string => run.entry(id)?.name ?? 'someone'
  switch (f.kind) {
    case 'change': {
      mem.deleteChange(db, f.change.id, run.by)
      run.noteRemovedChange(f.change.entryId)
      run.log({
        action: 'removed',
        what: 'change',
        entryId: f.entry.id,
        factId: f.change.id,
        entryName: f.entry.name,
        text: `${removedWords(f.change, nameOf)}: ${why}`,
        before: changeWords(f.change, nameOf),
        after: '',
        quote,
        undo: { op: 'change-removed', changeId: f.change.id }
      })
      return
    }
    case 'field': {
      const before = fieldValue(f.entry, f.field)
      if (!before.trim()) return
      repo.updateEntry(db, f.entry.id, patchFor(f.entry, f.field, ''), run.by)
      run.log({
        action: 'removed',
        what: 'entry',
        entryId: f.entry.id,
        entryName: f.entry.name,
        text: `${fieldLabel(f.entry, f.field)}: ${why}`,
        before,
        after: '',
        quote,
        undo: {
          op: 'field-set',
          entryId: f.entry.id,
          field: f.field,
          before,
          beforeOrigin: f.entry.fieldOrigins?.[f.field] ?? null,
          linkIds: []
        }
      })
      return
    }
    case 'voice': {
      const e = run.entry(f.entry.id)
      if (!e || adamField(e, 'sampleLines')) return
      const lines = sampleLines(e)
      const keep = lines.filter((l) => plain(l) !== plain(f.line))
      if (keep.length === lines.length) return
      repo.updateEntry(db, e.id, { fields: { ...e.fields, sampleLines: keep.join('\n') } }, run.by)
      run.log({
        action: 'removed',
        what: 'entry',
        entryId: e.id,
        entryName: e.name,
        text: `Sample line removed: ${why}`,
        before: f.line,
        after: '',
        quote: f.line,
        undo: { op: 'voice-removed', entryId: e.id, line: f.line }
      })
      return
    }
    case 'entry':
      return
  }
}

function applyVerdict(run: Run, planned: SceneFact, v: Record<string, unknown>, chunk: ChunkReply, refs: Map<string, ID>): void {
  const verdict = str(v.do ?? v.verdict ?? v.action, 20).toLowerCase()
  const db = run.db
  const f = freshFact(run, planned)
  if (!f) return
  const links = linksHere(f, run)
  if (verdict === 'remove' || verdict === 'delete') return removeFact(run, f, 'the scene no longer says this')
  const s = run.place(v.quote, chunk.paras)
  if (verdict === 'keep' || !verdict) {
    if (s && links[0]) run.moveLink(links[0], s)
    return
  }
  if (verdict !== 'update' && verdict !== 'change') return
  if (!s) return // no words to rest it on: leave it as it is, its link marked changed
  const nameOf = (id: ID): string => run.entry(id)?.name ?? 'someone'
  if (f.kind === 'field') {
    const value = str(v.value ?? v.after, 400)
    if (!value) return removeFact(run, f, 'the scene no longer says this')
    const e = run.entry(f.entry.id)
    if (!e) return
    if (adamField(e, f.field)) return askRefresh(run, f, { value }, s)
    const fp = fingerprint({ type: 'field', entryId: e.id, field: f.field })
    if (run.suppressed(fp, s.quote)) return
    const before = fieldValue(e, f.field)
    if (plain(before) !== plain(value)) repo.updateEntry(db, e.id, patchFor(e, f.field, value), run.by)
    if (links[0]) run.moveLink(links[0], s)
    if (plain(before) === plain(value)) return
    run.log({
      action: 'updated',
      what: 'entry',
      entryId: e.id,
      entryName: e.name,
      text: fieldLabel(e, f.field),
      before,
      after: value,
      quote: s.quote,
      undo: {
        op: 'field-set',
        entryId: e.id,
        field: f.field,
        before,
        beforeOrigin: e.fieldOrigins?.[f.field] ?? null,
        linkIds: [],
        fingerprint: fp,
        words: wordsOf(s.quote)
      }
    })
    return
  }
  if (f.kind !== 'change') return
  const c = f.change
  const data = updatedPayload(c, v, run, chunk.ids, refs, f.entry.kind)
  if (!data) return
  if (f.origin === 'adam') return askRefresh(run, f, { change: data }, s)
  const fp = fingerprint({ type: 'change', entryId: c.entryId, change: data })
  if (run.suppressed(fp, s.quote)) return
  const same = JSON.stringify(data.payload) === JSON.stringify(c.payload)
  const linkBefore = links[0] ?? null
  if (linkBefore) run.moveLink(linkBefore, s)
  if (same) return
  const version = kdb.latestVersion(db, 'change', c.id)
  mem.replaceChange(db, c.id, { ...changeInput(c, data), origin: 'text', runId: run.ctx.runId })
  run.remember(fp, changeContent(data), c.id)
  run.log({
    action: 'updated',
    what: 'change',
    entryId: f.entry.id,
    factId: c.id,
    entryName: f.entry.name,
    text: changeWords(data, nameOf),
    before: changeWords(c, nameOf),
    after: '',
    quote: s.quote,
    undo: { op: 'change-updated', changeId: c.id, version, link: linkBefore, fingerprint: fp, words: wordsOf(s.quote) }
  })
}

// ---------- New facts ----------

function addEntry(run: Run, a: Record<string, unknown>, chunk: ChunkReply, refs: Map<string, ID>): void {
  const name = str(a.name, 120)
  const kind = kindOf(a.kind)
  if (!name || !kind) return
  const s = run.place(a.quote, chunk.paras) ?? findMention([name], chunk.paras)
  if (!s) return
  const ref = str(a.ref, 10).toUpperCase()
  // Never a duplicate: a name already in the world is that entry (first seen elsewhere if need be).
  const existing =
    run.byName(name, kind) ??
    run.byName(name) ??
    strList(a.aliases)
      .map((x) => run.byName(x, kind))
      .find(Boolean) ??
    null
  if (existing) {
    if (!run.ensureHere(existing, s)) return
    if (ref) refs.set(ref, existing.id)
    if (
      existing.origin === 'text' &&
      !hist.linksForEntry(run.db, existing.id).some((l) => l.factKind === 'entry' && l.sceneId === run.scene.sceneId && l.state === 'ok')
    ) {
      run.addLink('entry', existing.id, null, s)
    }
    return
  }
  const fp = fingerprint({ type: 'entry', kind, name })
  if (run.suppressed(fp, s.quote) || run.deletedByAdam(kind, name, s)) return
  const fields: Record<string, string> = {}
  const given = (a.fields && typeof a.fields === 'object' ? a.fields : {}) as Record<string, unknown>
  for (const [k, v] of Object.entries(given)) {
    const key = fieldKey(kind, k)
    if (key && key !== 'summary' && key !== 'description' && str(v)) fields[key] = str(v)
  }
  const aliases = strList(a.aliases).filter((x) => plain(x) !== plain(name))
  const e = repo.createEntry(
    run.db,
    kind,
    { name, aliases, summary: str(a.summary, 300), fields },
    { origin: 'text', originStoryId: run.scene.storyId, originSceneId: run.scene.sceneId, runId: run.ctx.runId }
  )
  run.entryMade(e)
  if (ref) refs.set(ref, e.id)
  run.addLink('entry', e.id, null, s)
  for (const key of Object.keys(fields)) run.addLink('field', e.id, key, s)
  run.log({
    action: 'added',
    what: 'entry',
    entryId: e.id,
    entryName: e.name,
    text: `New ${kindWord(kind)}`,
    before: '',
    after: e.summary,
    quote: s.quote,
    undo: { op: 'entry-added', entryId: e.id, fingerprint: fp, words: wordsOf(s.quote) }
  })
}

/** Adds a change pinned to this scene, with its link, unless it is already there or Adam undid it from these words. */
function addChange(run: Run, entry: Entry, data: ChangeData, s: Spot, text?: string): Change | null {
  const fp = fingerprint({ type: 'change', entryId: entry.id, change: data })
  if (run.suppressed(fp, s.quote)) return null
  const same = run.duplicate(fp, changeContent(data))
  if (same) {
    if (same.changeId) run.alsoSupports(same.changeId, s)
    return null
  }
  const c = mem.insertChange(run.db, {
    ...data,
    entryId: entry.id,
    anchor: 'scene',
    sceneId: run.scene.sceneId,
    origin: 'text',
    runId: run.ctx.runId
  })
  run.addLink('change', c.id, null, s)
  run.remember(fp, changeContent(data), c.id)
  const nameOf = (id: ID): string => run.entry(id)?.name ?? 'someone'
  run.log({
    action: 'added',
    what: 'change',
    entryId: entry.id,
    factId: c.id,
    entryName: entry.name,
    text: text ?? changeWords(data, nameOf),
    before: '',
    after: '',
    quote: s.quote,
    undo: { op: 'change-added', changeId: c.id, fingerprint: fp, words: wordsOf(s.quote) }
  })
  return c
}

function addDetail(run: Run, e: Entry, field: string, value: string, s: Spot): void {
  const db = run.db
  const fp = fingerprint({ type: 'field', entryId: e.id, field })
  const before = fieldValue(e, field)
  if (plain(before) === plain(value)) {
    // The same detail again: these words support it too.
    if (
      fieldOrigin(e, field) !== 'adam' &&
      !hist
        .linksForEntry(db, e.id)
        .some((l) => l.factKind === 'field' && l.field === field && l.sceneId === run.scene.sceneId && l.state === 'ok')
    ) {
      run.addLink('field', e.id, field, s)
    }
    return
  }
  if (run.suppressed(fp, s.quote)) return
  if (adamField(e, field)) {
    if (!run.wasOffered(e.id, field, value)) clash(run, e, field, before, value, s)
    return
  }
  if (before.trim() && fieldOrigin(e, field) === 'text') {
    // Words elsewhere still say the old value: that is a clash between scenes, not a change.
    const support = hist.linksForEntry(db, e.id).filter((l) => l.factKind === 'field' && l.field === field && l.state === 'ok')
    if (support.some((l) => l.sceneId !== run.scene.sceneId)) return clash(run, e, field, before, value, s)
  }
  // An own version of events or a prequel (no other story sees it), or an entry that was already
  // there in earlier scenes (drafting those doesn't see it): the detail is a change in this scene.
  // An AI-drafted value on the entry gives way to the text instead.
  const aiValue = !!before.trim() && fieldOrigin(e, field) === 'ai'
  if (run.keepsToItsStory(e) || (run.laterDetail(e) && !aiValue)) return pinDetail(run, e, field, value, before, s)
  repo.updateEntry(db, e.id, patchFor(e, field, value), run.by)
  const link = run.addLink('field', e.id, field, s)
  run.log({
    action: before.trim() ? 'updated' : 'added',
    what: 'entry',
    entryId: e.id,
    entryName: e.name,
    text: before.trim() ? fieldLabel(e, field) : `${fieldLabel(e, field)}: ${value}`,
    before,
    after: before.trim() ? value : '',
    quote: s.quote,
    undo: {
      op: 'field-set',
      entryId: e.id,
      field,
      before,
      beforeOrigin: e.fieldOrigins?.[field] ?? null,
      linkIds: [link.id],
      fingerprint: fp,
      words: wordsOf(s.quote)
    }
  })
}

/**
 * A detail that counts from this scene on: a change pinned here, not written on the entry. When the
 * memory here already says something else because of an earlier scene's change, the text
 * contradicts it, and an issue is raised instead.
 */
function pinDetail(run: Run, e: Entry, field: string, value: string, before: string, s: Spot): void {
  const here = run.stateHere(e.id)
  const now = here ? fieldValue(here, field) : before
  if (plain(now) === plain(value)) return
  if (now.trim() && plain(now) !== plain(before)) return raiseClash(run, e, field, now, value, s)
  const data: ChangeData =
    field === 'summary' || field === 'description'
      ? { kind: 'update', payload: { note: '', [field]: value } }
      : { kind: 'update', payload: { note: '', fields: { [field]: value } } }
  addChange(run, e, data, s, `${fieldLabel(e, field)}: ${value}`)
}

/** The text disagrees with the memory: AI-drafted fields give way; Adam's facts (and other scenes' words) raise an issue. */
function clash(run: Run, e: Entry, field: string | null, memory: string, text: string, s: Spot): void {
  if (field && fieldOrigin(e, field) === 'ai' && e.fieldOrigins?.[field] !== 'adam' && text) {
    const updated = run.entry(e.id)
    if (updated) addDetail(run, updated, field, text, s)
    return
  }
  raiseClash(run, e, field, memory, text, s)
}

function raiseClash(run: Run, e: Entry, field: string | null, memory: string, text: string, s: Spot): void {
  const about = field ? fieldLabel(e, field).toLowerCase() : 'this'
  kdb.raiseIssue(run.db, {
    sceneId: run.scene.sceneId,
    storyId: run.scene.storyId,
    kind: 'fact',
    severity: 'warning',
    quote: s.quote,
    message: memory
      ? `${field ? `${e.name}’s ${about}` : e.name}: this scene says “${text}”, but the memory says “${memory}”.`
      : `${field ? `${e.name}’s ${about}` : e.name}: this scene says “${text}”, which doesn't match the memory.`,
    key: `clash:${e.id}:${field ?? 'other'}:${plain(text)}`,
    payload: { entryId: e.id, field, memory, text }
  })
}

function applyAdd(run: Run, a: Record<string, unknown>, chunk: ChunkReply, refs: Map<string, ID>): void {
  const type = str(a.type, 20).toLowerCase()
  if (type === 'entry') return addEntry(run, a, chunk, refs)
  const s = run.place(a.quote, chunk.paras)
  if (!s) return
  const db = run.db
  if (type === 'event') {
    const name = str(a.name, 160)
    if (!name) return
    const existing = run.byName(name, 'event')
    if (existing) {
      run.ensureHere(existing, s)
      return
    }
    const fp = fingerprint({ type: 'event', name })
    if (run.suppressed(fp, s.quote) || run.deletedByAdam('event', name, s)) return
    const e = repo.createEntry(
      db,
      'event',
      { name, summary: str(a.summary, 300) },
      { origin: 'text', originStoryId: run.scene.storyId, originSceneId: run.scene.sceneId, runId: run.ctx.runId }
    )
    run.entryMade(e)
    run.addLink('entry', e.id, null, s)
    const involved: ID[] = []
    for (const who of strList(a.involved, MAX_INVOLVED)) {
      const other = run.resolve(who, chunk.ids, refs)
      if (!other || other.id === e.id || !run.ensureHere(other, s)) continue
      const c = mem.insertChange(db, {
        kind: 'relationship',
        payload: { otherId: e.id, type: 'involved in', feels: '', otherFeels: '' },
        entryId: other.id,
        anchor: 'scene',
        sceneId: run.scene.sceneId,
        origin: 'text',
        runId: run.ctx.runId
      })
      run.addLink('change', c.id, null, s)
      involved.push(c.id)
      run.touched.add(other.id)
    }
    run.log({
      action: 'added',
      what: 'entry',
      entryId: e.id,
      entryName: e.name,
      text: 'New event',
      before: '',
      after: e.summary,
      quote: s.quote,
      undo: { op: 'entry-added', entryId: e.id, changeIds: involved, fingerprint: fp, words: wordsOf(s.quote) }
    })
    return
  }
  if (type === 'thread') {
    let thread = a.entry ? run.resolve(a.entry, chunk.ids, refs) : null
    if (thread && thread.kind !== 'thread') thread = null
    const name = str(a.name, 200)
    if (!thread && name) thread = run.byName(name, 'thread')
    if (!thread) {
      if (!name) return
      const fp = fingerprint({ type: 'entry', kind: 'thread', name })
      if (run.suppressed(fp, s.quote) || run.deletedByAdam('thread', name, s)) return
      thread = repo.createEntry(
        db,
        'thread',
        { name, summary: str(a.note, 300) },
        { origin: 'text', originStoryId: run.scene.storyId, originSceneId: run.scene.sceneId, runId: run.ctx.runId }
      )
      run.entryMade(thread)
      run.addLink('entry', thread.id, null, s)
      run.log({
        action: 'added',
        what: 'entry',
        entryId: thread.id,
        entryName: thread.name,
        text: 'New plot thread',
        before: '',
        after: thread.summary,
        quote: s.quote,
        undo: { op: 'entry-added', entryId: thread.id, fingerprint: fp, words: wordsOf(s.quote) }
      })
    } else if (!run.ensureHere(thread, s)) return
    const status = str(a.status, 20) === 'resolved' ? 'resolved' : 'open'
    addChange(run, thread, { kind: 'thread', payload: { status, note: str(a.note, 300) } }, s)
    return
  }
  const entry = run.resolve(a.entry, chunk.ids, refs)
  if (!entry || !run.ensureHere(entry, s)) return
  switch (type) {
    case 'change': {
      const fields: Record<string, string> = {}
      const given = (a.fields && typeof a.fields === 'object' ? a.fields : {}) as Record<string, unknown>
      for (const [k, v] of Object.entries(given)) {
        const key = fieldKey(entry.kind, k)
        if (key && key !== 'summary' && key !== 'description' && str(v)) fields[key] = str(v)
      }
      const note = str(a.note, 200)
      if (!note && !Object.keys(fields).length) return
      addChange(run, entry, { kind: 'update', payload: { note, ...(Object.keys(fields).length ? { fields } : {}) } }, s)
      return
    }
    case 'detail': {
      const field = fieldKey(entry.kind, a.field)
      const value = str(a.value, 400)
      if (!field || !value) return
      addDetail(run, run.entry(entry.id) ?? entry, field, value, s)
      return
    }
    case 'relationship': {
      const other = run.resolve(a.other, chunk.ids, refs)
      if (!other || other.id === entry.id || !run.ensureHere(other, s)) return
      addChange(
        run,
        entry,
        {
          kind: 'relationship',
          payload: {
            otherId: other.id,
            type: str(a.rel ?? a.type, 80) || 'linked',
            feels: str(a.feels, 200),
            otherFeels: str(a.otherFeels, 200),
            ended: bool(a.ended)
          }
        },
        s
      )
      run.touched.add(other.id)
      return
    }
    case 'knows': {
      const fact = str(a.fact, 300)
      if (!fact) return
      const k = str(a.factId, 10).toUpperCase()
      const factId = chunk.ids.known.get(k) ?? mem.listFacts(db).find((x) => plain(x.fact) === plain(fact))?.factId ?? newId()
      addChange(run, entry, { kind: 'knowledge', payload: { factId, fact, forgets: bool(a.forgets) } }, s)
      return
    }
    case 'voice': {
      const e = run.entry(entry.id)
      if (!e || e.kind !== 'character' || adamField(e, 'sampleLines')) return
      const line = s.quote.trim()
      // Like a detail: a line from a later scene (or a what-if) counts from this scene on.
      const pinned = run.keepsToItsStory(e) || run.laterDetail(e)
      const lines = sampleLines(pinned ? (run.stateHere(e.id) ?? e) : e)
      if (lines.length >= MAX_SAMPLE_LINES || lines.some((l) => plain(l) === plain(line))) return
      const fp = fingerprint({ type: 'voice', entryId: e.id })
      if (run.suppressed(fp, line)) return
      if (pinned) {
        addChange(
          run,
          e,
          { kind: 'update', payload: { note: '', fields: { sampleLines: [...lines, line].join('\n') } } },
          s,
          'New sample line'
        )
        return
      }
      repo.updateEntry(db, e.id, { fields: { ...e.fields, sampleLines: [...lines, line].join('\n') } }, run.by)
      const link = run.addLink('voice', e.id, 'sampleLines', s)
      run.log({
        action: 'added',
        what: 'entry',
        entryId: e.id,
        entryName: e.name,
        text: 'New sample line',
        before: '',
        after: '',
        quote: line,
        undo: { op: 'voice-added', entryId: e.id, line, linkId: link.id, fingerprint: fp, words: wordsOf(line) }
      })
      return
    }
  }
}

function applyClash(run: Run, c: Record<string, unknown>, chunk: ChunkReply, refs: Map<string, ID>): void {
  const e = run.resolve(c.entry, chunk.ids, refs)
  const s = run.place(c.quote, chunk.paras)
  const text = str(c.text, 300)
  if (!e || !s || !text) return
  const field = fieldKey(e.kind, c.about)
  clash(run, run.entry(e.id) ?? e, field, field ? fieldValue(e, field) || str(c.memory, 300) : str(c.memory, 300), text, s)
}

// ---------- After the reply: names, last mentions, side stories ----------

/** Names in the new paragraphs: text entries get a link to the mention; entries from elsewhere are first seen here. */
function linkMentions(run: Run): void {
  if (!run.plan.toRead.length) return
  const db = run.db
  const linked = new Set(
    hist
      .linksInScene(db, run.scene.sceneId)
      .filter((l) => l.factKind === 'entry' && l.state === 'ok')
      .map((l) => l.factId)
  )
  for (const e of repo.listEntries(db)) {
    if (e.kind === 'thread' || e.kind === 'event') continue
    const s = findMention([e.name, ...e.aliases], run.plan.toRead)
    if (!s) continue
    if (!run.ensureHere(e, s)) continue
    if (e.origin === 'text' && !linked.has(e.id)) {
      run.addLink('entry', e.id, null, s)
      linked.add(e.id)
    }
  }
}

/** Where the text still mentions the entry (in any live scene, read or not), or null. */
function mentionedSomewhere(db: DB, e: Entry): { scene: KeeperScene; spot: Spot } | null {
  const names = [e.name, ...e.aliases].filter((n) => n.trim().length >= 2)
  const longestWord = (n: string): string =>
    n
      .trim()
      .split(/\s+/)
      .sort((a, b) => b.length - a.length)[0] ?? n
  for (const scene of kdb.scenesWithWords(db, names.map(longestWord))) {
    const spot = findMention(names, sceneParagraphs(scene.doc, scene.text))
    if (spot) return { scene, spot }
  }
  return null
}

/** Text entries whose last mention is gone, which Adam never edited, move to Trash (with their own text changes). */
function trashForgotten(run: Run): void {
  const db = run.db
  const candidates = new Set([...run.plan.touchedEntries, ...run.removedChanges])
  for (const id of candidates) {
    const e = run.entry(id)
    if (!e || e.origin !== 'text' || e.byHand) continue
    if (hist.linksForEntry(db, id).some((l) => l.state === 'ok')) continue
    const own = mem.changesForEntry(db, id)
    if (own.some((c) => c.origin !== 'text')) continue
    const unsupported: ID[] = []
    let supported = false
    for (const c of own) {
      if (hist.linksForFact(db, 'change', c.id).some((l) => l.state === 'ok')) supported = true
      else unsupported.push(c.id)
    }
    if (supported || kdb.entryReferenced(db, id, unsupported)) continue
    // Another scene still names it (one read before the entry existed, or not read yet): it stays, linked there.
    const still = mentionedSomewhere(db, e)
    if (still) {
      hist.addLink(db, {
        factKind: 'entry',
        factId: id,
        field: null,
        sceneId: still.scene.sceneId,
        sceneVersion: still.scene.textVersion,
        ...still.spot
      })
      continue
    }
    for (const cid of unsupported) mem.deleteChange(db, cid, run.by)
    repo.deleteEntry(db, id, run.by)
    run.log({
      action: 'removed',
      what: 'entry',
      entryId: id,
      entryName: e.name,
      text: 'Moved to Trash: no scene mentions it any more',
      before: '',
      after: '',
      quote: run.plan.moves.find((m) => m.link.factId === id)?.link.quote ?? '',
      undo: { op: 'entry-trashed', entryId: id, changeIds: unsupported }
    })
  }
}

/** "Which happened last?": a side story and its host both change something this run touched. The host wins until Adam answers. */
function askWhichLast(run: Run): void {
  const { shape, sideClashes } = run.ctx
  if (!shape || !sideClashes || !run.touched.size) return
  const story = shape.stories.find((s) => s.id === run.scene.storyId)
  if (!story) return
  const sides = [
    ...(story.kind === 'side' ? [story] : []),
    ...shape.stories.filter((s) => s.kind === 'side' && s.startStoryId === story.id)
  ]
  for (const side of sides) {
    const host = shape.stories.find((s) => s.id === side.startStoryId)
    if (!host) continue
    let clashes: ReturnType<SideClashes> = []
    try {
      clashes = sideClashes(side.id)
    } catch (e) {
      console.warn('Could not compare a side story with its host', e)
      continue
    }
    for (const c of clashes) {
      if (c.answer || !run.touched.has(c.entryId)) continue
      const key = `${side.id}:${c.entryId}:${c.aspect}`
      if (kdb.questionAsked(run.db, key) || run.lines.some((l) => (l.undo as { key?: string } | null)?.key === key)) continue
      const e = run.entry(c.entryId)
      if (!e) continue
      const hostTitle = host.title.trim() || 'the main story'
      const sideTitle = side.title.trim() || 'the side story'
      run.log({
        action: 'updated',
        what: 'change',
        entryId: e.id,
        entryName: e.name,
        text: `${aspectWords(run, e, c.aspect)} changes in both ${hostTitle} and ${sideTitle}; for now, ${hostTitle} counts`,
        before: '',
        after: '',
        question: {
          text: 'Which happened last?',
          options: [
            { id: 'host', label: `What happens in ${hostTitle}` },
            { id: 'side', label: `What happens in ${sideTitle}` }
          ],
          answer: 'host'
        },
        undo: { op: 'which-last', key }
      })
    }
  }
}

// ---------- The whole run ----------

/** Applies a run (call inside a transaction). */
export function applyRead(db: DB, ctx: ApplyContext, plan: ReadPlan, replies: ChunkReply[]): ApplyResult {
  const run = new Run(db, ctx, plan)
  for (const m of plan.moves) {
    if (m.to) run.moveLink(m.link, m.to)
    else hist.updateLink(db, m.link.id, { state: m.state })
  }

  // Verdicts on facts whose words were edited (and on facts in a re-read paragraph).
  const verdicts = new Map<string, Record<string, unknown>>()
  const refsFor = new Map<ChunkReply, Map<string, ID>>()
  for (const chunk of replies) {
    const refs = new Map<string, ID>()
    refsFor.set(chunk, refs)
    for (const v of chunk.reply.facts) {
      const id = str(v.id, 10).toUpperCase()
      const f = chunk.ids.facts.get(id)
      if (!f || verdicts.has(f.key)) continue
      const atRisk = plan.atRisk.some((x) => x.key === f.key)
      const reread = f.links.some((l) => l.paragraphId && chunk.paras.some((p) => p.pid === l.paragraphId))
      if (!atRisk && !reread) continue
      // Words that are still there aren't taken away on the model's say-so; they can be read anew.
      if (!atRisk && /^(remove|delete)$/i.test(str(v.do ?? v.verdict ?? v.action, 20))) continue
      verdicts.set(f.key, v)
      applyVerdict(run, f, v, chunk, refs)
    }
  }
  // Facts whose words were deleted go (Adam's are asked about); an edited fact with no verdict stays, marked changed.
  for (const f of plan.gone) removeFact(run, f, ctx.removed ? 'those words were deleted with the scene' : 'those words were deleted')

  linkMentions(run)
  for (const chunk of replies) {
    const refs = refsFor.get(chunk)!
    for (const a of chunk.reply.add) {
      try {
        applyAdd(run, a, chunk, refs)
      } catch (e) {
        console.warn('Skipped a fact the memory model gave', e)
      }
    }
    for (const c of chunk.reply.clashes) applyClash(run, c, chunk, refs)
  }
  trashForgotten(run)
  askWhichLast(run)

  for (const l of run.lines) kdb.insertLog(db, l)
  if (!ctx.removed) {
    kdb.markProcessed(
      db,
      plan.scene.sceneId,
      plan.version,
      plan.paras.map((p) => ({ id: p.id, hash: p.hash, text: p.text }))
    )
  }
  for (const l of run.lines) if (l.entryId) run.touched.add(l.entryId)
  return { lines: run.lines.length, entryIds: [...run.touched], newEntryIds: [...run.madeHere] }
}
