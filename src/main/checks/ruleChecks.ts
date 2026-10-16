// The free rule-based checks over one scene, read from the world (long story memory fix 8; the rules are in rules.ts).
// They run with no AI call, as soon as the memory keeper has read a scene (and where things stand at its end is brought up
// to date: keeper/index.ts), and whenever the checks check a scene (run.ts). What they find goes in the Issues tab like any
// check's finding (`by: 'rule'`, marked "Found by a rule, not the AI"), with Fix the text, Ignore and Undo, so fix 7's
// lessons work for them: an ignored one is meant and never comes back, a fixed one is a slip later scenes are warned of.
// Each run replaces what the rules found there before; the AI's findings and the memory keeper's clashes are left as they
// are, and a rule never raises what either has raised already (db/checks.ts sameThing). When the AI check finds the
// same thing, its finding takes the rule's place (saveFound). Cheap: one reading of the memory as the scene begins (as a
// check makes), the story calendar kept until the world changes, and the stage kept for the scene.
// No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID, WritingPrefs } from '@shared/types'
import { effectiveStyle } from '@shared/style'
import * as repo from '../db/repo'
import * as cdb from '../db/checks'
import { calledIn } from '../db/called'
import { sceneCards } from '../db/worldViews'
import { loadShape, sceneMemory } from '../memory/scene'
import { labeler, storyOfScene } from '../memory/line'
import { ledgerOf } from '../memory/ledger'
import { sameMoment } from '../memory/calendar'
import { ageHere, calendarOfScene, scenesGoingBack } from '../memory/storyCalendar'
import { storedState } from '../continuity/tracker'
import { parentChain } from '../ai/context'
import { shortPlace } from '../ai/mustStay'
import { UserError } from '../util'
import { onStage, ruleFindings, type Meanwhile, type RuleFinding, type RuleScene } from './rules'

type DB = Database.Database

/** The most other scenes at the same moment looked at for where the point of view is. */
export const MEANWHILE_MOST = 6

/** The key a rule's finding is kept under: one per rule, scene and what it is about. */
export const ruleKey = (f: Pick<RuleFinding, 'rule' | 'about'>, sceneId: ID): string => `rule:${f.rule}:${sceneId}:${f.about}`

/** True when two places are apart: neither is the other, nor inside it (the back room is in the Inn). */
function apart(a: ID, b: ID, byId: Map<ID, Entry>): boolean {
  if (a === b) return false
  const pa = byId.get(a)
  const pb = byId.get(b)
  if (!pa || !pb) return false
  return !parentChain(pa, byId).some((p) => p.id === b) && !parentChain(pb, byId).some((p) => p.id === a)
}

/**
 * What the rules read of a scene: the memory as it begins, as the writer is given it (facts whose words were edited and
 * not confirmed left out), the changes the memory pinned to it, the stage at its end while that still stands, and the
 * story calendar. Null when the scene is gone or has no words.
 */
export function ruleScene(db: DB, sceneId: ID, prefs?: WritingPrefs): RuleScene | null {
  const shape = loadShape(db)
  const node = storyOfScene(shape, sceneId)
  if (!node) return null
  const scene = repo.getScene(db, sceneId)
  const text = scene.text ?? ''
  if (!text.trim()) return null
  const { story } = repo.sceneLocation(db, sceneId)
  const memory = sceneMemory(db, sceneId, { forWriter: true, dropGuesses: true })
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
  // Other scenes at this very moment somewhere else: both cards give their own day and time (none leans on the scene
  // before, as "Later that evening" does, nor goes back), and their places are apart.
  const meanwhile: Meanwhile[] = []
  if (cal && date && !date.back && !date.leans && card.locationId) {
    const cards = sceneCards(db)
    for (const [id, d] of cal.dates) {
      if (id === sceneId || d.back || d.leans || sameMoment(d, date) !== true) continue
      const other = cards.get(id)
      if (!other?.locationId || !apart(other.locationId, card.locationId, byId)) continue
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
    pov: effectiveStyle(prefs ?? ({} as WritingPrefs), repo.getWorldStyle(db), story.style).pov.trim(),
    place,
    sceneLabel,
    date,
    sceneAt: (where) => cal?.byLabel.get(where) ?? null,
    dateOf: (id) => cal?.dates.get(id) ?? null,
    back: back && { beforeId: back.beforeId, elapsed: back.elapsed },
    age: (e) => (cal ? ageHere(cal, e, sceneId) : null),
    meanwhile
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
      fix: null,
      memoryFix: null,
      ...(f.entryId ? { entryId: f.entryId } : {}),
      ...(f.field ? { field: f.field } : {})
    }
  }
}

/**
 * Runs every rule over a scene and saves what they find, replacing what they found there before. Returns how many new
 * issues were raised. Nothing when the scene is gone; a scene with no words keeps nothing the rules found.
 */
export function runRuleChecks(db: DB, sceneId: ID, prefs?: WritingPrefs): number {
  if (!cdb.sceneTexts(db, [sceneId]).has(sceneId)) return 0
  let storyId: ID
  try {
    storyId = repo.sceneLocation(db, sceneId).story.id
  } catch (e) {
    if (e instanceof UserError) return 0
    throw e
  }
  const s = ruleScene(db, sceneId, prefs)
  const found = s ? ruleFindings(s).map((f) => ruleIssue(f, sceneId, storyId)) : []
  return cdb.saveFound(db, cdb.rowsInScenes(db, [sceneId]), found, (p) => p.by === 'rule')
}

/** The same, never throwing (a failure is noted and nothing changes): after a reading of the memory, and in a check. */
export function ruleChecksQuietly(db: DB, sceneId: ID, prefs?: WritingPrefs): number {
  try {
    return db.open ? runRuleChecks(db, sceneId, prefs) : 0
  } catch (e) {
    console.warn('Could not run the rule checks for a scene', e)
    return 0
  }
}
