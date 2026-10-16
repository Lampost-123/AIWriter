// A profile's typical clothing once a piece of it is gone for good (memory/looks.ts). Invented test text only.
import { describe, expect, it } from 'vitest'
import { clothingAfter, goneForGood, passingLook, withoutPassingLooks } from './looks'

describe('typical clothing, once a piece is gone for good', () => {
  it('reads what is gone for good: lost, thrown away, cut away; a bandage or sling taken off', () => {
    expect(goneForGood('bandage gone; the cut has closed')).toEqual(['bandage'])
    expect(goneForGood('lost his good hat in the millrace')).toEqual(['hat'])
    expect(goneForGood('threw away the torn gloves')).toEqual(['glove'])
    expect(goneForGood('took the sling off and flexed her arm')).toEqual(['sling'])
    expect(goneForGood('the dressing came off at last')).toEqual(['dressing'])
    expect(goneForGood('no longer wears the locket')).toEqual(['locket'])
  })

  it('reads nothing into a thing taken off for a while, kept, or not lost', () => {
    for (const note of [
      'took his hat off to greet her',
      'pulled her boots off by the fire',
      'never removed the bandage',
      "didn't lose the locket after all",
      'lost blood through the bandage',
      'would lose the sling within the week',
      'the bandage gone grey with dust',
      'lost her temper',
      'put on a dry coat'
    ]) {
      expect(goneForGood(note), note).toEqual([])
    }
  })

  it('leaves out only the pieces that name it', () => {
    expect(clothingAfter('oilskin patched at the elbows; bandage round his head; wide hat', 'bandage gone; the cut has closed')).toBe(
      'oilskin patched at the elbows; wide hat'
    )
    expect(clothingAfter('grey shawl, bandages on both hands, clogs', 'the bandages cut away by the healer')).toBe('grey shawl, clogs')
    // Nothing gone, or nothing of it worn: no change.
    expect(clothingAfter('grey shawl, clogs', 'bandage gone')).toBeNull()
    expect(clothingAfter('grey shawl, wide hat', 'took his hat off to greet her')).toBeNull()
    expect(clothingAfter('', 'lost her hat')).toBeNull()
  })
})

describe('clothes off for a while are not what someone typically wears (2026-10-16)', () => {
  it('reads a Typical clothing value that says only that nothing is worn, or only what came off', () => {
    for (const v of [
      'none',
      'nothing',
      'Nothing at all.',
      'naked',
      'nude',
      'naked except for her grey stockings',
      'nothing but the silver locket',
      'nothing (undressed for bed)',
      'none; her dress over the chair',
      'undressed',
      'half-dressed',
      'dress off, stockings off',
      'shirt removed; boots kicked off',
      'barefoot'
    ])
      expect(passingLook('clothing', v), v).toBe(true)
  })

  it('never reads what someone does wear that way', () => {
    for (const v of [
      'a green wool dress, grey stockings, laced boots',
      'bare feet and a ragged smock',
      'a coat with its collar off-white',
      'nothing fancy: a brown jerkin and boots',
      'boots never taken off',
      'linen shirt, brown waistcoat, wool trousers',
      ''
    ])
      expect(passingLook('clothing', v), v).toBe(false)
  })

  it('reads naked in another Looks field, and touches no other field', () => {
    expect(passingLook('skin', 'naked and flushed')).toBe(true)
    expect(passingLook('marks', 'none')).toBe(false)
    expect(passingLook('hair', 'loose')).toBe(false)
    expect(passingLook('goals', 'nothing')).toBe(false)
    expect(withoutPassingLooks({ clothing: 'nothing', hair: 'loose', marks: 'none' })).toEqual({ hair: 'loose', marks: 'none' })
  })
})
