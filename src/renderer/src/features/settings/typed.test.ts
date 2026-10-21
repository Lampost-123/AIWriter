import { describe, expect, it } from 'vitest'
import { parseTemperature } from './typed'

describe('a typed temperature', () => {
  it('reads a number, with a comma too', () => {
    expect(parseTemperature('1.5')).toBe(1.5)
    expect(parseTemperature(' 1,25 ')).toBe(1.25)
    expect(parseTemperature('2')).toBe(2)
  })
  it('is nothing yet while half typed or not a number', () => {
    expect(parseTemperature('')).toBeNull()
    expect(parseTemperature('.')).toBeNull()
    expect(parseTemperature('abc')).toBeNull()
  })
})
