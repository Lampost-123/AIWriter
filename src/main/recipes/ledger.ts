// The recipe library's spending file (spending.ts), open while the app runs, for the Recipe maker's calls and for
// the usage page and the monthly limit (usage/index.ts adds it to the worlds' spending, as "Story recipes").
// Nothing is made until the first recipe call: a library with no recipes has no Recipes folder. No Electron.

import type Database from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tallyWorld, type WorldTally } from '../usage/aggregate'
import { recipesDir } from './paths'
import { openSpending, SPENDING_FILE } from './spending'

type DB = Database.Database

let open: { dir: string; db: DB } | null = null

/** The spending file for this library, opened (and made) if need be. */
export function spendingDb(library: string): DB {
  const dir = recipesDir(library)
  if (open && open.dir === dir && open.db.open) return open.db
  closeSpending()
  open = { dir, db: openSpending(dir) }
  return open.db
}

export function closeSpending(): void {
  try {
    open?.db.close()
  } catch {
    /* already closed */
  }
  open = null
}

/** What the Recipe maker has cost in this library, brought up to date from `before`; null when nothing has been spent. */
export function recipeTally(library: string, before: WorldTally | null): WorldTally | null {
  if (!library) return null
  const dir = recipesDir(library)
  if (!(open && open.dir === dir && open.db.open) && !existsSync(join(dir, SPENDING_FILE))) return null
  try {
    return tallyWorld(spendingDb(library), before)
  } catch (e) {
    console.warn('Could not add up what recipes cost', e)
    return before
  }
}
