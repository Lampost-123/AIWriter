// Free checks over the story index (overhaul phase 1): slips the index alone can show, with no AI call. Each says
// nothing when the record is unsure, so a finding is worth reading:
// - `same-moment`: someone is in two scenes the cards put at the very same moment in two different places. Only when both
//   cards give their own day and the same clock time ("Day 3, 9pm": a time of day such as "evening" lasts hours), neither
//   leans on the scene before ("Later that evening") nor goes back, both have a place and neither place is the other or
//   inside it (the back room is in the inn), and the card of at least one of them has them there. As the rule-based
//   checks read a moment (checks/ruleChecks.ts, pov-elsewhere), for anyone rather than the point of view.
// - `after-death`: someone a scene card has there (its point of view or its people) after the memory is sure they died
//   (ai/deaths.ts surelyDied: never "presumed dead"), until a note says they live. Being named in the words is never
//   enough (a body, a grave, a memory). Not a dream, a vision, a ghost, a memory or a flashback (the card says so, or its
//   When goes back), nor a scene the calendar dates before the death.
// Findings are plain data with the scenes they are about; nothing here stores them. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID, SceneCard } from '@shared/types'
import * as repo from '../db/repo'
import * as sidx from '../db/storyIndex'
import { storyCalendar } from '../memory/storyCalendar'
import { dateLabel, type StoryDate } from '../memory/calendar'
import type { IndexScene } from './types'

type DB = Database.Database

export type IndexCheck = 'same-moment' | 'after-death'

export interface IndexFinding {
  check: IndexCheck
  /** The scene the slip is in (the later one). */
  sceneId: ID
  /** The other scene it is about: the one at the same moment, or the one the death is in. */
  otherSceneId: ID
  entryId: ID
  /** In plain words. */
  message: string
}

/** A card that is a dream, a vision, a ghost, a memory or a flashback. */
const DREAMLIKE =
  /\b(?:dream\w*|nightmare\w*|vision\w*|ghost\w*|spirit|memor(?:y|ies)|remember\w*|recall\w*|flashback\w*|imagin\w*|hallucinat\w*)\b/i
const dreamlike = (card: SceneCard | undefined): boolean =>
  !!card && DREAMLIKE.test([card.when, card.notes, card.goal, card.outcome].join(' '))

/** A clock time the card itself gives ("9pm", "21:30"), not a time of day ("evening" is a span of hours). */
const clockTime = (d: StoryDate): boolean => d.timeFrom === 'card' && d.minute !== null && !!d.span && d.span[0] === d.span[1]
/** A date the card gives outright: its own day and clock time, not leaning on the scene before, not going back. */
const exact = (d: StoryDate | undefined): d is StoryDate =>
  !!d && d.reading === 'read' && !d.back && !d.leans && d.axis !== null && d.n !== null && clockTime(d)

/** On the card: its point of view or its people. */
const onCard = (card: SceneCard | undefined, id: ID): boolean => !!card && (card.povId === id || (card.presentIds ?? []).includes(id))

/** True when two places are apart: neither is the other, nor inside it. */
function apart(a: ID, b: ID, parents: ReadonlyMap<ID, ID | null>): boolean {
  if (a === b) return false
  const within = (x: ID, y: ID): boolean => {
    const seen = new Set<ID>()
    for (let p = parents.get(x) ?? null; p && !seen.has(p); p = parents.get(p) ?? null) {
      if (p === y) return true
      seen.add(p)
    }
    return false
  }
  return !within(a, b) && !within(b, a)
}

/** Every finding of the free checks over one story's index, in story order. */
export function indexChecks(db: DB, storyId: ID): IndexFinding[] {
  const scenes = sidx.indexScenes(db, storyId)
  if (!scenes.length) return []
  const cards = repo.sceneCards(
    db,
    scenes.map((s) => s.sceneId)
  )
  let dates = new Map<ID, StoryDate>()
  try {
    dates = storyCalendar(db, storyId)?.dates ?? dates
  } catch (e) {
    console.warn('Could not read the story calendar for the story index checks', e)
  }
  const out = [...sameMoment(db, scenes, cards, dates), ...afterDeath(db, storyId, scenes, cards, dates)]
  const at = new Map(scenes.map((s) => [s.sceneId, s.position]))
  return out.sort((a, b) => (at.get(a.sceneId) ?? 0) - (at.get(b.sceneId) ?? 0))
}

function sameMoment(
  db: DB,
  scenes: readonly IndexScene[],
  cards: ReadonlyMap<ID, SceneCard>,
  dates: ReadonlyMap<ID, StoryDate>
): IndexFinding[] {
  // Scenes at the same moment: the same day on the same calendar, at the same clock time.
  const moments = new Map<string, { scene: IndexScene; date: StoryDate }[]>()
  for (const s of scenes) {
    const d = dates.get(s.sceneId)
    if (!s.placeEntryId || !exact(d) || dreamlike(cards.get(s.sceneId))) continue
    const key = `${d.axis}|${d.n}|${d.minute}`
    moments.set(key, [...(moments.get(key) ?? []), { scene: s, date: d }])
  }
  const groups = [...moments.values()].filter((g) => g.length > 1)
  if (!groups.length) return []
  const parents = sidx.placeParents(db)
  const names = sidx.entryNames(
    db,
    groups.flatMap((g) => g.flatMap((x) => [...x.scene.present, x.scene.placeEntryId!]))
  )
  const out: IndexFinding[] = []
  for (const group of groups) {
    for (let j = 1; j < group.length; j++) {
      for (let i = 0; i < j; i++) {
        const [a, b] = [group[i], group[j]]
        if (!apart(a.scene.placeEntryId!, b.scene.placeEntryId!, parents)) continue
        for (const id of b.scene.present) {
          const who = names.get(id)
          if (who?.kind !== 'character' || !a.scene.present.includes(id)) continue
          if (!onCard(cards.get(a.scene.sceneId), id) && !onCard(cards.get(b.scene.sceneId), id)) continue
          const placeA = names.get(a.scene.placeEntryId!)?.name ?? 'one place'
          const placeB = names.get(b.scene.placeEntryId!)?.name ?? 'another'
          out.push({
            check: 'same-moment',
            sceneId: b.scene.sceneId,
            otherSceneId: a.scene.sceneId,
            entryId: id,
            message: `${who.name} is at ${placeB} in ${b.scene.label} and at ${placeA} in ${a.scene.label}, at the same moment (${dateLabel(b.date)}).`
          })
        }
      }
    }
  }
  return out
}

function afterDeath(
  db: DB,
  storyId: ID,
  scenes: readonly IndexScene[],
  cards: ReadonlyMap<ID, SceneCard>,
  dates: ReadonlyMap<ID, StoryDate>
): IndexFinding[] {
  const deaths = sidx
    .storyFactsInOrder(db, storyId)
    .filter((f) => f.kind === 'status' && f.slot === 'life' && f.value === 'dead' && f.entryId)
  if (!deaths.length) return []
  const names = sidx.entryNames(
    db,
    deaths.map((d) => d.entryId!)
  )
  const out: IndexFinding[] = []
  const said = new Set<string>()
  for (const d of deaths) {
    const id = d.entryId!
    const name = names.get(id)?.name
    if (!name) continue
    const died = dates.get(d.fromSceneId)
    for (const s of scenes) {
      if (s.position <= d.fromPosition || (d.untilPosition !== null && s.position >= d.untilPosition)) continue
      // A death told twice (two notes) is one death.
      if (said.has(`${id}|${s.sceneId}`)) continue
      const card = cards.get(s.sceneId)
      if (!onCard(card, id) || dreamlike(card)) continue
      const when = dates.get(s.sceneId)
      // Told later but set earlier (a flashback, or the calendar puts it before the death): not after it at all.
      if (when?.back) continue
      if (when && died && when.axis !== null && when.axis === died.axis && when.n !== null && died.n !== null && when.n < died.n) continue
      said.add(`${id}|${s.sceneId}`)
      out.push({
        check: 'after-death',
        sceneId: s.sceneId,
        otherSceneId: d.fromSceneId,
        entryId: id,
        message: `${name} died in ${d.fromLabel}, but the scene card of ${s.label} has ${name} there.`
      })
    }
  }
  return out
}
