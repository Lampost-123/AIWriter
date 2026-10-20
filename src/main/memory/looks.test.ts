// A profile's typical clothing once a piece of it is gone for good (memory/looks.ts). Invented test text only.
import { describe, expect, it } from 'vitest'
import { clothingAfter, goneForGood, passingLook, usualLook, withoutPassingLooks } from './looks'

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

describe('typical clothing, never what is worn for the moment (live test, 2026-10-16)', () => {
  it('leaves out pieces worn just then, unless they say it is usual', () => {
    expect(
      usualLook('clothing', 'grey wool dress, laced boots, coat buttoned to the chin, the red wool scarf up round her jaw, her grandmother’s brass key on a cord round her neck')
    ).toBe('grey wool dress, laced boots, her grandmother’s brass key on a cord round her neck')
    expect(usualLook('clothing', 'oilskin soaked through; boots caked with mud; a blue knitted cap')).toBe('a blue knitted cap')
    expect(usualLook('clothing', 'coat always buttoned to the chin, black gloves')).toBe('coat always buttoned to the chin, black gloves')
    // Only the moment: nothing kept.
    expect(usualLook('clothing', 'coat buttoned to the chin, scarf pulled up against the cold')).toBe('')
    expect(passingLook('clothing', 'coat buttoned to the chin')).toBe(true)
    // Other fields, and plain clothes, as they are.
    expect(usualLook('clothing', 'a green wool dress, laced boots')).toBe('a green wool dress, laced boots')
    expect(usualLook('hair', 'wet from the rain')).toBe('wet from the rain')
  })
})

describe('typical clothing the story sets from now on (memory review, 2026-10-20)', () => {
  it('keeps what someone wears from now on, though it is said as "nothing but"', () => {
    // Told in Ch 3, Sc 2 to wear only a green jumper: the change's note says it lasts.
    expect(usualLook('clothing', 'nothing but the green jumper', 'told to wear only the green jumper from now on')).toBe('the green jumper')
    // The words that it lasts say when, not what is worn: kept without them.
    expect(usualLook('clothing', 'none but the green jumper, from now on')).toBe('the green jumper')
    expect(usualLook('clothing', 'only the green jumper (from now on)')).toBe('only the green jumper')
    expect(passingLook('clothing', 'nothing but the green jumper, from now on')).toBe(false)
    expect(passingLook('clothing', 'only ever the green jumper')).toBe(false)
    // Undressed for now stays undressed for now: no lasting words.
    expect(usualLook('clothing', 'nothing but the silver locket')).toBe('')
    expect(usualLook('clothing', 'nothing but the silver locket', 'undressed for bed')).toBe('')
    // "Always" or "ever" in a love scene's note is no rule (review, 2026-10-20).
    expect(usualLook('clothing', 'nothing but her stockings', 'undressed for him for the first time ever')).toBe('')
    expect(usualLook('clothing', 'nothing but his shirt', 'always wanted this')).toBe('')
    expect(usualLook('clothing', 'nothing but stockings, more naked than ever')).toBe('')
  })

  it('never reads bare-headed, or a borrowed piece, as undressed for now; bare-chested is for now', () => {
    expect(passingLook('clothing', 'bare-headed, green jumper')).toBe(false)
    expect(usualLook('clothing', 'bare-headed, green jumper')).toBe('green jumper')
    for (const v of ['bare-chested', 'bare-legged', 'stripped to the waist', 'stripped-to-the-waist', 'bare-chested, jeans unbuttoned'])
      expect(usualLook('clothing', v), v).toBe('')
    // A usual piece described so stays (review round 2).
    expect(usualLook('clothing', 'a bare-shouldered silk gown, silver locket')).toBe('a bare-shouldered silk gown, silver locket')
  })

  it('reads "for good" as lasting only where it ends a clause: never "for good luck"', () => {
    expect(usualLook('clothing', 'red ribbon in her hair for good luck, grey dress')).toBe('red ribbon in her hair for good luck, grey dress')
    expect(usualLook('clothing', 'light linen dress for good weather')).toBe('light linen dress for good weather')
    expect(usualLook('clothing', 'nothing but a sheet for good measure')).toBe('')
    expect(usualLook('clothing', 'nothing but the grey habit, for good')).toBe('the grey habit')
    expect(usualLook('clothing', 'the borrowed green jumper')).toBe('the borrowed green jumper')
    expect(usualLook('clothing', 'grey shawl, a jumper she was lent')).toBe('grey shawl, a jumper she was lent')
    // Still undressed: "bare" said alone, and "bare - and shivering".
    expect(passingLook('clothing', 'bare')).toBe(true)
    expect(passingLook('clothing', 'bare - shivering by the fire')).toBe(true)
  })
})
