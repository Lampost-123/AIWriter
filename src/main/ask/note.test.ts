// Saving words from an answer to the memory as Adam's own note, and taking them back out (the toast's
// Undo). The note goes on the entry as it is where Adam asks (a prequel's starting description, say), and
// in an own version of events it never reaches another story nor stops the entry's own description from
// reaching that one.
import { describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import { memoryWorld } from '../../../tests/unit/helpers'
import { dbWorld } from '../../../tests/unit/testWorld'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { countRaw } from '../ai/tokens'
import { memoryAt } from '../memory/asOf'
import { assembleAsk } from './context'
import { notePageName, noteName, noteText, saveNote, undoNote, withNote, withoutNote } from './note'

type World = ReturnType<typeof dbWorld>

/** An entry's description as the memory has it at a story's end, or after one of its scenes. */
const descriptionIn = (w: World, entry: string, story: string, scene?: string): string => {
  const at = scene ? { kind: 'scene' as const, storyId: w.id(story), sceneId: w.id(scene) } : { kind: 'end' as const, storyId: w.id(story) }
  const m = memoryAt(w.db, at)
  return (m.state.entries.get(w.id(entry)) ?? m.state.absent.get(w.id(entry)))?.description ?? ''
}

/** What Ask the world sends for a question asked in a story (no scene open). */
const briefing = (w: World, question: string, story: string): string =>
  assembleAsk(
    w.db,
    { question, storyId: w.id(story), sceneId: null, turns: [], prefs: defaultWritingPrefs(), contextLength: null },
    countRaw
  ).messages[0].content

describe('the words of a note', () => {
  it('takes the brackets off names and tidies the lines', () => {
    expect(noteText('She trusts [[Tobin]] and [[Mara Venn|Mara]].  \n\n\n\nThen [[ The Grey Ferry ]].')).toBe(
      'She trusts Tobin and Mara.\n\nThen The Grey Ferry.'
    )
  })

  it('goes at the end of a description, as its own paragraph, and comes out again', () => {
    expect(withNote('A smith’s daughter.\n', 'Quick to anger.')).toBe('A smith’s daughter.\n\nQuick to anger.')
    expect(withNote('  ', 'Quick to anger.')).toBe('Quick to anger.')
    expect(withoutNote('A smith’s daughter.\n\nQuick to anger.\n\nLoves the river.', 'Quick to anger.')).toBe(
      'A smith’s daughter.\n\nLoves the river.'
    )
    expect(withoutNote('A smith’s daughter.', 'Quick to anger.')).toBeNull()
  })

  it('names a new note after the question it answers', () => {
    expect(noteName('Give me ten tavern names that fit the north')).toBe('Tavern names that fit the north')
    expect(noteName('Could you suggest a few names for the river gods?')).toBe('Names for the river gods')
    expect(noteName('What would Mara do if Tobin lied to her?')).toBe('What would Mara do if Tobin lied to her')
    expect(noteName('')).toBe('A note from Ask the world')
    expect(noteName('Give me ' + 'very '.repeat(30) + 'long names').length).toBeLessThanOrEqual(60)
  })

  it('names a page holding a note about an entry after the entry and the question', () => {
    expect(notePageName('Mara Venn', 'What would Mara do if Tobin lied to her?')).toBe('Mara Venn: What would Mara do if Tobin lied to her')
    expect(notePageName('Mara Venn', '')).toBe('Mara Venn: A note from Ask the world')
    expect(notePageName('Mara Venn', 'Why ' + 'very '.repeat(40) + 'much?').length).toBeLessThanOrEqual(82)
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
  it('on an entry whose description other stories share, becomes a page of its own there: no other story sees it', () => {
    const w = dbWorld()
    const before = repo.getEntry(w.db, w.id('mara')).description
    const saved = saveNote(w.db, {
      text: 'She keeps a knife in her boot.',
      entryId: w.id('mara'),
      question: 'What would Mara do if Tobin lied to her?',
      storyId: w.id('keep')
    })
    expect(saved).toMatchObject({
      kind: 'lore',
      created: true,
      onlyIn: 'Mara Keeps Her Hand',
      name: 'Mara: What would Mara do if Tobin lied to her'
    })
    // The entry itself (what every story starts from) is unchanged.
    expect(repo.getEntry(w.db, w.id('mara')).description).toBe(before)
    expect(mem.changesForEntry(w.db, w.id('mara')).some((c) => JSON.stringify(c.payload).includes('knife'))).toBe(false)
    // The note is in the what-if's memory, and in no other story's.
    expect(memoryAt(w.db, { kind: 'end', storyId: w.id('keep') }).state.entries.get(saved.entryId)?.description).toBe(
      'She keeps a knife in her boot.'
    )
    expect(briefing(w, 'Does Mara keep a knife?', 'keep')).toContain('She keeps a knife in her boot.')
    for (const story of ['b1', 'b2', 'other']) {
      expect(memoryAt(w.db, { kind: 'end', storyId: w.id(story) }).state.entries.has(saved.entryId), story).toBe(false)
      expect(briefing(w, 'Does Mara keep a knife?', story), story).not.toContain('knife in her boot')
    }
    undoNote(w.db, saved.undo)
    expect(memoryAt(w.db, { kind: 'end', storyId: w.id('keep') }).state.entries.has(saved.entryId)).toBe(false)
  })

  it('never stops a later edit of the entry from reaching that story', () => {
    const w = dbWorld()
    saveNote(w.db, { text: 'She keeps a knife in her boot.', entryId: w.id('mara'), question: 'Knife?', storyId: w.id('keep') })
    repo.updateEntry(w.db, w.id('mara'), { description: 'A blacksmith’s daughter with a quick temper.' })
    expect(descriptionIn(w, 'mara', 'keep')).toBe('A blacksmith’s daughter with a quick temper.')
    expect(briefing(w, 'How is Mara?', 'keep')).toContain('A blacksmith’s daughter with a quick temper.')
  })

  it('on an entry whose description the story already sets for itself, goes there, and Undo puts it back as it was', () => {
    const w = dbWorld()
    // A detail the what-if's own text gave Mara (as the memory keeper pins one in an own version of events).
    const detail = mem.insertChange(w.db, {
      entryId: w.id('mara'),
      anchor: 'scene',
      sceneId: w.id('keep.c1.s1'),
      kind: 'update',
      payload: { note: '', description: 'A one-handed swordswoman.' },
      origin: 'text'
    })
    const saved = saveNote(w.db, { text: 'She keeps a knife in her boot.', entryId: w.id('mara'), storyId: w.id('keep') })
    expect(saved).toMatchObject({
      entryId: w.id('mara'),
      created: false,
      onlyIn: 'Mara Keeps Her Hand',
      asOf: 'Mara Keeps Her Hand, Ch 1, Sc 1'
    })
    expect(descriptionIn(w, 'mara', 'keep')).toBe('A one-handed swordswoman.\n\nShe keeps a knife in her boot.')
    // It is Adam's now, so the memory keeper never changes it.
    expect(mem.getChange(w.db, detail.id).origin).toBe('adam')
    for (const story of ['b1', 'b2', 'other']) expect(descriptionIn(w, 'mara', story), story).not.toContain('knife')
    undoNote(w.db, saved.undo)
    const back = mem.getChange(w.db, detail.id)
    expect(back.origin).toBe('text')
    expect(back.kind === 'update' && back.payload.description).toBe('A one-handed swordswoman.')
  })

  it('on an entry that first exists in that story, goes on the entry itself', () => {
    const w = dbWorld()
    const sword = repo.createEntry(
      w.db,
      'item',
      { name: 'Kestrel', description: 'A short sword.' },
      { origin: 'adam', originStoryId: w.id('keep') }
    )
    const saved = saveNote(w.db, { text: 'Forged in the north.', entryId: sword.id, storyId: w.id('keep') })
    expect(saved).toMatchObject({ created: false, onlyIn: 'Mara Keeps Her Hand', asOf: null })
    expect(repo.getEntry(w.db, sword.id).description).toBe('A short sword.\n\nForged in the north.')
  })

  it('a new note made there first exists there alone', () => {
    const w = dbWorld()
    const saved = saveNote(w.db, {
      text: 'The keep has a hidden well.',
      entryId: null,
      question: 'Where is the water?',
      storyId: w.id('keep')
    })
    expect(saved.onlyIn).toBe('Mara Keeps Her Hand')
    expect(memoryAt(w.db, { kind: 'end', storyId: w.id('keep') }).state.entries.has(saved.entryId)).toBe(true)
    expect(memoryAt(w.db, { kind: 'end', storyId: w.id('b1') }).state.entries.has(saved.entryId)).toBe(false)
  })
})

describe('a note saved in a story of the main history', () => {
  it('goes on the entry itself when its own description is what counts there', () => {
    const w = dbWorld()
    const saved = saveNote(w.db, { text: 'Hates the cold.', entryId: w.id('mara'), storyId: w.id('b2'), sceneId: w.id('b2.c3.s1') })
    expect(saved).toMatchObject({ onlyIn: null, asOf: null, created: false })
    expect(repo.getEntry(w.db, w.id('mara')).description).toContain('Hates the cold.')
  })

  it('in a prequel, goes on the starting description it gives the entry, so the prequel has it and Book 1 doesn’t', () => {
    const w = dbWorld()
    const before = repo.getEntry(w.db, w.id('mara')).description
    const saved = saveNote(w.db, { text: 'She hides in the mill when it rains.', entryId: w.id('mara'), storyId: w.id('ym') })
    expect(saved).toMatchObject({ created: false, onlyIn: null, asOf: 'the start of Young Mara' })
    expect(briefing(w, 'What is Mara like?', 'ym')).toContain('She hides in the mill when it rains.')
    expect(briefing(w, 'What is Mara like?', 'ym2')).toContain('She hides in the mill when it rains.')
    expect(briefing(w, 'What is Mara like?', 'b1')).not.toContain('She hides in the mill')
    expect(repo.getEntry(w.db, w.id('mara')).description).toBe(before)
    expect(descriptionIn(w, 'mara', 'ym')).toBe('A girl of nine who has never left the mill town.\n\nShe hides in the mill when it rains.')
    // Adam's own edit of the drafted starting description: the story's own text no longer replaces it.
    const start = mem.changesForEntry(w.db, w.id('mara')).find((c) => c.kind === 'full')!
    expect(start.origin).toBe('adam')
    undoNote(w.db, saved.undo)
    expect(descriptionIn(w, 'mara', 'ym')).toBe('A girl of nine who has never left the mill town.')
    expect(mem.getChange(w.db, start.id).origin).toBe('ai')
  })

  it('goes on a detail a scene gave the entry when that is what counts where Adam is, and from there on only', () => {
    const w = dbWorld()
    mem.insertChange(w.db, {
      entryId: w.id('tobin'),
      anchor: 'scene',
      sceneId: w.id('b2.c3.s1'),
      kind: 'update',
      payload: { note: '', description: 'A ferryman gone grey, who no longer trusts Mara.' },
      origin: 'text'
    })
    const saved = saveNote(w.db, {
      text: 'He still keeps her letters.',
      entryId: w.id('tobin'),
      storyId: w.id('b2'),
      sceneId: w.id('b2.c4.s1')
    })
    expect(saved.asOf).toBe('Book 2, Ch 3, Sc 1')
    expect(descriptionIn(w, 'tobin', 'b2', 'b2.c4.s1')).toBe(
      'A ferryman gone grey, who no longer trusts Mara.\n\nHe still keeps her letters.'
    )
    expect(descriptionIn(w, 'tobin', 'b3')).toContain('He still keeps her letters.')
    // Before that scene, and in Book 1, Tobin is as he was.
    expect(descriptionIn(w, 'tobin', 'b2', 'b2.c2.s1')).toBe("Mara's oldest friend, who keeps the ferry.")
    expect(descriptionIn(w, 'tobin', 'b1')).toBe("Mara's oldest friend, who keeps the ferry.")
  })

  it('Undo after the description was edited since takes out only the note', () => {
    const w = dbWorld()
    const saved = saveNote(w.db, { text: 'She hides in the mill when it rains.', entryId: w.id('mara'), storyId: w.id('ym') })
    if (saved.undo.kind !== 'changed') throw new Error('expected a change')
    const c = mem.getChange(w.db, saved.undo.changeId)
    if (c.kind !== 'full') throw new Error('expected a starting description')
    mem.replaceChange(w.db, c.id, {
      entryId: c.entryId,
      anchor: c.anchor,
      storyId: c.storyId,
      kind: 'full',
      payload: { ...c.payload, description: `${c.payload.description}\n\nAfraid of the dark.` },
      origin: 'adam'
    })
    undoNote(w.db, saved.undo)
    expect(descriptionIn(w, 'mara', 'ym')).toBe('A girl of nine who has never left the mill town.\n\nAfraid of the dark.')
  })
})
