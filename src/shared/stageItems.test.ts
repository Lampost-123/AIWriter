// The stage piece by piece (step 2b): each piece of clothing and each thing in the place changes on its own, a change
// finds the piece it is about, and an old one-line "wearing" reads as pieces with nothing lost. Invented text only.
import { describe, expect, it } from 'vitest'
import {
  itemKey,
  isGone,
  itemsFromText,
  matching,
  mergeItems,
  MOST_CLOTHES,
  namesItem,
  parsePiece,
  parseThing,
  pieceText,
  singular,
  thingText,
  type StageItem
} from './stageItems'

const piece = (name: string, state: string): StageItem => ({ name, state })

describe('the stage piece by piece', () => {
  it('compares names without "the" or "her", and plurals as one', () => {
    expect(itemKey('Her grey cloak')).toBe('grey cloak')
    expect(itemKey("Tobin's coat")).toBe('tobin coat')
    expect(itemKey('The')).toBe('the')
    expect(['boots', 'dresses', 'glasses', 'dress', 'bus'].map(singular)).toEqual(['boot', 'dress', 'glass', 'dress', 'bus'])
  })

  it('changes one piece at a time: boots off never touches the coat', () => {
    const before = [piece('grey coat', 'on, buttoned to the throat'), piece('boots', 'on')]
    const { items, changed } = mergeItems(before, [piece('her boots', 'off, by the hearth')], true, MOST_CLOTHES)
    expect(items).toEqual([piece('grey coat', 'on, buttoned to the throat'), piece('boots', 'off, by the hearth')])
    expect(changed).toEqual([{ from: 'her boots', to: 'boots' }])
  })

  it('finds a piece by its last word, keeps the fuller name, and never mixes left and right', () => {
    const before = [piece('grey cloak', 'on'), piece('left boot', 'on'), piece('right boot', 'on')]
    expect(matching(before, 'cloak', true)).toEqual([0])
    expect(matching(before, 'left boot', true)).toEqual([1])
    expect(matching(before, 'right boots', true)).toEqual([2])
    // A bare word is about every piece that has it; a plain pair kept never takes a left boot's change.
    expect(matching(before, 'boots', true)).toEqual([1, 2])
    expect(matching([piece('boots', 'on')], 'left boot', true)).toEqual([])
    // Things: two doors and "the door" is neither, so it is a new one rather than a guess.
    expect(matching([piece('the front door', 'locked'), piece('the back door', 'open')], 'the door', false)).toEqual([])
    const both = mergeItems(before, [piece('cloak', 'off, over the chair'), piece('boots', 'off')], true, MOST_CLOTHES).items
    expect(both).toEqual([piece('grey cloak', 'off, over the chair'), piece('boots', 'off')])
  })

  it('keeps both when someone changes into another of the same kind', () => {
    expect(matching([piece('grey dress', 'on')], 'blue dress', true)).toEqual([])
    const changed = mergeItems(
      [piece('grey dress', 'on')],
      [piece('grey dress', 'off, on the floor'), piece('blue dress', 'on')],
      true,
      MOST_CLOTHES
    )
    expect(changed.items).toEqual([piece('grey dress', 'off, on the floor'), piece('blue dress', 'on')])
    expect(changed.changed).toEqual([
      { from: 'grey dress', to: 'grey dress' },
      { from: 'blue dress', to: 'blue dress' }
    ])
  })

  it('takes a piece or thing off the list when it is gone, and adds new ones at the end', () => {
    const things = [piece('the door', 'barred from inside'), piece('the survey case', 'on the windowsill')]
    const picked = mergeItems(things, [piece('the case', 'gone'), piece('the lamp', 'lit')], false, 12).items
    expect(picked).toEqual([piece('the door', 'barred from inside'), piece('the lamp', 'lit')])
    const unbarred = mergeItems(picked, [piece('the door', 'unbarred and open')], false, 12).items
    // A change moves it to the end: the list runs from longest unchanged to latest.
    expect(unbarred).toEqual([piece('the lamp', 'lit'), piece('the door', 'unbarred and open')])
  })

  it('keeps at most so many, letting go of those changed longest ago', () => {
    const many = Array.from({ length: 12 }, (_, i) => piece(`thing ${i + 1}`, 'here'))
    const { items } = mergeItems(many, [piece('thing 1', 'moved'), piece('the lamp', 'lit')], false, 12)
    expect(items).toHaveLength(12)
    expect(items.map((x) => x.name)).toContain('thing 1')
    expect(items.map((x) => x.name)).not.toContain('thing 2')
    expect(items.at(-1)).toEqual(piece('the lamp', 'lit'))
  })

  it('a thing changed a step ago outlasts things never changed since (round G: the case dropped at step 7)', () => {
    // Step 1: the satchel first, then ten pebbles on the shelf, never touched again.
    const start = [piece('the satchel', 'on his back'), ...Array.from({ length: 10 }, (_, i) => piece(`pebble ${i + 1}`, 'on the shelf'))]
    // Step 2: the satchel is set down, and changed again at step 3.
    const two = mergeItems(start, [piece('the satchel', 'on the bench')], false, 12).items
    expect(two.at(-1)).toEqual(piece('the satchel', 'on the bench'))
    const three = mergeItems(two, [piece('the satchel', 'open on the bench'), piece('the candle', 'lit')], false, 12).items
    // Step 4: three new things push the list past 12: the three oldest pebbles go, never the satchel.
    const four = mergeItems(three, [piece('the jug', 'full'), piece('the cup', 'empty'), piece('the poker', 'in the fire')], false, 12).items
    expect(four).toHaveLength(12)
    expect(four.map((x) => x.name)).toContain('the satchel')
    expect(four.map((x) => x.name)).not.toContain('pebble 3')
    expect(four.map((x) => x.name)).toContain('pebble 4')
    // Unchanged ones keep their order (no change: nothing moves).
    expect(mergeItems(start, [], false, 12).items).toEqual(start)
  })

  it('a bare "the door" given with a new "the stable door" in one reply is another door (round G, K1-2)', () => {
    const before = [piece('the lamp', 'lit')]
    const one = mergeItems(before, [piece('the stable door', 'dragged open'), piece('the door', 'barred and locked')], false, 12)
    expect(one.items).toEqual([piece('the lamp', 'lit'), piece('the stable door', 'dragged open'), piece('the door', 'barred and locked')])
    // The other way round too.
    const two = mergeItems(before, [piece('the door', 'barred and locked'), piece('the stable door', 'dragged open')], false, 12).items
    expect(two.map((x) => x.name)).toEqual(['the lamp', 'the door', 'the stable door'])
    // One already kept, or the same name again in one reply: still found, as before.
    expect(mergeItems([piece('the stable door', 'shut')], [piece('the door', 'dragged open')], false, 12).items).toEqual([piece('the stable door', 'dragged open')])
    const again = mergeItems(before, [piece('the stable door', 'dragged open'), piece('the stable door', 'shut again')], false, 12).items
    expect(again).toEqual([piece('the lamp', 'lit'), piece('the stable door', 'shut again')])
    // matching itself: one set apart is found only by its own name.
    const made = piece('the stable door', 'dragged open')
    expect(matching([made], 'the door', false, new Set([made]))).toEqual([])
    expect(matching([made], 'the stable door', false, new Set([made]))).toEqual([0])
  })

  it('reads an old one-line "wearing" as pieces, with nothing lost', () => {
    const old =
      'a white shirt unbuttoned to the waist, sleeves rolled up; dark trousers, boots off (by the door, wet), a silver ring and a cloak, over the chair'
    const items = itemsFromText(old)
    expect(items).toEqual([
      piece('a white shirt unbuttoned to the waist, sleeves rolled up', ''),
      piece('dark trousers', ''),
      piece('boots', 'off (by the door, wet)'),
      piece('a silver ring and a cloak, over the chair', '')
    ])
    // Read back, every word is there.
    expect(items.map(pieceText).join(', ')).toBe(old.replace(';', ','))
    // "On" only says it is worn when nothing follows it: boots on the floor are where they are.
    expect(itemsFromText('boots on, laced; hat on the peg; and gloves')).toEqual([
      piece('boots', 'on, laced'),
      piece('hat on the peg', ''),
      piece('gloves', '')
    ])
    // A change finds the old piece by its own word, and takes it over, moved to the end (the latest changed last).
    const merged = mergeItems(items, [piece('boots', 'on, laced'), piece('shirt', 'on, buttoned')], true, MOST_CLOTHES).items
    expect(merged.map(pieceText)).toEqual([
      'dark trousers',
      'a silver ring and a cloak, over the chair',
      'boots on, laced',
      'shirt on, buttoned'
    ])
    expect(itemsFromText('')).toEqual([])
  })

  it('reads a piece or a thing as Adam writes it', () => {
    expect(parsePiece('boots off, by the door')).toEqual(piece('boots', 'off, by the door'))
    expect(parsePiece('shirt: torn at the shoulder')).toEqual(piece('shirt', 'torn at the shoulder'))
    expect(parsePiece('  dark trousers ')).toEqual(piece('dark trousers', ''))
    expect(parsePiece(' ')).toBeNull()
    expect(parseThing('the lamp: lit')).toEqual(piece('the lamp', 'lit'))
    expect(parseThing('the lamp')).toEqual(piece('the lamp', ''))
    expect(parseThing('')).toBeNull()
  })

  it('reads each as words, and knows when some words name it', () => {
    expect(pieceText(piece('boots', 'off, by the door'))).toBe('boots off, by the door')
    expect(pieceText(piece('shirt', 'torn at the shoulder'))).toBe('shirt: torn at the shoulder')
    expect(thingText(piece('the door', 'barred from inside'))).toBe('the door: barred from inside')
    expect(namesItem('She reached for the cases.', piece('the survey case', 'on the windowsill'))).toBe(true)
    expect(namesItem('She pulled her boot on.', piece('boots', 'off'))).toBe(true)
    expect(namesItem('cloak and dagger', piece('cloak off (over the beam)', ''))).toBe(true)
    expect(namesItem('a door', piece('the case', 'here'))).toBe(false)
  })

  it('a piece "removed" or "no longer worn" is off, not gone; only "gone" takes it off the list (review, 2026-10-07)', () => {
    expect(isGone('removed, by the door', true)).toBe(false)
    expect(isGone('no longer worn', true)).toBe(false)
    expect(isGone('gone (given to Tobin)', true)).toBe(true)
    expect(isGone('no longer theirs', true)).toBe(true)
    // A thing removed from the place is gone from it.
    expect(isGone('removed', false)).toBe(true)
    const kept = mergeItems([piece('coat', 'on'), piece('boots', 'on')], [piece('boots', 'removed, by the door')], true, MOST_CLOTHES).items
    expect(kept.map((x) => x.name)).toEqual(['coat', 'boots'])
  })

  it('only a bare plural is about every piece that has the word: "boot" is not both boots (review, 2026-10-07)', () => {
    const pair = [piece('left boot', 'on'), piece('right boot', 'on')]
    expect(matching(pair, 'boot', true)).toEqual([])
    expect(matching(pair, 'boots', true)).toEqual([0, 1])
    expect(mergeItems(pair, [piece('boot', 'off')], true, MOST_CLOTHES).items.map((x) => x.name)).toEqual(['left boot', 'right boot', 'boot'])
  })
})
