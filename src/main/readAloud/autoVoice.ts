// A character's read-aloud voice, filled in by the AI by itself. Whenever the AI makes or fills in a character
// (Quick start and the builder's suggestions Adam keeps, the memory finding someone new in a scene, the World
// builder), the character gets "How they sound" as Suggest on its page would write it (the same prompt, the same
// Read aloud model), and "Say it as" when its name is easy to misread.
//
// The rules (each tested in autoVoice.test.ts):
// - Only into an empty box: a description, a voice from the list or a "Say it as" Adam has set is never replaced,
//   even one set while the AI was writing.
// - In the background, one character at a time, never holding up the job that made them. A request that fails
//   leaves the box empty, as it was; nothing here throws.
// - Saved even when reading aloud isn't set up: it is only words, ready for when it is.
// - The background queue asks about each character once a session, so a voice Adam clears stays cleared.
// No Electron imports: the caller passes the model, the lines and what to tell the window.

import type Database from 'better-sqlite3'
import type { TaskDone } from '@shared/contracts/tasks'
import type { Entry, ID } from '@shared/types'
import * as repo from '../db/repo'
import { runTask, type Emit } from '../ai/tasks'
import type { JobModel } from '../ai/jobModel'
import { newId } from '../util'
import { cleanDesign, linesSpokenBy, readVoiceReply, voicePrompt } from './suggest'
import { getEntryReadAloud, setEntryReadAloud } from './voiceStore'

type DB = Database.Database

/** Room for the reply: a description of at most 40 words, and a "Say it as" line when one is asked for. */
export const VOICE_REPLY_TOKENS = 200
const VOICE_SAY_REPLY_TOKENS = 240
export const VOICE_TEMPERATURE = 0.5

const quiet: Emit = () => undefined

export interface VoiceRequest {
  db: DB
  entry: Entry
  /** Some of the character's own lines from the stories. */
  lines: string[]
  /** The description in the box now (Suggest keeps what fits); '' for none. */
  current?: string
  model: JobModel
  taskId: ID
  emit?: Emit
  /** Asks how the name is said too, for a name a narrator would likely misread. */
  withSay?: boolean
  onKeyRejected?: () => void
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export interface VoiceReply {
  done: TaskDone
  /** The description ('' when the request failed). */
  design: string
  /** How the name is said; '' when not asked for, or the name needs none. */
  say: string
}

/** One request for a character's voice, exactly as Suggest makes it (a 'speech' record with no scene). */
export async function askVoice(r: VoiceRequest): Promise<VoiceReply> {
  const done = await runTask({
    db: r.db,
    taskId: r.taskId,
    job: 'speech',
    sceneId: null,
    model: r.model,
    messages: voicePrompt(r.entry, r.lines, r.current ?? '', { say: !!r.withSay }),
    reply: r.withSay ? VOICE_SAY_REPLY_TOKENS : VOICE_REPLY_TOKENS,
    temperature: VOICE_TEMPERATURE,
    direction: `A voice for ${r.entry.name}`,
    emit: r.emit ?? quiet,
    onKeyRejected: r.onKeyRejected,
    fetchImpl: r.fetchImpl,
    retryDelays: r.retryDelays
  })
  if (done.status === 'error') return { done, design: '', say: '' }
  if (!r.withSay) return { done, design: cleanDesign(done.text), say: '' }
  return { done, ...readVoiceReply(done.text, r.entry) }
}

/** A character with nothing in "How they sound": no description and no voice from the list. */
export function needsVoice(db: DB, e: Pick<Entry, 'id' | 'kind'>): boolean {
  if (e.kind !== 'character') return false
  const v = getEntryReadAloud(db, e.id).voice
  return !v.design.trim() && !v.voice.trim()
}

/**
 * Saves what the AI wrote into the boxes that are empty now: the description only while the character has no voice
 * at all, "Say it as" only while it is empty. True when something was saved.
 */
export function keepVoice(db: DB, entryId: ID, got: { design: string; say: string }): boolean {
  if (!db.open || !repo.getEntries(db, [entryId]).length) return false
  const now = getEntryReadAloud(db, entryId)
  const voiceFree = !now.voice.design.trim() && !now.voice.voice.trim()
  const design = voiceFree && got.design.trim() ? got.design.trim() : now.voice.design
  const say = !now.say.trim() && got.say.trim() ? got.say.trim() : now.say
  if (design === now.voice.design && say === now.say) return false
  setEntryReadAloud(db, entryId, { voice: { design, voice: now.voice.voice }, say })
  return true
}

export interface GiveVoicesOptions {
  db: DB
  model: JobModel
  /** A character's own lines from the stories; by default, those a dialogue tag gives them in any story. */
  lines?: (e: Entry) => string[]
  /** Sent each request's progress; nothing by default (no window is waiting on it). */
  emit?: Emit
  /** True once the caller has stopped (Cancel, the world closing): nothing more is asked or written. */
  stopped?: () => boolean
  /** Told each request's task id as it starts (null when it ends), so the caller can stop it. */
  onTask?: (taskId: ID | null) => void
  /** Told before each character is asked about: its place in the list, from 1, and how many there are. */
  onStep?: (n: number, of: number) => void
  /** Told each character as soon as its voice is saved. */
  onVoiced?: (entryId: ID) => void
  onKeyRejected?: () => void
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

export interface GiveVoicesResult {
  /** The characters given a voice (or a "Say it as"). */
  voiced: ID[]
  /** USD; null when unknown. */
  cost: number | null
}

/** Gives each of these characters that has no voice yet a voice, one request each, in order. Never throws. */
export async function giveVoices(o: GiveVoicesOptions, entryIds: ID[]): Promise<GiveVoicesResult> {
  const out: GiveVoicesResult = { voiced: [], cost: null }
  let characters: Entry[]
  try {
    characters = repo.getEntries(o.db, [...new Set(entryIds)]).filter((e) => needsVoice(o.db, e))
  } catch (e) {
    console.warn('Could not find the characters to give voices', e)
    return out
  }
  const storyIds = o.lines ? [] : repo.listStories(o.db).map((s) => s.id)
  for (const [i, e] of characters.entries()) {
    if (o.stopped?.() || !o.db.open) break
    o.onStep?.(i + 1, characters.length)
    const taskId = newId()
    o.onTask?.(taskId)
    let got: VoiceReply
    try {
      let lines: string[] = []
      try {
        lines = o.lines ? o.lines(e) : linesSpokenBy(o.db, e, { storyIds })
      } catch {
        /* Their lines can't be read: the description comes from the page alone. */
      }
      got = await askVoice({
        db: o.db,
        entry: e,
        lines,
        model: o.model,
        taskId,
        emit: o.emit,
        withSay: true,
        onKeyRejected: o.onKeyRejected,
        fetchImpl: o.fetchImpl,
        retryDelays: o.retryDelays
      })
    } catch (err) {
      console.warn('Could not ask for a voice', err)
      continue
    } finally {
      o.onTask?.(null)
    }
    if (got.done.cost != null) out.cost = (out.cost ?? 0) + got.done.cost
    if (got.done.status !== 'complete' || !got.design || o.stopped?.() || !o.db.open) continue
    try {
      if (keepVoice(o.db, e.id, got)) {
        out.voiced.push(e.id)
        o.onVoiced?.(e.id)
      }
    } catch (err) {
      console.warn('Could not save a voice', err)
    }
  }
  return out
}

// ---------- In the background ----------

export interface VoiceLaterOptions {
  db: DB
  /** The Read aloud model (the one Suggest uses), asked for when the voices are; null when there is none. */
  model: () => JobModel | null
  /** False once the world has closed or another is open: nothing more is asked or written. */
  live?: () => boolean
  /** Waits this long first, starting again if the same character is handed over meanwhile (Adam keeping one builder suggestion after another). */
  delayMs?: number
  lines?: (e: Entry) => string[]
  /** Told the characters given voices, so their pages show them. */
  onVoiced?: (entryIds: ID[]) => void
  /** For tests. */
  fetchImpl?: typeof fetch
  retryDelays?: number[]
}

/** The characters the background queue has asked about this session, by world. */
const asked = new WeakMap<DB, Set<ID>>()
const waiting = new Map<ID, ReturnType<typeof setTimeout>>()
let queue: Promise<void> = Promise.resolve()

/**
 * Gives these characters voices in the background, after whatever the queue is doing, as a follow-on that never
 * slows or breaks the job that made them. Entries that aren't characters, or that have a voice, are left alone.
 */
export function voiceLater(entryIds: ID[], o: VoiceLaterOptions): void {
  const go = (ids: ID[]): void => {
    queue = queue.then(() => voiceNow(ids, o)).catch((e) => console.warn('Could not give the characters their voices', e))
  }
  if (!o.delayMs) return go(entryIds)
  for (const id of new Set(entryIds)) {
    const was = waiting.get(id)
    if (was) clearTimeout(was)
    const timer = setTimeout(() => {
      waiting.delete(id)
      go([id])
    }, o.delayMs)
    timer.unref?.()
    waiting.set(id, timer)
  }
}

/** Resolves once the background queue has nothing left to do (for tests). Characters still waiting out a delay aren't counted. */
export const voicesSettled = (): Promise<void> => queue

async function voiceNow(entryIds: ID[], o: VoiceLaterOptions): Promise<void> {
  const live = (): boolean => o.db.open && (o.live?.() ?? true)
  if (!live()) return
  const seen = asked.get(o.db) ?? new Set<ID>()
  asked.set(o.db, seen)
  const todo = repo
    .getEntries(
      o.db,
      entryIds.filter((id) => !seen.has(id))
    )
    .filter((e) => needsVoice(o.db, e))
  if (!todo.length) return
  const model = o.model()
  if (!model) return
  for (const e of todo) seen.add(e.id)
  const result = await giveVoices(
    { db: o.db, model, lines: o.lines, stopped: () => !live(), fetchImpl: o.fetchImpl, retryDelays: o.retryDelays },
    todo.map((e) => e.id)
  )
  if (result.voiced.length && live()) o.onVoiced?.(result.voiced)
}
