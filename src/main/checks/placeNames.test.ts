// The scene card's place keeps its name (free rules, 2026-10-19): a named place of the same kind as the card's place (or a
// place it is in) under another name is a slip, mended without asking only where that is safe. Controls: a second real
// codex place, a person's or a family's name, a line of dialogue, the codex's own name in the same paragraph, a feast or a
// plant, a place the card isn't in. Invented text.
import { describe, expect, it } from 'vitest'
import { placeNameSlips, placeFixWhy, type LockPlace, type PlaceNameContext } from './placeNames'

const ashby: LockPlace = { id: 'ashby', name: 'Ashby', aliases: [], parentId: null }
const anne: LockPlace = { id: 'anne', name: "St Anne's church, Ashby", aliases: [], parentId: 'ashby' }
const vestry: LockPlace = { id: 'vestry', name: 'The vestry', aliases: [], parentId: 'anne' }
const crown: LockPlace = { id: 'crown', name: 'The Crown Inn', aliases: [], parentId: 'ashby' }
const cobb: LockPlace = { id: 'cobb', name: 'Cobb Lane', aliases: [], parentId: 'ashby' }
const mary: LockPlace = { id: 'mary', name: "St Mary's chapel", aliases: [], parentId: 'ashby' }
const PLACES = [ashby, anne, vestry, crown, cobb, mary]

const ctx = (chain: string[], more: Partial<PlaceNameContext> = {}): PlaceNameContext => ({
  places: PLACES,
  chain,
  otherNames: new Set(['mara', 'tobin', 'tobin venn', 'venn']),
  ...more
})

const slips = (text: string, c: PlaceNameContext, scene?: string) => placeNameSlips(text, c, scene).map((s) => ({ words: s.words, right: s.right, safe: s.safe }))

describe('the card place’s name', () => {
  it('finds a saint’s church named wrong, as the live test’s writer did, and mends it when safe', () => {
    const c = ctx(['anne', 'ashby'])
    expect(slips('Mara knelt in the cold nave of St Chad’s and waited for the bell.', c)).toEqual([{ words: 'St Chad’s', right: "St Anne's", safe: true }])
    expect(slips('The door of St Chad’s Church stood open.', c)).toEqual([{ words: 'St Chad’s', right: "St Anne's", safe: true }])
    expect(slips('Saint Chad’s was empty.', c)).toEqual([{ words: 'Saint Chad’s', right: "Saint Anne's", safe: true }])
    // From a room inside the church, the church is a place it is in.
    expect(slips('Beyond the vestry door, St Chad’s was dark.', ctx(['vestry', 'anne', 'ashby']))).toEqual([{ words: 'St Chad’s', right: "St Anne's", safe: true }])
    const [s] = placeNameSlips('Mara knelt in St Chad’s.', c)
    expect(s.message).toBe("This scene is at St Anne's church, Ashby, but the words call it St Chad’s. St Chad’s isn’t in the codex: use St Anne's?")
    expect(placeFixWhy(s)).toBe("This scene is at St Anne's church, Ashby, so it is St Anne's, not St Chad’s.")
  })

  it('finds an inn named wrong, and asks about a lane (another is often passed), only when the card is at the lane itself', () => {
    expect(slips('The fire in the Red Lion Inn had burned low.', ctx(['crown', 'ashby']))).toEqual([{ words: 'Red Lion', right: 'Crown', safe: true }])
    expect(slips('Rain ran down Mill Lane to her door.', ctx(['cobb', 'ashby']))).toEqual([{ words: 'Mill', right: 'Cobb', safe: false }])
    // A house on Cobb Lane may look out on Mill Lane.
    const house: LockPlace = { id: 'house', name: 'The Venns’ house', aliases: [], parentId: 'cobb' }
    expect(slips('From the window she watched Mill Lane.', { ...ctx(['house', 'cobb', 'ashby']), places: [...PLACES, house] })).toEqual([])
  })

  it('asks rather than mends when the codex name is elsewhere in the scene, or two card places have that kind', () => {
    const scene = 'They had been married at St Anne’s.\n\nMara knelt in St Chad’s.'
    expect(slips('Mara knelt in St Chad’s.', ctx(['anne', 'ashby']), scene)).toEqual([{ words: 'St Chad’s', right: "St Anne's", safe: false }])
  })

  it('says nothing of a second real codex place, a person’s or family’s name, dialogue, a feast, a plant or the saint', () => {
    const c = ctx(['anne', 'ashby'])
    const fine = [
      'From the churchyard she could see St Mary’s chapel.', // another codex place
      'The bells of St Mary’s rang.',
      'Tobin’s Mill stood dark across the water.',
      'They walked up Venn Lane.',
      '‘Father Ivo at St Chad’s would know,’ she said.',
      'It was St John’s Day, and the bells rang.',
      'She brewed St John’s wort for the pain.',
      'Mara prayed to St Anthony.',
      'St Anthony’s medal hung at her throat.',
      'From St Anne’s she could see the spire of St Chad’s.', // two churches in one paragraph
      'Ashby Church was full.', // Ashby is a codex place
      'The door of St Anne’s stood open.'
    ]
    for (const t of fine) expect(slips(t, c), t).toEqual([])
  })

  it('says nothing when the card has no place, or its place has no name of that kind', () => {
    expect(slips('Mara knelt in St Chad’s.', ctx([]))).toEqual([])
    expect(slips('Mara knelt in St Chad’s.', ctx(['ashby']))).toEqual([])
    expect(slips('The fire in the Red Lion Inn had burned low.', ctx(['anne', 'ashby']))).toEqual([])
  })
})
