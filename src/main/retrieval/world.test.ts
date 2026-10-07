// Step 5 for the open world: closing it mid-way, an index that can't catch up, and words written while the background
// indexing works. Made-up scenes, an index in memory and a stand-in model.
import { describe, expect, it } from 'vitest'
import type { ID } from '@shared/types'
import { defaultWritingPrefs, emptySceneCard } from '@shared/defaults'
import * as repo from '../db/repo'
import { gatherContextInput } from '../ai/gather'
import { memoryWorld } from '../../../tests/unit/helpers'
import { memorySearchIndex, type SearchIndex } from './store'
import { syncNow, syncSlowly } from './indexing'
import { stubEmbedder } from './stub'
import type { Embedder } from './types'
import { WorldRecall } from './world'

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const ids: ID[] = [o.scenes[0].id]
  for (let i = 2; i <= 4; i++) ids.push(repo.createScene(db, o.chapters[0].id, { title: `Scene ${i}`, afterId: ids[ids.length - 1] }).id)
  const mara = repo.createEntry(db, 'character', { name: 'Mara', summary: 'A smuggler.' })
  repo.saveSceneText(db, ids[0], null, 'At the old well Mara swore she would come back before the snow.')
  repo.saveSceneText(db, ids[1], null, 'The ferry was late. Kell counted the coins.')
  repo.updateSceneCard(db, ids[3], { ...emptySceneCard(), povId: mara.id, presentIds: [mara.id], beats: ['Mara remembers the well'] })
  return { db, ids, scene: ids[3] }
}

const inputFor = (db: ReturnType<typeof memoryWorld>, scene: ID) => gatherContextInput(db, scene, undefined, { prefs: defaultWritingPrefs(), contextLength: 128_000, creativity: 'balanced' })

describe('step 5 for the open world', () => {
  it('searches the index it keeps, and goes without earlier passages when the index can’t catch up', async () => {
    const w = world()
    const index = memorySearchIndex()
    const recall = new WorldRecall({ db: w.db, folder: '', embedder: () => null, open: () => index })
    const found = await recall.search(w.scene, inputFor(w.db, w.scene))
    expect(found?.passages.map((p) => p.text).join(' ')).toContain('old well')
    // The well is written out of scene 1, and the index can't take the new words: the old ones are never sent.
    repo.saveSceneText(w.db, w.ids[0], null, 'Mara left the village without a word.')
    index.putScene = () => {
      throw Object.assign(new Error('disk I/O error'), { code: 'SQLITE_IOERR' })
    }
    const after = await recall.search(w.scene, inputFor(w.db, w.scene))
    expect(after).not.toBeNull()
    expect(after!.passages.map((p) => p.text).join(' ')).not.toContain('old well')
    recall.close()
  })

  it('stops at once when the world closes in the middle of indexing, and writes nothing after', async () => {
    const w = world()
    const index = memorySearchIndex()
    let release: () => void = () => undefined
    const asked: AbortSignal[] = []
    const slow: Embedder = {
      model: 'slow',
      floor: 0,
      embed: () => Promise.reject(new Error('not used')),
      embedLater: (texts, signal) =>
        new Promise((resolve, reject) => {
          if (signal) asked.push(signal)
          release = () => resolve(texts.map(() => Float32Array.from([1, 0])))
          signal?.addEventListener('abort', () => reject(new Error('Stopped')), { once: true })
        })
    }
    const recall = new WorldRecall({ db: w.db, folder: '', embedder: () => slow, open: () => index })
    const running = recall.indexNow()
    await new Promise((r) => setTimeout(r, 20))
    expect(asked).toHaveLength(1)
    recall.close()
    release()
    await running
    expect(asked[0].aborted).toBe(true)
    expect(index.open).toBe(false)
    // A search after closing says nothing.
    expect(await recall.search(w.scene, inputFor(w.db, w.scene))).toBeNull()
  })

  it('reads the world’s passages for meaning in the background, and says how far it has got', async () => {
    const w = world()
    const index = memorySearchIndex()
    const model = stubEmbedder()
    const recall = new WorldRecall({ db: w.db, folder: '', embedder: () => model, open: () => index })
    await recall.indexNow()
    expect(recall.counts('stub')).toEqual({ done: 2, total: 2 })
    recall.close()
  })
})

describe('words written while the background indexing works', () => {
  it('are never covered by the older words it read first', async () => {
    const w = world()
    const index: SearchIndex = memorySearchIndex()
    // Both scenes are new to the index; it takes them one at a time, and scene 2 is written in between.
    const going = syncSlowly(w.db, index, new AbortController().signal, 1)
    repo.saveSceneText(w.db, w.ids[1], null, 'The ferry sank in the night.')
    await going
    expect(index.keyword(['sank'], [w.ids[1]])).toHaveLength(1)
    expect(index.keyword(['coins'], [w.ids[1]])).toEqual([])
    // And the next catch-up has nothing left to do.
    expect(syncNow(w.db, index).changed).toEqual([])
  })
})
