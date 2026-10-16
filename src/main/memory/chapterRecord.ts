// What changed in a chapter, and how things stand at its end, from the story record (long story memory fix 15,
// 2026-10-16). Chapter, story and series summaries used to be summaries of summaries; every round of re-summarising
// adds errors (FlawedFictions), so the hard facts now come from the record and the summaries are signposts. A
// chapter's snapshot is worked out with no AI from what the memory already keeps:
// - what changed in its scenes (the memory's notes, and ties between characters made or ended there);
// - who learned what in it, still known at its end, with how (the who-knows-what ledger, fix 9), and who came to
//   believe something that isn't true;
// - plot threads it set up, moved on or paid off (fix 10's threads);
// - when it runs, on the story calendar (fix 11);
// - how each character in it stands at its end: dead, where the last scene with them on its card is, looks a change
//   set during the story (an injury's mark), what they now hold, what they believe wrongly; and the threads still open.
// The snapshot itself, and how it is said, are in memory/snapshot.ts. It is kept in meta (db/snapshots.ts) and brought up
// to date by the memory keeper (keeper/snapshots.ts); the chapter, story and series roll-ups (keeper/summaries.ts) and the
// writer's timeline (ai/timeline.ts) read it.

import type Database from 'better-sqlite3'
import type { Change, EntryState, ID, KnowHow } from '@shared/types'
import { CHARACTER_GROUPS } from '@shared/fields'
import { saysDied, deathOf } from '../ai/deaths'
import { sceneCards } from '../db/worldViews'
import * as repo from '../db/repo'
import { buildLine, findChapter, labeler } from './line'
import { indexChanges, stateAt } from './state'
import { holdingsOf, itemName } from './items'
import { storyCalendar } from './storyCalendar'
import { clean, clip, SNAPSHOT_MOST, SNAPSHOT_VERSION, spanOf, type ChapterSnapshot, type NameOf, type ThreadStep } from './snapshot'
import type { MemoryData, WorldShape } from './types'

type DB = Database.Database

/** Looks a change may set that say how someone is (a scar, a missing hand), not what they wear or how they move. */
const LOOKS = (CHARACTER_GROUPS.find((g) => g.id === 'looks')?.fields ?? []).filter((f) => f.key !== 'clothing' && f.key !== 'movement')

/** What the snapshot reads, loaded once for many chapters (memory/scene.ts loadShape, writerData of loadMemoryData). */
export interface RecordRead {
  shape: WorldShape
  data: MemoryData
}

/**
 * A chapter's snapshot, worked out from the record (no AI): null when it is gone or none of its scenes has words yet.
 * `read`: the shape and the memory as the writer is given it (facts whose words were edited and not yet confirmed left
 * out), loaded once by the caller.
 */
export function chapterSnapshot(db: DB, chapterId: ID, read: RecordRead): ChapterSnapshot | null {
  const { shape, data } = read
  const at = findChapter(shape, chapterId)
  if (!at) return null
  const story = at.story
  const scenes = at.chapter.scenes
  const cards = sceneCards(db)
  const written = scenes.filter((s) => (cards.get(s.id)?.words ?? 0) > 0)
  if (!written.length) return null
  const lastId = written[written.length - 1].id
  const changes = indexChanges(data.changes)
  const line = buildLine(shape, { storyId: story.id, after: lastId })
  const state = stateAt(data, shape, line, changes)
  const label = labeler(shape)
  const scNo = new Map(scenes.map((s, i) => [s.id, i + 1]))
  const byLabel = new Map(scenes.map((s) => [label({ storyId: story.id, sceneId: s.id }), s.id]))
  const kinds = new Map(data.entries.map((e) => [e.id, e.kind]))
  const isKind = (id: ID, kind: EntryState['kind']): boolean => (state.entries.get(id)?.kind ?? kinds.get(id)) === kind

  // What changed in its scenes, and the plot threads it touched.
  const changed: ChapterSnapshot['changed'] = []
  const threads: ChapterSnapshot['threads'] = []
  const threadStep = (c: Change, sceneId: ID): ThreadStep => {
    if (c.kind === 'thread' && c.payload.status === 'resolved') return 'paid off'
    const t = state.threads.find((x) => x.entryId === c.entryId)
    return c.kind === 'thread' && t && byLabel.get(clean(t.setUp)) === sceneId ? 'set up' : 'moved on'
  }
  // Only scenes with words: a change pinned to a scene still to be written is what that scene should bring about, not
  // something that has happened (review, 2026-10-16).
  for (const s of written) {
    const sc = scNo.get(s.id) ?? 0
    for (const c of changes.byScene.get(s.id) ?? []) {
      if (isKind(c.entryId, 'thread') && (c.kind === 'thread' || c.kind === 'update')) {
        const step = threadStep(c, s.id)
        if (!threads.some((t) => t.thread === c.entryId && t.step === step)) threads.push({ thread: c.entryId, step, sc })
        continue
      }
      if (c.kind === 'update' && clean(c.payload.note)) changed.push({ who: c.entryId, note: clip(c.payload.note), sc })
      else if (c.kind === 'relationship' && isKind(c.entryId, 'character') && isKind(c.payload.otherId, 'character') && clean(c.payload.type))
        changed.push({ who: c.entryId, with: c.payload.otherId, note: clip(`${c.payload.ended ? 'no longer ' : ''}${c.payload.type}`, 60), sc })
    }
  }
  // Deaths first, then in the order they happened, as many as are kept.
  const keptChanged = [...changed.filter((c) => !c.with && saysDied(c.note)), ...changed.filter((c) => c.with || !saysDied(c.note))]
    .slice(0, SNAPSHOT_MOST.changed)
    .sort((a, b) => changed.indexOf(a) - changed.indexOf(b))

  // Who learned what here, still known (or believed) at its end: grouped by fact, scene and how.
  const learned: ChapterSnapshot['learned'] = []
  const hasWords = new Set(written.map((s) => s.id))
  const add = (who: ID, fact: string, sceneId: ID | undefined, how: KnowHow | 'said' | undefined, from: ID | undefined, wrong: boolean): void => {
    if (!sceneId || !hasWords.has(sceneId) || how === 'said' || !isKind(who, 'character') || !clean(fact)) return
    const sc = scNo.get(sceneId)!
    const same = learned.find((l) => l.fact === clip(fact) && l.sc === sc && l.how === how && l.from === from && !!l.wrong === wrong)
    if (same) {
      if (!same.who.includes(who)) same.who.push(who)
      return
    }
    learned.push({ who: [who], fact: clip(fact), sc, ...(how ? { how } : {}), ...(from ? { from } : {}), ...(wrong ? { wrong: true as const } : {}) })
  }
  for (const f of state.facts) for (const who of f.knownBy) add(who, f.fact, f.since?.[who]?.sceneId, f.since?.[who]?.how, f.since?.[who]?.from, false)
  for (const b of state.beliefs) for (const who of b.believedBy) add(who, b.fact, b.since[who]?.sceneId, b.since[who]?.how, b.since[who]?.from, true)
  learned.sort((a, b) => a.sc - b.sc)

  // The characters in it, in the order they first come in: on the cards of its scenes with words, then in what changed
  // and what was learned.
  const people: ID[] = []
  const join = (id: ID | null | undefined): void => {
    if (id && !people.includes(id) && state.entries.get(id)?.kind === 'character') people.push(id)
  }
  for (const s of written) {
    const card = cards.get(s.id)
    join(card?.povId)
    for (const id of card?.presentIds ?? []) join(id)
  }
  for (const c of keptChanged) {
    join(c.who)
    join(c.with)
  }
  for (const l of learned) for (const id of l.who) join(id)
  const holdings = holdingsOf({ entries: [...state.entries.values()], relationships: state.relationships, people })
  const standing: ChapterSnapshot['people'] = []
  for (const who of people) {
    if (standing.length >= SNAPSHOT_MOST.people) break
    const e = state.entries.get(who)!
    if (deathOf(e)) {
      standing.push({ who, dead: true })
      continue
    }
    const p: ChapterSnapshot['people'][number] = { who }
    // Where: the last scene with words whose card has them there, at its place.
    for (let i = written.length - 1; i >= 0; i--) {
      const card = cards.get(written[i].id)
      if (!card || (card.povId !== who && !(card.presentIds ?? []).includes(who))) continue
      if (card.locationId && state.entries.has(card.locationId)) {
        p.at = card.locationId
        p.atSc = scNo.get(written[i].id)
      }
      break
    }
    const looks = LOOKS.filter((f) => e.changed.includes(f.key) && clean(e.fields?.[f.key]))
      .slice(0, SNAPSHOT_MOST.looks)
      .map((f) => `${f.label}: ${clip(e.fields[f.key], 100)}`)
    if (looks.length) p.looks = looks
    const holds = holdings.filter((h) => h.personId === who && h.has).map((h) => h.itemId)
    if (holds.length) p.holds = [...new Set(holds)].slice(0, SNAPSHOT_MOST.holds)
    const believes = state.beliefs
      .filter((b) => b.believedBy.includes(who))
      .sort((a, b) => b.at - a.at)
      .slice(0, SNAPSHOT_MOST.believes)
      .map((b) => clip(b.fact))
    if (believes.length) p.believes = believes
    if (p.at || p.looks || p.holds || p.believes) standing.push(p)
  }

  // Threads still open at its end: those it touched first.
  const touched = new Set(threads.map((t) => t.thread))
  const open = state.threads
    .filter((t) => t.status === 'open' && !t.planned)
    .map((t) => t.entryId)
    .sort((a, b) => Number(touched.has(b)) - Number(touched.has(a)))
    .slice(0, SNAPSHOT_MOST.open)

  const cal = storyCalendar(db, story.id)
  const { span, days } = spanOf(written.map((s) => cal?.dates.get(s.id)))
  return {
    v: SNAPSHOT_VERSION,
    chapterId,
    storyId: story.id,
    sceneId: lastId,
    span,
    days,
    changed: keptChanged,
    learned: learned.slice(0, SNAPSHOT_MOST.learned),
    threads: threads.slice(0, SNAPSHOT_MOST.threads),
    people: standing,
    open
  }
}

/** Every live entry's name, by id (for the roll-ups, which name things as they are now). */
export function entryNames(db: DB): NameOf {
  const names = new Map(repo.listEntries(db).map((e) => [e.id, { name: clean(e.name), kind: e.kind }]))
  return (id) => {
    const e = names.get(id)
    return e ? (e.kind === 'item' ? itemName(e.name) : e.name) : null
  }
}
