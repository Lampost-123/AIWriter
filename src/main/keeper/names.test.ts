// Spotting characters however they are named (long story memory fix 12): what a scene's words call someone. The pure
// rules first; then the memory keeper reading made-up scenes with the fake memory model (tests/fake-provider), its
// reply given "name" items: what it keeps for the scene, what it offers in Worth a look, and Add name, Ignore and Undo.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { defaultWritingPrefs } from '@shared/defaults'
import { startFakeProvider, type FakeProvider } from '../../../tests/fake-provider/server.mjs'
import { entryNamed, readScene, saveParas, testWorld } from '../../../tests/unit/keeperRead'
import * as repo from '../db/repo'
import * as kdb from '../db/keeper'
import { calledIn } from '../db/called'
import { gatherContextInput } from '../ai/gather'
import { aliasWorthy, cleanCalled } from './names'
import { keepMemoryCheck, listMemoryChecks, removeMemoryCheck, undoMemoryCheck } from './checkQueue'
import { undoItem } from './undo'
import { READING_SYSTEM } from './prompts'

describe('what a scene calls someone', () => {
  it('tidies the words a "name" item gives', () => {
    expect(cleanCalled('  the   Captain ')).toBe('the Captain')
    expect(cleanCalled('“the Captain’s”')).toBe('the Captain')
    expect(cleanCalled("her brother's")).toBe('her brother')
    expect(cleanCalled('Red,')).toBe('Red')
  })

  it('never a pronoun, "the" alone, a lower-case single word, or something too long', () => {
    for (const bad of ['she', 'Her', 'them', 'the', 'her', 'boss', 'girl', 'x', '', 'a b c d e f g', 'the man who sold the world and then some more'])
      expect(cleanCalled(bad)).toBeNull()
    expect(cleanCalled(42)).toBeNull()
    expect(cleanCalled('Mother')).toBe('Mother')
    expect(cleanCalled('the old woman')).toBe('the old woman')
  })

  it('offered as another name: a nickname or a title, never a relation or a description', () => {
    for (const yes of ['the Captain', 'Red', 'The Old Man', 'Lord Harlan', 'Aunt Jo', 'Mother Agate', 'the Duke of Varn']) expect(aliasWorthy(yes)).toBe(true)
    for (const no of ['her brother', 'Her Brother', 'my Lord', 'Mother', 'Gran', 'the old woman', 'the boy', 'Brother', 'his Majesty'])
      expect(aliasWorthy(no)).toBe(false)
  })

  it('the memory model is asked for them, in the reply it already gives', () => {
    expect(READING_SYSTEM).toContain('{"type": "name", "entry": "E1", "name": "the Captain", "quote": "..."}')
    expect(READING_SYSTEM).toContain('"her brother" if here it can only mean them')
  })
})

let fake: FakeProvider
beforeAll(async () => {
  fake = await startFakeProvider({ delayMs: 0 })
})
afterAll(() => fake.close())

const DECK = 'The Captain shouted at her brother across the deck.'

/** Mara and Tobin, read from the first scene, where the words call Mara "the Captain" and Tobin "her brother". */
async function deckScene() {
  const w = testWorld(1)
  const [s1, s2] = w.scenes
  saveParas(w.db, s1, [
    ['p1', 'Mara lost her hat. Tobin lost his oar.'],
    ['p2', DECK]
  ])
  await readScene(w.db, fake, s1, {
    add: [
      { type: 'name', entry: 'Mara', name: 'the Captain', quote: DECK },
      { type: 'name', entry: 'Tobin', name: 'her brother', quote: DECK }
    ]
  })
  return { ...w, s1, s2, mara: entryNamed(w.db, 'Mara')!, tobin: entryNamed(w.db, 'Tobin')! }
}

describe('the memory keeper reads what the words call someone', () => {
  it('keeps both for the scene, each with a note; offers the title as another name, never the relation', async () => {
    const w = await deckScene()
    expect(calledIn(w.db, w.s1)).toEqual([
      { entryId: w.mara.id, words: 'the Captain' },
      { entryId: w.tobin.id, words: 'her brother' }
    ])
    const notes = kdb.listLog(w.db).filter((l) => l.note && l.entryId === w.mara.id)
    expect(notes.map((l) => l.text)).toEqual(['Also called “the Captain” here'])
    // The relation gets a plain note, so Adam can see it and take it back, but is never offered as another name.
    expect(kdb.listLog(w.db).filter((l) => l.note && l.entryId === w.tobin.id).map((l) => l.text)).toEqual(['Called “her brother” here'])
    const checks = listMemoryChecks(w.db).filter((i) => i.group === 'alias')
    expect(checks).toHaveLength(1)
    expect(checks[0]).toMatchObject({ entryId: w.mara.id, entryName: 'Mara', text: 'Also called “the Captain”', sceneId: w.s1, quote: DECK })
    // Nothing on the entries themselves until Adam says so.
    expect(entryNamed(w.db, 'Mara')!.aliases).toEqual([])
  })

  it('the writer of that scene and of the next knows who they mean', async () => {
    const w = await deckScene()
    const opts = { prefs: defaultWritingPrefs(), contextLength: 32000, creativity: 'balanced' as const }
    expect(gatherContextInput(w.db, w.s1, undefined, opts).called?.here).toEqual(calledIn(w.db, w.s1))
    const next = gatherContextInput(w.db, w.s2, undefined, opts)
    expect(next.called?.previous).toEqual(calledIn(w.db, w.s1))
    expect(next.called?.here).toEqual([])
  })

  it('Add name puts it on the character, once; Undo takes it off again', async () => {
    const w = await deckScene()
    const item = listMemoryChecks(w.db).find((i) => i.group === 'alias')!
    const undo = keepMemoryCheck(w.db, item.fact)
    const mara = entryNamed(w.db, 'Mara')!
    expect(mara.aliases).toEqual(['the Captain'])
    // Adam's say: the name is his, so the memory never takes it away.
    expect(mara.fieldOrigins.aliases).toBe('adam')
    expect(listMemoryChecks(w.db).some((i) => i.group === 'alias')).toBe(false)
    undoMemoryCheck(w.db, undo)
    expect(entryNamed(w.db, 'Mara')!.aliases).toEqual([])
    expect(listMemoryChecks(w.db).filter((i) => i.group === 'alias')).toHaveLength(1)
  })

  it('Ignore leaves the character as they are and stops the words counting as them; Undo brings both back', async () => {
    const w = await deckScene()
    const item = listMemoryChecks(w.db).find((i) => i.group === 'alias')!
    const undo = removeMemoryCheck(w.db, item.fact)
    expect(listMemoryChecks(w.db).some((i) => i.group === 'alias')).toBe(false)
    expect(calledIn(w.db, w.s1).map((c) => c.words)).toEqual(['her brother'])
    expect(entryNamed(w.db, 'Mara')!.aliases).toEqual([])
    undoMemoryCheck(w.db, undo)
    expect(listMemoryChecks(w.db).filter((i) => i.group === 'alias')).toHaveLength(1)
    expect(calledIn(w.db, w.s1).map((c) => c.words).sort()).toEqual(['her brother', 'the Captain'])
    // Dismissed in What changed instead: the same.
    const note = kdb.listLog(w.db).find((l) => l.note && l.entryId === w.mara.id)!
    undoItem(w.db, note.id)
    expect(listMemoryChecks(w.db).some((i) => i.group === 'alias')).toBe(false)
    expect(calledIn(w.db, w.s1).map((c) => c.words)).toEqual(['her brother'])
  })

  it('Ignore sticks: the scene read again with the same words never counts them as her there again', async () => {
    const w = await deckScene()
    removeMemoryCheck(w.db, listMemoryChecks(w.db).find((i) => i.group === 'alias')!.fact)
    const again = async () => {
      saveParas(w.db, w.s1, [
        ['p1', 'Mara lost her hat. Tobin lost his oar.'],
        ['p2', DECK],
        ['p3', 'The Captain laughed at her brother.']
      ])
      await readScene(w.db, fake, w.s1, {
        add: [
          { type: 'name', entry: 'Mara', name: 'the Captain', quote: DECK },
          { type: 'name', entry: 'Tobin', name: 'her brother', quote: DECK }
        ]
      })
    }
    await again()
    expect(calledIn(w.db, w.s1).map((c) => c.words)).toEqual(['her brother'])
    expect(listMemoryChecks(w.db).some((i) => i.group === 'alias')).toBe(false)
    // Never offered again anywhere in the story, but another scene may still call her so.
    saveParas(w.db, w.s2, [['q1', 'The Captain came aboard.']])
    await readScene(w.db, fake, w.s2, { add: [{ type: 'name', entry: 'Mara', name: 'the Captain', quote: 'The Captain came aboard.' }] })
    expect(calledIn(w.db, w.s2)).toEqual([{ entryId: w.mara.id, words: 'the Captain' }])
    expect(listMemoryChecks(w.db).some((i) => i.group === 'alias')).toBe(false)
    expect(kdb.listLog(w.db).filter((l) => l.sceneId === w.s2 && l.note).map((l) => l.text)).toEqual(['Called “the Captain” here'])
  })

  it('a relation, dismissed in What changed, stops counting there for good', async () => {
    const w = await deckScene()
    const note = kdb.listLog(w.db).find((l) => l.note && l.entryId === w.tobin.id)!
    undoItem(w.db, note.id)
    expect(calledIn(w.db, w.s1).map((c) => c.words)).toEqual(['the Captain'])
    saveParas(w.db, w.s1, [
      ['p1', 'Mara lost her hat. Tobin lost his oar.'],
      ['p2', DECK],
      ['p3', 'Her brother said nothing.']
    ])
    await readScene(w.db, fake, w.s1, { add: [{ type: 'name', entry: 'Tobin', name: 'her brother', quote: 'Her brother said nothing.' }] })
    expect(calledIn(w.db, w.s1).map((c) => c.words)).toEqual(['the Captain'])
    expect(kdb.listLog(w.db).filter((l) => l.note && l.entryId === w.tobin.id)).toHaveLength(1)
  })

  it('words no longer in the scene stop counting there at its next read', async () => {
    const w = await deckScene()
    saveParas(w.db, w.s1, [
      ['p1', 'Mara lost her hat. Tobin lost his oar.'],
      ['p2', 'The Captain shouted across the deck.']
    ])
    await readScene(w.db, fake, w.s1)
    expect(calledIn(w.db, w.s1)).toEqual([{ entryId: w.mara.id, words: 'the Captain' }])
  })

  it('Add name is refused, in plain words, when someone else already goes by it', async () => {
    const w = await deckScene()
    const item = listMemoryChecks(w.db).find((i) => i.group === 'alias')!
    repo.updateEntry(w.db, w.tobin.id, { aliases: ['the Captain'] })
    // No longer offered...
    expect(listMemoryChecks(w.db).some((i) => i.group === 'alias')).toBe(false)
    // ...and an Add that was already on screen is refused, changing nothing.
    expect(() => keepMemoryCheck(w.db, item.fact)).toThrow(
      '“the Captain” is already Tobin’s name, so it wasn’t added to Mara. To give it to Mara, take it off Tobin’s page first.'
    )
    expect(entryNamed(w.db, 'Mara')!.aliases).toEqual([])
    expect(kdb.getLog(w.db, (item.fact as { logId: string }).logId)!.undone).toBe(false)
  })

  it('offered once: read again, it is not offered again', async () => {
    const w = await deckScene()
    saveParas(w.db, w.s1, [
      ['p1', 'Mara lost her hat. Tobin lost his oar.'],
      ['p2', DECK],
      ['p3', 'The Captain laughed.']
    ])
    await readScene(w.db, fake, w.s1, { add: [{ type: 'name', entry: 'Mara', name: 'the Captain', quote: 'The Captain laughed.' }] })
    expect(kdb.listLog(w.db).filter((l) => l.note && l.entryId === w.mara.id)).toHaveLength(1)
  })

  it('leaves alone words given for two people, words already someone’s name, words not in the scene, and places', async () => {
    const w = testWorld(0)
    const [s1] = w.scenes
    const quote = 'Red waved from the Gilded Eel, and the Boss nodded.'
    saveParas(w.db, s1, [
      ['p1', 'Mara lost her hat. Tobin lost his oar. Ana lost her bag.'],
      ['p2', quote]
    ])
    await readScene(w.db, fake, s1)
    const ana = entryNamed(w.db, 'Ana')!
    repo.updateEntry(w.db, ana.id, { aliases: ['the Boss'] })
    const eel = repo.createEntry(w.db, 'place', { name: 'The Gilded Eel' })
    saveParas(w.db, s1, [
      ['p1', 'Mara lost her hat. Tobin lost his oar. Ana lost her bag.'],
      ['p2', quote],
      ['p3', 'The Lady sat down.']
    ])
    await readScene(w.db, fake, s1, {
      add: [
        { type: 'name', entry: 'Mara', name: 'Red', quote },
        { type: 'name', entry: 'Tobin', name: 'Red', quote },
        { type: 'name', entry: 'Mara', name: 'the Boss', quote },
        { type: 'name', entry: 'Tobin', name: 'the Skipper', quote },
        { type: 'name', entry: eel.name, name: 'the Eel', quote },
        // The one that counts.
        { type: 'name', entry: 'Mara', name: 'the Lady', quote: 'The Lady sat down.' }
      ]
    })
    expect(calledIn(w.db, s1)).toEqual([{ entryId: entryNamed(w.db, 'Mara')!.id, words: 'the Lady' }])
    expect(listMemoryChecks(w.db).filter((i) => i.group === 'alias').map((i) => i.text)).toEqual(['Also called “the Lady”'])
  })
})
