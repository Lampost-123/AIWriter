import { describe, expect, it } from 'vitest'
import { reachedMarkAhead } from './markAhead'

const order = new Map([
  ['p1', 0],
  ['p2', 1],
  ['p3', 2]
])

describe('where the reading asks for the next notes', () => {
  it('is reached by a clip in its paragraph that ends past it, or by any clip after that paragraph', () => {
    const at = { pid: 'p2', at: 40 }
    expect(reachedMarkAhead({ pid: 'p1', to: 500 }, at, order)).toBe(false)
    expect(reachedMarkAhead({ pid: 'p2', to: 40 }, at, order)).toBe(false)
    expect(reachedMarkAhead({ pid: 'p2', to: 41 }, at, order)).toBe(true)
    expect(reachedMarkAhead({ pid: 'p3', to: 5 }, at, order)).toBe(true)
  })

  it('counts a place whose paragraph has gone from the page as reached', () => {
    expect(reachedMarkAhead({ pid: 'p1', to: 5 }, { pid: 'gone', at: 0 }, order)).toBe(true)
    // A clip from a paragraph the page doesn't have now never reaches anything.
    expect(reachedMarkAhead({ pid: 'old', to: 5 }, { pid: 'p2', at: 0 }, order)).toBe(false)
  })
})
