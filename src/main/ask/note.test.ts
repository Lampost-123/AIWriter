// Saving words from an answer to the memory as Adam's own note, and taking them back out (the toast's
// Undo). In an own version of events, a note on an entry from outside it stays in that story.
import { describe, expect, it } from 'vitest'
import { memoryWorld } from '../../../tests/unit/helpers'
import { dbWorld } from '../../../tests/unit/testWorld'
import * as repo from '../db/repo'
import { memoryAt } from '../memory/asOf'
import { noteName, noteText, saveNote, undoNote, withNote } from './note'

describe('the words of a note', () => {
  it('takes the brackets off names and tidies the lines', () => {
    expect(noteText('She trusts [[Tobin]] and [[Mara Venn|Mara]].  \n\n\n\nThen [[ The Grey Ferry ]].')).toBe(
      'She trusts Tobin and Mara.\n\nThen The Grey Ferry.'
    )
  })

  it('goes at the end of a description, as its own paragraph', () => {
    expect(withNote('A smith’s daughter.\n', 'Quick to anger.')).toBe('A smith’s daughter.\n\nQuick to anger.')
    expect(withNote('  ', 'Quick to anger.')).toBe('Quick to anger.')
  })

  it('names a new note after the question it answers', () => {
    expect(noteName('Give me ten tavern names that fit the north')).toBe('Tavern names that fit the north')
    expect(noteName('Could you suggest a few names for the river gods?')).toBe('Names for the river gods')
    expect(noteName('What would Mara do if Tobin lied to her?')).toBe('What would Mara do if Tobin lied to her')
    expect(noteName('')).toBe('A note from Ask the world')
    expect(noteName('Give me ' + 'very '.repeat(30) + 'long names').length).toBeLessThanOrEqual(60)
  })
})

describe('saving a note', () => {
  it('adds it to the end of an entry’s description, as typed by Adam', () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'character', { name: 'Mara Venn', description: 'A smith’s daughter.' }, { origin: 'text' })
    expect(e.byHand).toBe(false)
    const saved = saveNote(db, { text: 'She would say nothing and watch [[Tobin]].', entryId: e.id, storyId: null })
    expect(saved).toMatchObject({ entryId: e.id, name: 'Mara Venn', created: false, onlyIn: null })
    const after = repo.getEntry(db, e.id)
    expect(after.description).toBe('A smith’s daughter.\n\nShe would say nothing and watch Tobin.')
    expect(after.fieldOrigins.description).toBe('adam')
    expect(after.byHand).toBe(true)
  })

  it('takes it back out with Undo, as if it had never been saved', () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'character', { name: 'Mara Venn', description: 'A smith’s daughter.' }, { origin: 'text' })
    const saved = saveNote(db, { text: 'Quick to anger.', entryId: e.id, storyId: null })
    undoNote(db, saved.undo)
    const after = repo.getEntry(db, e.id)
    expect(after.description).toBe('A smith’s daughter.')
    expect(after.fieldOrigins.description ?? after.origin).toBe('text')
    expect(after.byHand).toBe(false)
  })

  it('after Adam has changed the description since, Undo takes out only the note', () => {
    const db = memoryWorld()
    const e = repo.createEntry(db, 'character', { name: 'Mara Venn', description: 'A smith’s daughter.' })
    const saved = saveNote(db, { text: 'Quick to anger.', entryId: e.id, storyId: null })
    repo.updateEntry(db, e.id, { description: 'A smith’s daughter.\n\nQuick to anger.\n\nLoves the river.' })
    undoNote(db, saved.undo)
    expect(repo.getEntry(db, e.id).description).toBe('A smith’s daughter.\n\nLoves the river.')
  })

  it('makes a new page in Lore when the answer is about nothing in the memory', () => {
    const db = memoryWorld()
    const saved = saveNote(db, {
      text: '1. The Salt Lamp\n2. The Frozen Oar',
      entryId: null,
      question: 'Give me ten tavern names that fit the north',
      storyId: null
    })
    expect(saved).toMatchObject({ kind: 'lore', name: 'Tavern names that fit the north', created: true })
    const page = repo.getEntry(db, saved.entryId)
    expect(page.description).toBe('1. The Salt Lamp\n2. The Frozen Oar')
    expect(page.origin).toBe('adam')
    expect(page.byHand).toBe(true)
    undoNote(db, saved.undo)
    expect(() => repo.getEntry(db, saved.entryId)).toThrow()
  })

  it('refuses an empty note in plain words', () => {
    const db = memoryWorld()
    expect(() => saveNote(db, { text: ' [[ ]] ', entryId: null, storyId: null })).toThrow(/no words to save/)
  })
})

describe('a note saved in an own version of events', () => {
  it('stays in that story: no other story sees it, and Undo takes it out', () => {
    const w = dbWorld()
    const before = repo.getEntry(w.db, w.id('mara')).description
    const saved = saveNote(w.db, { text: 'She keeps a knife in her boot.', entryId: w.id('mara'), storyId: w.id('keep') })
    expect(saved.onlyIn).toBe('Mara Keeps Her Hand')
    // The page itself (what every other story starts from) is unchanged.
    expect(repo.getEntry(w.db, w.id('mara')).description).toBe(before)
    const inKeep = memoryAt(w.db, { kind: 'end', storyId: w.id('keep') }).state.entries.get(w.id('mara'))
    expect(inKeep?.description).toContain('She keeps a knife in her boot.')
    for (const story of ['b1', 'b2', 'other']) {
      const there = memoryAt(w.db, { kind: 'end', storyId: w.id(story) }).state.entries.get(w.id('mara'))
      expect(there?.description ?? '', story).not.toContain('knife')
    }
    undoNote(w.db, saved.undo)
    expect(memoryAt(w.db, { kind: 'end', storyId: w.id('keep') }).state.entries.get(w.id('mara'))?.description).not.toContain('knife')
  })

  it('a new note made there first exists there alone', () => {
    const w = dbWorld()
    const saved = saveNote(w.db, {
      text: 'The keep has a hidden well.',
      entryId: null,
      question: 'Where is the water?',
      storyId: w.id('keep')
    })
    expect(memoryAt(w.db, { kind: 'end', storyId: w.id('keep') }).state.entries.has(saved.entryId)).toBe(true)
    expect(memoryAt(w.db, { kind: 'end', storyId: w.id('b1') }).state.entries.has(saved.entryId)).toBe(false)
  })

  it('in a story of the main series, the note goes on the page itself', () => {
    const w = dbWorld()
    const saved = saveNote(w.db, { text: 'Hates the cold.', entryId: w.id('mara'), storyId: w.id('b2') })
    expect(saved.onlyIn).toBeNull()
    expect(repo.getEntry(w.db, w.id('mara')).description).toContain('Hates the cold.')
  })
})
