// One AI consistency check of one scene (milestone 5, AI checks): gathers the memory as of the scene's
// start (context.ts), asks the consistency check model once for every check asked for (cost matters), in
// parts that fit a small model when the scene is long, reads the reply (parse.ts: a malformed reply is asked
// for once more, saying what was wrong, as the memory keeper does; one cut off by the reply limit is asked
// again in two halves), and saves what it found in one go, replacing what the same checks found there
// before. Each request is a 'check' generation record made by the shared task runner, so "What the AI saw"
// works for it. Never writes once stopped by the world closing. No Electron imports.

import type Database from 'better-sqlite3'
import type { CheckKind } from '@shared/contracts/checks'
import type { ChatMessage, Entry, EntryState, ID, WritingPrefs } from '@shared/types'
import * as repo from '../db/repo'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import * as cdb from '../db/checks'
import { CUT_OFF } from '../keeper/json'
import { estimateTokens, plain } from '../keeper/text'
import { fieldOrigin, fieldValue } from '../keeper/facts'
import { newId, UserError } from '../util'
import { checkRequest, checkSections, gatherSceneCheck, splitScene, type SceneCheckContext } from './context'
import { foundIssues, orderedChecks, readCheckReply, type ReadContext } from './parse'
import { retryMessage, sceneSystem } from './prompts'

type DB = Database.Database

/** Low creativity: the check reports, it doesn't invent. */
export const CHECK_TEMPERATURE = 0.2
/** Context length assumed when the model's is unknown. */
const DEFAULT_CONTEXT = 16_000
/** How many times one scene's check may split a part whose reply ran past the reply limit. */
const MAX_SPLITS = 8

export interface CheckOptions {
  db: DB
  model: JobModel
  prefs: WritingPrefs
  /** True once the check should stop (Stop, or the world closing). */
  stopped: () => boolean
  /** True once the world has closed: nothing more is written. */
  closed?: () => boolean
  /** Told each request's task id as it starts, so Stop can stop it. */
  onTask?: (taskId: ID | null) => void
  onKeyRejected?: () => void
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export type SceneOutcome =
  | { status: 'done'; found: number }
  | { status: 'empty' }
  | { status: 'stopped'; found: number }
  | { status: 'error'; error: string; found: number }

/** Room for the reply, and for the scene's text in one request, for this model. */
export function checkBudget(model: Pick<JobModel, 'choice'>, system: string): { reply: number; available: number } {
  const contextLength = model.choice.contextLength && model.choice.contextLength > 0 ? model.choice.contextLength : DEFAULT_CONTEXT
  let reply = Math.max(800, Math.min(3000, Math.floor(contextLength * 0.15)))
  if (model.choice.maxOutput && model.choice.maxOutput > 0) reply = Math.min(reply, model.choice.maxOutput)
  return { reply, available: Math.floor(contextLength * 0.9) - reply - estimateTokens(system) }
}

/** A field is Adam's when he wrote it (as the memory keeper decides it). */
export const adamsField = (e: Entry, field: string): boolean =>
  e.fieldOrigins?.[field] === 'adam' || (fieldOrigin(e, field) === 'adam' && fieldValue(e, field).trim() !== '')

/**
 * True when "Update the memory" may set an entry's field from the text: the field is Adam's own, and no
 * earlier scene's change has set it, so what the memory says at this scene is his note itself.
 */
export function canUpdateField(db: DB, state: EntryState, field: string): boolean {
  if ((state.changed ?? []).includes(field)) return false
  let base: Entry
  try {
    base = repo.getEntry(db, state.id)
  } catch {
    return false
  }
  return adamsField(base, field) && plain(fieldValue(state, field)) === plain(fieldValue(base, field))
}

/** Events from the task runner aren't for the window: the check says how it goes itself. */
const quiet: Emit = () => undefined

/** Checks one scene with these checks and saves what was found. Never throws once started. */
export async function checkScene(o: CheckOptions, sceneId: ID, asked: CheckKind[]): Promise<SceneOutcome> {
  const checks = orderedChecks(asked)
  let ctx: SceneCheckContext
  try {
    ctx = gatherSceneCheck(o.db, sceneId, o.prefs)
  } catch (e) {
    if (e instanceof UserError) return { status: 'error', error: e.message, found: 0 }
    throw e
  }
  if (!ctx.text.trim()) return { status: 'empty' }

  const system = sceneSystem(checks)
  const budget = checkBudget(o.model, system)
  let sections = checkSections(ctx, checks)
  const size = (s: typeof sections): number => s.reduce((n, x) => n + estimateTokens(x.text) + 8, 0)
  // A big memory leaves too little room for the scene: its entries are told in a line each.
  if (size(sections) > budget.available * 0.6) sections = checkSections(ctx, checks, true)
  const room = budget.available - size(sections)
  if (room < 250) {
    return {
      status: 'error',
      error: 'This is more than the consistency check model can read at once. Pick a model that can read more in Settings › Models.',
      found: 0
    }
  }
  const parts = splitScene(ctx.text, room)

  const read: ReadContext = {
    sceneId,
    storyId: ctx.storyId,
    text: ctx.text,
    checks,
    entries: new Map(ctx.entries.map((c) => [c.code, c.entry])),
    scenes: new Map(ctx.earlier.map((s) => [s.code, { sceneId: s.sceneId, label: s.label }])),
    canUpdateMemory: (entryId, field) => {
      const e = ctx.entries.find((c) => c.entry.id === entryId)?.entry
      return !!e && canUpdateField(o.db, e, field)
    }
  }
  const versions = new Map(ctx.entries.map((c) => [c.entry.id, c.entry.updatedAt]))
  const items: Record<string, unknown>[] = []
  let splits = 0
  let failure: string | null = null
  let stopped = false
  // A reply read only in part can't say what is no longer there.
  let partial = false
  const queue = parts.map((text) => ({ text }))
  let number = 0
  const total = (): number => number + queue.length

  while (queue.length && !stopped && !failure) {
    const part = queue.shift()!
    number++
    const req = checkRequest(sections, part.text, { part: number, parts: total() })
    let messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: req.user }
    ]
    let got: Record<string, unknown>[] | null = null
    for (let attempt = 0; attempt < 2 && !got && !stopped && !failure; attempt++) {
      if (o.stopped()) {
        stopped = true
        break
      }
      const taskId = newId()
      o.onTask?.(taskId)
      let done
      try {
        done = await runTask({
          db: o.db,
          taskId,
          job: 'check',
          sceneId,
          model: o.model,
          messages,
          reply: budget.reply,
          temperature: CHECK_TEMPERATURE,
          topP: 1,
          blocks: req.blocks,
          entries: req.entryIds.map((id) => ({ entryId: id, version: versions.get(id) ?? '' })),
          emit: quiet,
          onKeyRejected: o.onKeyRejected,
          fetchImpl: o.fetchImpl,
          retryDelays: o.retryDelays
        })
      } catch (e) {
        failure = e instanceof UserError ? e.message : 'Something went wrong starting the check. Try again.'
        break
      } finally {
        o.onTask?.(null)
      }
      if (done.status === 'stopped' || o.stopped()) {
        stopped = true
        break
      }
      if (done.status === 'error') {
        failure = done.error ?? 'Something went wrong while checking. Try again.'
        break
      }
      const reply = readCheckReply(done.text)
      if (reply.ok) {
        got = reply.items
        if (!reply.complete) partial = true
        break
      }
      // A long reply cut off by the reply limit: asking again would be cut off the same way, so the part is checked in halves.
      if ((reply.why === CUT_OFF || done.cutOff) && splits < MAX_SPLITS) {
        const halves = splitScene(part.text, Math.ceil(estimateTokens(part.text) / 2))
        if (halves.length > 1) {
          splits++
          queue.unshift(...halves.map((text) => ({ text })))
          number--
          break
        }
      }
      messages = [...messages, { role: 'assistant', content: done.text }, { role: 'user', content: retryMessage(reply.why) }]
      if (attempt === 1) {
        failure =
          "The consistency check model's reply wasn't in the right format. Try again, or pick another consistency check model in Settings › Models."
      }
    }
    if (got) items.push(...got)
  }

  if (!o.db.open || o.closed?.() || (stopped && !items.length)) return { status: 'stopped', found: 0 }
  // The scene may have been deleted while it was checked.
  if (!cdb.sceneTexts(o.db, [sceneId]).has(sceneId)) return { status: 'stopped', found: 0 }
  const found = foundIssues(items, read)
  const whole = !stopped && !failure && !partial
  // A whole check replaces what the same checks found here before; a check cut short only adds.
  const replaces = whole ? (p: cdb.IssuePayload) => !!p.check && (checks as string[]).includes(p.check) : () => false
  const raised = cdb.saveFound(o.db, cdb.rowsInScenes(o.db, [sceneId]), found, replaces)
  if (failure) return { status: 'error', error: failure, found: raised }
  if (stopped) return { status: 'stopped', found: raised }
  return { status: 'done', found: raised }
}
