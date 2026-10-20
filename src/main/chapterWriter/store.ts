// What the chapter writer keeps, in the world's meta table (no migration; the data model is frozen): the latest run's
// report for each chapter (`chapter_writer:<chapter id>`) and the chapter's words as they were before that run
// (`chapter_writer_before:<chapter id>`: each scene's page and text), so Undo can put them back whatever History keeps,
// and the name the run gave a chapter that had only its number, with its title before (`chapter_writer_named:<chapter
// id>`), so Undo can put that back too. All go with their chapter when it is emptied from Recently deleted (db/trash.ts).
// No Electron imports.

import type Database from 'better-sqlite3'
import type { ChapterWriterReport } from '@shared/contracts/chapterWriter'
import type { ID } from '@shared/types'
import * as repo from '../db/repo'

type DB = Database.Database

export const REPORT_PREFIX = 'chapter_writer:'
export const BEFORE_PREFIX = 'chapter_writer_before:'
export const NAMED_PREFIX = 'chapter_writer_named:'

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

/** The name the latest run gave its chapter, and the chapter's title before (Adam, 2026-10-20). */
export interface ChapterNamed {
  from: string
  to: string
}

export const loadNamed = (db: DB, chapterId: ID): ChapterNamed | null => read<ChapterNamed>(db, NAMED_PREFIX + chapterId)

/** Keeps the name the run gave the chapter, with its title before; null (as a run starts) forgets an earlier run's. */
export function saveNamed(db: DB, chapterId: ID, named: ChapterNamed | null): void {
  repo.setMeta(db, NAMED_PREFIX + chapterId, JSON.stringify(named))
}

/**
 * The title Undo puts back on the chapter: the one it had before the latest run named it, but only while the chapter
 * still has the run's name (a name Adam gave it since is his, and stays). Null when there is nothing to put back.
 */
export function titleToPutBack(db: DB, chapterId: ID): string | null {
  const named = loadNamed(db, chapterId)
  if (!named || typeof named.to !== 'string' || typeof named.from !== 'string') return null
  let now: string
  try {
    now = repo.getChapter(db, chapterId).title
  } catch {
    return null // The chapter has been deleted since.
  }
  return now.trim() === named.to.trim() ? named.from : null
}

/** Every scene of the chapter as it is now: its page and text. */
export function scenesNow(db: DB, sceneIds: ID[]): SceneBefore[] {
  return sceneIds.map((sceneId) => {
    const s = repo.getScene(db, sceneId)
    return { sceneId, doc: s.doc ?? null, text: s.text ?? '' }
  })
}
