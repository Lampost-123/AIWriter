import { describe, expect, it } from 'vitest'
import { stepAfter, stepBefore, TOUR_STEPS } from './tourSteps'

describe('the guided tour', () => {
  it('moves forward and ends after the last step', () => {
    expect(stepAfter(0)).toBe(1)
    expect(stepAfter(TOUR_STEPS.length - 2)).toBe(TOUR_STEPS.length - 1)
    expect(stepAfter(TOUR_STEPS.length - 1)).toBeNull()
  })

  it('never goes before the first step', () => {
    expect(stepBefore(0)).toBe(0)
    expect(stepBefore(3)).toBe(2)
  })

  it('has a title and words for every step, and points only at things the desk has', () => {
    for (const step of TOUR_STEPS) {
      expect(step.title.length).toBeGreaterThan(0)
      expect(step.body.length).toBeGreaterThan(20)
    }
    expect(TOUR_STEPS[0].target).toBeUndefined()
  })
})
