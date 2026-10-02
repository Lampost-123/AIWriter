// The world views (milestone 3): the timeline, the relationship map and the plot threads board. Each
// reads the world once and works its view out with the same line as drafting, for one story at a time.
// No Electron imports, so each is tested against an in-memory world (views.test.ts, perf.test.ts).
import type Database from 'better-sqlite3'
import type { AsOf, ID } from '@shared/types'
import type { RelationshipMap, ThreadsBoard, Timeline } from '@shared/contracts/worldViews'
import { asOfStops, memoryAt } from '../memory/asOf'
import { buildLine } from '../memory/line'
import { loadMemoryData, loadShape } from '../memory/scene'
import { sceneCards } from '../db/worldViews'
import { UserError } from '../util'
import { buildTimeline } from './timeline'
import { buildBoard } from './threads'
import { buildMap, countChanges, createLayoutCache, worldGraph } from './map'

type DB = Database.Database

/** The memory at a story's end, with the shape and data it was worked out from. */
function atEnd(db: DB, storyId: ID): ReturnType<typeof memoryAt> {
  const shape = loadShape(db)
  if (!shape.stories.some((s) => s.id === storyId)) throw new UserError('That story no longer exists. Choose another story.')
  return memoryAt(db, { kind: 'end', storyId }, shape, loadMemoryData(db))
}

export function timelineOf(db: DB, storyId: ID): Timeline {
  const { shape, data, line, state } = atEnd(db, storyId)
  return buildTimeline({ storyId, shape, data, line, state, cards: sceneCards(db) })
}

export function threadsBoardOf(db: DB, storyId: ID): ThreadsBoard {
  const { shape, data, line, state } = atEnd(db, storyId)
  return buildBoard({ storyId, shape, data, line, state, cards: sceneCards(db) })
}

const layoutFor = createLayoutCache()

/**
 * The relationship map as seen in a story, as of one of its slider's stops. With no stop asked for (or
 * one that isn't on this story's slider), the stop for `sceneId` if it has one, otherwise the last.
 */
export function relationshipMapOf(db: DB, storyId: ID, at: AsOf | null, sceneId: ID | null): RelationshipMap {
  const shape = loadShape(db)
  if (!shape.stories.some((s) => s.id === storyId)) throw new UserError('That story no longer exists. Choose another story.')
  const data = loadMemoryData(db)
  const stops = countChanges(asOfStops(db, storyId), data)
  const same = (a: AsOf): boolean =>
    !!at && a.kind === at.kind && a.storyId === at.storyId && (a.kind !== 'scene' || (at.kind === 'scene' && a.sceneId === at.sceneId))
  const stop =
    stops.find((s) => same(s.at)) ?? (sceneId ? stops.find((s) => s.sceneId === sceneId) : undefined) ?? stops[stops.length - 1]
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
