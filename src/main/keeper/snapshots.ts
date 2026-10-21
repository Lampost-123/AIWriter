// Keeps each chapter's end-of-chapter snapshot (memory/chapterRecord.ts, long story memory fix 15) in step with the
// record, with no AI. A snapshot is worked out again only when what it rests on changes (its key): its chapter's scenes
// and every scene before them in the story (the words the memory last read, the cards' people, place and day, whether
// they have words, the changes pinned to them or ended in them), every change outside the story's own scenes (the
// starting setup, the books before), and every entry's kind (and whether it is deleted). Every earlier scene counts, not
// only how the chapter before ended (review, 2026-10-16): someone off every card in Ch 1 who is given a key there and
// relieved of it again changes nothing Ch 1's snapshot says, but Ch 2's. So an edit early on works out every later
// chapter again; a chapter's summary is tied only to what changed in it (summaries.ts), so that costs no AI calls. The
// keys are a few queries, however long the story; the memory keeper works out at most a few snapshots at a time while it
// has nothing else to do (engine.ts), so a long story never holds it up. No Electron imports.

import type Database from 'better-sqlite3'
import type { ID } from '@shared/types'
import { sceneCards } from '../db/worldViews'
import { outsideStamp, putSnapshot, sceneStamps, storedSnapshots, type StoredSnapshot } from '../db/snapshots'
import { chapterSnapshot, type RecordRead } from '../memory/chapterRecord'
import { SNAPSHOT_VERSION } from '../memory/snapshot'
import { storyCalendar } from '../memory/storyCalendar'
import { loadMemoryData, loadShape, writerData } from '../memory/scene'
import { buildLine } from '../memory/line'
import type { WorldShape } from '../memory/types'
import { hashText } from './text'

type DB = Database.Database

/** How many snapshots the memory keeper works out at a time before it lets anything else run. */
export const SNAPSHOTS_AT_A_TIME = 3

/** What a story's chapters' snapshots rest on: what is outside the story, then each chapter's own scenes. */
function chapterStamps(db: DB, shape: WorldShape, storyId: ID): { outside: string; chapters: { chapterId: ID; stamp: string }[] } | null {
  const story = shape.stories.find((s) => s.id === storyId)
  if (!story) return null
  const sceneIds = story.chapters.flatMap((c) => c.scenes.map((s) => s.id))
  const stamps = sceneStamps(db, sceneIds)
  const cards = sceneCards(db)
  const cal = storyCalendar(db, storyId)
  return {
    outside: hashText(outsideStamp(db, sceneIds)),
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
 * changed). Returns how many were worked out, whether more are left to do, and the memory it read for them: the memory
 * keeper passes that back as `memory` for the next few while nothing has changed (review #26), so a change early in a
 * long book doesn't read the whole memory again for every few chapters.
 */
export function refreshSnapshots(
  db: DB,
  storyId: ID,
  most = SNAPSHOTS_AT_A_TIME,
  memory: RecordRead | null = null
): { worked: ID[]; more: boolean; read: RecordRead | null } {
  const shape = loadShape(db)
  const stamps = chapterStamps(db, shape, storyId)
  if (!stamps) return { worked: [], more: false, read: null }
  const kept = storedSnapshots(
    db,
    stamps.chapters.map((c) => c.chapterId)
  )
  let read: RecordRead | null = memory
  const worked: ID[] = []
  // Every scene before this chapter in the story, as one running hash.
  let before = ''
  for (const { chapterId, stamp } of stamps.chapters) {
    const key = hashText(`v${SNAPSHOT_VERSION}\n${stamps.outside}\n${before}\n${stamp}`)
    const row: StoredSnapshot | undefined = kept.get(chapterId)
    if (row?.key !== key) {
      if (worked.length >= most) return { worked, more: true, read }
      read ??= { shape, data: writerData(db, loadMemoryData(db)) }
      putSnapshot(db, chapterId, { key, snapshot: chapterSnapshot(db, chapterId, read) })
      worked.push(chapterId)
    }
    before = hashText(`${before}\n${stamp}`)
  }
  return { worked, more: false, read }
}

/**
 * The stories whose record rests on this one's, itself first: those whose line goes through it (a book that follows on,
 * a side story told in it, and the books after those). An edit in Book 1 can change how things stand all through Book 2.
 */
export function storiesReading(shape: WorldShape, storyId: ID): ID[] {
  const out = [storyId]
  for (const s of shape.stories) {
    if (s.id === storyId) continue
    try {
      // A story that only starts before it (a prequel) reads nothing of it.
      const segs = buildLine(shape, { storyId: s.id, through: 'end' }).segments
      if (segs.some((g) => g.storyId === storyId && (g.whole || g.stop?.at !== 'pre'))) out.push(s.id)
    } catch {
      // A story the line can't be built for (half-made data) reads nothing.
    }
  }
  return out
}
