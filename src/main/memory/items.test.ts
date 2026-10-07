// What someone gave away or lost stays known, and an item is found by its main word (Adam, 2026-10-07: the trap story's
// brass compass, given away in scene 7 and taken out of a pocket in scene 23). Invented test text only.
import { describe, expect, it } from 'vitest'
import type { EntryKind, EntryState, RelationshipState } from '@shared/types'
import { holdingLine, holdingsFirst, holdingsOf, itemHeads, mainWord, movesIn, namesOf, type Holding } from './items'
import { memoryWorld } from '../../../tests/unit/helpers'
import * as repo from '../db/repo'
import * as mem from '../db/memory'
import { sceneMemory } from './scene'

let seq = 0
const entry = (kind: EntryKind, name: string, extra: Partial<EntryState> = {}): EntryState => ({
  id: `e${++seq}`,
  kind,
  name,
  aliases: [],
  summary: '',
  description: '',
  tags: [],
  notes: '',
  fields: {},
  parentId: null,
  hardRule: false,
  origin: 'text',
  fieldOrigins: {},
  originStoryId: null,
  originSceneId: null,
  originStart: false,
  byHand: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  happened: [],
  changed: [],
  ...extra
})

const note = (text: string, sc: number, i = 0) => ({ note: text, where: `Fell Road, Ch ${Math.ceil(sc / 4)}, Sc ${sc}`, changeId: `c${sc}-${i}`, at: sc * 10 + i })

/** The trap story's people and things: Wren, Mother Agate the bridge-keeper, Ash, the brass compass and the survey map. */
function cast() {
  const wren = entry('character', 'Wren Calloway')
  const agate = entry('character', 'Mother Agate', { aliases: ['the bridge-keeper'] })
  const ash = entry('character', 'Ash')
  const compass = entry('item', 'The brass compass', { aliases: ["Wren's compass"], summary: "Wren's grandmother's brass pocket compass." })
  const map = entry('item', 'The survey map')
  const fell = entry('place', 'Carrow Fell')
  return { wren, agate, ash, compass, map, fell }
}

/** Many things happen to Wren after the compass goes: it is long out of her last few. */
const busy = (from: number, n: number) => Array.from({ length: n }, (_, i) => note(`walked on through the rain, day ${i}`, from + i))

describe("an item's main word", () => {
  it('is the last word of a name with other words, never a common word or one another entry shares', () => {
    expect(mainWord('The brass compass')).toBe('compass')
    expect(mainWord("Wren's compass")).toBe('compass')
    expect(mainWord('The iron key of Harrow')).toBe('key')
    expect(mainWord('Stormbringer')).toBe('')
    expect(mainWord('The Ring')).toBe('')
    expect(mainWord('The Blade of Dawn')).toBe('')
    const { compass, map, fell, wren } = cast()
    expect(itemHeads([compass, map, fell, wren]).get(compass.id)).toEqual(['compass'])
    expect(itemHeads([compass, map, fell, wren]).get(map.id)).toEqual(['map'])
    // A place that has the word too: "compass" alone could be either.
    const inn = entry('place', 'The Compass Rose')
    expect(itemHeads([compass, inn]).get(compass.id)).toBeUndefined()
    // A common word: the Dragon's Eye is never found by "eye".
    const eye = entry('item', "The Dragon's Eye")
    expect(itemHeads([eye]).get(eye.id)).toBeUndefined()
    expect(namesOf(compass, itemHeads([compass, map]))).toEqual(['The brass compass', "Wren's compass", 'brass compass', 'compass'])
    // Only items: a character is found by its names alone.
    expect(namesOf(wren, itemHeads([compass, wren]))).toEqual(['Wren Calloway'])
  })
})

describe('reading what moved', () => {
  const { wren, agate, ash, compass, map } = cast()
  const heads = itemHeads([wren, agate, ash, compass, map])
  const items = [compass, map].map((e) => ({ id: e.id, names: namesOf(e, heads) }))
  const people = [
    { id: wren.id, names: ['Wren Calloway', 'Wren'] },
    { id: agate.id, names: ['Mother Agate', 'the bridge-keeper'] },
    { id: ash.id, names: ['Ash'] }
  ]
  const own = { self: wren.id, itemSelf: null, items, people }

  it("reads a character's own notes: given, lost, got back, traded for", () => {
    expect(movesIn("Gave her grandmother's brass compass to Mother Agate as a toll", own)).toEqual([{ item: compass.id, to: agate.id, from: [wren.id] }])
    expect(movesIn('gave the bridge-keeper her compass', own)).toEqual([{ item: compass.id, to: agate.id, from: [wren.id] }])
    expect(movesIn('paid the toll with her compass', own)).toEqual([{ item: compass.id, to: null, from: [wren.id] }])
    expect(movesIn('dropped the survey map in the river', own)).toEqual([{ item: map.id, to: null, from: [wren.id] }])
    expect(movesIn('got the compass back from Mother Agate', own)).toEqual([{ item: compass.id, to: wren.id, from: [agate.id] }])
    expect(movesIn('traded her knife for the compass', own)).toEqual([{ item: compass.id, to: wren.id, from: [] }])
    expect(movesIn('had her compass stolen by Ash', own)).toEqual([{ item: compass.id, to: ash.id, from: [wren.id] }])
    expect(movesIn('Mother Agate took her compass as a toll', own)).toEqual([{ item: compass.id, to: agate.id, from: [wren.id] }])
    // Someone met earlier in the clause isn't who does it; a "by" after an active verb isn't who has it.
    expect(movesIn('having met Ash at the inn, gave her compass to Mother Agate', own)).toEqual([{ item: compass.id, to: agate.id, from: [wren.id] }])
    expect(movesIn('found the compass, guarded by Ash', own)).toEqual([{ item: compass.id, to: wren.id, from: [] }])
    expect(movesIn('took the compass from Ash, then gave it to Mother Agate', own)).toEqual([
      { item: compass.id, to: wren.id, from: [ash.id] },
      { item: compass.id, to: agate.id, from: [wren.id] }
    ])
  })

  it('reads nothing into what did not happen, or what is no item', () => {
    for (const text of [
      'did not give her compass to Mother Agate',
      'promised to give the compass to Ash',
      'would never sell the compass',
      'took a bearing with the compass',
      'lost her temper with Ash',
      'lost the use of her left hand',
      "the compass's needle stuck",
      'gave Ash a hard look',
      'has a scar where the compass chain cut her',
      'gave up hope of finding the compass'
    ]) {
      expect(movesIn(text, own), text).toEqual([])
    }
  })

  it("reads an item's own notes and an event's words", () => {
    const self = { self: null, itemSelf: compass.id, items, people }
    expect(movesIn('given to Mother Agate as a toll', self)).toEqual([{ item: compass.id, to: agate.id, from: [] }])
    expect(movesIn('Wren gave it to the bridge-keeper', self)).toEqual([{ item: compass.id, to: agate.id, from: [wren.id] }])
    expect(movesIn('stolen by Ash from Mother Agate', self)).toEqual([{ item: compass.id, to: ash.id, from: [agate.id] }])
    expect(movesIn('lost in the river', self)).toEqual([{ item: compass.id, to: null, from: [] }])
    expect(movesIn('kept in the chapel', self)).toEqual([])
    const event = { self: null, itemSelf: null, items, people }
    expect(movesIn("Wren paid Mother Agate's toll with her brass compass.", event)).toEqual([{ item: compass.id, to: null, from: [wren.id] }])
  })
})

describe('who has what', () => {
  it('the compass case: given away early, still gone many scenes on, and said with where it happened', () => {
    const { wren, agate, ash, compass, map } = cast()
    wren.happened = [note('burned her left forearm pulling the survey case from the fire', 2), note("gave her grandmother's brass compass to Mother Agate as a toll", 7), ...busy(8, 19)]
    const all = [wren, agate, ash, compass, map]
    const got = holdingsOf({ entries: all, relationships: [], people: [wren.id, ash.id] })
    expect(got).toHaveLength(1)
    expect(got[0]).toMatchObject({ personId: wren.id, itemId: compass.id, has: false, item: 'the brass compass', where: 'Fell Road, Ch 2, Sc 7' })
    expect(holdingLine(got[0], (w) => w.replace('Fell Road, ', ''))).toBe(
      "Wren Calloway: no longer has the brass compass (gave her grandmother's brass compass to Mother Agate as a toll; since Ch 2, Sc 7)"
    )
    // Mother Agate, there too, has it now: Wren's note says so, in Wren's name.
    const both = holdingsOf({ entries: all, relationships: [], people: [wren.id, agate.id] })
    expect(both.map((h) => holdingLine(h))).toContain(
      "Mother Agate: has the brass compass (Wren Calloway gave her grandmother's brass compass to Mother Agate as a toll; since Fell Road, Ch 2, Sc 7)"
    )
  })

  it('got back: has it again, and whoever had it no longer does', () => {
    const { wren, agate, ash, compass } = cast()
    wren.happened = [note('gave her compass to Mother Agate as a toll', 7), ...busy(8, 10), note('got the compass back from Mother Agate', 20)]
    const got = holdingsOf({ entries: [wren, agate, ash, compass], relationships: [], people: [wren.id, agate.id] })
    const line = (id: string) => holdingLine(got.find((h) => h.personId === id)!)
    expect(line(wren.id)).toBe('Wren Calloway: has the brass compass again (got the compass back from Mother Agate; since Fell Road, Ch 5, Sc 20)')
    expect(line(agate.id)).toBe('Mother Agate: no longer has the brass compass (Wren Calloway got the compass back from Mother Agate; since Fell Road, Ch 5, Sc 20)')
  })

  it("from relationships, an item's own notes and events, read in line order", () => {
    const { wren, agate, ash, compass } = cast()
    // Wren owns it from the start (a tie Adam set); the item's own note gives it away in scene 7.
    const owns: RelationshipState = { aId: wren.id, bId: compass.id, type: 'owns', aFeels: '', bFeels: '', where: '', at: -1 }
    compass.happened = [note('given to Mother Agate as a toll', 7)]
    const got = holdingsOf({ entries: [wren, agate, ash, compass], relationships: [owns], people: [wren.id, agate.id] })
    expect(got.find((h) => h.personId === wren.id)).toMatchObject({ has: false, how: 'given to Mother Agate as a toll', where: 'Fell Road, Ch 2, Sc 7' })
    expect(got.find((h) => h.personId === agate.id)).toMatchObject({ has: true })
    // Held from the start and never moved: no change, nothing to say.
    compass.happened = []
    expect(holdingsOf({ entries: [wren, agate, compass], relationships: [owns], people: [wren.id] })).toEqual([])
    // A tie set during the story says who holds it now.
    const holds: RelationshipState = { aId: compass.id, bId: ash.id, type: 'held by', aFeels: '', bFeels: '', where: 'Fell Road, Ch 3, Sc 11', at: 110 }
    const tied = holdingsOf({ entries: [wren, agate, ash, compass], relationships: [owns, holds], people: [wren.id, ash.id] })
    expect(tied.map((h) => holdingLine(h))).toEqual([
      'Wren Calloway: no longer has the brass compass (the brass compass held by Ash; since Fell Road, Ch 3, Sc 11)',
      'Ash: has the brass compass (the brass compass held by Ash; since Fell Road, Ch 3, Sc 11)'
    ])
    // An event the keeper made, with those in it.
    const toll = entry('event', 'The toll at the bridge', { summary: 'Wren paid the toll with her brass compass.' })
    const inIt: RelationshipState = { aId: wren.id, bId: toll.id, type: 'involved in', aFeels: '', bFeels: '', where: 'Fell Road, Ch 2, Sc 7', at: 70 }
    const ev = holdingsOf({ entries: [wren, agate, compass, toll], relationships: [inIt], people: [wren.id] })
    expect(ev.map((h) => holdingLine(h))).toEqual(['Wren Calloway: no longer has the brass compass (Wren paid the toll with her brass compass; since Fell Road, Ch 2, Sc 7)'])
  })

  it('says nothing of people not in the scene, nor of things that are not items', () => {
    const { wren, agate, ash, compass } = cast()
    wren.happened = [note('gave her compass to Mother Agate', 7), note('lost her left hand to the frost', 9), note('lost her temper with Ash', 10)]
    expect(holdingsOf({ entries: [wren, agate, ash, compass], relationships: [], people: [ash.id] })).toEqual([])
    expect(holdingsOf({ entries: [wren, agate, ash, compass], relationships: [], people: [wren.id] })).toHaveLength(1)
  })

  it('counts only what comes before the scene on its own line: never a later scene, nor a later book', () => {
    const db = memoryWorld()
    const b1 = repo.listStories(db)[0].id
    const outline = repo.getOutline(db, b1)
    const ch1 = outline.chapters[0].id
    const s1 = outline.scenes[0].id
    const s2 = repo.createScene(db, ch1).id
    const s3 = repo.createScene(db, ch1).id
    const s4 = repo.createScene(db, ch1).id
    const b2 = repo.createStory(db, { title: 'Book 2' }).id
    const b2s1 = repo.createScene(db, repo.createChapter(db, b2).id).id
    const wren = repo.createEntry(db, 'character', { name: 'Wren' }).id
    const agate = repo.createEntry(db, 'character', { name: 'Mother Agate' }).id
    repo.createEntry(db, 'item', { name: 'The brass compass' })
    const at = (sceneId: string, note: string) => mem.insertChange(db, { entryId: wren, anchor: 'scene', sceneId, kind: 'update', payload: { note }, origin: 'text' })
    at(s1, 'gave her brass compass to Mother Agate as a toll')
    at(s3, 'got the compass back from Mother Agate')
    at(b2s1, 'lost the compass in the river')
    const lines = (sceneId: string) => {
      const m = sceneMemory(db, sceneId)
      return holdingsOf({ entries: m.entries, relationships: m.relationships, people: [wren, agate] }).map((h) => holdingLine(h))
    }
    expect(lines(s2)).toEqual([
      'Wren: no longer has the brass compass (gave her brass compass to Mother Agate as a toll; since Book 1, Ch 1, Sc 1)',
      'Mother Agate: has the brass compass (Wren gave her brass compass to Mother Agate as a toll; since Book 1, Ch 1, Sc 1)'
    ])
    // Scene 3's own change is what scene 3 brings about, not a fact while it is written.
    expect(lines(s3)).toEqual(lines(s2))
    expect(lines(s4)).toEqual([
      'Wren: has the brass compass again (got the compass back from Mother Agate; since Book 1, Ch 1, Sc 3)',
      'Mother Agate: no longer has the brass compass (Wren got the compass back from Mother Agate; since Book 1, Ch 1, Sc 3)'
    ])
  })

  it('puts first what the scene names, then what someone no longer has, then the most recent', () => {
    const h = (item: string, has: boolean, at: number, words: string[]): Holding => ({
      personId: 'w',
      person: 'Wren',
      itemId: item,
      item,
      words,
      has,
      again: false,
      how: '',
      where: '',
      at
    })
    const list = [h('the bead', true, 90, ['bead']), h('the map', false, 20, ['map']), h('the compass', false, 70, ['compass']), h('the lantern', false, 40, ['lantern'])]
    expect(holdingsFirst(list, 'She checks the compass in the fog.').map((x) => x.item)).toEqual(['the compass', 'the lantern', 'the map', 'the bead'])
    expect(holdingsFirst(list, 'Pell asks about the bead.').map((x) => x.item)).toEqual(['the bead', 'the compass', 'the lantern', 'the map'])
  })
})
