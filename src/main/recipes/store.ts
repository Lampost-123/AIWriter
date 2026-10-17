// The recipe library's files (spec, "Story recipes": one file per recipe plus the imported story's text, so it can
// be read again), in the Recipes folder of the library (paths.ts):
//   <id>/recipe.json   the recipe: its name, parts, which parts Adam changed, whether it is being made
//   <id>/source.json   the story's text (source.ts), while it is kept
//   <id>/making.json   while the recipe is being made: each chapter's notes so far, so it carries on after a restart
//   <id>/plans/<storyId>.json  a story being planned from it: Adam's guidance and the premise (2026-10-17)
//   .removed/<id>/     a recipe deleted or cancelled, until its Undo has gone (then deleted for good)
//   spending.db        what the Recipe maker's calls cost (spending.ts), with no words
// Folders are named by id, never by the story's title. No Electron imports.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { RecipePartId, RecipeParts, RecipeStatus, RecipeSummary } from '@shared/contracts/recipes'
import { readJson, renameRetrySync, UserError, writeFileAtomic } from '../util'
import { emptyParts } from './parse'
import type { RecipeSource } from './source'

export interface StoredRecipe {
  version: 1
  id: string
  name: string
  /** Who named it: the AI's suggestion is replaced when the story is read again; Adam's never is. */
  nameBy: 'ai' | 'adam'
  status: RecipeStatus
  problem: string | null
  words: number
  chapters: number
  byHand: boolean
  createdAt: string
  updatedAt: string
  parts: RecipeParts
  edited: RecipePartId[]
  /** Chapters (from 1) the AI couldn't read when it was last made: the recipe leaves them out. */
  unread?: number[]
  /** Made by a newer AI Write: it can't be opened, changed or made here (never written to the file). */
  newer?: boolean
}

export interface MakingFile {
  version: 1
  /** When it was asked for: recipes are made in this order. */
  queuedAt: string
  /** Each chapter's notes, null until read. */
  notes: (string | null)[]
  /**
   * Why it is paused: 'auto' (no model, the spending limit) carries on by itself when the settings change;
   * 'adam' (stopped, failed twice, cancelled and brought back) waits for Try again.
   */
  held: 'auto' | 'adam' | null
  /** It was finished before (read again): Cancel puts it back as it was rather than removing it. */
  wasReady?: boolean
  /** Chapters (from 1) whose notes couldn't be used even when asked twice (a refusal, say): read as having none. */
  unread?: number[]
}

/** Removed recipes are kept this long for their Undo, then deleted for good. */
export const REMOVED_KEEP_MS = 10 * 60 * 1000

const ID = /^[0-9a-f-]{8,64}$/i

/** True for a recipe id (the folders are named by them); anything else names no recipe. */
export const isRecipeId = (id: unknown): id is string => typeof id === 'string' && ID.test(id)

export const NEWER = 'This recipe was made by a newer AI Write; update to open it.'

const isNewer = (f: unknown): boolean => !!f && typeof f === 'object' && Number((f as { version?: unknown }).version) > 1

/** A part as text, whatever a hand-edited file has in it: a list is read line by line. */
function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join('\n')
  return ''
}

const chapterNumbers = (v: unknown): number[] =>
  Array.isArray(v) ? [...new Set(v.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b) : []

/** A story planned from a recipe (plans/<storyId>.json in the recipe's folder), so the plan page opens again after a restart. */
export interface PlanFile {
  version: 1
  worldId: string
  storyId: string
  guidance: string
  premise: { status: 'open' | 'kept' | 'discarded'; text: string | null; before: string | null }
  updatedAt: string
}

export class RecipeFiles {
  constructor(readonly dir: string) {}

  private folder = (id: string): string => {
    if (!ID.test(id)) throw new Error('Not a recipe id')
    return join(this.dir, id)
  }
  private removedFolder = (id: string): string => join(this.dir, '.removed', id)

  ensure(): void {
    mkdirSync(this.dir, { recursive: true })
  }

  ids(): string[] {
    if (!existsSync(this.dir)) return []
    try {
      return readdirSync(this.dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && ID.test(d.name) && existsSync(join(this.dir, d.name, 'recipe.json')))
        .map((d) => d.name)
    } catch {
      return []
    }
  }

  /**
   * A recipe as kept, whatever was hand-edited into its file (2026-10-17: every part read as text). One made by a
   * newer AI Write (`version` over 1, its own or its notes') is `newer`: shown as finished, never made or written.
   */
  read(id: string): StoredRecipe | null {
    const folder = this.folder(id)
    const r = readJson<Record<string, unknown> | null>(join(folder, 'recipe.json'), null)
    if (!r || typeof r !== 'object' || r.id !== id) return null
    const newer = isNewer(r) || isNewer(readJson<unknown>(join(folder, 'making.json'), null))
    const parts = emptyParts()
    const got = r.parts && typeof r.parts === 'object' ? (r.parts as Record<string, unknown>) : {}
    for (const k of Object.keys(parts) as RecipePartId[]) parts[k] = asText(got[k])
    const createdAt = asText(r.createdAt)
    return {
      version: 1,
      id,
      name: asText(r.name),
      nameBy: r.nameBy === 'adam' ? 'adam' : 'ai',
      status: !newer && (r.status === 'making' || r.status === 'paused') ? r.status : 'ready',
      problem: typeof r.problem === 'string' ? r.problem : null,
      words: Number(r.words) || 0,
      chapters: Number(r.chapters) || 0,
      byHand: !!r.byHand,
      createdAt,
      updatedAt: asText(r.updatedAt) || createdAt,
      parts,
      edited: Array.isArray(r.edited) ? [...new Set(r.edited.filter((k): k is RecipePartId => typeof k === 'string' && k in parts))] : [],
      unread: chapterNumbers(r.unread),
      ...(newer ? { newer: true } : {})
    }
  }

  write(r: StoredRecipe): void {
    // Never over a newer AI Write's recipe: what it holds that this one doesn't know would be lost.
    if (r.newer || isNewer(readJson<unknown>(join(this.folder(r.id), 'recipe.json'), null))) throw new UserError(NEWER, 'newer-recipe')
    const out: StoredRecipe = { ...r }
    delete out.newer
    writeFileAtomic(join(this.folder(r.id), 'recipe.json'), JSON.stringify(out, null, 2))
  }

  summary(r: StoredRecipe): RecipeSummary {
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      words: r.words,
      chapters: r.chapters,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      hasSource: this.hasSource(r.id),
      byHand: r.byHand
    }
  }

  list(): StoredRecipe[] {
    return this.ids()
      .map((id) => this.read(id))
      .filter((r): r is StoredRecipe => !!r)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  // ----- The story's text -----

  hasSource = (id: string): boolean => existsSync(join(this.folder(id), 'source.json'))

  source(id: string): RecipeSource | null {
    const s = readJson<RecipeSource | null>(join(this.folder(id), 'source.json'), null)
    return s && Array.isArray(s.chapters) ? s : null
  }

  writeSource(id: string, s: RecipeSource): void {
    writeFileAtomic(join(this.folder(id), 'source.json'), JSON.stringify(s))
  }

  /** Moves the story's text out (for its Undo); `restoreSource` brings it back until it is deleted for good. */
  removeSource(id: string): void {
    const from = join(this.folder(id), 'source.json')
    if (!existsSync(from)) return
    const to = join(this.dir, '.removed', `source-${id}`)
    rmSync(to, { recursive: true, force: true })
    mkdirSync(to, { recursive: true })
    renameRetrySync(from, join(to, 'source.json'))
    writeFileAtomic(join(to, 'removed.json'), JSON.stringify({ at: Date.now() }))
  }

  restoreSource(id: string): boolean {
    const from = join(this.dir, '.removed', `source-${id}`, 'source.json')
    if (!existsSync(from) || !existsSync(this.folder(id)) || this.hasSource(id)) return false
    renameRetrySync(from, join(this.folder(id), 'source.json'))
    rmSync(join(this.dir, '.removed', `source-${id}`), { recursive: true, force: true })
    return true
  }

  // ----- Making -----

  making(id: string): MakingFile | null {
    const m = readJson<MakingFile | null>(join(this.folder(id), 'making.json'), null)
    if (!m || !Array.isArray(m.notes) || isNewer(m)) return null
    return {
      version: 1,
      queuedAt: asText(m.queuedAt),
      notes: m.notes.map((n) => (n == null ? null : asText(n))),
      held: m.held === 'auto' || m.held === 'adam' ? m.held : null,
      wasReady: !!m.wasReady,
      unread: chapterNumbers(m.unread)
    }
  }

  writeMaking(id: string, m: MakingFile | null): void {
    const file = join(this.folder(id), 'making.json')
    if (m) writeFileAtomic(file, JSON.stringify(m))
    else rmSync(file, { force: true })
  }

  // ----- Stories planned from it -----

  private planFile = (id: string, storyId: string): string => {
    if (!ID.test(storyId)) throw new Error('Not a story id')
    return join(this.folder(id), 'plans', `${storyId}.json`)
  }

  plans(id: string): PlanFile[] {
    const dir = join(this.folder(id), 'plans')
    if (!existsSync(dir)) return []
    let names: string[]
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json') && ID.test(n.slice(0, -5)))
    } catch {
      return []
    }
    return names
      .map((n) => readJson<Partial<PlanFile> | null>(join(dir, n), null))
      .flatMap((p): PlanFile[] => {
        if (!p || typeof p !== 'object' || isNewer(p) || !isRecipeId(p.storyId) || typeof p.worldId !== 'string') return []
        const pr = p.premise && typeof p.premise === 'object' ? p.premise : null
        const status = pr?.status === 'kept' || pr?.status === 'discarded' ? pr.status : 'open'
        return [
          {
            version: 1,
            worldId: p.worldId,
            storyId: p.storyId,
            guidance: asText(p.guidance),
            premise: { status, text: typeof pr?.text === 'string' ? pr.text : null, before: typeof pr?.before === 'string' ? pr.before : null },
            updatedAt: asText(p.updatedAt)
          }
        ]
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  writePlan(id: string, p: PlanFile): void {
    if (!existsSync(join(this.folder(id), 'recipe.json'))) return
    const file = this.planFile(id, p.storyId)
    mkdirSync(join(this.folder(id), 'plans'), { recursive: true })
    writeFileAtomic(file, JSON.stringify(p))
  }

  removePlan(id: string, storyId: string): void {
    rmSync(this.planFile(id, storyId), { force: true })
  }

  // ----- Removing, with Undo -----

  remove(id: string): void {
    const from = this.folder(id)
    if (!existsSync(from)) return
    const to = this.removedFolder(id)
    mkdirSync(join(this.dir, '.removed'), { recursive: true })
    rmSync(to, { recursive: true, force: true })
    renameRetrySync(from, to)
    writeFileAtomic(join(to, 'removed.json'), JSON.stringify({ at: Date.now() }))
  }

  restore(id: string): boolean {
    const from = this.removedFolder(id)
    if (!ID.test(id) || !existsSync(from) || existsSync(this.folder(id))) return false
    renameRetrySync(from, this.folder(id))
    rmSync(join(this.folder(id), 'removed.json'), { force: true })
    return true
  }

  /** Deletes for good what was removed longer ago than its Undo lasts (all of it with `all`). */
  purgeRemoved(nowMs = Date.now(), all = false): void {
    const dir = join(this.dir, '.removed')
    if (!existsSync(dir)) return
    try {
      for (const name of readdirSync(dir)) {
        const f = join(dir, name)
        try {
          const at = Number(readJson<{ at?: number }>(join(f, 'removed.json'), {}).at) || statSync(f).mtimeMs
          if (all || nowMs - at > REMOVED_KEEP_MS) rmSync(f, { recursive: true, force: true })
        } catch (e) {
          console.warn('Could not finish removing a recipe', e)
        }
      }
    } catch {
      /* the folder went meanwhile */
    }
  }
}
