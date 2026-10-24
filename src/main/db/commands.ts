// Under suggestion's SQL (migration 7): the commands people are under and each step of their history. What holds at a
// point is worked out from these in memory/commands.ts; reading them from the scenes is commands/read.ts. Whether a
// story is tracked is a meta row (`commands_on:<story id>`), as other per-story choices are, so it needs no migration.
import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import type { CommandStep, CommandStepKind, CommandValues } from '@shared/contracts/commands'
import { newId, now } from '../util'
import { getMeta, setMeta } from './repo'

type DB = Database.Database
type Row = Record<string, unknown>

export interface CommandRow {
  id: ID
  storyId: ID
  subjectId: ID
  giverId: ID | null
  origin: 'ai' | 'adam'
  createdAt: string
}

const ON_PREFIX = 'commands_on:'
/** The source of the last reading of a scene for commands (commands/read.ts), so an unchanged scene isn't read again. */
const READ_PREFIX = 'commands_read:'

export const trackingOn = (db: DB, storyId: ID): boolean => getMeta(db, ON_PREFIX + storyId) === '1'
export const setTracking = (db: DB, storyId: ID, on: boolean): void => setMeta(db, ON_PREFIX + storyId, on ? '1' : '0')

export const readHash = (db: DB, sceneId: ID): string | null => getMeta(db, READ_PREFIX + sceneId)
export const setReadHash = (db: DB, sceneId: ID, hash: string): void => setMeta(db, READ_PREFIX + sceneId, hash)

const STEP_KINDS: CommandStepKind[] = ['given', 'stronger', 'changed', 'fired', 'resisted', 'ended']

function parseValues(s: unknown): Partial<CommandValues> {
  try {
    const v = JSON.parse(String(s ?? '{}'))
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Partial<CommandValues>) : {}
  } catch {
    return {}
  }
}

const toCommand = (r: Row): CommandRow => ({
  id: String(r.id),
  storyId: String(r.story_id),
  subjectId: String(r.subject_id),
  giverId: r.giver_id ? String(r.giver_id) : null,
  origin: r.origin === 'adam' ? 'adam' : 'ai',
  createdAt: String(r.created_at)
})

const toStep = (r: Row): CommandStep => ({
  id: String(r.id),
  commandId: String(r.command_id),
  sceneId: String(r.scene_id),
  kind: STEP_KINDS.includes(r.kind as CommandStepKind) ? (r.kind as CommandStepKind) : 'changed',
  values: parseValues(r.values_json),
  quote: String(r.quote ?? ''),
  note: String(r.note ?? ''),
  origin: r.origin === 'adam' ? 'adam' : 'ai',
  answer: r.answer === 'yes' || r.answer === 'no' ? r.answer : '',
  unsure: !!r.unsure,
  seq: Number(r.seq ?? 0),
  createdAt: String(r.created_at)
})

/** Every command in the world with at least one step, and all their steps (a world holds few; the line picks what counts). */
export function loadCommands(db: DB): { commands: CommandRow[]; steps: CommandStep[] } {
  const steps = (db.prepare('SELECT * FROM command_steps ORDER BY created_at, seq').all() as Row[]).map(toStep)
  const used = new Set(steps.map((s) => s.commandId))
  const commands = (db.prepare('SELECT * FROM commands ORDER BY created_at').all() as Row[]).map(toCommand).filter((c) => used.has(c.id))
  return { commands, steps }
}

export function getCommand(db: DB, id: ID): CommandRow | null {
  const r = db.prepare('SELECT * FROM commands WHERE id = ?').get(id) as Row | undefined
  return r ? toCommand(r) : null
}

export function getStep(db: DB, id: ID): CommandStep | null {
  const r = db.prepare('SELECT * FROM command_steps WHERE id = ?').get(id) as Row | undefined
  return r ? toStep(r) : null
}

export function stepsOfCommand(db: DB, commandId: ID): CommandStep[] {
  return (db.prepare('SELECT * FROM command_steps WHERE command_id = ? ORDER BY created_at, seq').all(commandId) as Row[]).map(toStep)
}

export function stepsInScene(db: DB, sceneId: ID): CommandStep[] {
  return (db.prepare('SELECT * FROM command_steps WHERE scene_id = ? ORDER BY seq, created_at').all(sceneId) as Row[]).map(toStep)
}

export function insertCommand(db: DB, c: Omit<CommandRow, 'id' | 'createdAt'> & { id?: ID }): ID {
  const id = c.id ?? newId()
  const t = now()
  db.prepare('INSERT INTO commands (id, story_id, subject_id, giver_id, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    c.storyId,
    c.subjectId,
    c.giverId,
    c.origin,
    t,
    t
  )
  return id
}

export function setGiver(db: DB, commandId: ID, giverId: ID | null): void {
  db.prepare('UPDATE commands SET giver_id = ?, updated_at = ? WHERE id = ?').run(giverId, now(), commandId)
}

export function insertStep(db: DB, s: Omit<CommandStep, 'id' | 'createdAt' | 'answer'> & { id?: ID; answer?: CommandStep['answer'] }): ID {
  const id = s.id ?? newId()
  db.prepare(
    `INSERT INTO command_steps (id, command_id, scene_id, kind, values_json, quote, note, origin, answer, unsure, seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, s.commandId, s.sceneId, s.kind, JSON.stringify(s.values ?? {}), s.quote, s.note, s.origin, s.answer ?? '', s.unsure ? 1 : 0, s.seq, now())
  return id
}

export function setAnswer(db: DB, stepId: ID, answer: CommandStep['answer']): void {
  db.prepare('UPDATE command_steps SET answer = ? WHERE id = ?').run(answer, stepId)
}

export function deleteStep(db: DB, stepId: ID): void {
  db.prepare('DELETE FROM command_steps WHERE id = ?').run(stepId)
}

/** Drops commands that have no steps left. */
export function dropEmptyCommands(db: DB): void {
  db.prepare('DELETE FROM commands WHERE id NOT IN (SELECT DISTINCT command_id FROM command_steps)').run()
}

/**
 * The memory's own unanswered steps in a scene, before a new reading of it puts its own in their place. Steps Adam
 * answered (yes or no) and his own stay; so do commands given here that later steps lean on (dropEmptyCommands takes the
 * rest).
 */
export function clearReadSteps(db: DB, sceneId: ID): void {
  db.prepare("DELETE FROM command_steps WHERE scene_id = ? AND origin = 'ai' AND answer = ''").run(sceneId)
  dropEmptyCommands(db)
}
