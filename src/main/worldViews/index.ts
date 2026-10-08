// The world views (milestone 3): the timeline, the relationship map and the plot threads board. Each
// reads the world once and works its view out with the same line as drafting, for one story at a time.
// No Electron imports, so each is tested against an in-memory world (timeline.test.ts, threads.test.ts,
// map.test.ts, perf.test.ts).
//
// What a view reads (the stories, the memory, the scene cards) is kept for each open world until
// anything is written to it, so moving between the views, or back to a story already seen, doesn't
// read it all again. SQLite counts every row the connection changes (`changesMade`), and the open
// world has a single connection, so an unchanged count means nothing has changed.
import type Database from 'better-sqlite3'
import type { AsOf, ID } from '@shared/types'
import type { RelationshipMap, ThreadsBoard, Timeline } from '@shared/contracts/worldViews'
import { asOfStops, memoryAt, type MemoryAt } from '../memory/asOf'
import { buildLine } from '../memory/line'
import { loadMemoryData, loadShape } from '../memory/scene'
import type { MemoryData, WorldShape } from '../memory/types'
import { changesMade, readMapLayout, sceneCards, storyGaps, writeMapLayout, writtenScenes, type CardInfo } from '../db/worldViews'
import * as hist from '../db/history'
import * as kdb from '../db/keeper'
import { UserError } from '../util'
import { buildTimeline } from './timeline'
import { buildBoard } from './threads'
import { buildMap, countChanges, createLayoutCache, worldGraph } from './map'

type DB = Database.Database

/** What the views read from one open world, while nothing has been written to it. */
interface Read {
  changed: number
  shape: WorldShape
  data: MemoryData
  cards: Map<ID, CardInfo> | null
  /** Each story's time gap, for the ones that have one. */
  gaps: Map<ID, string> | null
  /** The memory at each story's end. */
  ends: Map<ID, MemoryAt>
  timelines: Map<ID, Timeline>
  boards: Map<ID, ThreadsBoard>
}

const reads = new WeakMap<DB, Read>()

function readWorld(db: DB, storyId: ID): Read {
  const changed = changesMade(db)
  let r = reads.get(db)
  if (!r || r.changed !== changed) {
    r = {
      changed,
      shape: loadShape(db),
      data: loadMemoryData(db),
      cards: null,
      gaps: null,
      ends: new Map(),
      timelines: new Map(),
      boards: new Map()
    }
    reads.set(db, r)
  }
  if (!r.shape.stories.some((s) => s.id === storyId)) throw new UserError('That story no longer exists. Choose another story.')
  return r
}

/** The memory at a story's end, with the scene cards. */
function atEnd(db: DB, r: Read, storyId: ID): MemoryAt & { cards: Map<ID, CardInfo> } {
  let end = r.ends.get(storyId)
  if (!end) r.ends.set(storyId, (end = memoryAt(db, { kind: 'end', storyId }, r.shape, r.data)))
  return { ...end, cards: (r.cards ??= sceneCards(db)) }
}

export function timelineOf(db: DB, storyId: ID): Timeline {
  const r = readWorld(db, storyId)
  let t = r.timelines.get(storyId)
  if (!t) {
    const { shape, data, line, state, cards } = atEnd(db, r, storyId)
    const gaps = (r.gaps ??= storyGaps(db))
    r.timelines.set(storyId, (t = buildTimeline({ storyId, shape, data, line, state, cards, gaps })))
  }
  return t
}

export function threadsBoardOf(db: DB, storyId: ID): ThreadsBoard {
  const r = readWorld(db, storyId)
  let b = r.boards.get(storyId)
  if (!b) {
    const { shape, data, line, state, cards } = atEnd(db, r, storyId)
    r.boards.set(
      storyId,
      (b = buildBoard({
        storyId,
        shape,
        data,
        line,
        state,
        cards,
        payoff: (ids) => payoffWords(db, ids),
        linkScenes: (ids) => hist.entryLinkScenes(db, ids),
        written: writtenScenes(db)
      }))
    )
  }
  return b
}

/** The words each resolving change was read from (its first link still in the scene), and the line Undo takes back. */
function payoffWords(db: DB, changeIds: ID[]): Map<ID, { quote: string; undoId: ID | null }> {
  const links = hist.linksForFacts(db, 'change', changeIds)
  const lines = kdb.addedLines(db, changeIds)
  const out = new Map<ID, { quote: string; undoId: ID | null }>()
  for (const id of changeIds) {
    const list = links.get(id) ?? []
    const link = list.find((l) => l.state === 'ok') ?? list[0]
    out.set(id, { quote: link?.quote ?? '', undoId: lines.get(id) ?? null })
  }
  return out
}

const layoutFor = createLayoutCache<DB>({ load: readMapLayout, save: writeMapLayout })

/**
 * The relationship map as seen in a story, as of one of its slider's stops. With no stop asked for (or
 * one that isn't on this story's slider), the stop for `sceneId` if it has one, otherwise the last.
 */
export function relationshipMapOf(db: DB, storyId: ID, at: AsOf | null, sceneId: ID | null): RelationshipMap {
  const { shape, data } = readWorld(db, storyId)
  const stops = countChanges(asOfStops(db, storyId), data)
  const same = (a: AsOf): boolean =>
    !!at && a.kind === at.kind && a.storyId === at.storyId && (a.kind !== 'scene' || (at.kind === 'scene' && a.sceneId === at.sceneId))
  const stop = stops.find((s) => same(s.at)) ?? (sceneId ? stops.find((s) => s.sceneId === sceneId) : undefined) ?? stops[stops.length - 1]
  const point: AsOf = stop ? { ...stop.at, seenIn: storyId } : { kind: 'end', storyId }
  const { state, label } = memoryAt(db, point, shape, data)
  return buildMap({
    storyId,
    at: point,
    label,
    stops,
    data,
    state,
    line: buildLine(shape, { storyId, through: 'end' }),
    positions: layoutFor(db, worldGraph(data))
  })
}
