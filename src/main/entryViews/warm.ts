// Reading every scene's words for the codex and entry pages ahead of time, a slice at a time, in
// the quiet moments after a world opens. In a big world the first look at the codex or an entry page
// would otherwise wait for all of them (about 150 ms for a million words); a slice takes a few
// milliseconds, and the window's requests are answered between slices. No Electron imports.

import type Database from 'better-sqlite3'
import type { Entry, ID } from '@shared/types'
import * as repo from '../db/repo'
import * as views from '../db/entryViews'
import { readAhead } from './appearances'

type DB = Database.Database

/**
 * Starts reading `db`'s scenes ahead, `delayMs` from now (so opening the world and its first page
 * come first). `open` says whether that world is still the open one; once it isn't, nothing more is read.
 */
export function warmReadings(db: DB, open: () => boolean, opts: { delayMs?: number; slice?: number } = {}): void {
  const slice = opts.slice ?? 100
  let ids: ID[] | null = null
  let entries: Entry[] | null = null
  const step = (): void => {
    if (!open()) return
    try {
      ids ??= [...views.sceneVersions(db).keys()]
      entries ??= repo.listEntries(db)
      const some = ids.splice(0, slice)
      if (some.length && readAhead(db, entries, some)) setImmediate(step)
    } catch (e) {
      // Only a head start: the codex and entry pages read whatever they need themselves.
      console.error('Could not read the scenes ahead for the codex', e)
    }
  }
  setTimeout(step, opts.delayMs ?? 400)
}
