// When the memory model (or the consistency check model) turns a scene down: some models won't read explicit scenes,
// and Adam writes them. Each job that was turned down goes on without what it asked for (a summary, a plan, a check)
// and is noted here, by world; the top bar shows one lasting note in plain words (MemoryStatus.refused) that says what
// was skipped and what to do: pick another model. It stays until Adam dismisses it or picks another model, and gathers
// every refusal since rather than telling each one on its own. A memory read that is turned down has its own lasting
// note already ("Memory isn't updating", keeper/run.ts), so it isn't noted here.
// What was turned down is also remembered by its words (below), so the same words aren't sent to the same model again
// and again: every call is paid for. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'

type DB = Database.Database

/** What was turned down, by what it was for. */
export type RefusedTask = 'summary' | 'rollup' | 'stage' | 'plan' | 'repair' | 'check'

/** Which model turned it down, as Settings › Models names it. */
export type RefusingModel = 'memory' | 'check'

export interface Refusal {
  task: RefusedTask
  model: RefusingModel
  /** The model's provider and id ("providerId:modelId"): a note goes once another model is picked. */
  modelKey: string
  /** The scene it was about; null for a roll-up (a chapter, story or series summary). */
  sceneId: ID | null
  at: number
}

/** The most refusals kept per world: the note counts scenes, so a long run of them needn't all be kept. */
const MOST = 50

const notes = new WeakMap<DB, Refusal[]>()
const listeners = new Set<(db: DB) => void>()

/** The key a model is known by here: its provider and its id. */
export const modelKeyOf = (m: { target: { id: string }; choice: { modelId: string } }): string => `${m.target.id}:${m.choice.modelId}`

/** A job was turned down: noted for the top bar's note, and the listeners told (the window's status is sent again). */
export function noteRefusal(db: DB, r: Omit<Refusal, 'at'>): void {
  const was = notes.get(db) ?? []
  notes.set(db, [...was, { ...r, at: Date.now() }].slice(-MOST))
  for (const fn of listeners) {
    try {
      fn(db)
    } catch (e) {
      console.warn('Could not pass on a refusal', e)
    }
  }
}

/** Told whenever a refusal is noted. Returns a function that stops it. */
export function onRefusal(fn: (db: DB) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Adam dismissed the note: it comes back only with a new refusal. */
export function dismissRefusals(db: DB): void {
  notes.delete(db)
}

/** The refusals noted for a world, oldest first (for tests and the note). */
export const refusalsOf = (db: DB): readonly Refusal[] => notes.get(db) ?? []

const MODEL_NAME: Record<RefusingModel, string> = { memory: 'memory model', check: 'consistency check model' }

/**
 * What went without: for the one scene named; for one of several scenes named; for several of them.
 */
const SKIPPED: Record<RefusedTask, [only: string, oneOf: string, several: string]> = {
  summary: ['its summary wasn’t written', 'a summary wasn’t written', 'their summaries weren’t written'],
  rollup: [
    'a chapter or story summary wasn’t brought up to date',
    'a chapter or story summary wasn’t brought up to date',
    'some chapter or story summaries weren’t brought up to date'
  ],
  stage: [
    'where things stand at its end is carried on from the scene before (put it right in Recall)',
    'where things stand is carried on through one of them (put it right in Recall)',
    'where things stand is carried on through them (put it right in Recall)'
  ],
  plan: ['a draft was written without a plan', 'a draft was written without a plan', 'some drafts were written without a plan'],
  repair: [
    'new words weren’t checked against the memory',
    'new words weren’t checked against the memory',
    'new words weren’t checked against the memory'
  ],
  check: ['it wasn’t checked for consistency', 'one wasn’t checked for consistency', 'they weren’t checked for consistency']
}
const ORDER: RefusedTask[] = ['check', 'summary', 'stage', 'plan', 'repair', 'rollup']

/** "a, b and c". */
const listed = (xs: string[]): string => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : (xs[0] ?? ''))

/**
 * The top bar's note, from the refusals still worth telling: only those by a model still in use (`current`: the key
 * of the memory model and of the consistency check model now, null when there is none). `where` names a scene
 * ("Chapter 2, Scene 3"). Null when there is nothing to tell.
 */
export function refusalNote(
  db: DB,
  current: Record<RefusingModel, string | null>,
  where: (sceneId: ID) => string
): { title: string; message: string } | null {
  const live = refusalsOf(db).filter((r) => current[r.model] === r.modelKey)
  if (!live.length) return null
  const models = (['memory', 'check'] as RefusingModel[]).filter((m) => live.some((r) => r.model === m))
  const sentences = models.map((model) => {
    const mine = live.filter((r) => r.model === model)
    const scenes = [...new Set(mine.map((r) => r.sceneId).filter((id): id is ID => !!id))]
    const latest = [...mine].reverse().find((r) => r.sceneId)?.sceneId ?? null
    // Only roll-ups: no scene to name.
    if (!latest) return `The ${MODEL_NAME[model]} turned down a chapter or story summary, so it wasn’t brought up to date.`
    const name = where(latest) || 'a scene'
    const others = scenes.length > 1 ? ` and ${scenes.length - 1 === 1 ? '1 other scene' : `${scenes.length - 1} other scenes`}` : ''
    const many = scenes.length > 1
    const skipped = ORDER.filter((t) => mine.some((r) => r.task === t)).map((t) => {
      const n = new Set(mine.filter((r) => r.task === t).map((r) => r.sceneId ?? `rollup:${r.at}`)).size
      return SKIPPED[t][!many ? 0 : n > 1 ? 2 : 1]
    })
    return `The ${MODEL_NAME[model]} turned down ${name}${others}, so ${listed(skipped)}.`
  })
  const names = models.map((m) => MODEL_NAME[m])
  const title = models.length > 1 ? 'Scenes were turned down' : `The ${names[0]} turned a scene down`
  const pick = models.length > 1 ? 'Pick other models' : `Pick another ${names[0]}`
  return {
    title,
    message: `${sentences.join(' ')} Some models won’t read explicit scenes. ${pick} in Settings › Models.`
  }
}

// ---------- What was turned down, by its words ----------
// A scene's reading or its summary that the memory model turned down isn't asked for again (before every draft, at
// every start) until the scene's words change, another memory model is picked, or Adam presses Try again. Kept in the
// world's `meta` under 'memory-refused', by scene: the hash of the words that were turned down and the model's key.

export const REFUSED_KEY = 'memory-refused'

/** What was turned down: the memory reading the scene, or writing its summary. */
export type RefusedKind = 'read' | 'summary'

type Store = Partial<Record<RefusedKind, Record<ID, { hash: string; model: string }>>>

function loadStore(db: DB): Store {
  try {
    const raw = JSON.parse(repo.getMeta(db, REFUSED_KEY) ?? '{}') as unknown
    return raw && typeof raw === 'object' ? (raw as Store) : {}
  } catch {
    return {}
  }
}

/** The model turned down these words of the scene (`hash`). */
export function markRefused(db: DB, kind: RefusedKind, sceneId: ID, hash: string, model: string): void {
  if (!db.open) return
  const all = loadStore(db)
  all[kind] = { ...(all[kind] ?? {}), [sceneId]: { hash, model } }
  repo.setMeta(db, REFUSED_KEY, JSON.stringify(all))
}

/** True when this model already turned down these words of the scene: asking again would be paid for and turned down again. */
export function wasRefused(db: DB, kind: RefusedKind, sceneId: ID, hash: string, model: string | null): boolean {
  if (!model || !db.open) return false
  const r = loadStore(db)[kind]?.[sceneId]
  return !!r && r.hash === hash && r.model === model
}

/** Try again: what was turned down (for one scene, or every scene) is asked for once more. */
export function clearRefused(db: DB, sceneId?: ID): void {
  if (!db.open) return
  const all = loadStore(db)
  if (!Object.keys(all).length) return
  if (!sceneId) return repo.setMeta(db, REFUSED_KEY, '{}')
  let changed = false
  for (const kind of Object.keys(all) as RefusedKind[]) {
    if (all[kind]?.[sceneId]) {
      delete all[kind]![sceneId]
      changed = true
    }
  }
  if (changed) repo.setMeta(db, REFUSED_KEY, JSON.stringify(all))
}
