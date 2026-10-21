// The scene card's beats a whole-scene AI draft was written from, kept in the world's meta table.
import { describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from './repo'
import { beatsWrittenIn, noteBeatsWritten } from './beatsWritten'
import { purgeTrash } from './trash'

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  return { db, chapterId: o.chapters[0].id, sceneId: o.scenes[0].id }
}

const draft = 'Mara crossed the harbour wall while the lanterns guttered above the fishing boats.'

describe('the beats an AI draft wrote', () => {
  it('none until a draft notes them; then the card’s beats with words, trimmed, and the draft’s words, the newest draft’s', () => {
    const { db, sceneId } = world()
    expect(beatsWrittenIn(db, sceneId)).toBeNull()
    noteBeatsWritten(db, sceneId, ['  Mara meets Tobin ', '', 'Someone knocks'], draft)
    expect(beatsWrittenIn(db, sceneId)).toEqual({ beats: ['Mara meets Tobin', 'Someone knocks'], words: ['crossed', 'harbour', 'while', 'lanterns', 'guttered', 'above', 'fishing', 'boats'] })
    noteBeatsWritten(db, sceneId, ['A new beat'], draft)
    expect(beatsWrittenIn(db, sceneId)?.beats).toEqual(['A new beat'])
    // A card with no beats, or a draft with no words, leaves nothing behind.
    noteBeatsWritten(db, sceneId, [' '], draft)
    expect(beatsWrittenIn(db, sceneId)).toBeNull()
    noteBeatsWritten(db, sceneId, ['A beat'], '')
    expect(beatsWrittenIn(db, sceneId)).toBeNull()
  })

  it('reads a broken row as none', () => {
    const { db, sceneId } = world()
    repo.setMeta(db, `beats_written:${sceneId}`, '{not json')
    expect(beatsWrittenIn(db, sceneId)).toBeNull()
    repo.setMeta(db, `beats_written:${sceneId}`, JSON.stringify({ beats: [3, 'Kept', null], words: ['harbour', 7] }))
    expect(beatsWrittenIn(db, sceneId)).toEqual({ beats: ['Kept'], words: ['harbour'] })
    repo.setMeta(db, `beats_written:${sceneId}`, JSON.stringify({ beats: ['Kept'] }))
    expect(beatsWrittenIn(db, sceneId)).toBeNull()
  })

  it('goes with its scene when the Trash is emptied', () => {
    const { db, chapterId, sceneId } = world()
    const other = repo.createScene(db, chapterId, { title: 'Two' }).id
    noteBeatsWritten(db, sceneId, ['One'], draft)
    noteBeatsWritten(db, other, ['Two'], draft)
    repo.deleteScene(db, other)
    purgeTrash(db, 30, Date.now() + 40 * 24 * 3600 * 1000)
    expect(beatsWrittenIn(db, other)).toBeNull()
    expect(beatsWrittenIn(db, sceneId)?.beats).toEqual(['One'])
  })
})
