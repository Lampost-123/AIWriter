// Saving what a build lays out, as it goes, under the same origin rules as Quick start (builder/save.ts):
// each new entry is Adam's (never moved to the Trash automatically), his own words in it are his and saved
// exactly as he wrote them, and what the AI wrote is marked "drafted by AI", so the memory keeper updates
// it when the story later says otherwise. Nothing already in the world is changed: the world's themes and
// tone are filled only while empty, and a place is put inside another only when it is new. Everything is
// true from the start the build was given: the beginning of the world, or a story's start. Each thing
// saved is one line in What changed, in the build's one memory run, made with its first save.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { ChangeAnchor, ChangeData, Entry, EntryKind, ID } from '@shared/types'
import type { WorldBuildItem } from '@shared/contracts/worldBuilder'
import type { BuilderValues } from '@shared/contracts/builder'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import * as kdb from '../db/keeper'
import { stampOrigins } from '../db/builder'
import { BUILD_RUN_SCENE } from '../db/worldBuilder'
import { ownInput, toInput } from '../builder/profile'
import { savedValues } from '../builder/save'
import { kindWord } from '../keeper/facts'
import { upperFirst } from '../keeper/text'
import { storyCalendar } from '../memory/storyCalendar'
import { parseWhen } from '../worldViews/when'
import { asProfileKind, type Profile } from './parse'
import { relationshipWords, type WorldUndo } from './lines'

type DB = Database.Database

/** A build's saving so far: its run (made with the first save) and everything it has made. */
export interface Writer {
  db: DB
  /** Where the summary's setup is true: null for the beginning of the world, else that story's start. */
  storyId: ID | null
  /** The scenes the summary numbers, when it is the story's own plan (planScenes): where its events can happen. */
  scenes: ID[]
  runId: ID | null
  made: WorldBuildItem[]
}

export const newWriter = (db: DB, storyId: ID | null, scenes: ID[] = []): Writer => ({ db, storyId, scenes, runId: null, made: [] })

const runOf = (w: Writer): ID => (w.runId ??= kdb.startRun(w.db, BUILD_RUN_SCENE, 0))

/** Where the changes a build makes are true: the beginning of the world, or the chosen story's start. */
const anchorOf = (w: Writer): { anchor: ChangeAnchor; storyId: ID | null } =>
  w.storyId ? { anchor: 'story-start', storyId: w.storyId } : { anchor: 'baseline', storyId: null }

const pick = (values: BuilderValues, keep: (key: string) => boolean): BuilderValues =>
  Object.fromEntries(Object.entries(values).filter(([k]) => keep(k)))

/** The suppression a line leaves once undone: what it added, and the summary's words it came from. */
export interface Source {
  fingerprint: string
  words: string
  /** The summary's sentence about it, shown on its line. */
  quote: string
}

/** Plain words for a new entry's line: "New character", "New rule, never to be broken". */
export const newEntryWords = (kind: EntryKind, rule: boolean): string =>
  kind === 'lore' && rule ? 'New rule, never to be broken' : `New ${kindWord(kind)}`

function line(w: Writer, l: Omit<kdb.NewLog, 'runId' | 'sceneId' | 'action' | 'question' | 'undo'> & { undo: WorldUndo }): kdb.LogRow {
  // `op` first, so the build's lines can be found by it.
  const { op, ...rest } = l.undo
  return kdb.insertLog(w.db, { ...l, runId: runOf(w), sceneId: null, action: 'added', question: null, undo: { op, ...rest } })
}

export interface NewEntry {
  kind: EntryKind
  /** The name the summary gave it (the first look's). */
  planned: string
  profile: Profile
  /** A place: the place it is inside. */
  parentId: ID | null
  /** Lore: a rule never to break. */
  hardRule: boolean
  /** An event: the characters who take part ('involved in' it, from where the build is true, or from its scene). */
  involved: ID[]
  /**
   * An event: the scene of the story's plan it happens in. It first exists there, and those taking part are involved in
   * it from there, so the scenes before it never hear of it and the timeline shows it at that scene. Without one, its
   * "Day N" may place it (sceneOnDay).
   */
  sceneId?: ID | null
  /** An event: the place it happens at (2026-10-17), linked from the event as "happens at". */
  placeId?: ID | null
  source: Source
}

/**
 * A When that names another book ("in Book 2", "the next book"). The prompts no longer ask for later books (Adam,
 * 2026-10-17); when the AI names one anyway, its words stay in the When, undated, and it is never placed on a scene.
 */
export const laterBook = (when: string): boolean =>
  /\bbook\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|[ivx]+)\b/i.test(when) || /\b(?:later|next|another|following) book\b/i.test(when)

/**
 * An event of the story's plan dated by a bare "Day N" with no scene given (2026-10-17: it existed from the story's
 * start, so the writer of Day 1 was told of it): the first of the plan's scenes dated on or after that day on the story
 * calendar, not counting flashbacks. Null when none is dated that late, or the summary isn't the story's plan.
 */
export function sceneOnDay(w: Pick<Writer, 'db' | 'storyId' | 'scenes'>, when: string): ID | null {
  if (!w.storyId || !w.scenes.length || laterBook(when)) return null
  const p = parseWhen(when.trim())
  if (!p?.dayCount || p.day === null || p.year !== null || p.month !== null || p.qual || p.step || p.next) return null
  const cal = storyCalendar(w.db, w.storyId)
  if (!cal) return null
  const plan = new Set(w.scenes)
  for (const id of cal.order) {
    const d = cal.dates.get(id)
    if (plan.has(id) && d && !d.back && d.day !== null && d.day >= p.day) return id
  }
  return null
}

/**
 * Makes an entry from a profile laid out from the summary: made by Adam, his words his, the rest drafted
 * by AI (a name the AI chose included). A plot thread is opened where the build is true, so it is set up
 * before the story starts. Null when the profile has no name.
 */
export function saveEntry(w: Writer, n: NewEntry): { entry: Entry; item: WorldBuildItem } | null {
  const kind = asProfileKind(n.kind)
  const his = new Set(n.profile.his)
  const ai = new Set(Object.keys(n.profile.values).filter((k) => !his.has(k)))
  const all = savedValues(kind, n.profile.values, ai)
  if (!all.name?.trim()) return null
  const mine = pick(all, (k) => !ai.has(k) || k === 'name')
  const drafted = pick(all, (k) => ai.has(k) && k !== 'name')
  const rule = n.kind === 'lore' && n.hardRule
  // Read before the transaction: the story calendar is kept between reads only outside one.
  const sceneId = n.kind === 'event' ? (n.sceneId ?? sceneOnDay(w, all.when ?? '')) : null
  return w.db.transaction(() => {
    const runId = runOf(w)
    let e = repo.createEntry(
      w.db,
      n.kind,
      { ...ownInput(kind, mine), parentId: n.kind === 'place' ? n.parentId : null, hardRule: rule, originStoryId: w.storyId },
      { origin: 'adam', originStoryId: w.storyId, originSceneId: sceneId, runId }
    )
    if (ai.has('name')) e = stampOrigins(w.db, e.id, { name: 'ai' })
    if (Object.keys(drafted).length) e = repo.updateEntry(w.db, e.id, toInput(kind, drafted), { origin: 'ai', runId })
    const changeIds: ID[] = []
    const add = (entryId: ID, data: ChangeData, at = anchorOf(w)): void => {
      changeIds.push(mem.insertChange(w.db, { ...data, entryId, ...at, origin: 'ai', runId }).id)
    }
    const atScene = n.kind === 'event' && sceneId && w.storyId ? { anchor: 'scene' as const, storyId: w.storyId, sceneId } : undefined
    for (const who of n.kind === 'event' ? n.involved : []) {
      if (who !== e.id) add(who, { kind: 'relationship', payload: { otherId: e.id, type: 'involved in', feels: '', otherFeels: '' } }, atScene)
    }
    if (n.kind === 'event' && n.placeId && n.placeId !== e.id) {
      add(e.id, { kind: 'relationship', payload: { otherId: n.placeId, type: 'happens at', feels: '', otherFeels: '' } }, atScene)
    }
    if (n.kind === 'thread') add(e.id, { kind: 'thread', payload: { status: 'open', note: '' } })
    const l = line(w, {
      what: 'entry',
      entryId: e.id,
      factId: null,
      entryName: e.name,
      text: newEntryWords(n.kind, rule),
      before: '',
      after: e.summary,
      quote: n.source.quote,
      undo: {
        op: 'world-build',
        did: 'entry',
        entryId: e.id,
        kind: n.kind,
        planned: n.planned,
        rule,
        changeIds,
        fingerprint: n.source.fingerprint,
        words: n.source.words
      }
    })
    const item: WorldBuildItem = {
      lineId: l.id,
      what: 'entry',
      entryId: e.id,
      kind: n.kind,
      name: e.name,
      detail: e.summary,
      hardRule: rule,
      otherId: null,
      undone: false
    }
    w.made.push(item)
    return { entry: e, item }
  })()
}

/** Puts a place the build made inside another, found once both are made. */
export function setParent(w: Writer, entryId: ID, parentId: ID): void {
  if (entryId === parentId) return
  repo.updateEntry(w.db, entryId, { parentId }, { origin: 'ai', runId: runOf(w) })
}

export interface NewRelationship {
  from: Pick<Entry, 'id' | 'name'>
  to: Pick<Entry, 'id' | 'name'>
  type: string
  feels: string
  otherFeels: string
  source: Source
}

/** Records a relationship on the first entry, true from where the build is true, drafted by AI. */
export function saveRelationship(w: Writer, r: NewRelationship): WorldBuildItem {
  return w.db.transaction(() => {
    const runId = runOf(w)
    const data: ChangeData = { kind: 'relationship', payload: { otherId: r.to.id, type: r.type, feels: r.feels, otherFeels: r.otherFeels } }
    const c = mem.insertChange(w.db, { ...data, entryId: r.from.id, ...anchorOf(w), origin: 'ai', runId })
    const detail = relationshipWords(r.type, r.to.name)
    const l = line(w, {
      what: 'change',
      entryId: r.from.id,
      factId: c.id,
      entryName: r.from.name,
      text: detail,
      before: '',
      after: '',
      quote: r.source.quote,
      undo: {
        op: 'world-build',
        did: 'relationship',
        changeId: c.id,
        fromId: r.from.id,
        toId: r.to.id,
        names: [r.from.name, r.to.name],
        type: r.type,
        fingerprint: r.source.fingerprint,
        words: r.source.words
      }
    })
    const item: WorldBuildItem = {
      lineId: l.id,
      what: 'relationship',
      entryId: r.from.id,
      kind: null,
      name: r.from.name,
      detail,
      hardRule: false,
      otherId: r.to.id,
      undone: false
    }
    w.made.push(item)
    return item
  })()
}

/** Fills the world's themes or tone, only while it is empty. Null when there is something there already. */
export function saveMeta(w: Writer, key: 'themes' | 'tone', value: string, source: Source): WorldBuildItem | null {
  const text = value.trim()
  if (!text) return null
  return w.db.transaction(() => {
    const before = repo.getMeta(w.db, key) ?? ''
    if (before.trim()) return null
    repo.setMeta(w.db, key, text)
    const l = line(w, {
      what: 'entry',
      entryId: null,
      factId: null,
      entryName: '',
      text: key === 'themes' ? "The world's themes" : "The world's tone",
      before: '',
      after: text,
      quote: source.quote,
      undo: { op: 'world-build', did: 'meta', key, before, after: text, fingerprint: source.fingerprint, words: source.words }
    })
    const item: WorldBuildItem = {
      lineId: l.id,
      what: key,
      entryId: null,
      kind: null,
      name: key === 'themes' ? 'Themes' : 'Tone',
      detail: text,
      hardRule: false,
      otherId: null,
      undone: false
    }
    w.made.push(item)
    return item
  })()
}

/** The consistency issue a build raises, as db/keeper.ts raiseIssue takes it. */
export type BuildIssue = Parameters<typeof kdb.raiseIssue>[1]

/**
 * Raises a disagreement the build found as a consistency issue, with its line, so Undo build takes it back too
 * (2026-10-17). False when the same issue is open or ignored already (nothing new, no line).
 */
export function saveIssue(w: Writer, issue: BuildIssue, l: { entryId: ID; entryName: string; memory: string; says: string; source: Source }): boolean {
  return w.db.transaction(() => {
    if (!kdb.raiseIssue(w.db, issue)) return false
    line(w, {
      what: 'entry',
      entryId: l.entryId,
      factId: null,
      entryName: l.entryName,
      text: 'Your summary disagrees with this page',
      before: l.memory,
      after: l.says,
      quote: l.source.quote,
      undo: { op: 'world-build', did: 'issue', issue, fingerprint: l.source.fingerprint, words: l.source.words }
    })
    return true
  })()
}

/** Dates a scene the build started the timeline on ("Day 1"), with its line, so Undo build takes it back (2026-10-17). */
export function saveSceneWhen(w: Writer, sceneId: ID, before: string, after: string, title: string): void {
  line(w, {
    what: 'scene',
    entryId: null,
    factId: sceneId,
    entryName: title,
    text: `The story starts on ${after}`,
    before,
    after,
    quote: '',
    undo: { op: 'world-build', did: 'when', sceneId, before, after, fingerprint: `world-build:when:${sceneId}`, words: '' }
  })
}

/**
 * Fills an empty field of an entry the world has already (an event found again, whose When was empty: 2026-10-17),
 * as the AI's, with its line. Never overwrites: false when the field has something in it.
 */
export function fillField(w: Writer, entryId: ID, key: string, value: string, source: Source): boolean {
  const text = value.trim()
  if (!text) return false
  return w.db.transaction(() => {
    const e = repo.getEntry(w.db, entryId)
    if ((e.fields[key] ?? '').trim()) return false
    const runId = runOf(w)
    repo.updateEntry(w.db, entryId, { fields: { [key]: text } }, { origin: 'ai', runId })
    line(w, {
      what: 'entry',
      entryId,
      factId: null,
      entryName: e.name,
      text: key === 'when' ? 'When it happens' : upperFirst(key),
      before: '',
      after: text,
      quote: source.quote,
      undo: { op: 'world-build', did: 'field', entryId, key, after: text, fingerprint: source.fingerprint, words: source.words }
    })
    return true
  })()
}

/** Ends the build's run in What changed (when it made one). */
export function finishWriter(w: Writer, status: 'done' | 'failed' | 'stopped', error: string | null, totals: kdb.RunTotals): void {
  if (w.runId && w.db.open) kdb.finishRun(w.db, w.runId, status, error, totals)
}
