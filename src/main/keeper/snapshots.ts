// Keeps each chapter's end-of-chapter snapshot (memory/chapterRecord.ts, long story memory fix 15) in step with the
// record, with no AI. A snapshot is worked out again only when what it rests on changes (its key): the chapter's scenes
// (the words the memory last read, the cards' people, place and day, whether they have words), the changes pinned to
// them or ended in them, every change outside the story's own scenes (the starting setup, the books before), and how
// things stood at the end of the chapter before (that snapshot's own end, so an edit early on is carried forward only as
// far as it changes anything). The keys are a few queries, however long the story; the memory keeper works out at most
// a few snapshots at a time while it has nothing else to do (engine.ts), so a long story never holds it up. No Electron
// imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { sceneCards } from '../db/worldViews'
import { outsideStamp, putSnapshot, sceneStamps, storedSnapshots, type StoredSnapshot } from '../db/snapshots'
import { chapterSnapshot, type RecordRead } from '../memory/chapterRecord'
import { endPart, SNAPSHOT_VERSION } from '../memory/snapshot'
import { storyCalendar } from '../memory/storyCalendar'
import { loadMemoryData, loadShape, writerData } from '../memory/scene'
import type { WorldShape } from '../memory/types'
import { hashText } from './text'

type DB = Database.Database

/** How many snapshots the memory keeper works out at a time before it lets anything else run. */
export const SNAPSHOTS_AT_A_TIME = 3

/** What a story's chapters' snapshots rest on, chapter by chapter, besides the chapter before's end. */
function chapterStamps(db: DB, shape: WorldShape, storyId: ID): { outside: string; chapters: { chapterId: ID; stamp: string }[] } | null {
  const story = shape.stories.find((s) => s.id === storyId)
  if (!story) return null
  const sceneIds = story.chapters.flatMap((c) => c.scenes.map((s) => s.id))
  const stamps = sceneStamps(db, sceneIds)
  const cards = sceneCards(db)
  const cal = storyCalendar(db, storyId)
  return {
    outside: outsideStamp(db, sceneIds),
    chapters: story.chapters.map((c) => ({
      chapterId: c.id,
      stamp: c.scenes
        .map((s) => {
          const card = cards.get(s.id)
          const d = cal?.dates.get(s.id)
          const day = d ? `${d.date}/${d.day ?? ''}/${d.time}/${d.back ? 'b' : ''}` : ''
          return `${s.id}|${stamps.get(s.id) ?? ''}|${(card?.words ?? 0) > 0 ? 'w' : ''}|${card?.povId ?? ''}|${(card?.presentIds ?? []).join(',')}|${card?.locationId ?? ''}|${day}`
        })
        .join('\n')
    }))
  }
}

/**
 * Brings a story's snapshots up to date, in chapter order, working out at most `most` of them (each one whose key
 * changed). Returns how many were worked out, and whether more are left to do.
 */
export function refreshSnapshots(db: DB, storyId: ID, most = SNAPSHOTS_AT_A_TIME): { worked: ID[]; more: boolean } {
  const shape = loadShape(db)
  const stamps = chapterStamps(db, shape, storyId)
  if (!stamps) return { worked: [], more: false }
  const kept = storedSnapshots(
    db,
    stamps.chapters.map((c) => c.chapterId)
  )
  let read: RecordRead | null = null
  const worked: ID[] = []
  let before = ''
  for (const { chapterId, stamp } of stamps.chapters) {
    const key = hashText(`v${SNAPSHOT_VERSION}\n${stamps.outside}\n${before}\n${stamp}`)
    let row: StoredSnapshot | undefined = kept.get(chapterId)
    if (row?.key !== key) {
      if (worked.length >= most) return { worked, more: true }
      read ??= { shape, data: writerData(db, loadMemoryData(db)) }
      row = { key, snapshot: chapterSnapshot(db, chapterId, read) }
      putSnapshot(db, chapterId, row)
      worked.push(chapterId)
    }
    // A chapter with no words yet passes on the end of the one before it.
    if (row.snapshot) before = hashText(endPart(row.snapshot))
  }
  return { worked, more: false }
}
