// The memory as of a point in the series (milestone 3): entry pages' as-of slider, the relationship
// map, hover cards and the Cast tab. The same line decides it as for drafting (spec, Multi-story
// rules: "every as-of view uses it too"). No Electron imports.
import type Database from 'better-sqlite3'
import type { AsOf, AsOfStop, EntryAsOf, ID } from '@shared/types'
import type { Line, LineStep, MemoryData, WorldShape } from './types'
import { buildLine, labeler } from './line'
import { indexChanges, stateAt, type MemoryStateAll } from './state'
import { loadMemoryData, loadShape } from './scene'
import * as mem from '../db/memory'
import * as repo from '../db/repo'
import { UserError } from '../util'

type DB = Database.Database

/** The memory at a point, with the line it was worked out along and the point in plain words. */
export interface MemoryAt {
  shape: WorldShape
  data: MemoryData
  line: Line
  state: MemoryStateAll
  label: string
}

const titleOf = (shape: WorldShape, storyId: ID): string => shape.stories.find((s) => s.id === storyId)?.title ?? ''

/** A point in plain words: "Start of Book 2", "Book 1, Ch 12, Sc 3", "End of Book 2". */
export function asOfLabel(shape: WorldShape, at: AsOf): string {
  if (at.kind === 'scene') return labeler(shape)({ storyId: at.storyId, sceneId: at.sceneId })
  return `${at.kind === 'start' ? 'Start' : 'End'} of ${titleOf(shape, at.storyId)}`
}

/** Whether a step of a walk is the point. */
const isPoint = (step: LineStep, at: AsOf): boolean =>
  at.kind === 'scene'
    ? step.type === 'scene' && step.sceneId === at.sceneId
    : step.storyId === at.storyId && step.type === (at.kind === 'start' ? 'start-changes' : 'end')

/** The point's own line: its story walked up to it. */
function ownLine(shape: WorldShape, at: AsOf): Line {
  if (at.kind === 'scene') return buildLine(shape, { storyId: at.storyId, after: at.sceneId })
  return buildLine(shape, { storyId: at.storyId, through: at.kind === 'start' ? 'start' : 'end' })
}

/**
 * The line a point is seen along: the `seenIn` story's walk cut just after the point. A point that
 * isn't on that walk (a story it never sees) falls back to the point's own line.
 */
export function lineAt(shape: WorldShape, at: AsOf): Line {
  if (!shape.stories.some((s) => s.id === at.storyId)) throw new UserError('That story no longer exists.')
  if (at.kind === 'scene' && !shape.stories.some((s) => s.chapters.some((c) => c.scenes.some((sc) => sc.id === at.sceneId)))) {
    throw new UserError('That scene no longer exists.')
  }
  const seenIn = at.seenIn && at.seenIn !== at.storyId && shape.stories.some((s) => s.id === at.seenIn) ? at.seenIn : null
  if (seenIn) {
    const whole = buildLine(shape, { storyId: seenIn, through: 'end' })
    const i = whole.steps.findIndex((step) => isPoint(step, at))
    if (i >= 0) return { ...whole, steps: whole.steps.slice(0, i + 1) }
  }
  return ownLine(shape, at)
}

/** Works out the memory at a point. About as quick as a scene's briefing (one read of the memory). */
export function memoryAt(db: DB, at: AsOf, shape: WorldShape = loadShape(db), data: MemoryData = loadMemoryData(db)): MemoryAt {
  const line = lineAt(shape, at)
  return { shape, data, line, state: stateAt(data, shape, line, indexChanges(data.changes)), label: asOfLabel(shape, at) }
}

/**
 * The stops of an as-of slider for a story: the start of each story on its line (after its
 * start-of-story changes) and every scene, through the story's end, in reading order. Each stop is
 * seen along this story's line. With an entry, each stop counts that entry's changes there.
 */
export function asOfStops(db: DB, storyId: ID, entryId?: ID | null): AsOfStop[] {
  const shape = loadShape(db)
  if (!shape.stories.some((s) => s.id === storyId)) throw new UserError('That story no longer exists.')
  const line = buildLine(shape, { storyId, through: 'end' })
  const label = labeler(shape)
  const atScene = new Map<ID, number>()
  const atStart = new Map<ID, number>()
  if (entryId) {
    for (const c of mem.changesForEntry(db, entryId)) {
      if (c.anchor === 'scene' && c.sceneId) atScene.set(c.sceneId, (atScene.get(c.sceneId) ?? 0) + 1)
      else if (c.anchor === 'story-start' && c.storyId) atStart.set(c.storyId, (atStart.get(c.storyId) ?? 0) + 1)
    }
  }
  const stops: AsOfStop[] = []
  for (const step of line.steps) {
    if (step.type === 'start-changes') {
      stops.push({
        at: { kind: 'start', storyId: step.storyId, seenIn: storyId },
        label: `Start of ${titleOf(shape, step.storyId)}`,
        storyId: step.storyId,
        sceneId: null,
        changes: atStart.get(step.storyId) ?? 0
      })
    } else if (step.type === 'scene') {
      stops.push({
        at: { kind: 'scene', storyId: step.storyId, sceneId: step.sceneId, seenIn: storyId },
        label: label({ storyId: step.storyId, sceneId: step.sceneId }),
        storyId: step.storyId,
        sceneId: step.sceneId,
        changes: atScene.get(step.sceneId) ?? 0
      })
    }
  }
  return stops
}

/** An entry as it is at a point: its state (or why it isn't there yet), relationships, what it knows, a thread's status. */
export function entryAsOf(db: DB, entryId: ID, at: AsOf, shape?: WorldShape, data?: MemoryData): EntryAsOf {
  repo.getEntry(db, entryId) // a plain-words error when it has been deleted
  const { state, label } = memoryAt(db, at, shape, data)
  const entry = state.entries.get(entryId) ?? null
  return {
    at,
    label,
    state: entry,
    absent: entry ? null : 'Not in the story yet at this point',
    relationships: entry ? state.relationships.filter((r) => r.aId === entryId || r.bId === entryId) : [],
    knows: entry ? state.facts.filter((f) => f.knownBy.includes(entryId)) : [],
    thread: entry ? (state.threads.find((t) => t.entryId === entryId) ?? null) : null
  }
}
