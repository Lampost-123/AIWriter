// Applies a run to the memory: moves links to where their words are now, then the memory model's
// verdicts on facts whose words were edited, removes facts whose words were deleted, adds new facts,
// links names to entries (and entries first seen elsewhere), raises issues for clashes with Adam's
// facts, moves text entries whose last mention is gone to Trash, and writes the "What changed" lines.
// Every write passes { origin: 'text', runId } so the memory history records it. Rules (spec,
// Multi-story rules, "Source links and automatic upkeep"; World Memory Overhaul part A, Adam 2026-10-08):
// - What Adam made himself (his entries, changes and fields, never read from the text) is never changed or
//   removed: a clash raises an issue, and at most a question-marked line says the scene no longer says it.
// - A fact read from the text that Adam only edited keeps his words while its words are there (changed words get a
//   question offering a refresh), and goes when they go, like any text fact; so does a text entry he only edited.
// - A text fact goes when its last link is gone or no longer supports it, or when it stays unconfirmed (no verdict, or
//   words that can't be placed) for one more read after its words were edited. Each removal has Undo.
// - An entry's or event's summary has a link of its own and follows its words (a re-reported event, or a "summary" item).
// - AI-drafted fields are replaced when the text says otherwise.
// - Facts Adam undid are not added again from the same words (suppressions).
// The caller runs this inside one transaction. No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, ChangeData, ChangeUntil, Entry, EntryKind, ID, Origin, SourceLink } from '@shared/types'
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
import { findMention, relocate, spotIn, type ReadPlan, type Spot } from './track'
import { existedEarlier } from './places'
import { contradicts } from './agree'
import { isSaidKind } from '../retrieval/said'
import { thingNotCharacter } from './kinds'
import { CLUE_NOTE, clueList, laterCardPaysOff, payoffLater, threadPlace, threadStatus, threadStep } from './threads'
import { LEFT_OR_DIED, onStageAt, paraIndexOf, WHISPERED } from './presence'
import { deathOf } from '../ai/deaths'
import type { ThreadList } from '@shared/threadLinks'
import {
  changeContent,
  changeWords,
  factContent,
  factFingerprint,
  factSaysSomething,
  fieldLabel,
  fieldOrigin,
  fieldValue,
  builderField,
  guessFields,
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
  /**
   * The memory is being tidied against the text with no model (tidy.ts, World Memory Overhaul A7): links follow their
   * words and facts whose words are gone go, but nothing new is read and the scene isn't marked read.
   */
  sweep?: boolean
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
  | {
      op: 'change-added'
      changeId: ID
      /** A plot thread the memory put on the scene card with it (keeper/threads.ts): Undo takes that link back too. */
      cardLink?: { sceneId: ID; list: ThreadList; threadId: ID }
    }
  | { op: 'change-updated'; changeId: ID; version: number; link: SourceLink | null }
  | {
      op: 'change-removed'
      changeId: ID
      /** Links to forget when this is undone (a fact removed as unconfirmed: brought back, it is Adam's to keep). */
      linkIds?: ID[]
    }
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
  /**
   * A quiet note that changes nothing (World Memory Overhaul, 2026-10-08): "the scene no longer says this" under one of
   * Adam's own facts, or the tidy-up's summary line. Undoing it only dismisses it.
   */
  | { op: 'note'; key: string }
  /** Where a fact stops being true was set or cleared (World Memory Overhaul B1): Undo puts back what it was before. */
  | { op: 'until-set'; changeId: ID; before: ChangeUntil | null }
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
  if (builderField(e, field) && fieldValue(e, field).trim() !== '') return true // the world builder's drafts count as Adam's (2026-10-08)
  return fieldOrigin(e, field) === 'adam' && fieldValue(e, field).trim() !== ''
}

export const sampleLines = (e: Entry): string[] =>
  (e.fields?.sampleLines ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

export const MAX_SAMPLE_LINES = 5
const MAX_INVOLVED = 6
/** The longest line something said is kept with (its source link keeps all of its words). */
const MAX_SAID_CHARS = 2000

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
  /** Facts whose words changed that this run settled (a usable verdict, a re-reported summary): not unconfirmed. */
  readonly settled = new Set<string>()
  /** Entries with a fact this run kept for Adam (see keptForAdam): never moved to the Trash by it. */
  readonly keptForAdam = new Set<ID>()
  /**
   * Summaries to remove once the Trash has been seen to (null after): an entry moved there keeps its summary, so its
   * Undo brings it back whole, and no "Summary" line comes before "Moved to Trash".
   */
  laterSummaries: { planned: SceneFact; why: string; unconfirmed?: ID[] }[] | null = []

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

  /**
   * Where a plot thread stands just before this scene, as the memory has it here: resolved, open (a thread change on
   * the line opened it), or none (planned, or not in the story yet). With this scene's own changes so far: threadNow.
   */
  threadBefore(id: ID): 'none' | 'open' | 'resolved' {
    const t = this.ctx.memory?.threads.find((x) => x.entryId === id)
    if (!t || t.planned) return 'none'
    return t.status
  }

  /** Where a plot thread stands now in this scene: before it, then this scene's own thread changes (this run's too). */
  threadNow(id: ID): 'none' | 'open' | 'resolved' {
    return threadStatus(this.threadBefore(id), mem.changesInScene(this.db, this.scene.sceneId), id)
  }

  private cardIds: ID[] | null = null
  private povId: ID | null = null
  /**
   * Who is on stage at these words (World Memory Overhaul B5, keeper/presence.ts): the scene card's people (from when
   * they come in) and anyone named as there in the paragraph or just before it, less those who left or died earlier. Only people who exist
   * here (or this read found), living.
   */
  stageAt(s: Spot): Entry[] {
    const paras = this.plan.paras
    const index = paraIndexOf(paras, s)
    if (index < 0) return []
    if (!this.cardIds) {
      try {
        const card = repo.getScene(this.db, this.scene.sceneId).card
        this.cardIds = [card.povId, ...(card.presentIds ?? [])].filter((x): x is ID => !!x)
        this.povId = card.povId ?? null
      } catch {
        this.cardIds = []
      }
    }
    const living = new Map<ID, Entry>()
    const dead = new Set((this.ctx.memory?.entries ?? []).filter((e) => deathOf(e)).map((e) => e.id))
    for (const e of this.entries) {
      if (e.kind !== 'character' || dead.has(e.id)) continue
      if (!this.here || this.here.has(e.id) || this.madeHere.has(e.id)) living.set(e.id, e)
    }
    const gone: { id: ID; index: number }[] = []
    for (const c of mem.changesInScene(this.db, this.scene.sceneId)) {
      if (c.kind !== 'update' || !LEFT_OR_DIED.test(c.payload.note ?? '')) continue
      for (const l of hist.linksForFact(this.db, 'change', c.id)) {
        if (l.state !== 'ok') continue
        const at = paraIndexOf(paras, l)
        if (at >= 0) gone.push({ id: c.entryId, index: at })
      }
    }
    return onStageAt({ paras, index, onCard: this.cardIds, pov: this.povId, people: [...living.values()], gone }).flatMap((id) => living.get(id) ?? [])
  }

  /** The paragraph's words a spot is in ('' when it can't be found). */
  paraText(s: Spot): string {
    return this.plan.paras[paraIndexOf(this.plan.paras, s)]?.text ?? ''
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
    case 'thread':
      // Its words were edited: the note may follow them, but whether it opened or was resolved here comes only from a
      // new thread item (a resolve needs the payoff on the page: keeper/threads.ts).
      return { kind: 'thread', payload: { status: c.payload.status, note: str(v.note, 300) || c.payload.note } }
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

/**
 * True when the fact was read from the text (or drafted by the AI), not made by Adam himself. Fields and sample lines
 * a scene's links point at were written by the keeper; a change says who made it in its first version.
 */
function textBorn(run: Run, f: SceneFact): boolean {
  if (f.kind === 'change') return (hist.firstOrigin(run.db, 'change', f.change.id) ?? f.change.origin) !== 'adam'
  return true
}

/**
 * Adam's say on a fact that lost its words (Adam, 2026-10-08): kept, with a question-marked line, when he made it
 * himself, or when he edited it while this run was reading. A text fact he merely edited before goes with its words.
 * A field of his own entry is his when he typed it as he made the entry (it has no origin of its own) or the world
 * builder drafted it (that counts as his, 2026-10-08), even if an older version left it resting on the scene's words.
 */
const keptForAdam = (run: Run, planned: SceneFact, f: SceneFact): boolean =>
  (f.kind === 'field' &&
    f.entry.origin === 'adam' &&
    (builderField(f.entry, f.field) || f.entry.fieldOrigins?.[f.field] === undefined) &&
    fieldValue(f.entry, f.field).trim() !== '') ||
  (f.origin === 'adam' && (planned.origin !== 'adam' || !textBorn(run, f)))

/** Every link of a fact, in any scene, as it is now. */
function allLinks(run: Run, f: SceneFact): SourceLink[] {
  if (f.kind === 'change') return hist.linksForFact(run.db, 'change', f.change.id)
  if (f.kind === 'field') return hist.linksForEntry(run.db, f.entry.id).filter((l) => hist.isFieldLink(l, f.field))
  return hist.linksById(
    run.db,
    f.links.map((l) => l.id)
  )
}

/**
 * An entry's summary whose words are gone, or which the model wouldn't confirm, while the entry stays (Adam,
 * 2026-10-08): the old summary is kept, and the writer goes on seeing it, until a new one is written. The first time,
 * its link moves to words that still mention the entry (in this scene, else another), marked changed, so the next read
 * of that scene asks the model about it ("summary E3: …") and it can be revised from what is left. If that read doesn't
 * settle it, the summary simply stays, resting on no words (asked about no more; a re-reported entry or a "summary"
 * item can still give it new words).
 */
function keepSummaryForRewrite(run: Run, f: Extract<SceneFact, { kind: 'field' }>): void {
  const db = run.db
  const here = hist.linksById(
    db,
    linksHere(f, run).map((l) => l.id)
  )
  if (!here.length) return
  const asked = here.some((l) => l.state === 'changed' && (l.checks ?? 0) >= 1)
  const mention = asked ? null : findMention([f.entry.name, ...f.entry.aliases], run.plan.paras)
  const elsewhere = asked || mention ? null : mentionedSomewhere(db, f.entry)
  const [first, ...rest] = here
  for (const l of rest) hist.deleteLink(db, l.id)
  if (mention) {
    hist.updateLink(db, first.id, { paragraphId: mention.paragraphId, state: 'changed' })
    hist.updateLink(db, first.id, { checks: 1 })
  } else if (elsewhere && elsewhere.scene.sceneId !== run.scene.sceneId) {
    hist.deleteLink(db, first.id)
    const l = hist.addLink(db, {
      factKind: 'summary',
      factId: f.entry.id,
      field: 'summary',
      sceneId: elsewhere.scene.sceneId,
      sceneVersion: elsewhere.scene.textVersion,
      paragraphId: elsewhere.spot.paragraphId,
      start: elsewhere.spot.start,
      end: elsewhere.spot.end,
      quote: first.quote,
      state: 'changed'
    })
    hist.updateLink(db, l.id, { checks: 1 })
  } else hist.deleteLink(db, first.id)
}

/**
 * Adam's own fact that the scene no longer supports (Adam, 2026-10-08): it is never changed or removed, only a quiet
 * note says so, which he can dismiss (once per set of words).
 */
function noteNoLonger(run: Run, f: SceneFact): void {
  if (f.kind !== 'field' && f.kind !== 'change') return
  const key = `no-longer:${f.key}:${wordsOf(f.links[0]?.quote ?? '')}`
  if (kdb.lineGiven(run.db, key) || run.lines.some((l) => (l.undo as { key?: string } | null)?.key === key)) return
  const label = f.kind === 'field' ? fieldLabel(f.entry, f.field) : changeWords(f.change, (id) => run.entry(id)?.name ?? 'someone')
  run.log({
    action: 'updated',
    what: f.kind === 'field' ? 'entry' : 'change',
    entryId: f.entry.id,
    factId: f.kind === 'change' ? f.change.id : null,
    entryName: f.entry.name,
    text: `${label}: the scene no longer says this (yours is kept as it is)`,
    before: '',
    after: '',
    quote: f.links[0]?.quote ?? '',
    undo: { op: 'note', key }
  })
}

/**
 * Removes a text (or AI-drafted) fact whose words are gone or no longer say it. `unconfirmed`: the links of a fact
 * removed because it stayed unconfirmed; undoing the removal forgets them, so the fact is Adam's to keep.
 */
function removeFact(run: Run, planned: SceneFact, why: string, unconfirmed?: ID[]): void {
  const db = run.db
  if (planned.kind === 'field' && planned.field === 'summary' && run.laterSummaries) {
    run.laterSummaries.push({ planned, why, unconfirmed })
    return
  }
  const f = freshFact(run, planned)
  if (!f) return
  if (keptForAdam(run, planned, f)) {
    run.keptForAdam.add(f.kind === 'change' ? f.change.entryId : f.entry.id)
    return noteNoLonger(run, f)
  }
  // An entry's summary is never cleared while the entry stays (Adam, 2026-10-08): it waits for a new one.
  if (f.kind === 'field' && f.field === 'summary') return keepSummaryForRewrite(run, f)
  const quote = f.links[0]?.quote ?? ''
  const nameOf = (id: ID): string => run.entry(id)?.name ?? 'someone'
  switch (f.kind) {
    case 'change': {
      mem.deleteChange(db, f.change.id, run.by)
      run.noteRemovedChange(f.change.entryId)
      // An event someone was involved in may now have nothing left that says it happened (checked after the run).
      if (f.change.kind === 'relationship') run.noteRemovedChange(f.change.payload.otherId)
      // A plot thread the memory put on this scene's card for it comes off with it (Adam's own link stays).
      if (f.change.kind === 'thread' && f.change.sceneId) {
        const status = f.change.payload.status
        const still = mem
          .changesInScene(db, f.change.sceneId)
          .some((c) => c.entryId === f.change.entryId && c.kind === 'thread' && c.payload.status === status)
        if (!still) repo.setAiThreadLink(db, f.change.sceneId, status === 'resolved' ? 'paysOff' : 'setsUp', f.change.entryId, false)
      }
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
        undo: { op: 'change-removed', changeId: f.change.id, ...(unconfirmed?.length ? { linkIds: unconfirmed } : {}) }
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
          linkIds: unconfirmed ?? []
        }
      })
      return
    }
    case 'voice': {
      const e = run.entry(f.entry.id)
      if (!e) return
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

/**
 * Applies the memory model's verdict on a fact. True when that settles it (kept on words now in the scene, updated,
 * removed, or left to Adam); false when it doesn't (no usable words, nothing usable to update with): the fact is then
 * unconfirmed (see settleUnconfirmed).
 */
function applyVerdict(run: Run, planned: SceneFact, v: Record<string, unknown>, chunk: ChunkReply, refs: Map<string, ID>): boolean {
  const verdict = str(v.do ?? v.verdict ?? v.action, 20).toLowerCase()
  const db = run.db
  const f = freshFact(run, planned)
  if (!f) return true
  const links = linksHere(f, run)
  if (verdict === 'remove' || verdict === 'delete') {
    removeFact(run, planned, 'the scene no longer says this')
    return true
  }
  const s = run.place(v.quote, chunk.paras)
  if (verdict === 'keep' || !verdict) {
    // Words that can't be placed: the fact's own words may still be found, a little changed; otherwise it is unconfirmed.
    const at = s ?? (links[0] ? relocate(links[0], run.plan.paras) : null)
    if (!at) return false
    if (links[0]) run.moveLink(links[0], at)
    return true
  }
  if (verdict !== 'update' && verdict !== 'change') return false
  if (!s) return false // no words to rest it on: its link stays marked changed, and it is unconfirmed
  const nameOf = (id: ID): string => run.entry(id)?.name ?? 'someone'
  if (f.kind === 'field') {
    const value = str(v.value ?? v.summary ?? v.after, 400)
    if (!value) {
      // A summary still told by the edited words, with no new one given, stays as it is (a "summary" item revises it).
      if (f.field === 'summary') {
        if (links[0]) run.moveLink(links[0], s)
        return true
      }
      removeFact(run, planned, 'the scene no longer says this')
      return true
    }
    const e = run.entry(f.entry.id)
    if (!e) return true
    // His words stand (with a question offering the new value), or Adam undid this update from these words: either
    // way the fact now rests on these words, so it isn't asked about again at every read.
    if (adamField(e, f.field)) {
      askRefresh(run, f, { value }, s)
      if (links[0]) run.moveLink(links[0], s)
      return true
    }
    const fp = fingerprint({ type: 'field', entryId: e.id, field: f.field })
    if (run.suppressed(fp, s.quote)) {
      if (links[0]) run.moveLink(links[0], s)
      return true
    }
    const before = fieldValue(e, f.field)
    if (plain(before) !== plain(value)) repo.updateEntry(db, e.id, patchFor(e, f.field, value), run.by)
    if (links[0]) run.moveLink(links[0], s)
    if (plain(before) === plain(value)) return true
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
    return true
  }
  if (f.kind !== 'change') return false
  const c = f.change
  const data = updatedPayload(c, v, run, chunk.ids, refs, f.entry.kind)
  if (!data) return false
  // Something said (0.6.29) whose line now reads differently keeps the line as it now reads.
  if (data.kind === 'knowledge' && data.payload.said) data.payload.said = { ...data.payload.said, words: s.quote }
  if (f.origin === 'adam') {
    askRefresh(run, f, { change: data }, s)
    if (links[0]) run.moveLink(links[0], s)
    return true
  }
  const fp = fingerprint({ type: 'change', entryId: c.entryId, change: data })
  if (run.suppressed(fp, s.quote)) {
    if (links[0]) run.moveLink(links[0], s)
    return true
  }
  const same = JSON.stringify(data.payload) === JSON.stringify(c.payload)
  const linkBefore = links[0] ?? null
  if (linkBefore) run.moveLink(linkBefore, s)
  if (same) return true
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
  return true
}

/**
 * Facts whose words were edited that the model was asked about and that nothing settled (World Memory Overhaul A1,
 * 2026-10-08): the first time, unconfirmed (the writer leaves them out until a read confirms them: memory/scene.ts);
 * still unconfirmed at the next read, a text fact goes, with Undo. What Adam made himself only gets a question.
 */
function settleUnconfirmed(run: Run, replies: ChunkReply[]): void {
  const asked = new Set<string>()
  for (const chunk of replies) for (const f of chunk.ids.facts.values()) asked.add(f.key)
  for (const planned of run.plan.atRisk) {
    if (run.settled.has(planned.key) || !asked.has(planned.key)) continue
    const f = freshFact(run, planned)
    if (!f || !factSaysSomething(f)) continue
    const links = allLinks(run, f)
    // Words said it again (a new link), here or elsewhere: it stands.
    if (links.some((l) => l.state === 'ok')) continue
    const changed = links.filter((l) => l.sceneId === run.scene.sceneId && l.state === 'changed')
    if (!changed.length) continue
    if (changed.some((l) => (l.checks ?? 0) >= 1)) {
      removeFact(
        run,
        planned,
        'the scene no longer clearly says this',
        changed.map((l) => l.id)
      )
    } else for (const l of changed) hist.updateLink(run.db, l.id, { checks: (l.checks ?? 0) + 1 })
  }
}

// ---------- Summaries of entries and events (World Memory Overhaul A2) ----------

/**
 * A new one-line summary for an entry or event, from the words at `s`: a "summary" item (the scene now tells it
 * differently), or the entry reported again. `onlyIfUnsettled`: only when the summary's words here changed (it was
 * asked about in this read, or its link here isn't ok). What Adam wrote himself is never rewritten; a summary read
 * from the text that he edited keeps his words, with a question offering the new one.
 */
function reviseSummary(run: Run, entry: Entry, value: string, s: Spot, onlyIfUnsettled: boolean): void {
  const e = run.entry(entry.id)
  if (!e || !value) return
  const key = `field:${e.id}:summary`
  const links = hist.linksForEntry(run.db, e.id).filter((l) => hist.isFieldLink(l, 'summary'))
  const here = links.filter((l) => l.sceneId === run.scene.sceneId)
  const unsettled = run.plan.atRisk.some((f) => f.key === key) || (here.length > 0 && !here.some((l) => l.state === 'ok'))
  if (onlyIfUnsettled && !unsettled) return
  if (adamField(e, 'summary') && !links.length) return // Adam's own summary
  const link = here.find((l) => l.state !== 'ok') ?? here[0] ?? null
  run.settled.add(key)
  if (adamField(e, 'summary')) {
    askRefresh(run, { kind: 'field', key, entry: e, field: 'summary', origin: 'adam', links: here }, { value }, s)
    if (link) run.moveLink(link, s)
    return
  }
  const fp = fingerprint({ type: 'field', entryId: e.id, field: 'summary' })
  if (run.suppressed(fp, s.quote)) return
  if (link) run.moveLink(link, s)
  else run.addLink('summary', e.id, 'summary', s)
  const before = e.summary
  if (plain(before) === plain(value)) return
  repo.updateEntry(run.db, e.id, { summary: value }, run.by)
  run.log({
    action: 'updated',
    what: 'entry',
    entryId: e.id,
    entryName: e.name,
    text: 'Summary',
    before,
    after: value,
    quote: s.quote,
    undo: {
      op: 'field-set',
      entryId: e.id,
      field: 'summary',
      before,
      beforeOrigin: e.fieldOrigins?.summary ?? null,
      linkIds: [],
      fingerprint: fp,
      words: wordsOf(s.quote)
    }
  })
}

/** An event (or entry) read from the text, reported again: its words now are where it was told, and its summary may follow. */
function reReported(run: Run, e: Entry, summary: string, s: Spot): void {
  if (e.origin !== 'text') return
  const here = hist.linksForEntry(run.db, e.id).filter((l) => l.sceneId === run.scene.sceneId && l.factKind === 'entry')
  if (!here.some((l) => l.state === 'ok')) {
    const stale = here.find((l) => l.state !== 'ok')
    if (stale) run.moveLink(stale, s)
    else run.addLink('entry', e.id, null, s)
  }
  if (summary) reviseSummary(run, e, summary, s, true)
}

// ---------- New facts ----------

function addEntry(run: Run, a: Record<string, unknown>, chunk: ChunkReply, refs: Map<string, ID>): void {
  const name = str(a.name, 120)
  const asked = kindOf(a.kind)
  if (!name || !asked) return
  const s = run.place(a.quote, chunk.paras) ?? findMention([name], chunk.paras)
  if (!s) return
  const ref = str(a.ref, 10).toUpperCase()
  const given = (a.fields && typeof a.fields === 'object' ? a.fields : {}) as Record<string, unknown>
  // A thing the model called a character (a bead someone wants) is made as an item (keeper/kinds.ts, Adam 2026-10-07).
  let kind: EntryKind = asked
  if (asked === 'character') {
    const asGiven = Object.fromEntries(Object.entries(given).map(([k, v]) => [k, str(v, 200)]))
    const e = { name, aliases: strList(a.aliases), summary: str(a.summary, 300), fields: asGiven, ref }
    if (thingNotCharacter(e, run.plan.paras.map((p) => p.text), chunk.reply.add)) kind = 'item'
  }
  // Never a duplicate: a name already in the world is that entry (first seen elsewhere if need be), whichever kind
  // the model gave it.
  const existing =
    run.byName(name, kind) ??
    run.byName(name) ??
    strList(a.aliases)
      .map((x) => run.byName(x, kind) ?? (kind !== asked ? run.byName(x, asked) : null))
      .find(Boolean) ??
    null
  if (existing) {
    if (!run.ensureHere(existing, s)) return
    if (ref) refs.set(ref, existing.id)
    // Its words are here now (an entry link left behind by an edit follows them), and its summary may follow them.
    reReported(run, existing, str(a.summary, 300), s)
    return
  }
  const fp = fingerprint({ type: 'entry', kind, name })
  if (run.suppressed(fp, s.quote) || run.deletedByAdam(kind, name, s)) return
  // Undone or deleted by Adam when it was made as the kind the model gave: not made again from these words either.
  if (kind !== asked && (run.suppressed(fingerprint({ type: 'entry', kind: asked, name }), s.quote) || run.deletedByAdam(asked, name, s))) return
  const fields: Record<string, string> = {}
  let description = ''
  for (const [k, v] of Object.entries(given)) {
    const key = fieldKey(kind, k)
    if (key === 'description') description = str(v, 2000)
    else if (key && key !== 'summary' && str(v)) fields[key] = str(v)
  }
  const aliases = strList(a.aliases).filter((x) => plain(x) !== plain(name))
  const e = repo.createEntry(
    run.db,
    kind,
    { name, aliases, summary: str(a.summary, 300), description, fields },
    { origin: 'text', originStoryId: run.scene.storyId, originSceneId: run.scene.sceneId, runId: run.ctx.runId }
  )
  run.entryMade(e)
  if (ref) refs.set(ref, e.id)
  run.addLink('entry', e.id, null, s)
  // Its summary rests on the same words, and follows them (World Memory Overhaul A2, 2026-10-08).
  if (e.summary.trim()) run.addLink('summary', e.id, 'summary', s)
  // What the text says it is, read with it, is the text's too (it was dropped before 2026-10-07, leaving room for a guess).
  if (description) run.addLink('field', e.id, 'description', s)
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
    // The same detail again: these words support it too (never Adam's own value or the world builder's draft, which
    // don't rest on words and must never go with them).
    if (
      !adamField(e, field) &&
      fieldOrigin(e, field) !== 'adam' &&
      !hist
        .linksForEntry(db, e.id)
        .some((l) => hist.isFieldLink(l, field) && l.sceneId === run.scene.sceneId && l.state === 'ok')
    ) {
      run.addLink('field', e.id, field, s)
    }
    return
  }
  if (run.suppressed(fp, s.quote)) return
  if (adamField(e, field)) {
    // Adam's own fact is never changed: only words that can't be true alongside it raise an issue.
    if (!run.wasOffered(e.id, field, value) && contradicts(field, before, value)) clash(run, e, field, before, value, s)
    return
  }
  if (before.trim() && fieldOrigin(e, field) === 'text') {
    // Words elsewhere still say the old value: a value that can't also be true is a clash between scenes;
    // the same in other words, or more of it, leaves the memory as those scenes have it.
    const support = hist.linksForEntry(db, e.id).filter((l) => hist.isFieldLink(l, field) && l.state === 'ok')
    if (support.some((l) => l.sceneId !== run.scene.sceneId)) {
      if (contradicts(field, before, value)) clash(run, e, field, before, value, s)
      return
    }
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
  if (now.trim() && plain(now) !== plain(before)) {
    // The memory here says it differently because of an earlier scene's change: only a value that can't
    // also be true is a clash; the same in other words leaves the memory as it is.
    if (contradicts(field, now, value)) raiseClash(run, e, field, now, value, s)
    return
  }
  const data: ChangeData =
    field === 'summary' || field === 'description'
      ? { kind: 'update', payload: { note: '', [field]: value } }
      : { kind: 'update', payload: { note: '', fields: { [field]: value } } }
  addChange(run, e, data, s, `${fieldLabel(e, field)}: ${value}`)
}

/** The text disagrees with the memory: AI-drafted fields give way; Adam's facts (and other scenes' words) raise an issue. */
function clash(run: Run, e: Entry, field: string | null, memory: string, text: string, s: Spot): void {
  if (field && fieldOrigin(e, field) === 'ai' && !builderField(e, field) && e.fieldOrigins?.[field] !== 'adam' && text) {
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

// ---------- Plot threads (2026-10-08, keeper/threads.ts) ----------

/** Fills an empty field the text gives (a thread's promise) on the entry itself. Adam's field, or one already filled, stays. */
function fillField(run: Run, entry: Entry, field: string, value: string, s: Spot): void {
  const e = run.entry(entry.id)
  if (!e || !value || adamField(e, field) || fieldValue(e, field).trim()) return
  const fp = fingerprint({ type: 'field', entryId: e.id, field })
  if (run.suppressed(fp, s.quote)) return
  repo.updateEntry(run.db, e.id, patchFor(e, field, value), run.by)
  const link = run.addLink('field', e.id, field, s)
  run.log({
    action: 'added',
    what: 'entry',
    entryId: e.id,
    entryName: e.name,
    text: `${fieldLabel(e, field)}: ${value}`,
    before: '',
    after: '',
    quote: s.quote,
    undo: {
      op: 'field-set',
      entryId: e.id,
      field,
      before: '',
      beforeOrigin: e.fieldOrigins?.[field] ?? null,
      linkIds: [link.id],
      fingerprint: fp,
      words: wordsOf(s.quote)
    }
  })
}

/** A clue for a plot thread: one more line of its clues (from the text); on Adam's own clues, a note on the thread here. */
function addClue(run: Run, thread: Entry, clue: string, s: Spot): void {
  const e = run.entry(thread.id)
  if (!e || !clue) return
  if (adamField(e, 'clues')) {
    addChange(run, e, { kind: 'update', payload: { note: `${CLUE_NOTE}${clue}` } }, s)
    return
  }
  const fp = fingerprint({ type: 'field', entryId: e.id, field: 'clues' })
  if (run.suppressed(fp, s.quote)) return
  const before = fieldValue(e, 'clues')
  const list = clueList(before)
  if (list.some((c) => plain(c) === plain(clue))) {
    // The same clue again: these words support it too.
    if (
      !hist.linksForEntry(run.db, e.id).some((l) => l.factKind === 'field' && l.field === 'clues' && l.sceneId === run.scene.sceneId && l.state === 'ok')
    )
      run.addLink('field', e.id, 'clues', s)
    return
  }
  const value = [...list, clue].join('\n')
  repo.updateEntry(run.db, e.id, patchFor(e, 'clues', value), run.by)
  const link = run.addLink('field', e.id, 'clues', s)
  run.log({
    action: before.trim() ? 'updated' : 'added',
    what: 'entry',
    entryId: e.id,
    entryName: e.name,
    text: `New clue: ${clue}`,
    before,
    after: value,
    quote: s.quote,
    undo: {
      op: 'field-set',
      entryId: e.id,
      field: 'clues',
      before,
      beforeOrigin: e.fieldOrigins?.clues ?? null,
      linkIds: [link.id],
      fingerprint: fp,
      words: wordsOf(s.quote)
    }
  })
}

/** Puts a thread the memory opened or resolved here on the scene card (the AI's link), and lets Undo take it back. */
function linkCard(run: Run, list: ThreadList, threadId: ID, change: Change): void {
  if (!repo.setAiThreadLink(run.db, run.scene.sceneId, list, threadId, true)) return
  const line = [...run.lines].reverse().find((l) => l.factId === change.id)
  const u = line?.undo as Extract<Undo, { op: 'change-added' }> | null | undefined
  if (u?.op === 'change-added') u.cardLink = { sceneId: run.scene.sceneId, list, threadId }
}

function applyThread(run: Run, a: Record<string, unknown>, chunk: ChunkReply, refs: Map<string, ID>, s: Spot): void {
  const db = run.db
  const step = threadStep(a.status ?? a.step)
  let thread = a.entry ? run.resolve(a.entry, chunk.ids, refs) : null
  if (thread && thread.kind !== 'thread') thread = null
  const name = str(a.name, 200)
  if (!thread && name) thread = run.byName(name, 'thread')
  const note = str(a.note, 300)
  const promise = str(a.promise, 300)
  const clue = str(a.clue, 200) || (step === 'clue' ? note : '')
  let made = false
  if (!thread) {
    // A clue or a step on needs a thread that is already there.
    if (!name || step === 'clue' || step === 'developing') return
    const fp = fingerprint({ type: 'entry', kind: 'thread', name })
    if (run.suppressed(fp, s.quote) || run.deletedByAdam('thread', name, s)) return
    thread = repo.createEntry(
      db,
      'thread',
      { name, summary: note, fields: promise ? { promise } : {} },
      { origin: 'text', originStoryId: run.scene.storyId, originSceneId: run.scene.sceneId, runId: run.ctx.runId }
    )
    run.entryMade(thread)
    run.addLink('entry', thread.id, null, s)
    if (thread.summary.trim()) run.addLink('summary', thread.id, 'summary', s)
    if (promise) run.addLink('field', thread.id, 'promise', s)
    made = true
    run.log({
      action: 'added',
      what: 'entry',
      entryId: thread.id,
      entryName: thread.name,
      text: 'New plot thread',
      before: '',
      after: promise || thread.summary,
      quote: s.quote,
      undo: { op: 'entry-added', entryId: thread.id, fingerprint: fp, words: wordsOf(s.quote) }
    })
  } else if (!run.ensureHere(thread, s)) return
  const now = run.threadNow(thread.id)
  switch (step) {
    case 'open': {
      if (!made && promise) fillField(run, thread, 'promise', promise, s)
      // Open already: this is a step on, not a second opening.
      if (now === 'open') {
        if (note) addChange(run, thread, { kind: 'thread', payload: { status: 'open', note } }, s)
        return
      }
      const c = addChange(run, thread, { kind: 'thread', payload: { status: 'open', note } }, s)
      if (c) linkCard(run, 'setsUp', thread.id, c)
      return
    }
    case 'clue':
      if (now !== 'resolved') addClue(run, thread, clue, s)
      return
    case 'developing':
      if (now === 'open' && note) addChange(run, thread, { kind: 'thread', payload: { status: 'open', note } }, s)
      return
    case 'resolved': {
      if (now === 'resolved') return
      // Only when the payoff is on the page, and not while Adam's plan puts it later: then it has only moved on.
      const place = threadPlace(run.ctx.shape, run.scene.sceneId)
      const entry = run.entry(thread.id) ?? thread
      if (laterCardPaysOff(db, place, thread.id) || (place && payoffLater(fieldValue(entry, 'payoff'), place))) {
        if (now === 'open' && note) addChange(run, thread, { kind: 'thread', payload: { status: 'open', note } }, s)
        return
      }
      const c = addChange(run, thread, { kind: 'thread', payload: { status: 'resolved', note } }, s)
      if (c) linkCard(run, 'paysOff', thread.id, c)
      return
    }
  }
}

// ---------- Facts with an end (World Memory Overhaul B1) ----------

const lowerFirst = (s: string): string => (s ? s[0].toLowerCase() + s.slice(1) : s)

/**
 * The fact an "end" item means: one of the entry's "So far" notes as of this scene (by its words), or a fact it knows
 * (a K id, or the fact's words). Only what is still true here can end. Null when nothing fits.
 */
function endTarget(run: Run, entry: Entry, fact: string, chunk: ChunkReply): Change | null {
  if (!fact) return null
  const here = run.ctx.memory?.entries.find((x) => x.id === entry.id)
  const k = fact.toUpperCase()
  const knownId =
    (/^K\d+$/.test(k) ? chunk.ids.known.get(k) : undefined) ??
    run.ctx.memory?.facts.find((f) => f.knownBy.includes(entry.id) && sameFact(f.fact, fact))?.factId
  const own = mem.changesForEntry(run.db, entry.id).filter((c) => c.entryId === entry.id && c.sceneId !== run.scene.sceneId)
  if (knownId && run.ctx.memory?.facts.some((f) => f.factId === knownId && f.knownBy.includes(entry.id))) {
    const learned = own.filter((c) => c.kind === 'knowledge' && c.payload.factId === knownId && !c.payload.forgets)
    const last = learned.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0]
    if (last) return last
  }
  let best: { id: ID; score: number } | null = null
  for (const h of here?.happened ?? []) {
    const score = sameFact(h.note, fact) ? 1 : likeness(fact, h.note)
    if (score >= 0.6 && (!best || score > best.score)) best = { id: h.changeId, score }
  }
  return (best && own.find((c) => c.id === best.id && c.kind === 'update')) || null
}

/**
 * The words say a fact is no longer true (she finds the lost knife): it stops counting from this scene on, with the
 * story's own words for when. Adam's own facts are never ended (Adam's rule): a quiet note says so instead, once per
 * set of words. Undo puts it back as it was, and it isn't ended again from the same words.
 */
function endChange(run: Run, c: Change, when: string, s: Spot): void {
  const db = run.db
  const nameOf = (id: ID): string => run.entry(id)?.name ?? 'someone'
  const what = changeWords(c, nameOf)
  const entryName = run.entry(c.entryId)?.name ?? ''
  if (adamMadeChange(db, c)) {
    const key = `ended:${c.id}:${wordsOf(s.quote)}`
    if (kdb.lineGiven(db, key) || run.lines.some((l) => (l.undo as { key?: string } | null)?.key === key)) return
    run.log({
      action: 'updated',
      what: 'change',
      entryId: c.entryId,
      factId: c.id,
      entryName,
      text: `${what}: the scene says this is no longer true (yours is kept as it is)`,
      before: '',
      after: '',
      quote: s.quote,
      undo: { op: 'note', key }
    })
    return
  }
  const fp = `until:${c.id}`
  if (run.suppressed(fp, s.quote)) return
  if (c.until?.sceneId === run.scene.sceneId) {
    // Ended here already: the end follows the words that say it now.
    if (c.until.quote !== s.quote || c.until.paragraphId !== s.paragraphId) mem.moveUntilWords(db, c.id, s)
    return
  }
  const before = c.until ?? null
  mem.setChangeUntil(db, c.id, { sceneId: run.scene.sceneId, when, origin: 'text', quote: s.quote, paragraphId: s.paragraphId }, run.by)
  run.log({
    action: 'updated',
    what: 'change',
    entryId: c.entryId,
    factId: c.id,
    entryName,
    text: `No longer true from here: ${lowerFirst(what)}${when ? ` (${when})` : ''}`,
    before: what,
    after: '',
    quote: s.quote,
    undo: { op: 'until-set', changeId: c.id, before, fingerprint: fp, words: wordsOf(s.quote) }
  })
}

/**
 * One of the memory's own guesses (World Memory Overhaul A4: a detail the AI filled in on an entry found in the story,
 * with no words behind it) that the words now bear out or rule out (B7, a "guess" item). Confirmed, it rests on those
 * words like a detail read from the scene; withdrawn, it goes (an entry's summary is never withdrawn: it waits for a new
 * one). Only ever a guess: Adam's fields, and the world builder's drafts on his entries, are never guesses, so never
 * touched. Undo puts it back as it was, and the same words don't settle it again.
 */
function settleGuess(run: Run, e: Entry, field: string, act: 'confirm' | 'withdraw', s: Spot): void {
  if (!guessFields(e).includes(field) || (act === 'withdraw' && field === 'summary')) return
  const value = fieldValue(e, field)
  if (!value.trim()) return
  const db = run.db
  const fp = fingerprint({ type: 'field', entryId: e.id, field })
  if (run.suppressed(fp, s.quote)) return
  const label = fieldLabel(e, field)
  const undo = { op: 'field-set' as const, entryId: e.id, field, before: value, beforeOrigin: 'ai' as const, fingerprint: fp, words: wordsOf(s.quote) }
  if (act === 'confirm') {
    if (hist.linksForEntry(db, e.id).some((l) => hist.isFieldLink(l, field) && l.state === 'ok')) return
    const link = run.addLink(field === 'summary' ? 'summary' : 'field', e.id, field, s)
    kdb.setFieldOrigins(db, e.id, { [field]: 'text' })
    run.log({
      action: 'updated',
      what: 'entry',
      entryId: e.id,
      entryName: e.name,
      text: `${label}: the story bears out the guess`,
      before: value,
      after: value,
      quote: s.quote,
      undo: { ...undo, linkIds: [link.id] }
    })
    return
  }
  repo.updateEntry(db, e.id, patchFor(e, field, ''), run.by)
  run.log({
    action: 'removed',
    what: 'entry',
    entryId: e.id,
    entryName: e.name,
    text: `${label}: a guess the story doesn't bear out`,
    before: value,
    after: '',
    quote: s.quote,
    undo: { ...undo, linkIds: [] }
  })
}

/**
 * The ends read from this scene follow their words, like any fact (B1): moved words carry the end with them, and an end
 * whose words are gone (and that this read didn't give again) is taken back, with Undo. The tidy-up, which can't ask
 * the model, keeps an end while its paragraph is still there. A deleted scene's ends stay, for when it comes back.
 */
function settleEnds(run: Run): void {
  if (run.ctx.removed) return
  const db = run.db
  for (const c of mem.changesEndingIn(db, run.scene.sceneId)) {
    const u = c.until
    if (!u || u.origin !== 'text' || !u.quote) continue
    const to = relocate({ paragraphId: u.paragraphId, quote: u.quote }, run.plan.paras)
    if (to) {
      if (to.quote !== u.quote || to.paragraphId !== u.paragraphId) mem.moveUntilWords(db, c.id, to)
      continue
    }
    if (run.ctx.sweep && u.paragraphId && run.plan.paras.some((p) => p.pid === u.paragraphId)) continue
    mem.setChangeUntil(db, c.id, null, run.by)
    run.log({
      action: 'removed',
      what: 'change',
      entryId: c.entryId,
      factId: c.id,
      entryName: run.entry(c.entryId)?.name ?? '',
      text: `True again: ${lowerFirst(changeWords(c, (id) => run.entry(id)?.name ?? 'someone'))} (the words that ended it are gone)`,
      before: '',
      after: '',
      quote: u.quote,
      // Undo keeps the end as Adam's (no words behind it), so the next read of the scene doesn't take it back again.
      undo: { op: 'until-set', changeId: c.id, before: { ...u, origin: 'adam', quote: '', paragraphId: null } }
    })
  }
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
      // Reported again (after an edit, say): its words and summary follow the words it is told in now.
      if (run.ensureHere(existing, s)) reReported(run, existing, str(a.summary, 300), s)
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
    if (e.summary.trim()) run.addLink('summary', e.id, 'summary', s)
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
    // Everyone on stage saw it happen (B5): they know it, with who was there, linked to the same words.
    const seen = (e.summary || e.name).trim()
    const stage = run.stageAt(s)
    if (seen && stage.length) {
      const factId = mem.listFacts(db).find((x) => plain(x.fact) === plain(seen))?.factId ?? newId()
      const there = stage.map((p) => p.id)
      for (const p of stage) {
        const c = addChange(run, p, { kind: 'knowledge', payload: { factId, fact: seen, seen: true, there } }, s, `Saw it happen: ${seen}`)
        if (c) involved.push(c.id)
      }
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
  if (type === 'thread') return applyThread(run, a, chunk, refs, s)
  // Close an open thread (B7): a resolve, under the same rules (the payoff on the page, not while the plan puts it later).
  if (type === 'close') return applyThread(run, { ...a, status: 'resolved' }, chunk, refs, s)
  const entry = run.resolve(a.entry, chunk.ids, refs)
  if (!entry || !run.ensureHere(entry, s)) return
  switch (type) {
    case 'guess': {
      // Confirm or withdraw one of the memory's own guesses (B7).
      const field = fieldKey(entry.kind, a.field)
      const act = str(a.do ?? a.verdict ?? a.action, 20).toLowerCase()
      if (field && (act === 'confirm' || act === 'withdraw')) settleGuess(run, run.entry(entry.id) ?? entry, field, act, s)
      return
    }
    case 'end': {
      // Something "So far" (or a fact they knew) is no longer true from here (B1).
      const target = endTarget(run, run.entry(entry.id) ?? entry, str(a.fact ?? a.note, 300), chunk)
      if (target) endChange(run, target, str(a.when, 120), s)
      return
    }
    case 'summary':
    case 'revise': {
      // The scene now tells it differently: a new one-line summary for an entry or event (World Memory Overhaul A2).
      reviseSummary(run, entry, str(a.summary ?? a.value, 300), s, false)
      return
    }
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
    case 'said': {
      // What was said (0.6.29): a promise, threat or secret told, kept as one fact the speaker and each hearer know,
      // with the spoken line (the quote, exactly as the scene has it) and who said it.
      const kind = str(a.kind, 20).toLowerCase()
      const fact = str(a.fact ?? a.about, 300)
      if (!isSaidKind(kind) || !fact || entry.kind !== 'character') return
      const hearers: Entry[] = []
      for (const who of strList(a.heard ?? a.hearers, MAX_INVOLVED)) {
        const e = run.resolve(who, chunk.ids, refs)
        if (e && e.kind === 'character' && e.id !== entry.id && !hearers.some((h) => h.id === e.id) && run.ensureHere(e, s)) hearers.push(e)
      }
      // The same line by the same speaker read again (however the model words the fact) is the fact already kept.
      const again = mem
        .changesInScene(db, run.scene.sceneId)
        .find((c) => c.kind === 'knowledge' && c.payload.said?.by === entry.id && plain(c.payload.said.words) === plain(s.quote))
      const k = str(a.factId, 10).toUpperCase()
      const factId =
        (again?.kind === 'knowledge' ? again.payload.factId : null) ??
        chunk.ids.known.get(k) ??
        mem.listFacts(db).find((x) => plain(x.fact) === plain(fact))?.factId ??
        newId()
      // Everyone on stage at those words heard them too (B5), unless they were whispered or said aside: then only those
      // the model names. Who was there is kept with the fact, so who doesn't know it can be told.
      if (!WHISPERED.test(run.paraText(s)))
        for (const p of run.stageAt(s)) if (p.id !== entry.id && !hearers.some((h) => h.id === p.id) && hearers.length < MAX_INVOLVED * 2) hearers.push(p)
      const said = { kind, by: entry.id, words: s.quote.slice(0, MAX_SAID_CHARS), heard: hearers.map((h) => h.id) }
      const there = [entry.id, ...hearers.map((h) => h.id)]
      for (const who of [entry, ...hearers]) addChange(run, who, { kind: 'knowledge', payload: { factId, fact, said, there } }, s)
      for (const h of hearers) run.touched.add(h.id)
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
  const memory = field ? fieldValue(e, field) || str(c.memory, 300) : str(c.memory, 300)
  // Reported as a contradiction, but only saying the same in other words (or more of it): not a clash.
  if (!contradicts(field, memory, text, true)) return
  clash(run, run.entry(e.id) ?? e, field, memory, text, s)
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

/**
 * Something Adam added to a text entry himself, rather than an edit of what the text said (Adam, 2026-10-08): notes,
 * a portrait, tags, a parent, a hard rule, or a field he filled in that no words were read for. It keeps the entry.
 */
function adamAddedTo(db: DB, e: Entry): boolean {
  if (e.notes.trim() || e.image || e.tags.length || e.parentId || e.hardRule) return true
  const links = hist.linksForEntry(db, e.id)
  for (const [k, origin] of Object.entries(e.fieldOrigins ?? {})) {
    if (origin !== 'adam' || k === 'name' || k === 'tags' || !fieldValue(e, k).trim()) continue
    if (!links.some((l) => l.field === k)) return true
  }
  return false
}

/**
 * The memory's guesses about a text entry (fields the AI filled in with no words in the story behind them: World Memory
 * Overhaul A4) go when no words say anything of the entry any more, each with Undo.
 */
function clearGuesses(run: Run, e: Entry): void {
  const links = hist.linksForEntry(run.db, e.id)
  for (const field of guessFields(e)) {
    if (links.some((l) => l.field === field && l.state === 'ok')) continue
    const fresh = run.entry(e.id)
    if (!fresh) return
    const before = fieldValue(fresh, field)
    if (!before.trim()) continue
    repo.updateEntry(run.db, fresh.id, patchFor(fresh, field, ''), run.by)
    run.log({
      action: 'removed',
      what: 'entry',
      entryId: fresh.id,
      entryName: fresh.name,
      text: `${fieldLabel(fresh, field)}: a guess, and no scene mentions ${fresh.name} any more`,
      before,
      after: '',
      quote: '',
      undo: { op: 'field-set', entryId: fresh.id, field, before, beforeOrigin: fresh.fieldOrigins?.[field] ?? null, linkIds: [] }
    })
  }
}

/**
 * A change Adam made himself (not one read from the text that he edited). What the world builder or a story flow made
 * (worldBuilder/save.ts, storyFlows/apply.ts) counts as his too, though stored as drafted by the AI (Adam, 2026-10-08):
 * the memory keeper itself only ever writes changes read from the text, so an AI-made change is always one of those.
 */
const adamMadeChange = (db: DB, c: Change): boolean => {
  if (c.origin === 'text') return false
  const first = hist.firstOrigin(db, 'change', c.id) ?? c.origin
  return first === 'adam' || first === 'ai'
}

/**
 * Text entries (people, things, places, events alike) whose last mention is gone move to Trash, with their own text
 * changes. One Adam only edited goes too (Adam, 2026-10-08); one he added something of his own to stays.
 */
function trashForgotten(run: Run): void {
  const db = run.db
  const candidates = new Set([...run.plan.touchedEntries, ...run.removedChanges])
  for (const id of candidates) {
    const e = run.entry(id)
    if (!e || e.origin !== 'text' || run.keptForAdam.has(id)) continue
    if (hist.linksForEntry(db, id).some((l) => l.state === 'ok')) continue
    const own = mem.changesForEntry(db, id)
    const unsupported: ID[] = []
    let supported = false
    for (const c of own) {
      if (hist.linksForFact(db, 'change', c.id).some((l) => l.state === 'ok')) supported = true
      else unsupported.push(c.id)
    }
    if (supported) continue
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
    // No words in any scene say anything of it now. It stays for something of Adam's (or on a card, a pin...), but the
    // memory's guesses about it go (World Memory Overhaul A4).
    if (
      adamAddedTo(db, e) ||
      own.some((c) => c.origin === 'ai' || adamMadeChange(db, c)) ||
      kdb.entryReferenced(db, id, unsupported)
    ) {
      clearGuesses(run, e)
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
  // Words a fact was read from were edited or deleted: the scene's summary may still tell the old version (and the
  // story so far, given to the writer, is made from it), so it is written again after this read, whatever the size
  // of the edit (Adam, 2026-10-04). Adam's own summary is left alone.
  // (Only for words lost at this read: a fact still unsettled from an earlier one doesn't ask for it again.)
  if ((plan.atRisk.length || plan.gone.length) && plan.moves.some((m) => !m.to)) kdb.markTextSummaryStale(db, 'scene', plan.scene.sceneId)
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
      if (applyVerdict(run, f, v, chunk, refs)) run.settled.add(f.key)
    }
  }
  // Facts whose words were deleted go (what Adam made himself is asked about). An edited fact with no usable verdict is
  // unconfirmed once the new facts are in (settleUnconfirmed).
  for (const f of plan.gone) removeFact(run, f, ctx.removed ? 'those words were deleted with the scene' : 'those words were deleted')

  if (!ctx.sweep) linkMentions(run)
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
  settleUnconfirmed(run, replies)
  settleEnds(run)
  trashForgotten(run)
  const later = run.laterSummaries ?? []
  run.laterSummaries = null
  for (const s of later) removeFact(run, s.planned, s.why, s.unconfirmed)
  askWhichLast(run)

  for (const l of run.lines) kdb.insertLog(db, l)
  if (!ctx.removed && !ctx.sweep) {
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
