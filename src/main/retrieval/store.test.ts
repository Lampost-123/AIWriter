import { afterEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { INDEX_FILE, INDEX_VERSION, indexPath, openSearchIndex, OTHER_VECTORS_KEPT } from './store'
import { scenePassages } from './text'

const folders: string[] = []
const folder = (): string => {
  const f = mkdtempSync(join(tmpdir(), 'aiwrite-index-'))
  folders.push(f)
  return f
}
afterEach(() => {
  for (const f of folders.splice(0)) rmSync(f, { recursive: true, force: true })
})

const vec = (...xs: number[]): Float32Array => Float32Array.from(xs)

describe('the search index file (search-index.db)', () => {
  it('is made beside world.db when missing, and kept', () => {
    const f = folder()
    const { index, problem, setAside } = openSearchIndex(f)
    expect(problem).toBeNull()
    expect(setAside).toBeNull()
    expect(index.inFile).toBe(true)
    index.putScene('s1', 'h1', scenePassages('Mara swore at the old well that she would come back.'))
    index.close()
    expect(existsSync(indexPath(f))).toBe(true)
    const again = openSearchIndex(f).index
    expect(again.sceneHashes().get('s1')).toBe('h1')
    again.close()
  })

  it('sets a damaged file aside (never deletes it) and starts afresh', () => {
    const f = folder()
    writeFileSync(indexPath(f), 'not a database at all, just words')
    const { index, setAside, problem } = openSearchIndex(f, Date.UTC(2026, 9, 7, 12))
    expect(problem).toBeNull()
    expect(setAside).toMatch(/^search-index\.db\.damaged-/)
    expect(readFileSync(join(f, setAside!), 'utf8')).toBe('not a database at all, just words')
    expect(index.inFile).toBe(true)
    expect(index.sceneHashes().size).toBe(0)
    index.close()
  })

  it('sets aside a database that is some other program’s', () => {
    const f = folder()
    const other = new Database(indexPath(f))
    other.exec('CREATE TABLE notes (x TEXT)')
    other.close()
    const { index, setAside } = openSearchIndex(f)
    expect(setAside).toMatch(/damaged/)
    index.close()
  })

  it('leaves one from a newer AI Write exactly as it is, and works in memory meanwhile', () => {
    const f = folder()
    const newer = new Database(indexPath(f))
    newer.pragma(`user_version = ${INDEX_VERSION + 1}`)
    newer.exec('CREATE TABLE future (x TEXT)')
    newer.close()
    const before = readFileSync(indexPath(f))
    const { index, problem } = openSearchIndex(f)
    expect(problem).toBe('newer')
    expect(index.inFile).toBe(false)
    index.putScene('s1', 'h', scenePassages('Words kept in memory only.'))
    expect(index.keyword(['memory'], ['s1'])).toHaveLength(1)
    index.close()
    expect(readFileSync(indexPath(f)).equals(before)).toBe(true)
    expect(readdirSync(f).filter((n) => n.startsWith(INDEX_FILE))).toEqual([INDEX_FILE])
  })
})

describe('what the index holds', () => {
  it('finds passages by keyword, only in the scenes asked, and forgets scenes that are gone', () => {
    const { index } = openSearchIndex(folder())
    index.putScene('s1', 'a', scenePassages('Mara promised Tobin she would come back before the snow, at the old well.'))
    index.putScene('s2', 'b', scenePassages('The ferry was late again. Kell counted the coins twice.'))
    index.putScene('s3', 'c', scenePassages('Later: the promise at the well was broken.'))
    const found = index.keyword(['promises', 'well'], ['s1', 's2'])
    expect(found.map((r) => r.passage.sceneId)).toEqual(['s1'])
    expect(found[0].score).toBeGreaterThan(0)
    // A scene's words again: its passages are replaced, not added to.
    index.putScene('s1', 'a2', scenePassages('Mara left without a word.'))
    expect(index.keyword(['promise'], ['s1'])).toEqual([])
    expect(index.passagesIn(['s1'])).toHaveLength(1)
    index.removeScenes(['s3'])
    expect(index.keyword(['broken'], ['s3'])).toEqual([])
    expect([...index.sceneHashes().keys()].sort()).toEqual(['s1', 's2'])
    index.close()
  })

  it('keeps vectors by model and words, and tidies those no longer needed', () => {
    const { index } = openSearchIndex(folder())
    index.putScene('s1', 'a', scenePassages('One passage of words.'))
    const [p] = index.passagesIn(['s1'])
    expect(index.withoutVectors('m1', 10)).toEqual([{ hash: p.hash, text: p.text }])
    index.putVectors('m1', 'passage', [{ hash: p.hash, vec: vec(0.6, 0.8) }])
    index.putVectors('m1', 'other', [{ hash: 'fact', vec: vec(1, 0) }])
    index.putVectors('m0', 'passage', [{ hash: p.hash, vec: vec(0, 1) }])
    expect(index.withoutVectors('m1', 10)).toEqual([])
    expect([...index.vectors('m1', [p.hash, 'fact', 'missing']).keys()].sort()).toEqual(['fact', p.hash].sort())
    expect(Array.from(index.vectors('m1', [p.hash]).get(p.hash)!)).toEqual([Math.fround(0.6), Math.fround(0.8)])
    expect(index.counts('m1')).toEqual({ passages: 1, withVectors: 1 })
    // The scene's words change: its old passage's vector goes; another model's vectors go.
    index.putScene('s1', 'b', scenePassages('Other words now.'))
    index.tidy('m1')
    expect(index.vectors('m0', [p.hash]).size).toBe(0)
    expect(index.vectors('m1', [p.hash]).size).toBe(0)
    expect(index.vectors('m1', ['fact']).size).toBe(1)
    expect(OTHER_VECTORS_KEPT).toBeGreaterThan(1000)
    index.close()
  })
})
