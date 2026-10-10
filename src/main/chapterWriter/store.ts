// What the chapter writer keeps, in the world's meta table (no migration; the data model is frozen): the latest run's
// report for each chapter (`chapter_writer:<chapter id>`) and the chapter's words as they were before that run
// (`chapter_writer_before:<chapter id>`: each scene's page and text), so Undo can put them back whatever History keeps.
// Both go with their chapter when it is emptied from Recently deleted (db/trash.ts). No Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterWriterReport } from '@shared/contracts/chapterWriter'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'

type DB = Database.Database

export const REPORT_PREFIX = 'chapter_writer:'
export const BEFORE_PREFIX = 'chapter_writer_before:'

/** A scene's page and text as they were before the run. */
export interface SceneBefore {
  sceneId: ID
  doc: unknown
  text: string
}

function read<T>(db: DB, key: string): T | null {
  const raw = repo.getMeta(db, key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export const loadReport = (db: DB, chapterId: ID): ChapterWriterReport | null => read<ChapterWriterReport>(db, REPORT_PREFIX + chapterId)

export function saveReport(db: DB, report: ChapterWriterReport): void {
  repo.setMeta(db, REPORT_PREFIX + report.chapterId, JSON.stringify(report))
}

export const loadBefore = (db: DB, chapterId: ID): SceneBefore[] => read<SceneBefore[]>(db, BEFORE_PREFIX + chapterId) ?? []

export function saveBefore(db: DB, chapterId: ID, scenes: SceneBefore[]): void {
  repo.setMeta(db, BEFORE_PREFIX + chapterId, JSON.stringify(scenes))
}

/** Every scene of the chapter as it is now: its page and text. */
export function scenesNow(db: DB, sceneIds: ID[]): SceneBefore[] {
  return sceneIds.map((sceneId) => {
    const s = repo.getScene(db, sceneId)
    return { sceneId, doc: s.doc ?? null, text: s.text ?? '' }
  })
}
