import { beforeEach, describe, expect, it } from 'vitest'
import { dockIdle, setDockKind, setReceiptShown, useFoot } from './foot'

describe('the foot of the desk takes turns', () => {
  beforeEach(() => useFoot.setState({ receipt: null, dock: {} }))

  it('knows which scene shows its receipt, and only that scene can take it away', () => {
    setReceiptShown('a', true)
    expect(useFoot.getState().receipt).toBe('a')
    // Another scene's receipt going (its page closing) leaves this one's.
    setReceiptShown('b', false)
    expect(useFoot.getState().receipt).toBe('a')
    setReceiptShown('a', false)
    expect(useFoot.getState().receipt).toBeNull()
  })

  it('reads the dock as idle until it says otherwise, scene by scene', () => {
    expect(dockIdle(useFoot.getState(), 'a')).toBe(true)
    setDockKind('a', 'busy')
    expect(dockIdle(useFoot.getState(), 'a')).toBe(false)
    expect(dockIdle(useFoot.getState(), 'b')).toBe(true)
    setDockKind('a', 'review')
    expect(dockIdle(useFoot.getState(), 'a')).toBe(false)
    setDockKind('a', 'idle')
    expect(dockIdle(useFoot.getState(), 'a')).toBe(true)
  })

  it('leaves the store as it is when nothing changes', () => {
    setDockKind('a', 'busy')
    const before = useFoot.getState().dock
    setDockKind('a', 'busy')
    expect(useFoot.getState().dock).toBe(before)
  })
})
