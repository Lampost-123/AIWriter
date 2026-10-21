import { describe, expect, it } from 'vitest'
import { sliderFill } from './Slider'

describe('the slider', () => {
  it('fills the track up to the value', () => {
    expect(sliderFill(55, 55, 90)).toBe(0)
    expect(sliderFill(90, 55, 90)).toBe(100)
    expect(sliderFill(1, 0, 2)).toBe(50)
  })
  it('stays on the track', () => {
    expect(sliderFill(-1, 0, 2)).toBe(0)
    expect(sliderFill(3, 0, 2)).toBe(100)
    expect(sliderFill(1, 2, 2)).toBe(0)
    expect(sliderFill(Number.NaN, 0, 2)).toBe(0)
  })
})
