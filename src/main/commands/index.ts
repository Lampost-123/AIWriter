// Under suggestion (the story map, phase 2): the open world's commands as of a point, for the page, the writer's briefing
// and the reading of a scene. Pure rules are in memory/commands.ts; SQL in db/commands.ts; reading scenes in read.ts.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { CommandAdd, CommandChange, PersonUnder, UnderSuggestion } from '@shared/contracts/commands'
import * as repo from '../db/repo'
import * as store from '../db/commands'
import { loadShape } from '../memory/scene'
import { buildLine, labeler, storyOfScene } from '../memory/line'
import type { WorldShape } from '../memory/types'
import { cleanValues, commandsAt, EMPTY_VALUES } from '../memory/commands'
import { UserError } from '../util'

type DB = Database.Database

/** The scenes on a story's line, in order (earlier stories it follows on from first), through its end. */
export function lineOrder(shape: WorldShape, storyId: ID): ID[] {
  return buildLine(shape, { storyId, through: 'end' })
    .steps.flatMap((s) => (s.type === 'scene' ? [s.sceneId] : []))
}

/** Where a scene is in plain words: "Ch 4, Sc 2" in its own story, "Book 1, Ch 4, Sc 2" in another. */
export function whereIn(shape: WorldShape, storyId: ID): (sceneId: ID) => string {
  const label = labeler(shape)
  const own = shape.stories.find((s) => s.id === storyId)?.title ?? ''
  return (sceneId) => {
    const l = label({ storyId: null, sceneId })
    return own && l.startsWith(`${own}, `) ? l.slice(own.length + 2) : l
  }
}

export interface PeopleAt {
  people: PersonUnder[]
  order: ID[]
  point: number
}

/**
 * Everyone under a command as of a scene (as it ends, or as it begins), or the end of the story so far (sceneId null).
 * The line is the story's own, so a series carries its commands from book to book.
 */
export function peopleAt(db: DB, storyId: ID, sceneId: ID | null, o: { asItBegins?: boolean; shape?: WorldShape } = {}): PeopleAt {
  const shape = o.shape ?? loadShape(db)
  const order = lineOrder(shape, storyId)
  const point = sceneId ? order.indexOf(sceneId) : order.length - 1
  if (sceneId && point < 0) return { people: [], order, point }
  const { commands, steps } = store.loadCommands(db)
  const names = new Map(repo.listEntries(db).map((e) => [e.id, e.name]))
  const people = commandsAt({
    commands,
    steps,
    order,
    point,
    asItBegins: o.asItBegins,
    where: whereIn(shape, storyId),
    nameOf: (id) => names.get(id) ?? null
  })
  return { people, order, point }
}

/** The Under suggestion page's data. */
export function underSuggestion(db: DB, storyId: ID, sceneId: ID | null, reading: UnderSuggestion['reading'] = null): UnderSuggestion {
  repo.getStory(db, storyId)
  const shape = loadShape(db)
  const { people } = peopleAt(db, storyId, sceneId, { shape })
  const where = whereIn(shape, storyId)
  let asOf = 'the end of the story so far'
  if (sceneId) asOf = where(sceneId)
  const triggers = people.flatMap((p) =>
    p.commands
      .filter((c) => c.waiting)
      .map((c) => ({ commandId: c.id, subjectName: p.name, trigger: c.values.trigger, does: c.values.does, triggerBy: c.values.triggerBy, giverName: c.giverName }))
  )
  return { storyId, on: store.trackingOn(db, storyId), sceneId, asOf, people, triggers, reading }
}

function sceneInWorld(db: DB, sceneId: ID): { storyId: ID } {
  const story = storyOfScene(loadShape(db), sceneId)
  if (!story) throw new UserError('That scene is no longer in the story. Pick another scene and try again.')
  return { storyId: story.id }
}

/** Adam adds a command himself, from a scene. */
export function addCommand(db: DB, input: CommandAdd): ID {
  const { storyId } = sceneInWorld(db, input.sceneId)
  const values = { ...EMPTY_VALUES, ...cleanValues(input.values) }
  if (!values.words && !values.does) throw new UserError('Say what the command is, or what it makes them do, then add it.')
  const subject = repo.listEntries(db).find((e) => e.id === input.subjectId)
  if (!subject) throw new UserError('That character is no longer in the world. Pick someone else.')
  return db.transaction(() => {
    const id = store.insertCommand(db, { storyId, subjectId: input.subjectId, giverId: input.giverId ?? null, origin: 'adam' })
    store.insertStep(db, { commandId: id, sceneId: input.sceneId, kind: 'given', values, quote: '', note: input.note?.trim() ?? '', origin: 'adam', unsure: false, seq: nextSeq(db, input.sceneId) })
    return id
  })()
}

const nextSeq = (db: DB, sceneId: ID): number => store.stepsInScene(db, sceneId).reduce((m, s) => Math.max(m, s.seq + 1), 0)

/** Adam changes a command from a scene on: what changes, or that it ends, fires or is resisted there. */
export function changeCommand(db: DB, input: CommandChange): ID {
  const command = store.getCommand(db, input.commandId)
  if (!command) throw new UserError('That command is gone. Close this and look again.')
  sceneInWorld(db, input.sceneId)
  const values = input.kind === 'changed' || input.kind === 'stronger' ? cleanValues(input.values) : {}
  if ((input.kind === 'changed' || input.kind === 'stronger') && !Object.keys(values).length && !input.note?.trim()) {
    throw new UserError('Say what changes, then save it.')
  }
  return store.insertStep(db, {
    commandId: command.id,
    sceneId: input.sceneId,
    kind: input.kind,
    values,
    quote: '',
    note: input.note?.trim() ?? '',
    origin: 'adam',
    unsure: false,
    seq: nextSeq(db, input.sceneId)
  })
}

/** Takes back a step Adam made; his first step of a command takes the command with it. */
export function undoStep(db: DB, stepId: ID): ID | null {
  const step = store.getStep(db, stepId)
  if (!step) return null
  const command = store.getCommand(db, step.commandId)
  db.transaction(() => {
    store.deleteStep(db, stepId)
    store.dropEmptyCommands(db)
  })()
  return command?.storyId ?? null
}

/** The story a step's command was given in, for telling the page. */
export function storyOfStep(db: DB, stepId: ID): ID | null {
  const step = store.getStep(db, stepId)
  return step ? (store.getCommand(db, step.commandId)?.storyId ?? null) : null
}
