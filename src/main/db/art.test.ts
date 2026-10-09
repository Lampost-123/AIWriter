// The desk's drawing and cover choices (UI overhaul, D5.4): kept in the world's meta, read back as written, and pruned.
import { describe, expect, it } from 'vitest'
import * as repo from './repo'
import { ART_KEY, readArtChoices, setEntryMotif, setStoryCover } from './art'
import { memoryWorld } from '../../../tests/unit/helpers'

function world() {
  const db = memoryWorld('Gullhaven')
  const [story] = repo.listStories(db)
  const edric = repo.createEntry(db, 'character', { name: 'Edric Halloway' })
  const iska = repo.createEntry(db, 'character', { name: 'Iska Vey' })
  return { db, story, edric, iska }
}

describe('art choices', () => {
  it('start empty and round-trip: an entry’s drawing, a story’s cover drawing and colour', () => {
    const { db, story, edric, iska } = world()
    expect(readArtChoices(db)).toEqual({ entries: {}, stories: {} })
    setEntryMotif(db, edric.id, 'bell')
    setEntryMotif(db, iska.id, 'letter')
    setStoryCover(db, story.id, { motif: 'lighthouse', hue: 395 })
    expect(readArtChoices(db)).toEqual({
      entries: { [edric.id]: { motif: 'bell', by: 'adam' }, [iska.id]: { motif: 'letter', by: 'adam' } },
      // A hue is kept within 0 to 359.
      stories: { [story.id]: { motif: 'lighthouse', hue: 35 } }
    })
    // The same JSON in meta, so it travels with the world in backups and world files.
    expect(JSON.parse(repo.getMeta(db, ART_KEY)!)).toEqual(readArtChoices(db))
  })

  it('null goes back to the drawing the words call for (the choice is dropped)', () => {
    const { db, story, edric } = world()
    setEntryMotif(db, edric.id, 'bell')
    setStoryCover(db, story.id, { hue: 200 })
    setEntryMotif(db, edric.id, null)
    setStoryCover(db, story.id, null)
    expect(readArtChoices(db)).toEqual({ entries: {}, stories: {} })
    // A cover with neither a drawing nor a colour is no choice.
    setStoryCover(db, story.id, {})
    expect(readArtChoices(db).stories).toEqual({})
  })

  it('leaves out choices for entries and stories that are gone, and drops them on the next write', () => {
    const { db, story, edric, iska } = world()
    setEntryMotif(db, edric.id, 'bell')
    setEntryMotif(db, iska.id, 'letter')
    const other = repo.createStory(db, { title: 'Elsewhere' })
    setStoryCover(db, other.id, { motif: 'ship' })
    repo.deleteEntry(db, edric.id)
    db.prepare('UPDATE stories SET deleted_at = ? WHERE id = ?').run(new Date().toISOString(), other.id)
    expect(readArtChoices(db)).toEqual({ entries: { [iska.id]: { motif: 'letter', by: 'adam' } }, stories: {} })
    setStoryCover(db, story.id, { hue: 10 })
    const saved = JSON.parse(repo.getMeta(db, ART_KEY)!)
    expect(Object.keys(saved.entries)).toEqual([iska.id])
    expect(Object.keys(saved.stories)).toEqual([story.id])
    // Choosing for something that is gone keeps nothing.
    setEntryMotif(db, edric.id, 'crown')
    expect(readArtChoices(db).entries[edric.id]).toBeUndefined()
  })

  it('refuses a drawing that isn’t in the library, and reads damaged or unknown values as no choice', () => {
    const { db, story, edric } = world()
    expect(() => setEntryMotif(db, edric.id, 'dragon-x')).toThrow('That drawing isn’t in the library.')
    expect(() => setStoryCover(db, story.id, { motif: 'nope' })).toThrow('That drawing isn’t in the library.')
    repo.setMeta(db, ART_KEY, JSON.stringify({ entries: { [edric.id]: { motif: 'from-a-newer-version' } }, stories: { [story.id]: { hue: 'red' } } }))
    expect(readArtChoices(db)).toEqual({ entries: {}, stories: {} })
    repo.setMeta(db, ART_KEY, '{oops')
    expect(readArtChoices(db)).toEqual({ entries: {}, stories: {} })
  })
})
