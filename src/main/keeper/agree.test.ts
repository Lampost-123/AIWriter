import { describe, expect, it } from 'vitest'
import { contradicts, saysTheSame, valueWords } from './agree'

describe('saying the same in other words', () => {
  it('reads comparatives, plurals, numbers and spellings as the same word', () => {
    expect([...valueWords('a redder beard')]).toEqual(['red', 'beard'])
    expect(saysTheSame('red beard', 'a redder beard')).toBe(true)
    expect(saysTheSame('12', 'about twelve')).toBe(true)
    expect(saysTheSame('grey', 'gray')).toBe(true)
    expect(saysTheSame('colourless', 'colorless')).toBe(true)
    expect(saysTheSame('freckles', 'a freckle')).toBe(true)
  })

  it('counts a fuller or a vaguer description as the same', () => {
    expect(saysTheSame('hazel', 'hazel, flecked with gold')).toBe(true)
    expect(saysTheSame('short copper curls under a felt cap', 'short copper')).toBe(true)
    expect(saysTheSame('a green cloak with a hood', 'hooded green cloak')).toBe(false)
  })

  it('tells different values apart', () => {
    expect(saysTheSame('blue', 'green')).toBe(false)
    expect(saysTheSame('red beard', 'a white beard')).toBe(false)
    expect(saysTheSame('34', 'about forty')).toBe(false)
  })
})

describe('a contradiction', () => {
  it('is a different value for a field that holds one value', () => {
    expect(contradicts('eyes', 'blue', 'green')).toBe(true)
    expect(contradicts('age', '12', 'twenty')).toBe(true)
    expect(contradicts('hair', 'red beard', 'a redder beard')).toBe(false)
    expect(contradicts('age', '12', 'about twelve')).toBe(false)
  })

  it('is never just another description in a field that describes', () => {
    expect(contradicts('senses', 'smells of pine resin', 'cold, and quiet as a held breath')).toBe(false)
    expect(contradicts('speech', 'slow and careful', 'speaks in short bursts when angry')).toBe(false)
    expect(contradicts(null, 'a lighthouse keeper', 'mends nets by the harbour')).toBe(false)
  })

  it('is what the memory model reports, unless it only says the same in other words', () => {
    expect(contradicts('speech', 'never raises her voice', 'shouts across the square', true)).toBe(true)
    expect(contradicts('hair', 'red beard', 'a redder beard', true)).toBe(false)
    expect(contradicts('geography', '', 'on an island', true)).toBe(true)
  })

  it('needs words in the scene', () => {
    expect(contradicts('eyes', 'blue', '  ', true)).toBe(false)
  })
})
