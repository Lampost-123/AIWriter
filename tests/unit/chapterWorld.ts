// A small invented story in three chapters, with a record to make end-of-chapter snapshots from (long story memory fix
// 15): scene cards with When, who is there and where, words in every scene, and changes the memory would have kept
// (made here as Adam's, so nothing needs a model). All names and text are invented.

import type Database from 'better-sqlite3'
import type { ChangeData, ID, SceneCard } from '../../src/shared/types'
import * as repo from '../../src/main/db/repo'
import * as mem from '../../src/main/db/memory'
import { memoryWorld } from './helpers'
import { saveParas } from './keeperRead'

type DB = Database.Database

export interface ChapterWorld {
  db: DB
  storyId: ID
  /** Three chapters: two scenes, three scenes, two scenes. */
  chapters: ID[]
  scenes: ID[][]
  ids: Record<'mara' | 'tobin' | 'ash' | 'edric' | 'mill' | 'quay' | 'key' | 'letter' | 'debt', ID>
}

/** Sets parts of a scene's card. */
export function setCard(db: DB, sceneId: ID, part: Partial<SceneCard>): void {
  repo.updateSceneCard(db, sceneId, { ...repo.getScene(db, sceneId).card, ...part })
}

/** A change pinned to a scene, as Adam's. */
export function change(db: DB, entryId: ID, sceneId: ID, data: ChangeData): ID {
  return mem.insertChange(db, { ...data, entryId, anchor: 'scene', sceneId, origin: 'adam' }).id
}

export function chapterWorld(): ChapterWorld {
  const db = memoryWorld('Chapters')
  const story = repo.listStories(db)[0]
  const first = repo.getOutline(db, story.id)
  const chapters = [first.chapters[0].id, repo.createChapter(db, story.id).id, repo.createChapter(db, story.id).id]
  const scenes: ID[][] = [[first.scenes[0].id], [], []]
  scenes[0].push(repo.createScene(db, chapters[0]).id)
  for (let i = 0; i < 3; i++) scenes[1].push(repo.createScene(db, chapters[1]).id)
  for (let i = 0; i < 2; i++) scenes[2].push(repo.createScene(db, chapters[2]).id)
  const entry = (kind: Parameters<typeof repo.createEntry>[1], name: string): ID => repo.createEntry(db, kind, { name }).id
  const ids = {
    mara: entry('character', 'Mara'),
    tobin: entry('character', 'Tobin'),
    ash: entry('character', 'Ash'),
    edric: entry('character', 'Edric'),
    mill: entry('place', 'The Mill'),
    quay: entry('place', 'The Quay'),
    key: entry('item', 'The brass key'),
    letter: entry('thread', 'Who sent the letter?'),
    debt: entry('thread', 'The ferryman’s debt')
  }
  const whens = [['Day 1', 'Day 2'], ['Day 3, dusk', 'That night', 'Day 5, morning'], ['Day 6', 'Day 7']]
  scenes.forEach((list, c) =>
    list.forEach((id, i) => {
      saveParas(db, id, [[`p${c}${i}`, `Chapter ${c + 1}, scene ${i + 1}. The river ran high under the bridge and nobody spoke of it.`]], false)
      setCard(db, id, { when: whens[c][i], povId: ids.mara, presentIds: [ids.tobin], locationId: i % 2 ? ids.mill : ids.quay })
    })
  )
  // Chapter 1 sets up the debt; chapter 2 is busy.
  change(db, ids.debt, scenes[0][0], { kind: 'thread', payload: { status: 'open', note: 'Tobin owes the ferryman' } })
  const [a, b, c] = scenes[1]
  change(db, ids.letter, a, { kind: 'thread', payload: { status: 'open', note: 'A letter came with no name' } })
  change(db, ids.mara, a, { kind: 'update', payload: { note: 'lost her left hand', fields: { marks: 'left hand missing' } } })
  change(db, ids.mara, b, { kind: 'relationship', payload: { otherId: ids.key, type: 'holds', feels: '', otherFeels: '' } })
  change(db, ids.mara, b, { kind: 'relationship', payload: { otherId: ids.tobin, type: 'rival', feels: 'wary', otherFeels: 'cold' } })
  change(db, ids.tobin, c, { kind: 'knowledge', payload: { factId: 'heir', fact: 'Mara is the heir', how: 'saw' } })
  change(db, ids.ash, c, { kind: 'knowledge', payload: { factId: 'heir', fact: 'Mara is the heir', how: 'saw' } })
  change(db, ids.tobin, c, { kind: 'knowledge', payload: { factId: 'sender', fact: 'Ash sent the letter', wrong: true } })
  change(db, ids.edric, c, { kind: 'update', payload: { note: 'died in his chair' } })
  change(db, ids.debt, c, { kind: 'thread', payload: { status: 'resolved', note: 'Tobin paid the ferryman' } })
  return { db, storyId: story.id, chapters, scenes, ids }
}
