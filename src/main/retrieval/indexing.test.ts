// Keeping the search index in step with the world, and making it again from nothing.
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { memoryWorld } from '../../../tests/unit/helpers'
import { indexPath, memorySearchIndex, openSearchIndex } from './store'
import { readPassages, scenesToSync, syncNow, syncSlowly, syncSummaries } from './indexing'
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

describe('keeping the summaries in step (summary-level recall, 2026-10-19)', () => {
  const withSummaries = () => {
    const w = world()
    const chapter = repo.getOutline(w.db, repo.listStories(w.db)[0].id).chapters[0].id
    mem.putSummary(w.db, { level: 'scene', targetId: w.a, text: 'By the end, Mara had crossed the river on the ferry.', origin: 'text' })
    mem.putSummary(w.db, { level: 'chapter', targetId: chapter, text: 'The crossing, and the coins counted at the inn.', origin: 'text' })
    return { ...w, chapter }
  }

  it('puts in each scene’s and chapter’s summary as it now reads, and forgets those gone', () => {
    const w = withSummaries()
    const index = memorySearchIndex()
    syncNow(w.db, index)
    expect([...index.summaryHashes().keys()].sort()).toEqual([`chapter:${w.chapter}`, `scene:${w.a}`].sort())
    expect(syncSummaries(w.db, index)).toEqual({ changed: 0, removed: 0 })
    // Written again (by Adam, say): the new words are searched, the old ones no longer.
    mem.putSummary(w.db, { level: 'scene', targetId: w.a, text: 'By the end, Mara had lost the rope in the flood.', origin: 'adam' })
    expect(syncSummaries(w.db, index)).toEqual({ changed: 1, removed: 0 })
    expect(index.keywordSummaries(['flood'], [`scene:${w.a}`])).toHaveLength(1)
    expect(index.keywordSummaries(['ferry'], [`scene:${w.a}`])).toEqual([])
    // An emptied summary, and a deleted scene's, are forgotten.
    mem.putSummary(w.db, { level: 'chapter', targetId: w.chapter, text: '  ', origin: 'adam' })
    repo.deleteScene(w.db, w.a)
    syncNow(w.db, index)
    expect(index.summaryHashes().size).toBe(0)
  })

  it('reads the summaries for meaning in the background, first, and kept as summaries', async () => {
    const w = withSummaries()
    const index = memorySearchIndex()
    await syncSlowly(w.db, index, new AbortController().signal, 1)
    expect(index.summaryHashes().size).toBe(2)
    const embedder = stubEmbedder()
    const read: string[][] = []
    const n = await readPassages(
      index,
      embedder,
      (t) => {
        read.push(t)
        return embedder.embed(t, 'passage')
      },
      { signal: new AbortController().signal }
    )
    expect(n).toBe(4)
    expect(read[0].slice(0, 2).sort()).toEqual(['By the end, Mara had crossed the river on the ferry.', 'The crossing, and the coins counted at the inn.'])
    const kinds = index.db.prepare('SELECT kind, COUNT(*) AS n FROM vectors GROUP BY kind ORDER BY kind').all()
    expect(kinds).toEqual([
      { kind: 'passage', n: 2 },
      { kind: 'summary', n: 2 }
    ])
    expect(index.counts('stub')).toEqual({ passages: 2, withVectors: 2 })
  })
})
