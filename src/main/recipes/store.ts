// The recipe library's files (spec, "Story recipes": one file per recipe plus the imported story's text, so it can
// be read again), in the Recipes folder of the library (paths.ts):
//   <id>/recipe.json   the recipe: its name, parts, which parts Adam changed, whether it is being made
//   <id>/source.json   the story's text (source.ts), while it is kept
//   <id>/making.json   while the recipe is being made: each chapter's notes so far, so it carries on after a restart
//   .removed/<id>/     a recipe deleted or cancelled, until its Undo has gone (then deleted for good)
//   spending.db        what the Recipe maker's calls cost (spending.ts), with no words
// Folders are named by id, never by the story's title. No Electron imports.

import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { RecipePartId, RecipeParts, RecipeStatus, RecipeSummary } from '@shared/contracts/recipes'
import { readJson, renameRetrySync, writeFileAtomic } from '../util'
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
}

/** Removed recipes are kept this long for their Undo, then deleted for good. */
export const REMOVED_KEEP_MS = 10 * 60 * 1000

const ID = /^[0-9a-f-]{8,64}$/i

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

  read(id: string): StoredRecipe | null {
    const r = readJson<Partial<StoredRecipe> | null>(join(this.folder(id), 'recipe.json'), null)
    if (!r || typeof r !== 'object' || r.id !== id) return null
    return {
      version: 1,
      id,
      name: typeof r.name === 'string' ? r.name : '',
      nameBy: r.nameBy === 'adam' ? 'adam' : 'ai',
      status: r.status === 'making' || r.status === 'paused' ? r.status : 'ready',
      problem: typeof r.problem === 'string' ? r.problem : null,
      words: Number(r.words) || 0,
      chapters: Number(r.chapters) || 0,
      byHand: !!r.byHand,
      createdAt: r.createdAt ?? '',
      updatedAt: r.updatedAt ?? r.createdAt ?? '',
      parts: { ...emptyParts(), ...(r.parts ?? {}) },
      edited: Array.isArray(r.edited) ? r.edited : []
    }
  }

  write(r: StoredRecipe): void {
    writeFileAtomic(join(this.folder(r.id), 'recipe.json'), JSON.stringify(r, null, 2))
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
    return m && Array.isArray(m.notes) ? { version: 1, queuedAt: m.queuedAt ?? '', notes: m.notes, held: m.held ?? null, wasReady: !!m.wasReady } : null
  }

  writeMaking(id: string, m: MakingFile | null): void {
    const file = join(this.folder(id), 'making.json')
    if (m) writeFileAtomic(file, JSON.stringify(m))
    else rmSync(file, { force: true })
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
