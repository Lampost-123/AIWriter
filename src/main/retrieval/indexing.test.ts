// Keeping the search index in step with the world, and making it again from nothing.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as repo from '../db/repo'
import { memoryWorld } from '../../../tests/unit/helpers'
import { indexPath, memorySearchIndex, openSearchIndex } from './store'
import { readPassages, scenesToSync, syncNow, syncSlowly } from './indexing'
import { stubEmbedder } from './stub'

const folders: string[] = []
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true })
})

function world() {
  const db = memoryWorld()
  const story = repo.listStories(db)[0]
  const o = repo.getOutline(db, story.id)
  const a = o.scenes[0].id
  const b = repo.createScene(db, o.chapters[0].id, { title: 'Two', afterId: a }).id
  repo.saveSceneText(db, a, null, 'The ferry crossed at dawn. Mara held the rope.')
  repo.saveSceneText(db, b, null, 'Kell counted the coins at the inn.')
  return { db, a, b }
}

describe('keeping the index in step', () => {
  it('reads new and changed scenes, and forgets deleted ones', () => {
    const w = world()
    const index = memorySearchIndex()
    expect(syncNow(w.db, index).changed.map((c) => c.id).sort()).toEqual([w.a, w.b].sort())
    expect(scenesToSync(w.db, index)).toEqual({ changed: [], removed: [] })
    repo.saveSceneText(w.db, w.a, null, 'The ferry sank at dawn.')
    repo.deleteScene(w.db, w.b)
    const sync = syncNow(w.db, index)
    expect(sync.changed.map((c) => c.id)).toEqual([w.a])
    expect(sync.removed).toEqual([w.b])
    expect(index.keyword(['sank'], [w.a])).toHaveLength(1)
    expect(index.keyword(['coins'], [w.a, w.b])).toEqual([])
  })

  it('is made again from the scenes when the file is gone, and its vectors read again', async () => {
    const w = world()
    const folder = mkdtempSync(join(tmpdir(), 'aiwrite-rebuild-'))
    folders.push(folder)
    const first = openSearchIndex(folder).index
    syncNow(w.db, first)
    const embedder = stubEmbedder()
    const read = (t: string[]) => embedder.embed(t, 'passage')
    expect(await readPassages(first, embedder, read, { signal: new AbortController().signal })).toBe(2)
    first.close()
    rmSync(indexPath(folder))
    const again = openSearchIndex(folder).index
    expect(again.sceneHashes().size).toBe(0)
    await syncSlowly(w.db, again, new AbortController().signal, 1)
    expect(again.sceneHashes().size).toBe(2)
    expect(again.counts('stub')).toEqual({ passages: 2, withVectors: 0 })
    expect(await readPassages(again, embedder, read, { signal: new AbortController().signal })).toBe(2)
    expect(again.counts('stub')).toEqual({ passages: 2, withVectors: 2 })
    again.close()
  })

  it('stops when asked, and picks up where it left off', async () => {
    const w = world()
    const index = memorySearchIndex()
    syncNow(w.db, index)
    const stop = new AbortController()
    stop.abort()
    const embedder = stubEmbedder()
    expect(await readPassages(index, embedder, (t) => embedder.embed(t, 'passage'), { signal: stop.signal })).toBe(0)
    expect(await syncSlowly(w.db, memorySearchIndex(), stop.signal)).toMatchObject({ changed: expect.any(Array) })
    expect(await readPassages(index, embedder, (t) => embedder.embed(t, 'passage'), { signal: new AbortController().signal })).toBe(2)
  })
})
