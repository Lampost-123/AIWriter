// The free rule-based checks over one scene, read from the world (long story memory fix 8; the rules are in rules.ts).
// They run with no AI call, as soon as the memory keeper has read a scene (and where things stand at its end is brought up
// to date: keeper/index.ts), and whenever the checks check a scene (run.ts). What they find goes in the Issues tab like any
// check's finding (`by: 'rule'`, marked "Found by a rule, not the AI"), with Fix the text, Ignore and Undo, so fix 7's
// lessons work for them: an ignored one is meant and never comes back, a fixed one is a slip later scenes are warned of.
// Each run replaces what the rules found there before; the AI's findings and the memory keeper's clashes are left as they
// are, and a rule never raises what either has raised already about the same entry (db/checks.ts sameThing). When the AI
// check or the memory keeper finds the same thing, its finding takes the rule's place.
// After a read, the later scenes on the line that still have a rule's finding open are looked at again (one may rest on
// the scene just read), and a scene deleted takes its open findings with it (keeper/index.ts scenesDeleted).
// Cheap: a check passes the memory it has already read; otherwise one reading of what is true as the scene begins
// (memory/scene.ts sceneStart, without the story so far), with the story calendar and the scene cards kept until a date
// or a card changes (memory/storyCalendar.ts calendarVersion), and the stage kept for the scene. The time and place
// rules over the words (free rules 2026-10-19) read the codex and the calendar through freeContext.ts, as check and
// repair does as new words land, so both find the same things under the same keys.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { Change, Entry, EntryState, ID, RelationshipState, WritingPrefs, FactState, BeliefState } from '@shared/types'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import * as mem from '../db/memory'
import { calledIn } from '../db/called'
import { loadShape, sceneStart } from '../memory/scene'
import { labeler, storyOfScene } from '../memory/line'
import { ledgerOf } from '../memory/ledger'
import { sameDay, type StoryDate } from '../memory/calendar'
import { ageHere, calendarCards, calendarOfScene, scenesGoingBack } from '../memory/storyCalendar'
import { storedState } from '../continuity/tracker'
import { parentChain } from '../ai/context'
import { shortPlace } from '../ai/mustStay'
import { UserError } from '../util'
import { dreamlikeCard, onStage, ruleFindings, type Meanwhile, type RuleFinding, type RuleScene } from './rules'
import { freeContext } from './freeContext'
import type { FreeContext } from './freeRules'

type DB = Database.Database

/** The most other scenes at the same moment looked at for where the point of view is. */
export const MEANWHILE_MOST = 6
/** The most later scenes looked at again after a read (those with a rule's finding open, nearest first). */
export const LATER_MOST = 12

/** The key a rule's finding is kept under: one per rule, scene and what it is about. */
export const ruleKey = (f: Pick<RuleFinding, 'rule' | 'about'>, sceneId: ID): string => `rule:${f.rule}:${sceneId}:${f.about}`

/** What is true as a scene begins, as the rules read it (a check's SceneMemory has all of it). */
export interface RuleMemory {
  entries: EntryState[]
  /** The entries that don't exist here, for telling names apart. */
  elsewhere: { entry: EntryState }[]
  relationships: RelationshipState[]
  facts: FactState[]
  beliefs?: BeliefState[]
  /** The changes the memory pinned to the scene. */
  bringAbout: Change[]
}

export interface RuleOptions {
  prefs?: WritingPrefs
  /** The memory as the scene begins, as the writer is given it, when the caller has read it already (a check). */
  memory?: RuleMemory
}

/** True when two places are apart: neither is the other, nor inside it (the back room is in the Inn). */
function apart(a: ID, b: ID, byId: Map<ID, Entry>): boolean {
  if (a === b) return false
  const pa = byId.get(a)
  const pb = byId.get(b)
  if (!pa || !pb) return false
  return !parentChain(pa, byId).some((p) => p.id === b) && !parentChain(pb, byId).some((p) => p.id === a)
}

/** A clock time the card itself gives ("9pm", "21:30"): not a time of day, which is a span ("evening", "night"). */
const clockTime = (d: StoryDate): boolean => d.timeFrom === 'card' && d.minute !== null && !!d.span && d.span[0] === d.span[1]

/** The memory as a scene begins, read as the writer is given it, without the story so far (sceneStart). */
function memoryAt(db: DB, sceneId: ID): RuleMemory {
  const { state, changes } = sceneStart(db, sceneId, { forWriter: true, dropGuesses: true })
  return {
    entries: [...state.entries.values()],
    elsewhere: [...state.absent.values()].map((entry) => ({ entry })),
    relationships: state.relationships,
    facts: state.facts,
    beliefs: state.beliefs,
    bringAbout: changes.byScene.get(sceneId) ?? []
  }
}

/**
 * What the rules read of a scene: the memory as it begins, as the writer is given it (facts whose words were edited and
 * not confirmed left out), the changes the memory pinned to it, the stage at its end while that still stands, and the
 * story calendar. Null when the scene is gone (or in Recently deleted) or has no words.
 */
export function ruleScene(db: DB, sceneId: ID, opts: RuleOptions = {}): RuleScene | null {
  const shape = loadShape(db)
  const node = storyOfScene(shape, sceneId)
  if (!node) return null
  const scene = repo.getScene(db, sceneId)
  const text = scene.text ?? ''
  if (!text.trim()) return null
  const { story } = repo.sceneLocation(db, sceneId)
  const memory = opts.memory ?? memoryAt(db, sceneId)
  const label = labeler(shape)
  const place = (where: string): string => shortPlace(where, story.title)
  const sceneLabel = (id: ID): string => {
    const s = storyOfScene(shape, id)
    return s ? place(label({ storyId: s.id, sceneId: id })) : ''
  }
  const all = [...memory.entries, ...memory.elsewhere.map((x) => x.entry)]
  const byId = new Map<ID, Entry>(all.map((e) => [e.id, e]))
  const people = all.filter((e) => e.kind === 'character').map((e) => ({ id: e.id, name: e.name, aliases: e.aliases ?? [] }))
  const card = scene.card
  const kept = storedState(db, sceneId)

  const cal = calendarOfScene(db, sceneId)
  const date = cal?.dates.get(sceneId) ?? null
  const back = cal ? (scenesGoingBack(db, node.id).find((b) => b.sceneId === sceneId) ?? null) : null
  // Other scenes at this very moment somewhere else: both cards give their own day and the same clock time (a time of
  // day such as "evening" lasts hours, so two evenings may be an hour apart; none leans on the scene before, as "Later
  // that evening" does, nor goes back, nor is a dream or a memory), and their places are apart.
  const meanwhile: Meanwhile[] = []
  if (cal && date && !date.back && !date.leans && clockTime(date) && card.locationId) {
    let cards: ReturnType<typeof calendarCards> | null = null
    for (const [id, d] of cal.dates) {
      if (id === sceneId || d.back || d.leans || !clockTime(d) || d.minute !== date.minute || sameDay(d, date) !== true) continue
      cards ??= calendarCards(db)
      const other = cards.get(id)
      if (!other?.locationId || !apart(other.locationId, card.locationId, byId) || dreamlikeCard({ ...other, notes: '', conflict: '', outcome: '' })) continue
      const there = new Set<ID>([other.povId, ...(other.presentIds ?? [])].filter((x): x is ID => !!x))
      const stage = storedState(db, id)
      if (stage?.current) for (const p of onStage(stage.state, id, people)) there.add(p)
      meanwhile.push({ sceneId: id, label: sceneLabel(id), people: [...there], place: byId.get(other.locationId)?.name.trim() || 'another place' })
      if (meanwhile.length >= MEANWHILE_MOST) break
    }
  }

  return {
    sceneId,
    text,
    card,
    placeName: card.locationId ? (byId.get(card.locationId)?.name.trim() ?? '') : '',
    entries: memory.entries,
    relationships: memory.relationships,
    people,
    called: calledIn(db, sceneId),
    here: memory.bringAbout,
    facts: memory.facts,
    ledger: ledgerOf(memory),
    stage: kept?.current ? kept.state : null,
    pov: effectiveStyle(opts.prefs ?? ({} as WritingPrefs), repo.getWorldStyle(db), story.style).pov.trim(),
    place,
    sceneLabel,
    date,
    sceneAt: (where) => cal?.byLabel.get(where) ?? null,
    dateOf: (id) => cal?.dates.get(id) ?? null,
    back: back && { beforeId: back.beforeId, elapsed: back.elapsed },
    age: (e) => (cal ? ageHere(cal, e, sceneId) : null),
    meanwhile,
    learnedIn: (entryId, factId) => mem.knowledgeScenes(db, entryId, factId),
    free: freeOf(db, sceneId)
  }
}

/** What the free rules over words read (freeContext.ts); null when it can't be read (those rules then say nothing). */
function freeOf(db: DB, sceneId: ID): FreeContext | null {
  try {
    return freeContext(db, sceneId)
  } catch (e) {
    console.warn('Could not read what the time and place rules need', e)
    return null
  }
}

/** A rule's finding as an issue to save. */
export function ruleIssue(f: RuleFinding, sceneId: ID, storyId: ID): cdb.FoundIssue {
  return {
    sceneId,
    storyId,
    kind: f.kind,
    severity: f.severity,
    quote: f.quote,
    message: f.message,
    key: ruleKey(f, sceneId),
    payload: {
      by: 'rule',
      rule: f.rule,
      sources: f.sources,
      fix: f.fix ?? null,
      memoryFix: null,
      ...(f.entryId ? { entryId: f.entryId } : {}),
      ...(f.field ? { field: f.field } : {})
    }
  }
}

/**
 * Runs every rule over a scene and saves what they find, replacing what they found there before. Returns how many new
 * issues were raised. Nothing when the scene is gone for good; a scene with no words, or in Recently deleted, keeps
 * nothing open that the rules found.
 */
export function runRuleChecks(db: DB, sceneId: ID, opts: RuleOptions = {}): number {
  if (!cdb.sceneTexts(db, [sceneId]).has(sceneId)) return 0
  let storyId: ID
  try {
    storyId = repo.sceneLocation(db, sceneId).story.id
  } catch (e) {
    if (e instanceof UserError) return 0
    throw e
  }
  const s = ruleScene(db, sceneId, opts)
  const found = s ? ruleFindings(s).map((f) => ruleIssue(f, sceneId, storyId)) : []
  return cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), found, (p) => p.by === 'rule')
}

/** The same, never throwing (a failure is noted and nothing changes): after a reading of the memory, and in a check. */
export function ruleChecksQuietly(db: DB, sceneId: ID, opts: RuleOptions = {}): number {
  try {
    return db.open ? runRuleChecks(db, sceneId, opts) : 0
  } catch (e) {
    console.warn('Could not run the rule checks for a scene', e)
    return 0
  }
}

/**
 * The scenes after this one on their own line that still have a rule's finding open, nearest first (`LATER_MOST` at
 * most): what the rules found there may rest on this scene (a death, a learning, a date), so they are looked at again.
 */
export function laterRuleScenes(db: DB, sceneId: ID): ID[] {
  const open = cdb.openRuleScenes(db).filter((id) => id !== sceneId)
  if (!open.length) return []
  const later: { id: ID; gap: number }[] = []
  for (const id of open) {
    const order = calendarOfScene(db, id)?.order ?? []
    const at = order.indexOf(sceneId)
    const here = order.indexOf(id)
    if (at >= 0 && here > at) later.push({ id, gap: here - at })
  }
  return later
    .sort((a, b) => a.gap - b.gap)
    .slice(0, LATER_MOST)
    .map((x) => x.id)
}

/**
 * After the memory read a scene: the rules over it, then over the later scenes whose open findings may rest on it. Never
 * throws.
 */
export function rulesAfterRead(db: DB, sceneId: ID, prefs?: WritingPrefs): void {
  ruleChecksQuietly(db, sceneId, { prefs })
  let later: ID[] = []
  try {
    later = db.open ? laterRuleScenes(db, sceneId) : []
  } catch (e) {
    console.warn('Could not find the later scenes to check again', e)
  }
  for (const id of later) ruleChecksQuietly(db, id, { prefs })
}

/**
 * After scenes were deleted (or brought back from Recently deleted): a deleted scene keeps none of the rules' findings
 * open (what Adam ignored or fixed stays, for when it comes back); a scene brought back is looked at again. Never throws.
 */
export function rulesAfterDeleting(db: DB, restored: ID[] = [], prefs?: WritingPrefs): void {
  try {
    if (!db.open) return
    cdb.clearDeletedRules(db)
    for (const id of restored) ruleChecksQuietly(db, id, { prefs })
  } catch (e) {
    console.warn('Could not tidy the rule checks after a delete', e)
  }
}
